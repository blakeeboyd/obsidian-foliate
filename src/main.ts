import { Editor, EditorPosition, Notice, Plugin, TAbstractFile, TFile, MarkdownView, addIcon } from "obsidian";
import { FoliateSettings, TaxaMapping } from "./types";
import { DEFAULT_TAXA_MAPPINGS, findTaxonByPrefix } from "./taxa";
import { FoliateSettingTab } from "./settings";
import { FOLIATE_ICON_ID, FOLIATE_ICON_SVG } from "./icon";
import {
  createTaxaLink,
  ensureFolderExists,
} from "./services/file-operations";
import { findUnlinkedMatches, findTaxaFileByText, findTaxaFilesByText } from "./services/unlinked-matcher";
import { TaxaPickerModal } from "./ui/taxa-picker-modal";
import { FilePickerModal } from "./ui/file-picker-modal";
import {
  SuggestionsView,
  SUGGESTIONS_VIEW_TYPE,
} from "./ui/suggestions-view";

const DEFAULT_SETTINGS: FoliateSettings = {
  taxaMappings: DEFAULT_TAXA_MAPPINGS,
  autoMoveEnabled: true,
  createFolderIfMissing: true,
  autoAddAlias: true,
  linkUnderCursorFallback: true,
  sidebarEnabled: true,
  sidebarOpen: true,
  autoScan: true,
  scopeToView: false,
  sortOrder: "mentions-desc",
  clickAction: "jump",
  modClickAction: "replace",
  altClickAction: "menu",
  shiftClickAction: "split",
  inlineActions: ["link", "linkAll", "unlink"],
  matchLinkedAliases: true,
  blocklist: [],
  highlightOnJump: true,
  highlightDurationSeconds: 2.5,
  selectOnJump: true,
  showSearchBar: true,
  collapsedCategories: [],
  highlightColor: "",
};

export default class FoliatePlugin extends Plugin {
  settings: FoliateSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    addIcon(FOLIATE_ICON_ID, FOLIATE_ICON_SVG);
    this.addSettingTab(new FoliateSettingTab(this.app, this));
    this.registerCommands();
    this.registerAutoMover();
    if (this.settings.sidebarEnabled) {
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
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(SUGGESTIONS_VIEW_TYPE);
  }

  private registerCommands() {
    this.addCommand({
      id: "foliate-create-taxa-link",
      name: "Create taxa link",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (selection && selection.trim().length > 0) {
          // Selection present: link it (creating the file via the picker when
          // nothing matches), exactly as before.
          this.linkSelectedText(editor, selection.trim());
          return;
        }

        // No selection. When the fallback is enabled, act on the cursor: link an
        // existing taxa mention under it, or fall back to the word under it.
        if (this.settings.linkUnderCursorFallback) {
          this.linkUnderCursor(editor);
          return;
        }

        new Notice("Select text first.");
      },
    });

    this.addCommand({
      id: "foliate-move-current-note",
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
      id: "foliate-open-suggestions",
      name: "Open Foliate sidebar",
      callback: () => {
        this.activateSuggestionsView();
      },
    });

    this.addCommand({
      id: "foliate-link-all-unlinked",
      name: "Link all unlinked taxa in the current note",
      callback: () => {
        void this.linkAllUnlinked();
      },
    });

