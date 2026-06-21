import { App, Modal, TFile } from "obsidian";
import { TaxaMapping } from "../types";

interface TaxaLink {
  displayName: string;
  filePath: string;
}

export class TaxaSummaryModal extends Modal {
  private mappings: TaxaMapping[];
  private file: TFile;

  constructor(app: App, mappings: TaxaMapping[], file: TFile) {
    super(app);
    this.mappings = mappings;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("enfoliate-taxa-summary");
    contentEl.createEl("h2", { text: `Taxa in ${this.file.basename}` });

    const cache = this.app.metadataCache.getFileCache(this.file);
    const links = cache?.links || [];

    // Group links by taxon
    const grouped = new Map<TaxaMapping, TaxaLink[]>();
    for (const mapping of this.mappings) {
      grouped.set(mapping, []);
    }

    for (const link of links) {
      for (const mapping of this.mappings) {
        if (link.link.startsWith(mapping.prefix)) {
          const existing = grouped.get(mapping)!;
          // Avoid duplicates
          if (!existing.some((e) => e.filePath === link.link)) {
            existing.push({
              displayName: link.displayText || link.link,
              filePath: link.link,
            });
          }
          break;
        }
      }
    }

    let hasAny = false;
    for (const [mapping, taxaLinks] of grouped) {
      if (taxaLinks.length === 0) continue;
      hasAny = true;

      const section = contentEl.createDiv("enfoliate-summary-section");
      section.createEl("h4", {
        text: `${mapping.prefix} ${mapping.label} (${taxaLinks.length})`,
      });

      const list = section.createEl("ul");
      for (const taxaLink of taxaLinks) {
        const li = list.createEl("li");
        const a = li.createEl("a", {
          text: taxaLink.displayName,
          cls: "enfoliate-summary-link",
        });
        a.addEventListener("click", (e) => {
          e.preventDefault();
          this.close();
          this.app.workspace.openLinkText(taxaLink.filePath, this.file.path);
        });
      }
    }

    if (!hasAny) {
      contentEl.createEl("p", {
        text: "No taxa links in this note.",
        cls: "enfoliate-empty-state",
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
