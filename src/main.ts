import { Notice, Plugin, TAbstractFile, TFile, MarkdownView, addIcon } from "obsidian";
import { EnfoliateSettings, TaxaMapping } from "./types";
import { DEFAULT_TAXA_MAPPINGS, findTaxonByPrefix } from "./taxa";
import { EnfoliateSettingTab } from "./settings";
import { ENFOLIATE_ICON_ID, ENFOLIATE_ICON_SVG } from "./icon";
import {
  createTaxaLink,
  ensureFolderExists,
} from "./services/file-operations";
import { findUnlinkedMatches, findTaxaFileByText } from "./services/unlinked-matcher";
import { TaxaPickerModal } from "./ui/taxa-picker-modal";
import {
  SuggestionsView,
  SUGGESTIONS_VIEW_TYPE,
} from "./ui/suggestions-view";

const DEFAULT_SETTINGS: EnfoliateSettings = {
  taxaMappings: DEFAULT_TAXA_MAPPINGS,
  autoMoveEnabled: true,
  createFolderIfMissing: true,
  autoAddAlias: true,
  sidebarOpen: false,
  autoScan: true,
  scopeToView: false,
  clickAction: "jump",
  modClickAction: "replace",
  altClickAction: "tab",
  shiftClickAction: "split",
  inlineActions: ["link", "linkAll", "unlink"],
  matchLinkedAliases: false,
  blocklist: [],
  highlightOnJump: true,
  highlightDurationSeconds: 2.5,
  selectOnJump: false,
  showSearchBar: true,
  collapsedCategories: [],
  highlightColor: "",
};