    this.addCommand({
      id: "foliate-toggle-auto-scan",
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
   * Link a piece of selected text. If it carries a taxa prefix, create/link that
   * taxon's file. If it matches exactly one existing taxa file (name or alias),
   * link straight to it. Otherwise open the picker so the user can choose a
   * taxon and a new file is created. This is the original "Create taxa link"
   * behavior, factored out so the cursor fallback can share the matched-file and
   * prefix paths.
   */
  private linkSelectedText(editor: Editor, text: string) {
    const detectedTaxon = findTaxonByPrefix(text, this.settings.taxaMappings);
    if (detectedTaxon) {
      createTaxaLink(this.app, editor, text, detectedTaxon, this.settings).then(() => {
        this.refreshSuggestionsView();
      });
      return;
    }

    const existing = findTaxaFileByText(this.app, text, this.settings.taxaMappings);
    if (existing) {
      editor.replaceSelection(`[[${existing.file.basename}|${text}]]`);
      new Notice(`Linked ${text} to ${existing.file.basename}`);
      this.refreshSuggestionsView();
      return;
    }

    new TaxaPickerModal(this.app, this.settings.taxaMappings, (taxon) => {
      createTaxaLink(this.app, editor, text, taxon, this.settings).then(() => {
        this.refreshSuggestionsView();
      });
    }).open();
  }

  /**
   * No-selection fallback for "Create taxa link". First try to link an existing
   * taxa mention (name or alias, possibly multi-word) whose span sits under the
   * cursor, preferring the longest. If none, select the single word under the
   * cursor and link it only when it already matches a taxa file or carries a
   * taxa prefix. A bare word that matches nothing is left alone (no file is
   * created from an unselected word, by design).
   */
  private linkUnderCursor(editor: Editor) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const content = editor.getValue();
    const cursor = editor.posToOffset(editor.getCursor());

    // Find taxa mentions whose span contains the cursor, preferring the longest
    // (so a full phrase like "artificial intelligence" wins over a shorter
    // alias). The matcher yields whole-term spans, one set per candidate file.
    const matches = findUnlinkedMatches(this.app, content, file, this.settings.taxaMappings, true);
    let bestLen = -1;
    let span: { offset: number; surface: string } | null = null;
    const targets: string[] = []; // distinct file names matching at the best span
    for (const match of matches) {
      for (const p of match.positions) {
        if (cursor >= p.offset && cursor <= p.offset + p.len) {
          if (p.len > bestLen) {
            // A longer span supersedes shorter ones: reset the candidate set.
            bestLen = p.len;
            span = { offset: p.offset, surface: p.surface };
            targets.length = 0;
            targets.push(match.fileName);
          } else if (p.len === bestLen && !targets.includes(match.fileName)) {
            targets.push(match.fileName);
          }
        }
      }
    }

    if (span) {
      const replace = (target: string) => {
        // replaceRange is a single editor edit, so Ctrl/Cmd+Z undoes it.
        editor.replaceRange(
          `[[${target}|${span!.surface}]]`,
          editor.offsetToPos(span!.offset),
          editor.offsetToPos(span!.offset + bestLen)
        );
        this.refreshSuggestionsView();
      };
      if (targets.length === 1) {
        replace(targets[0]);
      } else {
        // Same text maps to several files: let the user pick which to link.
        this.pickTaxaFile(targets, (basename) => replace(basename));
      }
      return;
    }

    // No existing mention under the cursor: fall back to the word the cursor is
    // in. Only link it when it has a prefix or matches a file; a word that
    // matches nothing is left alone, and the cursor isn't moved.
    const word = this.wordUnderCursor(editor);
    if (!word) {
      new Notice("No taxa mention under the cursor.");
      return;
    }

    const hasPrefix = findTaxonByPrefix(word.text, this.settings.taxaMappings) !== null;
    const fileHits = findTaxaFilesByText(this.app, word.text, this.settings.taxaMappings);
    if (!hasPrefix && fileHits.length === 0) {
      new Notice("No taxa mention under the cursor.");
      return;
    }

    // More than one existing file matches the word: pick which to link to,
    // linking it in place under the word's range.
    if (fileHits.length > 1) {
      this.pickTaxaFile(
        fileHits.map((h) => h.file.basename),
        (basename) => {
          editor.replaceRange(
            `[[${basename}|${word.text}]]`,
            word.from,
            word.to
          );
          this.refreshSuggestionsView();
        }
      );
      return;
    }

    // Single match (or a prefix to create from): select the word and route
    // through the selection path, which links or opens the picker as needed.
    editor.setSelection(word.from, word.to);
    this.linkSelectedText(editor, word.text);
  }

  /**
   * Open a file picker over the given taxa file basenames (each "PrefixName"),
   * calling back with the chosen basename. Resolves each basename to its TFile so
   * the picker can show the containing folder. Skips straight to the callback if
   * only one resolves.
   */
  private pickTaxaFile(basenames: string[], onChoose: (basename: string) => void) {
    const files: TFile[] = [];
    for (const name of [...new Set(basenames)]) {
      const f = this.app.metadataCache.getFirstLinkpathDest(name, "");
      if (f) files.push(f);
    }
    if (files.length === 0) return;
    if (files.length === 1) {
      onChoose(files[0].basename);
      return;
    }
    new FilePickerModal(this.app, files, (file) => onChoose(file.basename)).open();
  }

  /**
   * The word the cursor sits in, with its range, or null when the cursor isn't
   * on a word. Word characters are letters, digits, hyphen, and the taxa prefix
   * characters, so a prefixed token like "@Ada" is taken whole. Does not move
   * the cursor or selection.
   */
  private wordUnderCursor(
    editor: Editor
  ): { text: string; from: EditorPosition; to: EditorPosition } | null {
    const pos = editor.getCursor();
    const line = editor.getLine(pos.line);
    const prefixes = this.settings.taxaMappings.map((m) => m.prefix).join("");
    const isWord = (ch: string) =>
      /[\p{L}\p{N}\-]/u.test(ch) || prefixes.includes(ch);

    let start = pos.ch;
    let end = pos.ch;
    while (start > 0 && isWord(line[start - 1])) start--;
    while (end < line.length && isWord(line[end])) end++;
    if (start === end) return null;

    return {
      text: line.slice(start, end),
      from: { line: pos.line, ch: start },
      to: { line: pos.line, ch: end },
    };
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
    if (!this.settings.sidebarEnabled) {
      new Notice("Enable the sidebar in Foliate settings first (requires reload).");
      return;
    }
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, known) as FoliateSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
