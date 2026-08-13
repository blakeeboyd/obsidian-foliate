import { App, Modal, Notice, TFile } from "obsidian";
import { MisplacedFile, DuplicateTaxaName } from "../services/file-operations";
import { ResolveDuplicateModal } from "./resolve-duplicate-modal";
import { UsageOverlap } from "../services/index/stats";

/**
 * Results of "Find misplaced and duplicate taxa files": two related problems, reported
 * together because both are "a taxa file isn't where it should be".
 *
 * - Misplaced: carries a taxon's prefix but doesn't live in that taxon's folder.
 *   Movable, one at a time or all at once. Rows whose target path is already
 *   taken are shown but not movable, since which copy wins is a human decision.
 * - Duplicates: two files sharing a name in different folders. A bare [[Name]]
 *   link can't address either, so these open a side-by-side comparison
 *   (ResolveDuplicateModal) where the user picks the copy to keep. Never
 *   resolved automatically: choosing means reading the content.
 * - Similar usage: two files with DIFFERENT names that the mention index found
 *   in nearly the same notes. This catches what a name comparison structurally
 *   cannot ("@James Lang" and "@James M. Lang", "+Objet Sonore" and "+sound
 *   object", which share no characters), and needs an index to have been built.
 *   Weaker evidence than a name collision, so it is a suggestion: a founder and
 *   their company are inseparable in the data and are not one file.
 */
export interface MisplacedModalOptions {
  items: MisplacedFile[];
  duplicates: DuplicateTaxaName[];
  move: (file: TFile, item: MisplacedFile) => Promise<boolean>;
  rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] };
  similar?: UsageOverlap[];
  taxonOf?: (file: TFile) => DuplicateTaxaName["taxon"];
  merges?: {
    get: () => Record<string, string[]>;
    merge: (keeper: string, other: string) => Promise<void>;
    unmerge: (keeper: string) => Promise<void>;
  };
  /** Open scrolled to this term, for arriving from the sidebar's mark. */
  focusTerm?: string | null;
}

