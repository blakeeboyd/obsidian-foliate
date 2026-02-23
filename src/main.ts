import { Notice, Plugin, TAbstractFile, TFile, MarkdownView } from "obsidian";
import { PortfolioSettings } from "./types";
import { DEFAULT_TAXA_MAPPINGS, findTaxonByPrefix } from "./taxa";
import { PortfolioSettingTab } from "./settings";
import {
  createTaxaLink,
  ensureFolderExists,
} from "./services/file-operations";
import { TaxaPickerModal } from "./ui/taxa-picker-modal";
import { TaxaSuggest } from "./ui/taxa-suggest";
import {
  SuggestionsView,
  SUGGESTIONS_VIEW_TYPE,
} from "./ui/suggestions-view";

const DEFAULT_SETTINGS: PortfolioSettings = {
  taxaMappings: DEFAULT_TAXA_MAPPINGS,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2:3b",
  autoMoveEnabled: true,
  createFolderIfMissing: true,
  sidebarOpen: false,
  statusBarEnabled: true,
  aiEnabled: true,
  autoAnalyze: true,
  blocklist: [],
  highlightOnJump: true,
  highlightColor: "",
};

export default class PortfolioPlugin extends Plugin {
  settings: PortfolioSettings = DEFAULT_SETTINGS;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new PortfolioSettingTab(this.app, this));
    this.registerCommands();
    this.registerAutoMover();
    this.registerEditorSuggest(new TaxaSuggest(this.app, this.settings));
    this.registerView(
      SUGGESTIONS_VIEW_TYPE,
      (leaf) => new SuggestionsView(leaf, this)
    );
    if (this.settings.statusBarEnabled) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("portfolio-status-bar");
      this.statusBarEl.addClass("mod-clickable");
      this.statusBarEl.addEventListener("click", () => {
        this.activateSuggestionsView();
      });
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          this.updateStatusBar();
        })
      );
    }
    this.app.workspace.onLayoutReady(() => {
      this.updateStatusBar();
      if (this.settings.sidebarOpen) {
        this.activateSuggestionsView();
      }
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(SUGGESTIONS_VIEW_TYPE);
  }

  private registerCommands() {
    this.addCommand({
      id: "portfolio-create-taxa-link",
      name: "Create taxa link",
      editorCallback: (editor, view) => {
        const selection = editor.getSelection();
        if (!selection || selection.trim().length === 0) {
          new Notice("Select text first.");
          return;
        }

        const trimmed = selection.trim();
        const detectedTaxon = findTaxonByPrefix(
          trimmed,
          this.settings.taxaMappings
        );

        if (detectedTaxon) {
          createTaxaLink(
            this.app,
            editor,
            trimmed,
            detectedTaxon,
            this.settings
          ).then(() => {
            this.updateStatusBar();
            this.refreshSuggestionsView();
          });
        } else {
          new TaxaPickerModal(
            this.app,
            this.settings.taxaMappings,
            (taxon) => {
              createTaxaLink(
                this.app,
                editor,
                trimmed,
                taxon,
                this.settings
              ).then(() => {
                this.updateStatusBar();
                this.refreshSuggestionsView();
              });
            }
          ).open();
        }
      },
    });

    this.addCommand({
      id: "portfolio-move-current-note",
      name: "Move current note to taxa folder",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active file.");
          return;
        }
        const taxon = findTaxonByPrefix(
          file.basename,
          this.settings.taxaMappings
        );
        if (!taxon) {
          new Notice("No taxa prefix detected in filename.");
          return;
        }
        this.moveFileToTaxaFolder(file, taxon);
      },
    });

    this.addCommand({
      id: "portfolio-open-suggestions",
      name: "Open suggestions sidebar",
      callback: () => {
        this.activateSuggestionsView();
      },
    });
  }

  private registerAutoMover() {
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (this.settings.autoMoveEnabled) this.handleAutoMove(file);
        })
      );
      this.registerEvent(
        this.app.vault.on("rename", (file) => {
          if (this.settings.autoMoveEnabled) this.handleAutoMove(file);
        })
      );
    });
  }

  private async handleAutoMove(file: TAbstractFile) {
    if (!(file instanceof TFile)) return;
    if (file.extension !== "md") return;

    const taxon = findTaxonByPrefix(
      file.basename,
      this.settings.taxaMappings
    );
    if (!taxon) return;

    // Already in the right folder
    if (file.parent && file.parent.path === taxon.folder) return;

    await this.moveFileToTaxaFolder(file, taxon);
  }

  private async moveFileToTaxaFolder(
    file: TFile,
    taxon: { folder: string; label: string }
  ) {
    if (this.settings.createFolderIfMissing) {
      await ensureFolderExists(this.app.vault, taxon.folder);
    }

    const targetPath = `${taxon.folder}/${file.name}`;

    // Check for collision
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing) {
      new Notice(`File already exists at ${targetPath}`);
      return;
    }

    try {
      await this.app.fileManager.renameFile(file, targetPath);
      new Notice(`Moved to ${taxon.folder}/`);
    } catch (e) {
      new Notice(`Failed to move file: ${e}`);
    }
  }

  async activateSuggestionsView() {
    const leaves = this.app.workspace.getLeavesOfType(SUGGESTIONS_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: SUGGESTIONS_VIEW_TYPE,
          active: true,
        });
        this.app.workspace.revealLeaf(leaf);
      }
    }
  }

  refreshSuggestionsView() {
    const leaves = this.app.workspace.getLeavesOfType(SUGGESTIONS_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as SuggestionsView;
      if (view && typeof view.refresh === "function") {
        view.refresh();
      }
    }
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.statusBarEl.setText("");
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !cache.links) {
      this.statusBarEl.setText("");
      return;
    }

    const counts: Record<string, number> = {};
    for (const mapping of this.settings.taxaMappings) {
      counts[mapping.prefix] = 0;
    }

    for (const link of cache.links) {
      const linkText = link.link;
      for (const mapping of this.settings.taxaMappings) {
        if (linkText.startsWith(mapping.prefix)) {
          counts[mapping.prefix]++;
          break;
        }
      }
    }

    const parts: string[] = [];
    for (const mapping of this.settings.taxaMappings) {
      if (counts[mapping.prefix] > 0) {
        parts.push(`${counts[mapping.prefix]}${mapping.prefix}`);
      }
    }

    this.statusBarEl.setText(parts.length > 0 ? parts.join(" ") : "");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
