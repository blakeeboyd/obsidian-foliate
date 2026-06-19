import { ItemView, Notice, TFile, WorkspaceLeaf, MarkdownView, setIcon } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type PortfolioPlugin from "../main";
import { UnlinkedMatch, TaxaMapping, MatchPosition } from "../types";
import { findUnlinkedMatches, findFileMatchPositions } from "../services/unlinked-matcher";
import { stripPrefix } from "../taxa";

const addHighlight = StateEffect.define<{ from: number; to: number }>();
const clearHighlight = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(addHighlight)) {
        const mark = Decoration.mark({ class: "portfolio-jump-highlight" });
        return Decoration.set([mark.range(effect.value.from, effect.value.to)]);
      }
      if (effect.is(clearHighlight)) {
        return Decoration.none;
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const SUGGESTIONS_VIEW_TYPE = "portfolio-suggestions";

export class SuggestionsView extends ItemView {
  plugin: PortfolioPlugin;
  private dismissed: Set<string> = new Set();
  private currentFile: TFile | null = null;
  private selectionEditorCallback: (() => void) | null = null;
  private lastSelection = "";
  private jumpIndex: Map<string, number> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: PortfolioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SUGGESTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Portfolio: Suggestions";
  }

  getIcon(): string {
    return "square-pilcrow";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.onActiveFileChange();
        this.registerSelectionListener();
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.currentFile) {
          this.debounceRefresh();
        }
      })
    );

    this.registerSelectionListener();
    this.onActiveFileChange();
  }

  async onClose() {
    this.selectionEditorCallback = null;
  }

  private async findEditorForFile(noteFile: TFile): Promise<MarkdownView | null> {
    // Try active view first
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file === noteFile) return view;

    // Search all open leaves
    view = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!view && leaf.view instanceof MarkdownView && leaf.view.file === noteFile) {
        view = leaf.view as MarkdownView;
      }
    });
    if (view) return view;

    // File not open anywhere — open it
    const leaf = this.app.workspace.getLeaf();
    await leaf.openFile(noteFile);
    const opened = leaf.view;
    if (opened instanceof MarkdownView) return opened;
    return null;
  }

  private offsetToPos(content: string, offset: number): { line: number; ch: number } {
    const before = content.substring(0, offset);
    const lines = before.split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  }

  private async jumpToOccurrence(key: string, positions: (number | MatchPosition)[], content: string, noteFile: TFile, matchLength?: number) {
    const view = await this.findEditorForFile(noteFile);
    if (!view) return;

    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });

    const idx = (this.jumpIndex.get(key) ?? 0) % positions.length;
    this.jumpIndex.set(key, idx + 1);

    // Positions may be bare offsets (uniform length) or per-occurrence
    // objects that carry their own length (mixed-length alias matches).
    const entry = positions[idx];
    const offset = typeof entry === "number" ? entry : entry.offset;
    const occurrenceLen = typeof entry === "number" ? matchLength : entry.len;
    const pos = this.offsetToPos(content, offset);

    // Expand the highlight span to cover a full [[...]] wikilink if needed.
    let highlightLen = occurrenceLen ?? 0;
    if (highlightLen && content.substring(offset, offset + 2) === "[[") {
      const closeIdx = content.indexOf("]]", offset + 2);
      if (closeIdx !== -1) highlightLen = closeIdx + 2 - offset;
    }

    if (view.getMode() === "preview") {
      // Reading mode: there is no live CodeMirror editor to drive, so scroll
      // the rendered preview to the line and flash the section instead.
      this.jumpInPreview(view, pos.line);
    } else {
      const editor = view.editor;
      editor.setCursor(pos);
      editor.scrollIntoView({ from: pos, to: pos }, true);
      if (this.plugin.settings.highlightOnJump && highlightLen) {
        this.flashHighlight(editor, offset, offset + highlightLen);
      }
    }
  }

  private jumpInPreview(view: MarkdownView, line: number) {
    const preview = (view as any).previewMode;
    if (preview && typeof preview.applyScroll === "function") {
      preview.applyScroll(line);
    }
    if (!this.plugin.settings.highlightOnJump) return;

    // The target section may need a tick to render after scrolling.
    window.setTimeout(() => {
      const sections = preview?.renderer?.sections as
        | Array<{ lineStart: number; lineEnd: number; el: HTMLElement }>
        | undefined;
      if (!Array.isArray(sections)) return;
      const section = sections.find((s) => line >= s.lineStart && line <= s.lineEnd);
      const el = section?.el;
      if (!el) return;

      const color = this.plugin.settings.highlightColor;
      if (color) el.style.setProperty("--portfolio-highlight-color", color);
      el.addClass("portfolio-preview-flash");
      window.setTimeout(() => {
        el.removeClass("portfolio-preview-flash");
        if (color) el.style.removeProperty("--portfolio-highlight-color");
      }, 2500);
    }, 50);
  }

  private flashHighlight(editor: any, fromOffset: number, toOffset: number) {
    const cm: EditorView = editor.cm;
    if (!cm) return;

    // Ensure the highlight field is installed
    if (!cm.state.field(highlightField, false)) {
      cm.dispatch({ effects: StateEffect.appendConfig.of(highlightField) });
    }

    // Apply custom color if set
    const color = this.plugin.settings.highlightColor;
    const el = cm.dom.closest(".cm-editor") as HTMLElement | null;
    if (el && color) {
      el.style.setProperty("--portfolio-highlight-color", color);
    }

    cm.dispatch({ effects: addHighlight.of({ from: fromOffset, to: toOffset }) });

    setTimeout(() => {
      cm.dispatch({ effects: clearHighlight.of(null) });
      if (el && color) {
        el.style.removeProperty("--portfolio-highlight-color");
      }
    }, 2500);
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.refresh();
    }, 1000);
  }

  private registerSelectionListener() {
    this.selectionEditorCallback = null;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return;

    const editor = view.editor;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    this.selectionEditorCallback = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const sel = editor.getSelection() || "";
        if (sel !== this.lastSelection) {
          this.lastSelection = sel;
          this.refresh();
        }
      }, 200);
    };

    const cm = (editor as any).cm;
    if (cm && cm.contentDOM) {
      cm.contentDOM.addEventListener("mouseup", this.selectionEditorCallback);
      cm.contentDOM.addEventListener("keyup", this.selectionEditorCallback);
    }
  }

  private onActiveFileChange() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file === this.currentFile) return;

    this.currentFile = file;
    this.dismissed.clear();
    this.jumpIndex.clear();
    this.lastSelection = "";

    this.refresh();
  }

  async refresh() {
    const container = this.contentEl;
    container.empty();

    const file = this.currentFile;
    if (!file) {
      container.createEl("p", {
        text: "Open a note to see suggestions.",
        cls: "portfolio-empty-state",
      });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view ? view.editor.getSelection() : "";
    const textToAnalyze = selection && selection.trim().length > 0
      ? selection.trim()
      : content;
    const isSelection = selection && selection.trim().length > 0;

    // Header
    const header = container.createDiv("portfolio-suggestions-header");
    const titleEl = header.createEl("h4", { text: "Portfolio Suggestions" });
    if (isSelection) {
      titleEl.createSpan({
        text: " (selection)",
        cls: "portfolio-scope-indicator",
      });
    }

    const refreshBtn = header.createEl("button", {
      cls: "portfolio-refresh-btn",
      attr: { "aria-label": "Refresh" },
    });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => {
      this.refresh();
    });

    // Linked Taxa
    this.renderLinkedTaxa(container, file);

    // Layer 1: Unlinked Matches
    const unlinkedMatches = findUnlinkedMatches(
      this.app,
      textToAnalyze,
      file,
      this.plugin.settings.taxaMappings,
      this.plugin.settings.matchLinkedAliases
    ).filter((m) => !this.dismissed.has(m.filePath) && !this.plugin.settings.blocklist.includes(m.alias));

    if (unlinkedMatches.length > 0) {
      const section = container.createDiv("portfolio-section");
      section.createEl("h5", { text: "Unlinked Mentions" });

      // Group by taxon
      const grouped = groupByTaxon(unlinkedMatches, this.plugin.settings.taxaMappings);
      for (const [taxon, matches] of grouped) {
        const groupEl = section.createDiv("portfolio-taxa-group");
        groupEl.createEl("h6", {
          text: `${taxon.prefix} ${taxon.label}`,
          cls: "portfolio-group-label",
        });

        for (const match of matches) {
          this.renderUnlinkedMatch(groupEl, match, file, content);
        }
      }
    }
  }

  private renderUnlinkedMatch(
    container: HTMLElement,
    match: UnlinkedMatch,
    noteFile: TFile,
    fullContent: string
  ) {
    const row = container.createDiv("portfolio-suggestion-row");

    // Top line: name + action buttons
    const top = row.createDiv("portfolio-suggestion-top");

    const info = top.createDiv("portfolio-suggestion-info");
    const nameSpan = info.createSpan({
      text: match.alias,
      cls: "portfolio-match-text portfolio-clickable",
    });
    nameSpan.addEventListener("click", () => {
      this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length);
    });

    const actions = top.createDiv("portfolio-suggestion-actions");

    // Link button (replace first occurrence)
    const linkBtn = actions.createEl("button", {
      cls: "portfolio-action-btn",
      attr: { "aria-label": "Link" },
    });
    setIcon(linkBtn, "replace");
    linkBtn.addEventListener("click", async () => {
      await this.linkUnlinkedMatch(match, noteFile, false);
    });

    // Link all button (if multiple occurrences)
    if (match.positions.length > 1) {
      const linkAllBtn = actions.createEl("button", {
        cls: "portfolio-action-btn",
        attr: { "aria-label": "Link all" },
      });
      setIcon(linkAllBtn, "replace-all");
      linkAllBtn.addEventListener("click", async () => {
        await this.linkUnlinkedMatch(match, noteFile, true);
      });
    }

    // Ignore button (blocklist permanently)
    const ignoreBtn = actions.createEl("button", {
      cls: "portfolio-action-btn",
      attr: { "aria-label": "Always ignore" },
    });
    setIcon(ignoreBtn, "eye-off");
    ignoreBtn.addEventListener("click", async () => {
      this.plugin.settings.blocklist.push(match.alias);
      await this.plugin.saveSettings();
      this.refresh();
    });

    // Dismiss button (hide for this session)
    const dismissBtn = actions.createEl("button", {
      cls: "portfolio-dismiss-btn",
      attr: { "aria-label": "Dismiss" },
    });
    setIcon(dismissBtn, "x");
    dismissBtn.addEventListener("click", () => {
      this.dismissed.add(match.filePath);
      this.refresh();
    });

    // Bottom line: metadata
    const meta = row.createDiv("portfolio-suggestion-meta");
    meta.createSpan({
      text: `(${match.positions.length} ${match.positions.length > 1 ? "mentions" : "mention"})`,
      cls: "portfolio-meta-chunk",
    });
  }

  private async linkUnlinkedMatch(
    match: UnlinkedMatch,
    noteFile: TFile,
    linkAll: boolean
  ) {
    const content = await this.app.vault.read(noteFile);

    // Each occurrence links with its own surface form, so an alias hit becomes
    // [[Full Name|ZPD]] while a full-name hit links as itself.
    const wikilinkFor = (p: MatchPosition) => `[[${match.fileName}|${p.surface}]]`;

    let newContent: string;
    if (linkAll) {
      // Replace all occurrences, working backwards to preserve offsets
      newContent = content;
      const sortedPositions = [...match.positions].sort((a, b) => b.offset - a.offset);
      for (const p of sortedPositions) {
        const before = newContent.substring(0, p.offset);
        const after = newContent.substring(p.offset + p.len);
        newContent = before + wikilinkFor(p) + after;
      }
    } else {
      // Replace first occurrence only
      const p = match.positions[0];
      newContent =
        content.substring(0, p.offset) +
        wikilinkFor(p) +
        content.substring(p.offset + p.len);
    }

    await this.app.vault.modify(noteFile, newContent);
    const count = linkAll ? match.positions.length : 1;
    new Notice(
      `Linked ${match.alias} (${count} ${count > 1 ? "occurrences" : "occurrence"})`
    );
    this.plugin.updateStatusBar();
    this.refresh();
  }

  private async unlinkTaxaFromNote(link: string, displayName: string, noteFile: TFile) {
    const content = await this.app.vault.read(noteFile);

    // Match wikilinks: [[link]], [[link|alias]], [[link|anything]]
    const escapedLink = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\[\\[${escapedLink}(\\|[^\\]]*)?\\]\\]`, "g");

    const newContent = content.replace(pattern, (match) => {
      // Extract the display text: use alias if present, otherwise the link itself
      const aliasMatch = match.match(/\|([^\]]*)\]\]$/);
      return aliasMatch ? aliasMatch[1] : link;
    });

    if (newContent === content) {
      new Notice(`No wikilinks to ${displayName} found`);
      return;
    }

    const count = (content.match(pattern) || []).length;
    await this.app.vault.modify(noteFile, newContent);
    new Notice(`Unlinked ${displayName} (${count} ${count > 1 ? "occurrences" : "occurrence"})`);
    this.plugin.updateStatusBar();
    this.refresh();
  }

  private async renderLinkedTaxa(container: HTMLElement, file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links || [];
    const content = await this.app.vault.cachedRead(file);

    // Group linked taxa by mapping, collecting positions
    interface LinkedItem {
      displayName: string;
      link: string;
      positions: MatchPosition[];
      unlinkedCount: number;
    }
    const grouped = new Map<TaxaMapping, LinkedItem[]>();
    for (const mapping of this.plugin.settings.taxaMappings) {
      grouped.set(mapping, []);
    }

    for (const link of links) {
      for (const mapping of this.plugin.settings.taxaMappings) {
        if (link.link.startsWith(mapping.prefix)) {
          const items = grouped.get(mapping)!;
          if (!items.some((i) => i.link === link.link)) {
            const displayName = link.displayText || link.link;
            // Keyed by offset so wikilink, display-name, and alias hits dedupe.
            const byOffset = new Map<number, MatchPosition>();

            // Find wikilink positions (the actual links to this file)
            const wikiPattern = `[[${link.link}`;
            let searchFrom = 0;
            while (searchFrom < content.length) {
              const idx = content.indexOf(wikiPattern, searchFrom);
              if (idx === -1) break;
              byOffset.set(idx, { offset: idx, len: wikiPattern.length, surface: wikiPattern });
              searchFrom = idx + wikiPattern.length;
            }
            const linkedCount = byOffset.size;

            // Find plain text occurrences of the display name
            if (displayName.length >= 2) {
              const lowerContent = content.toLowerCase();
              const lowerName = displayName.toLowerCase();
              searchFrom = 0;
              while (searchFrom < lowerContent.length) {
                const idx = lowerContent.indexOf(lowerName, searchFrom);
                if (idx === -1) break;
                // Skip if this position overlaps with a wikilink position
                if (
                  !byOffset.has(idx) &&
                  ![...byOffset.keys()].some((p) => Math.abs(p - idx) < wikiPattern.length + 2)
                ) {
                  byOffset.set(idx, {
                    offset: idx,
                    len: displayName.length,
                    surface: content.substring(idx, idx + displayName.length),
                  });
                }
                searchFrom = idx + displayName.length;
              }
            }

            // Fold in unlinked occurrences of this file's other aliases
            // (e.g. "ZPD" for an already-linked Zone of Proximal Development).
            if (this.plugin.settings.matchLinkedAliases) {
              const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
              if (dest) {
                for (const mp of findFileMatchPositions(this.app, content, dest, mapping)) {
                  if (!byOffset.has(mp.offset)) byOffset.set(mp.offset, mp);
                }
              }
            }

            const positions = [...byOffset.values()].sort((a, b) => a.offset - b.offset);

            items.push({
              displayName,
              link: link.link,
              positions,
              unlinkedCount: positions.length - linkedCount,
            });
          }
          break;
        }
      }
    }

    let hasAny = false;
    for (const items of grouped.values()) {
      if (items.length > 0) { hasAny = true; break; }
    }

    if (!hasAny) return;

    const section = container.createDiv("portfolio-section");
    section.createEl("h5", { text: "Linked Taxa" });

    for (const [mapping, items] of grouped) {
      if (items.length === 0) continue;

      const groupEl = section.createDiv("portfolio-taxa-group");
      groupEl.createEl("h6", {
        text: `${mapping.prefix} ${mapping.label}`,
        cls: "portfolio-group-label",
      });

      for (const item of items) {
        const row = groupEl.createDiv("portfolio-linked-row");
        const info = row.createDiv("portfolio-linked-info");
        const nameSpan = info.createSpan({
          text: item.displayName,
          cls: "portfolio-linked-name portfolio-clickable",
        });
        if (item.positions.length > 0) {
          const jumpKey = `linked:${item.link}`;
          nameSpan.addEventListener("click", () => {
            this.jumpToOccurrence(jumpKey, item.positions, content, file, item.displayName.length);
          });
          info.createSpan({
            text:
              item.unlinkedCount > 0
                ? ` (${item.positions.length}, ${item.unlinkedCount} unlinked)`
                : ` (${item.positions.length})`,
            cls: "portfolio-match-count",
          });
        }

        const linkedActions = row.createDiv("portfolio-linked-actions");

        // Go to file button
        const goBtn = linkedActions.createEl("button", {
          cls: "portfolio-go-btn",
          attr: { "aria-label": "Open taxa file" },
        });
        setIcon(goBtn, "external-link");
        goBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.app.workspace.openLinkText(item.link, file.path);
        });

        // Unlink button
        const unlinkBtn = linkedActions.createEl("button", {
          cls: "portfolio-unlink-btn",
          attr: { "aria-label": "Unlink" },
        });
        setIcon(unlinkBtn, "unlink");
        unlinkBtn.addEventListener("click", async () => {
          await this.unlinkTaxaFromNote(item.link, item.displayName, file);
        });
      }
    }
  }

}

function groupByTaxon(
  matches: UnlinkedMatch[],
  taxaMappings: TaxaMapping[]
): Map<TaxaMapping, UnlinkedMatch[]> {
  // Pre-seed in settings order so groups appear in the same sequence
  const map = new Map<TaxaMapping, UnlinkedMatch[]>();
  for (const taxon of taxaMappings) {
    map.set(taxon, []);
  }
  for (const match of matches) {
    const existing = map.get(match.taxon) || [];
    existing.push(match);
    map.set(match.taxon, existing);
  }
  return map;
}