export class MisplacedFilesModal extends Modal {
  private items: MisplacedFile[];
  private duplicates: DuplicateTaxaName[];
  private similar: UsageOverlap[];
  private taxonOf: (file: TFile) => DuplicateTaxaName["taxon"];
  private mergedConcepts: () => Record<string, string[]>;
  private mergeConcepts: (keeper: string, other: string) => Promise<void>;
  private unmergeConcept: (keeper: string) => Promise<void>;
  private move: (file: TFile, item: MisplacedFile) => Promise<boolean>;
  private rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] };

  /** A term to scroll to and flash on open, set when arriving from a sidebar mark. */
  private focusTerm: string | null;

  constructor(app: App, opts: MisplacedModalOptions) {
    super(app);
    this.items = opts.items;
    this.duplicates = opts.duplicates;
    this.similar = opts.similar ?? [];
    this.move = opts.move;
    this.rescan = opts.rescan;
    this.taxonOf =
      opts.taxonOf ?? (() => ({ prefix: "", label: "", folder: "" } as DuplicateTaxaName["taxon"]));
    const merges = opts.merges ?? {
      get: () => ({}),
      merge: async () => {},
      unmerge: async () => {},
    };
    this.mergedConcepts = merges.get;
    this.mergeConcepts = merges.merge;
    this.unmergeConcept = merges.unmerge;
    this.focusTerm = opts.focusTerm ?? null;
  }

  onOpen() {
    this.modalEl.addClass("foliate-misplaced-modal");
    this.render();
    if (this.focusTerm) this.scrollToTerm(this.focusTerm);
  }

  /**
   * Bring the row claiming `term` into view and flash it.
   *
   * Arriving from a sidebar mark, the modal can be long and the relevant pair
   * anywhere in it; landing at the top means hunting for the thing you just
   * clicked. Deferred a frame so the rows exist and have been laid out.
   */
  private scrollToTerm(term: string): void {
    const needle = term.trim().toLowerCase();
    window.requestAnimationFrame(() => {
      const rows = this.contentEl.querySelectorAll<HTMLElement>("[data-terms]");
      for (const row of Array.from(rows)) {
        const terms = (row.dataset.terms ?? "").split("\u0000");
        if (!terms.includes(needle)) continue;
        row.scrollIntoView({ block: "center" });
        row.addClass("foliate-row-flash");
        window.setTimeout(() => row.removeClass("foliate-row-flash"), 1600);
        return;
      }
    });
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Misplaced and duplicate taxa files" });

    if (
      this.items.length === 0 &&
      this.duplicates.length === 0 &&
      this.similar.length === 0
    ) {
      contentEl.createEl("p", {
        text: "Every taxa and domain file is in its taxon's folder, and no two share a name.",
      });
      return;
    }

    this.renderDuplicates(contentEl);
    this.renderSimilar(contentEl);
    if (this.items.length === 0) return;

    const movable = this.items.filter((i) => !i.blocked);

    if (this.duplicates.length > 0) {
      contentEl.createEl("h3", { text: "Wrong folder" });
    }
    contentEl.createEl("p", {
      cls: "foliate-misplaced-summary",
      text:
        `${this.items.length} file${this.items.length === 1 ? "" : "s"} not in the folder configured for ` +
        `${this.items.length === 1 ? "its" : "their"} taxon.`,
    });

    const list = contentEl.createDiv("foliate-misplaced-list");
    for (const item of this.items) {
      const row = list.createDiv("foliate-misplaced-row");
      if (item.blocked) row.addClass("is-blocked");

      const info = row.createDiv("foliate-misplaced-info");
      const nameEl = info.createDiv("foliate-misplaced-name");
      nameEl.setText(item.file.basename);
      nameEl.addEventListener("click", () => {
        this.app.workspace.getLeaf(false).openFile(item.file);
        this.close();
      });
      info.createDiv({
        cls: "foliate-misplaced-path",
        text: `${item.currentFolder} → ${item.targetFolder}`,
      });
      if (item.blocked) {
        info.createDiv({
          cls: "foliate-misplaced-blocked",
          text: `A file named ${item.file.name} is already in ${item.targetFolder}.`,
        });
      }

      if (!item.blocked) {
        const btn = row.createEl("button", { text: "Move" });
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          const ok = await this.move(item.file, item);
          if (ok) {
            const r = this.rescan();

            this.items = r.misplaced;

            this.duplicates = r.duplicates;
            this.render();
          } else {
            btn.disabled = false;
          }
        });
      }
    }

    if (movable.length > 1) {
      const footer = contentEl.createDiv("foliate-misplaced-footer");
      const all = footer.createEl("button", {
        cls: "mod-cta",
        text: `Move all ${movable.length}`,
      });
      all.addEventListener("click", async () => {
        all.disabled = true;
        let moved = 0;
        // Sequential: each move is a rename that Obsidian follows with a link
        // rewrite, and firing them concurrently is what overwhelmed the vault in
        // past bulk renames.
        for (const item of movable) {
          if (await this.move(item.file, item)) moved++;
        }
        new Notice(`Moved ${moved} of ${movable.length} files.`);
        const r = this.rescan();

        this.items = r.misplaced;

        this.duplicates = r.duplicates;
        this.render();
      });
    }
  }

  /**
   * Files sharing a name across folders. Reported first because it is the more
   * damaging problem: a misplaced file still resolves, an ambiguous name does
   * not. "Compare" opens the copies side by side rather than fixing anything
   * directly, since which one survives is a judgment about content.
   */
  private renderDuplicates(contentEl: HTMLElement) {
    if (this.duplicates.length === 0) return;

    contentEl.createEl("h3", { text: "Duplicate files" });
    contentEl.createEl("p", {
      cls: "foliate-misplaced-summary",
      text:
        `${this.duplicates.length} name${this.duplicates.length === 1 ? " is" : "s are"} used by more than one file. ` +
        "Obsidian allows two files to have the same name if they are not in the same folder. " +
        "Press the compare button to choose which file you would like to keep and move to the correct folder.",
    });

    const list = contentEl.createDiv("foliate-misplaced-list");
    for (const dupe of this.duplicates) {
      const row = list.createDiv("foliate-misplaced-row foliate-duplicate-row");
      const info = row.createDiv("foliate-misplaced-info");

      const head = info.createDiv("foliate-misplaced-name");
      head.setText(`${dupe.name} (${dupe.files.length} files)`);

      for (const f of dupe.files) {
        const line = info.createDiv("foliate-misplaced-path foliate-duplicate-path");
        const isCanonical = dupe.canonical?.path === f.path;
        line.setText(isCanonical ? `${f.path}  ·  in the taxon folder` : f.path);
        if (isCanonical) line.addClass("is-canonical");
        line.addEventListener("click", () => {
          this.app.workspace.getLeaf(false).openFile(f);
          this.close();
        });
      }

      const compare = row.createEl("button", { text: "Compare" });
      compare.addEventListener("click", () => {
        new ResolveDuplicateModal(this.app, dupe, () => {
          const r = this.rescan();
          this.items = r.misplaced;
          this.duplicates = r.duplicates;
          this.render();
        }).open();
      });
    }
  }

  /**
   * Pairs the mention index found in nearly the same notes.
   *
   * Separate from the duplicate list above because the evidence differs in
   * kind. A shared name is a fact: two files answer to one link. Similar usage
   * is an observation: these two are mentioned together often enough to look
   * like one concept. That catches renamings a name check cannot see, and it
   * also catches pairs that genuinely belong together and must not be merged,
   * so nothing here is actionable without reading both files.
   */
  private renderSimilar(contentEl: HTMLElement) {
    if (this.similar.length === 0) return;

    contentEl.createEl("h3", { text: "Possibly the same concept" });
    contentEl.createEl("p", {
      cls: "foliate-misplaced-summary",
      text:
        `${this.similar.length} pair${this.similar.length === 1 ? " is" : "s are"} mentioned in nearly the same notes. ` +
        "Pairs that share a name or alias are listed first: those are two files competing for one word, " +
        "and are usually one concept written twice. The rest share no name, and are more often two things " +
        "your notes discuss together than one thing written two ways.",
    });

    const list = contentEl.createDiv("foliate-misplaced-list");
    for (const pair of this.similar) {
      const fileA = this.app.vault.getAbstractFileByPath(pair.a);
      const fileB = this.app.vault.getAbstractFileByPath(pair.b);
      if (!(fileA instanceof TFile) || !(fileB instanceof TFile)) continue;

      const row = list.createDiv("foliate-misplaced-row foliate-duplicate-row");
      // The shared terms are the handle the sidebar's mark arrives on.
      if (pair.sharedTerms.length) {
        row.dataset.terms = pair.sharedTerms.map((t) => t.toLowerCase()).join("\u0000");
      }
      const info = row.createDiv("foliate-misplaced-info");

      info.createDiv("foliate-misplaced-name").setText(
        `${fileA.basename}  ·  ${fileB.basename}`
      );

      // What kind of pair this is, which the overlap number alone cannot say.
      const collision = pair.sharedTerms.length > 0;
      const verdict = info.createDiv("foliate-misplaced-path");
      if (collision) {
        verdict.addClass("is-collision");
        verdict.setText(
          `Both answer to ${pair.sharedTerms.map((t) => `"${t}"`).join(", ")}. ` +
            "Every note using that word matches both files, which is why they travel together. " +
            "Usually one concept written twice."
        );
      } else {
        verdict.setText(
          "No shared name or alias. Two different things the notes discuss together, " +
            "such as co-authors or a pair of related ideas. Rarely one concept."
        );
      }

      info
        .createDiv("foliate-misplaced-path")
        .setText(
          `${Math.round(pair.jaccard * 100)}% overlap: together in ${pair.together} notes, ` +
            `${fileA.basename} in ${pair.dfA}, ${fileB.basename} in ${pair.dfB}`
        );

      for (const f of [fileA, fileB]) {
        const line = info.createDiv("foliate-misplaced-path foliate-duplicate-path");
        line.setText(f.path);
        line.addEventListener("click", () => {
          this.app.workspace.getLeaf(false).openFile(f);
          this.close();
        });
      }

      const actions = row.createDiv("foliate-similar-actions");

      // Two different answers to "these look like one thing", because the
      // question has two different right answers. Merging files is for one
      // concept written twice. Treating them as one concept is for two files
      // that belong apart but always travel together, where splitting the
      // evidence between them is what distorts the scoring.
      const merge = actions.createEl("button", { text: "Treat as one concept" });
      if (!collision) {
        // Offered, not recommended: without a shared term the pair is usually
        // two things that travel together, and merging them would tell the
        // scoring that two distinct ideas are one.
        merge.addClass("is-unlikely");
        merge.setAttribute(
          "aria-label",
          "These share no name or alias, so they are probably not one concept"
        );
      }
      merge.addEventListener("click", async () => {
        await this.mergeConcepts(fileA.path, fileB.path);
        this.similar = this.similar.filter((s) => s !== pair);
        this.render();
      });

      const compare = actions.createEl("button", { text: "Compare" });
      compare.addEventListener("click", () => {
        // Shaped as a DuplicateTaxaName so the existing resolver handles it
        // unchanged. canonical is null on purpose: neither name is more correct
        // than the other, which is the whole thing being decided.
        const asDuplicate: DuplicateTaxaName = {
          name: `${fileA.basename} / ${fileB.basename}`,
          taxon: this.taxonOf(fileA),
          files: [fileA, fileB],
          canonical: null,
        };
        new ResolveDuplicateModal(this.app, asDuplicate, () => {
          const r = this.rescan();
          this.items = r.misplaced;
          this.duplicates = r.duplicates;
          this.similar = this.similar.filter((s) => s !== pair);
          this.render();
        }).open();
      });
    }

    this.renderMerged(contentEl);
  }

  /**
   * Concepts the user has already confirmed are one, with a way back out.
   *
   * Listed because a merge changes what the plugin believes about the vault
   * while changing nothing visible in it. A decision with invisible effects has
   * to be inspectable, or it becomes a thing nobody remembers making.
   */
  private renderMerged(contentEl: HTMLElement) {
    const merged = Object.entries(this.mergedConcepts());
    if (merged.length === 0) return;

    contentEl.createEl("h3", { text: "Treated as one concept" });
    contentEl.createEl("p", {
      cls: "foliate-misplaced-summary",
      text:
        "Scoring counts these as a single concept. The files are untouched: nothing was renamed, moved, or linked differently.",
    });

    const list = contentEl.createDiv("foliate-misplaced-list");
    for (const [keeper, others] of merged) {
      const row = list.createDiv("foliate-misplaced-row");
      const info = row.createDiv("foliate-misplaced-info");
      info.createDiv("foliate-misplaced-name").setText(
        [keeper, ...others].map((p) => baseName(p)).join("  ·  ")
      );
      const undo = row.createEl("button", { text: "Separate" });
      undo.addEventListener("click", async () => {
        await this.unmergeConcept(keeper);
        this.render();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** File name without folder or extension, for display. */
function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