export default class EnfoliatePlugin extends Plugin {
  settings: EnfoliateSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    addIcon(ENFOLIATE_ICON_ID, ENFOLIATE_ICON_SVG);
    this.addSettingTab(new EnfoliateSettingTab(this.app, this));
    this.registerCommands();
    this.registerAutoMover();
    this.registerView(
      SUGGESTIONS_VIEW_TYPE,
      (leaf) => new SuggestionsView(leaf, this)
    );
    this.app.workspace.onLayoutReady(() => {
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
      id: "enfoliate-create-taxa-link",
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
            this.refreshSuggestionsView();
          });
          return;
        }

        // No prefix: if the selection matches exactly one existing taxa file
        // (by name or alias), link straight to it instead of opening the picker.
        const existing = findTaxaFileByText(
          this.app,
          trimmed,
          this.settings.taxaMappings
        );
        if (existing) {
          editor.replaceSelection(`[[${existing.file.basename}|${trimmed}]]`);
          new Notice(`Linked ${trimmed} to ${existing.file.basename}`);
          this.refreshSuggestionsView();
          return;
        }

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
              this.refreshSuggestionsView();
            });
          }
        ).open();
      },
    });

    this.addCommand({
      id: "enfoliate-move-current-note",
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
      id: "enfoliate-open-suggestions",
      name: "Open Enfoliate sidebar",
      callback: () => {
        this.activateSuggestionsView();
      },
    });

    this.addCommand({
      id: "enfoliate-link-all-unlinked",
      name: "Link all unlinked taxa in the current note",
      callback: () => {
        void this.linkAllUnlinked();
      },
    });

    this.addCommand({
      id: "enfoliate-link-under-cursor",
      name: "Link taxa mention under the cursor",
      editorCallback: (editor) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const content = editor.getValue();
        const cursor = editor.posToOffset(editor.getCursor());

        // Find the taxa mention whose span contains the cursor, preferring the
        // longest (so a full phrase like "artificial intelligence" wins over a
        // shorter alias). The matcher already yields whole-term spans.
        const matches = findUnlinkedMatches(this.app, content, file, this.settings.taxaMappings, true);
        let best: { offset: number; len: number; surface: string; target: string } | null = null;
        for (const match of matches) {
          for (const p of match.positions) {
            if (cursor >= p.offset && cursor <= p.offset + p.len) {
              if (!best || p.len > best.len) {
                best = { offset: p.offset, len: p.len, surface: p.surface, target: match.fileName };
              }
            }
          }
        }

        if (!best) {
          new Notice("No taxa mention under the cursor.");
          return;
        }
        // replaceRange is a single editor edit, so Ctrl/Cmd+Z undoes it.
        editor.replaceRange(
          `[[${best.target}|${best.surface}]]`,
          editor.offsetToPos(best.offset),
          editor.offsetToPos(best.offset + best.len)
        );
        this.refreshSuggestionsView();
      },
    });

    this.addCommand({
      id: "enfoliate-toggle-auto-scan",
      name: "Toggle auto-scan",
      callback: async () => {
        this.settings.autoScan = !this.settings.autoScan;
        await this.saveSettings();
        new Notice(`Auto-scan ${this.settings.autoScan ? "on" : "off"}.`);
        this.refreshSuggestionsView();
      },
    });
  }

  /**
   * Wrap every unlinked mention of an existing taxa file in the active note with
   * a wikilink, in one pass. Overlapping matches across files are resolved by
   * keeping the longest, so nothing gets double-wrapped or corrupted. When the
   * note is open in source mode the change is applied through the editor as a
   * single transaction so it can be undone with Ctrl/Cmd+Z.
   */
  private async linkAllUnlinked() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No active note.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view && view.file === file && view.getMode() === "source" ? view.editor : null;
    // Match against the editor's live text when available so offsets line up.
    const content = editor ? editor.getValue() : await this.app.vault.read(file);

    // includeLinkedFiles: also catch the remaining plain-text mentions of files
    // that are already linked somewhere in the note.
    const matches = findUnlinkedMatches(this.app, content, file, this.settings.taxaMappings, true);

    interface Occurrence {
      offset: number;
      len: number;
      surface: string;
      target: string;
    }
    const occurrences: Occurrence[] = [];
    for (const match of matches) {
      for (const p of match.positions) {
        occurrences.push({ offset: p.offset, len: p.len, surface: p.surface, target: match.fileName });
      }
    }
    if (occurrences.length === 0) {
      new Notice("No unlinked taxa mentions found.");
      return;
    }

    // Resolve overlaps across all files: longest first, drop any that overlaps a kept one.
    occurrences.sort((a, b) => b.len - a.len || a.offset - b.offset);
    const kept: Occurrence[] = [];
    for (const o of occurrences) {
      const overlaps = kept.some((k) => o.offset < k.offset + k.len && k.offset < o.offset + o.len);
      if (!overlaps) kept.push(o);
    }

    if (editor) {
      // One transaction = one undo step. Changes are non-overlapping (resolved
      // above) and given in document order.
      const changes = [...kept]
        .sort((a, b) => a.offset - b.offset)
        .map((o) => ({
          from: editor.offsetToPos(o.offset),
          to: editor.offsetToPos(o.offset + o.len),
          text: `[[${o.target}|${o.surface}]]`,
        }));
      editor.transaction({ changes });
    } else {
      // No live editor (reading mode / not open): rewrite the file back-to-front.
      kept.sort((a, b) => b.offset - a.offset);
      let newContent = content;
      for (const o of kept) {
        newContent =
          newContent.substring(0, o.offset) +
          `[[${o.target}|${o.surface}]]` +
          newContent.substring(o.offset + o.len);
      }
      await this.app.vault.modify(file, newContent);
    }

    new Notice(`Linked ${kept.length} taxa mention${kept.length > 1 ? "s" : ""}.`);
    this.refreshSuggestionsView();
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

    await this.moveFileToTaxaFolder(file, taxon);
  }

  private async moveFileToTaxaFolder(file: TFile, taxon: TaxaMapping) {
    const folder = taxon.folder.trim();
    // No folder configured for this taxon: leave the file where it is.
    if (!folder) return;
    // Already in the right folder.
    if (file.parent && file.parent.path === folder) return;

    if (this.settings.createFolderIfMissing) {
      await ensureFolderExists(this.app.vault, folder);
    }

    const targetPath = `${folder}/${file.name}`;

    // Check for collision
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing) {
      new Notice(`File already exists at ${targetPath}`);
      return;
    }

    try {
      await this.app.fileManager.renameFile(file, targetPath);
      new Notice(`Moved to ${folder}/`);
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

  async loadSettings() {
    const loaded = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    // Keep only keys the current settings shape knows about, so values left
    // behind by removed features don't get rewritten to data.json.
    const known: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in loaded) known[key] = loaded[key];
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, known) as EnfoliateSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
