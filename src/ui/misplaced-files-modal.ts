import { App, Modal, Notice, TFile } from "obsidian";
import { MisplacedFile, DuplicateTaxaName } from "../services/file-operations";
import { ResolveDuplicateModal } from "./resolve-duplicate-modal";

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
 */
export class MisplacedFilesModal extends Modal {
  private items: MisplacedFile[];
  private duplicates: DuplicateTaxaName[];
  private move: (file: TFile, item: MisplacedFile) => Promise<boolean>;
  private rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] };

  constructor(
    app: App,
    items: MisplacedFile[],
    duplicates: DuplicateTaxaName[],
    move: (file: TFile, item: MisplacedFile) => Promise<boolean>,
    rescan: () => { misplaced: MisplacedFile[]; duplicates: DuplicateTaxaName[] }
  ) {
    super(app);
    this.items = items;
    this.duplicates = duplicates;
    this.move = move;
    this.rescan = rescan;
  }

  onOpen() {
    this.modalEl.addClass("foliate-misplaced-modal");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Misplaced and duplicate taxa files" });

    if (this.items.length === 0 && this.duplicates.length === 0) {
      contentEl.createEl("p", {
        text: "Every taxa and domain file is in its taxon's folder, and no two share a name.",
      });
      return;
    }

    this.renderDuplicates(contentEl);
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
   * not. "Resolve" opens a comparison rather than fixing anything directly,
   * since which copy survives is a judgment about content.
   */
  private renderDuplicates(contentEl: HTMLElement) {
    if (this.duplicates.length === 0) return;

    contentEl.createEl("h3", { text: "Duplicate files" });
    contentEl.createEl("p", {
      cls: "foliate-misplaced-summary",
      text:
        `${this.duplicates.length} name${this.duplicates.length === 1 ? " is" : "s are"} used by more than one file. ` +
        "Obsidian allows two files to have the same name if they are not in the same folder. " +
        "Press the resolve button to choose which file you would like to keep and move to the correct folder.",
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

      const resolve = row.createEl("button", { text: "Resolve" });
      resolve.addEventListener("click", () => {
        new ResolveDuplicateModal(this.app, dupe, () => {
          const r = this.rescan();
          this.items = r.misplaced;
          this.duplicates = r.duplicates;
          this.render();
        }).open();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
