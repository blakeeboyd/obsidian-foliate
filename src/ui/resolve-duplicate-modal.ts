import { App, Modal, Notice, TFile } from "obsidian";
import { DuplicateTaxaName } from "../services/file-operations";

/** What the user needs to see to choose safely between two same-named files. */
interface Candidate {
  file: TFile;
  content: string;
  backlinks: number;
  /** Sits in its taxon's configured folder. */
  inTaxonFolder: boolean;
}

/**
 * Resolve one duplicated taxa name: show every file carrying it side by side,
 * labelled by location, and let the user keep one. The others go to trash and
 * the keeper is moved into the taxon folder if it isn't already.
 *
 * Deliberately informative rather than automatic. Deleting a note can destroy
 * content the other copy doesn't have, and because both files answer to the same
 * name, some links may currently resolve to the copy being discarded. So each
 * candidate shows its content and its backlink count, and the discard uses the
 * vault trash (recoverable) rather than a hard delete.
 */
export class ResolveDuplicateModal extends Modal {
  private dupe: DuplicateTaxaName;
  private onResolved: () => void;
  private candidates: Candidate[] = [];

  constructor(app: App, dupe: DuplicateTaxaName, onResolved: () => void) {
    super(app);
    this.dupe = dupe;
    this.onResolved = onResolved;
  }

  async onOpen() {
    this.modalEl.addClass("foliate-resolve-modal");
    this.contentEl.createEl("p", { text: "Reading files…" });
    this.candidates = await this.loadCandidates();
    this.render();
  }

  private async loadCandidates(): Promise<Candidate[]> {
    const folder = this.dupe.taxon.folder?.trim();
    const resolved = this.app.metadataCache.resolvedLinks;

    return Promise.all(
      this.dupe.files.map(async (file) => {
        // Count notes linking to this exact path. With two same-named files this
        // is the number that matters: it says which copy the vault actually uses.
        let backlinks = 0;
        for (const links of Object.values(resolved)) {
          if (file.path in links) backlinks++;
        }
        return {
          file,
          content: await this.app.vault.cachedRead(file),
          backlinks,
          inTaxonFolder: !!folder && file.parent?.path === folder,
        };
      })
    );
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: `Resolve "${this.dupe.name}"` });
    contentEl.createEl("p", {
      cls: "foliate-resolve-intro",
      text:
        `${this.candidates.length} files share this name, so a [[${this.dupe.name}]] link can't say which one it means. ` +
        "Pick the one to keep. The others go to your vault trash, and the keeper moves into the taxon folder if it isn't there already.",
    });

    const grid = contentEl.createDiv("foliate-resolve-grid");
    for (const c of this.candidates) {
      const card = grid.createDiv("foliate-resolve-card");

      const head = card.createDiv("foliate-resolve-head");
      const loc = head.createDiv("foliate-resolve-location");
      loc.setText(c.file.parent?.path ?? "/");
      if (c.inTaxonFolder) {
        head.createSpan({ cls: "foliate-resolve-badge", text: "taxon folder" });
      }

      const stats = card.createDiv("foliate-resolve-stats");
      stats.createSpan({
        text: `${c.backlinks} link${c.backlinks === 1 ? "" : "s"} to this copy`,
      });
      stats.createSpan({ text: `${c.content.length.toLocaleString()} chars` });

      // The content is the decision: a stub versus a real note is obvious on
      // sight, and no heuristic beats the user reading it.
      const body = card.createEl("pre", { cls: "foliate-resolve-body" });
      body.setText(c.content.trim() || "(empty file)");

      const actions = card.createDiv("foliate-resolve-actions");
      const open = actions.createEl("button", { text: "Open" });
      open.addEventListener("click", () => {
        this.app.workspace.getLeaf(false).openFile(c.file);
        this.close();
      });

      const keep = actions.createEl("button", { cls: "mod-cta", text: "Keep this one" });
      keep.addEventListener("click", () => void this.resolve(c));
    }
  }

  /**
   * Keep one file: trash the rest, then move the keeper into the taxon folder.
   *
   * Order matters. Trashing the losers first frees the target path, so a keeper
   * that has to move into the folder won't collide with a copy already sitting
   * there.
   */
  private async resolve(keeper: Candidate) {
    const losers = this.candidates.filter((c) => c.file.path !== keeper.file.path);
    const warning =
      losers.filter((l) => l.backlinks > 0).length > 0
        ? " Some links currently point at a copy being trashed; they will need repointing."
        : "";

    let trashed = 0;
    for (const l of losers) {
      try {
        await this.app.fileManager.trashFile(l.file);
        trashed++;
      } catch (e) {
        new Notice(`Could not trash ${l.file.path}: ${e}`);
      }
    }

    const folder = this.dupe.taxon.folder?.trim();
    let moved = false;
    if (folder && keeper.file.parent?.path !== folder) {
      const target = `${folder}/${keeper.file.name}`;
      if (this.app.vault.getAbstractFileByPath(target)) {
        new Notice(`Kept ${keeper.file.basename}, but ${target} is still occupied.`);
      } else {
        try {
          await this.app.fileManager.renameFile(keeper.file, target);
          moved = true;
        } catch (e) {
          new Notice(`Kept the file, but moving it failed: ${e}`);
        }
      }
    }

    new Notice(
      `Kept ${keeper.file.basename}. Trashed ${trashed} ${trashed === 1 ? "copy" : "copies"}` +
        (moved ? `, moved into ${folder}/` : "") +
        "." +
        warning
    );
    this.close();
    this.onResolved();
  }

  onClose() {
    this.contentEl.empty();
  }
}
