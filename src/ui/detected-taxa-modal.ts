import { App, Modal, Notice } from "obsidian";
import { DetectedTaxon } from "../services/detect-taxa";
import { TaxaMapping } from "../types";

/**
 * Confirm prefix conventions found in the vault before adding them as taxa.
 *
 * Detection is a suggestion, never an action: adding a taxon changes what the
 * sidebar scans and what auto-move relocates, so nothing is added without being
 * ticked. Each row carries the prefix, how many files use it, the folder those
 * files share, and an editable label, since the scan can see the convention but
 * not what the user calls it.
 */
export class DetectedTaxaModal extends Modal {
  private detected: DetectedTaxon[];
  private onAdd: (mappings: TaxaMapping[]) => Promise<void>;
  private chosen: Map<string, { label: string; folder: string; on: boolean }>;

  constructor(
    app: App,
    detected: DetectedTaxon[],
    onAdd: (mappings: TaxaMapping[]) => Promise<void>
  ) {
    super(app);
    this.detected = detected;
    this.onAdd = onAdd;
    this.chosen = new Map(
      detected.map((d) => [d.prefix, { label: "", folder: d.folder, on: true }])
    );
  }

  onOpen() {
    this.modalEl.addClass("foliate-detected-modal");
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Prefixes found in your vault" });

    if (this.detected.length === 0) {
      contentEl.createEl("p", {
        text: "No unconfigured prefix is used by enough files to look like a convention.",
      });
      return;
    }

    contentEl.createEl("p", {
      cls: "foliate-detected-intro",
      text:
        "These characters start enough file names to look deliberate. Adding one makes Foliate scan for its files and move new ones into the folder below.",
    });

    const list = contentEl.createDiv("foliate-detected-list");
    for (const d of this.detected) {
      const row = list.createDiv("foliate-detected-row");
      const state = this.chosen.get(d.prefix)!;

      const check = row.createEl("input", { type: "checkbox" });
      check.checked = state.on;
      check.addEventListener("change", () => {
        state.on = check.checked;
      });

      const info = row.createDiv("foliate-detected-info");
      const head = info.createDiv("foliate-detected-head");
      head.createSpan({ cls: "foliate-detected-prefix", text: d.prefix });
      head.createSpan({
        cls: "foliate-detected-count",
        text: `${d.fileCount} file${d.fileCount === 1 ? "" : "s"}`,
      });

      info.createDiv({
        cls: "foliate-detected-examples",
        text: d.examples.join(", "),
      });

      const fields = info.createDiv("foliate-detected-fields");
      const labelInput = fields.createEl("input", {
        type: "text",
        placeholder: "Label, for example People",
      });
      labelInput.addEventListener("input", () => {
        state.label = labelInput.value;
      });

      const folderInput = fields.createEl("input", {
        type: "text",
        placeholder: "Folder",
        value: d.folder,
      });
      folderInput.addEventListener("input", () => {
        state.folder = folderInput.value;
      });
    }

    const footer = contentEl.createDiv("foliate-detected-footer");
    footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const add = footer.createEl("button", { cls: "mod-cta", text: "Add selected" });
    add.addEventListener("click", async () => {
      const mappings: TaxaMapping[] = [];
      for (const d of this.detected) {
        const state = this.chosen.get(d.prefix)!;
        if (!state.on) continue;
        mappings.push({
          prefix: d.prefix,
          // A prefix with no label given is still worth adding; name it after
          // the symbol so the row is identifiable in settings.
          label: state.label.trim() || `Taxon ${d.prefix}`,
          folder: state.folder.trim(),
        });
      }
      if (mappings.length === 0) {
        new Notice("Nothing selected.");
        return;
      }
      add.disabled = true;
      await this.onAdd(mappings);
      new Notice(`Added ${mappings.length} taxa.`);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
