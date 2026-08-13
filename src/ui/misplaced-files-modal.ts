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
export class MisplacedFilesModal extends Modal {
  private items: MisplacedFile[];
  private duplicates: DuplicateTaxaName[];
  private similar: UsageOverlap[];
  private taxonOf: (file: TFile) => DuplicateTaxaName["taxon"];
  private move: (file: TFile, item: MisplacedFile) => Promise<boolean>;
  private rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] };

  constructor(
    app: App,
    items: MisplacedFile[],
    duplicates: DuplicateTaxaName[],
    move: (file: TFile, item: MisplacedFile) => Promise<boolean>,
    rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] },
    similar: UsageOverlap[] = [],
    taxonOf: (file: TFile) => DuplicateTaxaName["taxon"] = () =>
      ({ prefix: "", label: "", folder: "" } as DuplicateTaxaName["taxon"])
  ) {
    super(app);
    this.items = items;
    this.duplicates = duplicates;
    this.similar = similar;
    this.move = move;
    this.rescan = rescan;
    this.taxonOf = taxonOf;
  }

  onOpen() {
    this.modalEl.addClass("foliate-misplaced-modal");
    this.render();
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
        `${this.similar.length} pair${this.similar.length === 1 ? " is" : "s are"} mentioned in nearly the same notes, ` +
        "which can mean one concept written two ways. It can also mean two things that genuinely travel together, " +
        "so read both before deciding. Compare opens the same side-by-side view as a duplicate name.",
    });

    const list = contentEl.createDiv("foliate-misplaced-list");
    for (const pair of this.similar) {
      const fileA = this.app.vault.getAbstractFileByPath(pair.a);
      const fileB = this.app.vault.getAbstractFileByPath(pair.b);
      if (!(fileA instanceof TFile) || !(fileB instanceof TFile)) continue;

      const row = list.createDiv("foliate-misplaced-row foliate-duplicate-row");
      const info = row.createDiv("foliate-misplaced-info");

      info.createDiv("foliate-misplaced-name").setText(
        `${fileA.basename}  ·  ${fileB.basename}`
      );

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

      const compare = row.createEl("button", { text: "Compare" });
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
  }

  onClose() {
    this.contentEl.empty();
  }
}
