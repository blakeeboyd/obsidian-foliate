import { Editor, ItemView, Menu, Notice, TFile, WorkspaceLeaf, MarkdownView, setIcon } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type EnfoliatePlugin from "../main";
import { UnlinkedMatch, TaxaMapping, MatchPosition } from "../types";
import { findUnlinkedMatches, findFileMatchPositions, findUnlinkedPositions, bodyStartOffset, isInsideWikilink } from "../services/unlinked-matcher";
import { stripPrefix } from "../taxa";
import { ENFOLIATE_ICON_ID } from "../icon";

const addHighlight = StateEffect.define<{ from: number; to: number }>();
const clearHighlight = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(addHighlight)) {
        const mark = Decoration.mark({ class: "enfoliate-jump-highlight" });
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

export const SUGGESTIONS_VIEW_TYPE = "enfoliate-suggestions";

/**
 * An action available on a sidebar row. Rendered as an inline button when its
 * `id` is enabled in settings, and always offered in the row's right-click menu.
 * `inline: false` keeps an action menu-only (used for Jump, which the row name
 * click already performs).
 */
interface RowAction {
  id: string;
  label: string;
  icon: string;
  run: () => void | Promise<void>;
  inline?: boolean;
}

export class SuggestionsView extends ItemView {
  plugin: EnfoliatePlugin;
  private dismissed: Set<string> = new Set();
  private currentFile: TFile | null = null;
  private searchQuery = "";
  private stickyObserver: ResizeObserver | null = null;
  private jumpIndex: Map<string, number> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: EnfoliatePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SUGGESTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Enfoliate";
  }

  getIcon(): string {
    return ENFOLIATE_ICON_ID;
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.onActiveFileChange();
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.plugin.settings.autoScan && file === this.currentFile) {
          this.debounceRefresh();
        }
      })
    );

    // Recompute sticky-header offsets whenever the panel resizes — including
    // when it first gains dimensions, which fixes the offsets being measured
    // too early on initial open.
    this.stickyObserver = new ResizeObserver(() => this.updateStickyOffsets());
    this.stickyObserver.observe(this.contentEl);

    this.onActiveFileChange();
  }

  async onClose() {
    this.stickyObserver?.disconnect();
    this.stickyObserver = null;
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

  /**
   * Run the configured action for a click on a sidebar item, choosing the
   * binding by held modifier (precedence: Cmd/Ctrl, then Alt/Option, then Shift,
   * else plain click). Either jumps to the next occurrence (via `jump`) or opens
   * the taxa note in the current tab, a new tab, a split, or a new window.
   * openLinkText handles link resolution and main-area targeting.
   */
  private handleItemClick(
    evt: MouseEvent,
    linkText: string,
    sourcePath: string,
    jump: () => void
  ) {
    const s = this.plugin.settings;
    const action =
      evt.metaKey || evt.ctrlKey
        ? s.modClickAction
        : evt.altKey
          ? s.altClickAction
          : evt.shiftKey
            ? s.shiftClickAction
            : s.clickAction;
    if (action === "jump") {
      jump();
      return;
    }
    if (action === "copy") {
      const wikilink = `[[${linkText}]]`;
      navigator.clipboard.writeText(wikilink);
      new Notice(`Copied ${wikilink}`);
      return;
    }
    const newLeaf = action === "replace" ? false : action;
    this.app.workspace.openLinkText(linkText, sourcePath, newLeaf, { active: true });
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
      // the rendered preview and highlight the occurrence in the DOM. A
      // wikilink position renders as a link element; a plain position renders
      // as body text.
      const isWikilinkPos = content.substring(offset, offset + 2) === "[[";
      if (isWikilinkPos) {
        const m = content.substring(offset, offset + highlightLen).match(/^\[\[([^\]|#]+)/);
        this.jumpInPreview(view, pos.line, content, offset, "link", m ? m[1].trim() : "");
      } else {
        const surface = content.substring(offset, offset + (occurrenceLen ?? 0));
        this.jumpInPreview(view, pos.line, content, offset, "text", surface);
      }
    } else {
      const editor = view.editor;
      const endPos = this.offsetToPos(content, offset + highlightLen);
      if (this.plugin.settings.selectOnJump && highlightLen) {
        editor.setSelection(pos, endPos);
      } else {
        editor.setCursor(pos);
      }
      editor.scrollIntoView({ from: pos, to: endPos }, true);
      if (this.plugin.settings.highlightOnJump && highlightLen) {
        this.flashHighlight(editor, offset, offset + highlightLen);
      }
    }
  }

  private jumpInPreview(
    view: MarkdownView,
    line: number,
    content: string,
    offset: number,
    kind: "text" | "link",
    key: string
  ) {
    const preview = (view as any).previewMode;
    const wantsHighlight = this.plugin.settings.highlightOnJump && !!key;

    const findRanges = (root: HTMLElement) =>
      kind === "link" ? this.findLinkRanges(root, key) : this.findPreviewRanges(root, key);
    const countBefore = (from: number) =>
      kind === "link"
        ? this.countLinksBefore(content, key, from, offset)
        : this.countMatchesBefore(content, key, from, offset);

    const place = (target: Range) => {
      target.startContainer.parentElement?.scrollIntoView({ block: "center" });
      const HighlightCtor = (window as any).Highlight;
      const highlights = (CSS as any).highlights;
      if (!HighlightCtor || !highlights) return;
      const color = this.plugin.settings.highlightColor;
      if (color) document.body.style.setProperty("--enfoliate-highlight-color", color);
      highlights.set("enfoliate-jump", new HighlightCtor(target));
      window.setTimeout(() => {
        highlights.delete("enfoliate-jump");
        if (color) document.body.style.removeProperty("--enfoliate-highlight-color");
      }, this.highlightMs());
    };

    const highlight = () => {
      const root = preview?.containerEl as HTMLElement | undefined;
      if (!root) return;

      // Prefer resolving within the section containing the target line. Reading
      // view renders lazily, so a global count is unreliable; within one fully
      // rendered section the occurrence's index matches the rendered order.
      const section = this.findPreviewSection(preview, root, line);
      if (section) {
        const ranges = findRanges(section.el);
        if (ranges.length) {
          const index = countBefore(this.offsetOfLine(content, section.lineStart));
          place(ranges[Math.min(index, ranges.length - 1)]);
          return;
        }
      }

      // Fallback: search the whole preview so highlighting still works even if
      // the section lookup comes up empty.
      const ranges = findRanges(root);
      if (!ranges.length) return;
      const index = countBefore(bodyStartOffset(content));
      place(ranges[Math.min(index, ranges.length - 1)]);
    };

    // Render the target first (applyScroll), then highlight on the next tick.
    if (preview && typeof preview.applyScroll === "function") {
      preview.applyScroll(line);
    }
    if (wantsHighlight) window.setTimeout(highlight, 60);
  }

  /**
   * Find the rendered block containing `line`, with its source start line,
   * using the public getSectionInfo API.
   */
  private findPreviewSection(
    preview: any,
    root: HTMLElement,
    line: number
  ): { el: HTMLElement; lineStart: number } | null {
    const sizers = root.querySelectorAll(".markdown-preview-sizer");
    for (const sizer of Array.from(sizers)) {
      for (const block of Array.from(sizer.children)) {
        if (!(block instanceof HTMLElement)) continue;
        const info = preview?.getSectionInfo?.(block);
        if (info && line >= info.lineStart && line <= info.lineEnd) {
          return { el: block, lineStart: info.lineStart };
        }
      }
    }
    return null;
  }

  /** Char offset where a 0-based source line begins. */
  private offsetOfLine(content: string, line: number): number {
    if (line <= 0) return 0;
    let idx = 0;
    for (let i = 0; i < line; i++) {
      const nl = content.indexOf("\n", idx);
      if (nl === -1) return content.length;
      idx = nl + 1;
    }
    return idx;
  }

  /**
   * Count unlinked occurrences of `surface` in content[from, offset), giving the
   * occurrence's index among the rendered (non-link) matches in that range.
   */
  private countMatchesBefore(content: string, surface: string, from: number, offset: number): number {
    const lower = content.toLowerCase();
    const target = surface.toLowerCase();
    let count = 0;
    let cursor = from;
    while (cursor < offset) {
      const idx = lower.indexOf(target, cursor);
      if (idx === -1 || idx >= offset) break;
      if (!isInsideWikilink(content, idx)) count++;
      cursor = idx + target.length;
    }
    return count;
  }

  /**
   * Count wikilinks to `linkTarget` in content[from, offset), giving the link's
   * index among the rendered link elements for that target in that range.
   */
  private countLinksBefore(content: string, linkTarget: string, from: number, offset: number): number {
    if (!linkTarget) return 0;
    const lower = content.toLowerCase();
    const needle = `[[${linkTarget.toLowerCase()}`;
    let count = 0;
    let cursor = from;
    while (cursor < offset) {
      const idx = lower.indexOf(needle, cursor);
      if (idx === -1 || idx >= offset) break;
      count++;
      cursor = idx + needle.length;
    }
    return count;
  }

  /**
   * Find ranges over rendered internal-link elements pointing at `linkTarget`.
   */
  private findLinkRanges(root: HTMLElement, linkTarget: string): Range[] {
    const ranges: Range[] = [];
    if (!linkTarget) return ranges;
    const target = linkTarget.toLowerCase();
    root.querySelectorAll("a.internal-link, a[data-href]").forEach((a) => {
      const href = (a.getAttribute("data-href") || a.getAttribute("href") || "").toLowerCase();
      if (href === target || href.split("#")[0] === target) {
        const range = document.createRange();
        range.selectNodeContents(a);
        ranges.push(range);
      }
    });
    return ranges;
  }

  /**
   * Find ranges of `surface` in the rendered text under `root`, skipping links,
   * code, and the properties (frontmatter) widget — none of which are plain
   * unlinked body mentions.
   */
  private findPreviewRanges(root: HTMLElement, surface: string): Range[] {
    const target = surface.toLowerCase();
    const ranges: Range[] = [];
    if (target.length < 2) return ranges;

    // Skip text that isn't a plain body mention: links, code, the properties
    // widget, the inline title (rendered from the filename, not the source),
    // and embedded/transcluded notes.
    const skip = "a, code, pre, .metadata-container, .frontmatter, .inline-title, .markdown-embed";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(skip)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || "").toLowerCase();
      let from = 0;
      while (true) {
        const idx = text.indexOf(target, from);
        if (idx === -1) break;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + surface.length);
        ranges.push(range);
        from = idx + surface.length;
      }
    }
    return ranges;
  }

  private flashHighlight(editor: any, fromOffset: number, toOffset: number) {
    const cm: EditorView = editor.cm;
    if (!cm) return;

    // Ensure the highlight field is installed
    if (!cm.state.field(highlightField, false)) {
      cm.dispatch({ effects: StateEffect.appendConfig.of(highlightField) });
    }

    // Apply custom color and duration if set
    const color = this.plugin.settings.highlightColor;
    const el = cm.dom.closest(".cm-editor") as HTMLElement | null;
    if (el) {
      el.style.setProperty(
        "--enfoliate-highlight-duration",
        `${this.plugin.settings.highlightDurationSeconds}s`
      );
      if (color) el.style.setProperty("--enfoliate-highlight-color", color);
    }

    cm.dispatch({ effects: addHighlight.of({ from: fromOffset, to: toOffset }) });

    setTimeout(() => {
      cm.dispatch({ effects: clearHighlight.of(null) });
      if (el) {
        el.style.removeProperty("--enfoliate-highlight-duration");
        if (color) el.style.removeProperty("--enfoliate-highlight-color");
      }
    }, this.highlightMs());
  }

  /** Highlight duration in milliseconds, floored so it can't vanish instantly. */
  private highlightMs(): number {
    return Math.max(300, this.plugin.settings.highlightDurationSeconds * 1000);
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.refresh();
    }, 1000);
  }

  /**
   * Refresh as soon as the metadata cache reflects a just-made change to `file`,
   * so a linked/unlinked item moves between sections immediately instead of
   * waiting for the file-save event and the modify debounce. Falls back to a
   * timeout in case no change event arrives.
   */
  private refreshAfterMetadataUpdate(file: TFile) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      this.app.metadataCache.offref(ref);
      window.clearTimeout(timer);
      this.refresh();
    };
    const ref = this.app.metadataCache.on("changed", (changed) => {
      if (changed === file) run();
    });
    const timer = window.setTimeout(run, 2000);
  }

  private onActiveFileChange() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file === this.currentFile) return;

    this.currentFile = file;
    this.dismissed.clear();
    this.jumpIndex.clear();

    if (this.plugin.settings.autoScan) {
      this.refresh();
    } else {
      this.renderScanPrompt();
    }
  }

  /**
   * Build the pinned header: the "Enfoliate" title and — when auto-scan is off
   * — a Scan button that runs a manual scan of the active note.
   */
  private buildStickyHeader(stickyTop: HTMLElement) {
    const header = stickyTop.createDiv("enfoliate-suggestions-header");
    header.createEl("h4", { text: "Enfoliate" });
    if (!this.plugin.settings.autoScan) {
      const scanBtn = header.createEl("button", {
        cls: "enfoliate-scan-btn mod-cta",
        text: "Scan",
        attr: { "aria-label": "Scan the active note" },
      });
      scanBtn.addEventListener("click", () => this.refresh());
    }
  }

  /**
   * With auto-scan off, show the header (including the Scan button) and a prompt
   * rather than scanning automatically when the active note changes.
   */
  private renderScanPrompt() {
    const container = this.contentEl;
    container.empty();
    if (!this.currentFile) {
      container.createEl("p", {
        text: "Open a note to scan.",
        cls: "enfoliate-empty-state",
      });
      return;
    }
    const stickyTop = container.createDiv("enfoliate-sticky-top");
    this.buildStickyHeader(stickyTop);
    container.createEl("p", {
      text: "Auto-scan is off. Click Scan to analyze this note.",
      cls: "enfoliate-empty-state",
    });
    this.updateStickyOffsets();
    window.requestAnimationFrame(() => this.updateStickyOffsets());
  }

  async refresh() {
    const container = this.contentEl;
    container.empty();

    const file = this.currentFile;
    if (!file) {
      container.createEl("p", {
        text: "Open a note to see suggestions.",
        cls: "enfoliate-empty-state",
      });
      return;
    }

    const content = await this.app.vault.cachedRead(file);

    // Sticky top bar: title + search stay pinned as the list scrolls.
    const stickyTop = container.createDiv("enfoliate-sticky-top");

    this.buildStickyHeader(stickyTop);

    // Search / filter box (optional)
    if (this.plugin.settings.showSearchBar) {
      const searchWrap = stickyTop.createDiv("enfoliate-search");
      const searchInput = searchWrap.createEl("input", {
        type: "text",
        cls: "enfoliate-search-input",
        attr: { placeholder: "Filter taxa..." },
      });
      searchInput.value = this.searchQuery;

      // Clear button — shown only while there's a query.
      const clearBtn = searchWrap.createEl("button", {
        cls: "enfoliate-search-clear",
        attr: { "aria-label": "Clear search" },
      });
      setIcon(clearBtn, "x");
      const syncClear = () => {
        clearBtn.style.display = searchInput.value ? "" : "none";
      };
      syncClear();

      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        syncClear();
        this.applyFilter();
      });

      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        this.searchQuery = "";
        syncClear();
        this.applyFilter();
        searchInput.focus();
      });
    }

    // Linked Mentions (awaited so it renders above Unlinked Mentions)
    await this.renderLinkedTaxa(container, file);

    // Layer 1: Unlinked Matches. Already-linked files are excluded here so a
    // file never appears in both sections; its unlinked alias occurrences
    // surface under Linked Mentions instead (when "Match aliases" is on).
    const unlinkedMatches = findUnlinkedMatches(
      this.app,
      content,
      file,
      this.plugin.settings.taxaMappings,
      false
    ).filter((m) => !this.dismissed.has(m.filePath) && !this.plugin.settings.blocklist.includes(m.alias));

    if (unlinkedMatches.length > 0) {
      const { section, keys, collapseAllBtn } = this.makeSection(container, "Unlinked Mentions");

      // Group by taxon
      const grouped = groupByTaxon(unlinkedMatches, this.plugin.settings.taxaMappings);
      for (const [taxon, matches] of grouped) {
        if (matches.length === 0) continue;
        const key = `unlinked:${taxon.prefix} ${taxon.label}`;
        keys.push(key);
        const groupContent = this.makeTaxaGroup(section, key, `${taxon.prefix} ${taxon.label}`);

        for (const match of matches) {
          this.renderUnlinkedMatch(groupContent, match, file, content);
        }
      }
      this.wireCollapseAll(collapseAllBtn, keys);
    }

    // Apply any active search filter to the freshly rendered rows.
    this.applyFilter();

    // Measure now and again next frame, once layout has flushed (offsetHeight
    // can read 0 synchronously on the very first render).
    this.updateStickyOffsets();
    window.requestAnimationFrame(() => this.updateStickyOffsets());
  }

  /**
   * Measure the pinned top bar and a section header, then publish their heights
   * as CSS variables so the nested sticky headers (section, then category)
   * stack flush beneath each other.
   */
  private updateStickyOffsets() {
    const stickyTop = this.contentEl.querySelector<HTMLElement>(".enfoliate-sticky-top");
    if (!stickyTop) return;
    const topH = stickyTop.offsetHeight;
    const sectionHeader = this.contentEl.querySelector<HTMLElement>(".enfoliate-section-header");
    const sectionH = sectionHeader ? sectionHeader.offsetHeight : 0;
    this.contentEl.style.setProperty("--ptf-sticky-top", `${topH}px`);
    this.contentEl.style.setProperty("--ptf-sticky-section", `${topH + sectionH}px`);
  }

  /**
   * Show only rows whose name/alias matches the search query, hiding categories
   * that end up empty. With a query active, matching categories are expanded so
   * hits inside collapsed groups are visible; clearing it restores collapse state.
   */
  private applyFilter() {
    const query = this.searchQuery.trim().toLowerCase();
    const groups = this.contentEl.querySelectorAll<HTMLElement>(".enfoliate-taxa-group");
    groups.forEach((group) => {
      const content = group.querySelector<HTMLElement>(".enfoliate-group-content");
      const rows = group.querySelectorAll<HTMLElement>("[data-search]");
      let anyVisible = false;
      rows.forEach((row) => {
        const show = !query || (row.dataset.search || "").includes(query);
        row.style.display = show ? "" : "none";
        if (show) anyVisible = true;
      });

      if (!query) {
        group.style.display = "";
        if (content) {
          const collapsed = this.plugin.settings.collapsedCategories.includes(
            group.dataset.collapseKey || ""
          );
          content.style.display = collapsed ? "none" : "";
        }
      } else {
        group.style.display = anyVisible ? "" : "none";
        if (content) content.style.display = anyVisible ? "" : "none";
      }
    });

    // Hide a section heading entirely when all its categories are filtered out.
    const sections = this.contentEl.querySelectorAll<HTMLElement>(".enfoliate-section");
    sections.forEach((section) => {
      if (!query) {
        section.style.display = "";
        return;
      }
      const visible = Array.from(
        section.querySelectorAll<HTMLElement>(".enfoliate-taxa-group")
      ).some((g) => g.style.display !== "none");
      section.style.display = visible ? "" : "none";
    });
  }

  /**
   * Create a collapsible taxa-category group. Returns the content element that
   * items should be appended to. Collapsed state is keyed by `key` and persisted
   * so it survives the sidebar's frequent re-renders.
   */
  private makeTaxaGroup(parent: HTMLElement, key: string, labelText: string): HTMLElement {
    const groupEl = parent.createDiv("enfoliate-taxa-group");
    groupEl.dataset.collapseKey = key;
    const isCollapsed = this.plugin.settings.collapsedCategories.includes(key);

    const header = groupEl.createDiv("enfoliate-group-header enfoliate-clickable");
    const chevron = header.createSpan({ cls: "enfoliate-group-chevron" });
    setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
    header.createSpan({ text: labelText, cls: "enfoliate-group-label" });

    const content = groupEl.createDiv("enfoliate-group-content");
    if (isCollapsed) content.style.display = "none";

    header.addEventListener("click", async () => {
      const set = new Set(this.plugin.settings.collapsedCategories);
      const nowCollapsed = !set.has(key);
      if (nowCollapsed) set.add(key);
      else set.delete(key);
      content.style.display = nowCollapsed ? "none" : "";
      setIcon(chevron, nowCollapsed ? "chevron-right" : "chevron-down");
      this.plugin.settings.collapsedCategories = [...set];
      await this.plugin.saveSettings();
    });

    return content;
  }

  /**
   * Create a section (Linked Mentions / Unlinked Mentions) with a heading and a
   * collapse/expand-all button. Returns the section element plus a keys array
   * to fill with each category's collapse key and the button to wire afterward.
   */
  private makeSection(
    container: HTMLElement,
    title: string
  ): { section: HTMLElement; keys: string[]; collapseAllBtn: HTMLElement } {
    const section = container.createDiv("enfoliate-section");
    const head = section.createDiv("enfoliate-section-header");
    head.createEl("h5", { text: title });
    const collapseAllBtn = head.createEl("button", {
      cls: "enfoliate-collapse-all-btn",
    });
    return { section, keys: [], collapseAllBtn };
  }

  /**
   * Wire a section's collapse/expand-all button. Collapses every category when
   * any is expanded; expands every category when all are already collapsed.
   */
  private wireCollapseAll(btn: HTMLElement, keys: string[]) {
    if (keys.length === 0) {
      btn.style.display = "none";
      return;
    }
    const allCollapsed = keys.every((k) =>
      this.plugin.settings.collapsedCategories.includes(k)
    );
    setIcon(btn, allCollapsed ? "chevrons-up-down" : "chevrons-down-up");
    btn.setAttribute("aria-label", allCollapsed ? "Expand all" : "Collapse all");
    btn.addEventListener("click", async () => {
      const set = new Set(this.plugin.settings.collapsedCategories);
      if (allCollapsed) keys.forEach((k) => set.delete(k));
      else keys.forEach((k) => set.add(k));
      this.plugin.settings.collapsedCategories = [...set];
      await this.plugin.saveSettings();
      this.refresh();
    });
  }

  /**
   * Render a row's actions: inline buttons for the ids enabled in settings, plus
   * a right-click context menu that always exposes every action.
   */
  private renderRowActions(row: HTMLElement, container: HTMLElement, actions: RowAction[]) {
    for (const action of actions) {
      if (action.inline === false) continue;
      if (!this.plugin.settings.inlineActions.includes(action.id)) continue;
      const btn = container.createEl("button", {
        cls: "enfoliate-action-btn",
        attr: { "aria-label": action.label },
      });
      setIcon(btn, action.icon);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void action.run();
      });
    }

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      for (const action of actions) {
        menu.addItem((mi) =>
          mi.setTitle(action.label).setIcon(action.icon).onClick(() => void action.run())
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  /** An already-open source-mode editor for the file, or null. Never opens one. */
  private findOpenEditor(noteFile: TFile): Editor | null {
    let found: Editor | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (
        !found &&
        leaf.view instanceof MarkdownView &&
        leaf.view.file === noteFile &&
        leaf.view.getMode() === "source"
      ) {
        found = leaf.view.editor;
      }
    });
    return found;
  }

  /**
   * Wrap the given occurrences with wikilinks to linkTarget. When the note has
   * an open source-mode editor whose text still matches the captured offsets,
   * apply through a single editor transaction so Ctrl/Cmd+Z undoes it; otherwise
   * rewrite the file back-to-front via the vault.
   */
  private async applyLinks(noteFile: TFile, linkTarget: string, positions: MatchPosition[]) {
    if (positions.length === 0) return;
    const wikilinkFor = (p: MatchPosition) => `[[${linkTarget}|${p.surface}]]`;

    const editor = this.findOpenEditor(noteFile);
    if (editor) {
      const text = editor.getValue();
      // Only trust the captured offsets if the editor text still matches them.
      const aligned = positions.every(
        (p) => text.substring(p.offset, p.offset + p.len) === p.surface
      );
      if (aligned) {
        const changes = [...positions]
          .sort((a, b) => a.offset - b.offset)
          .map((p) => ({
            from: editor.offsetToPos(p.offset),
            to: editor.offsetToPos(p.offset + p.len),
            text: wikilinkFor(p),
          }));
        editor.transaction({ changes });
        return;
      }
    }

    const content = await this.app.vault.read(noteFile);
    let newContent = content;
    for (const p of [...positions].sort((a, b) => b.offset - a.offset)) {
      newContent =
        newContent.substring(0, p.offset) +
        wikilinkFor(p) +
        newContent.substring(p.offset + p.len);
    }
    await this.app.vault.modify(noteFile, newContent);
  }

  /**
   * Link the given (unlinked) occurrences of an already-linked file — used by
   * "Link all occurrences" on a Linked Mentions row.
   */
  private async linkPositions(noteFile: TFile, linkTarget: string, positions: MatchPosition[]) {
    if (positions.length === 0) return;
    await this.applyLinks(noteFile, linkTarget, positions);
    const n = positions.length;
    new Notice(`Linked ${n} ${n > 1 ? "occurrences" : "occurrence"}`);
    this.refreshAfterMetadataUpdate(noteFile);
  }

  private renderUnlinkedMatch(
    container: HTMLElement,
    match: UnlinkedMatch,
    noteFile: TFile,
    fullContent: string
  ) {
    const row = container.createDiv("enfoliate-suggestion-row");
    row.dataset.search = `${match.fileName} ${match.alias} ${match.matchText}`.toLowerCase();

    // Top line: name + action buttons
    const top = row.createDiv("enfoliate-suggestion-top");

    const info = top.createDiv("enfoliate-suggestion-info");
    const nameSpan = info.createSpan({
      // Show the file's title including its taxa prefix, not the bare alias.
      text: match.fileName,
      cls: "enfoliate-match-text enfoliate-clickable",
    });
    nameSpan.addEventListener("click", (evt) => {
      this.handleItemClick(evt, match.fileName, noteFile.path, () => {
        this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length);
      });
    });

    const actionsEl = top.createDiv("enfoliate-suggestion-actions");

    const rowActions: RowAction[] = [
      {
        id: "link",
        label: "Link first occurrence",
        icon: "replace",
        run: () => this.linkUnlinkedMatch(match, noteFile, false),
      },
    ];
    if (match.positions.length > 1) {
      rowActions.push({
        id: "linkAll",
        label: "Link all occurrences",
        icon: "replace-all",
        run: () => this.linkUnlinkedMatch(match, noteFile, true),
      });
    }
    rowActions.push(
      {
        id: "open",
        label: "Open note",
        icon: "external-link",
        run: () => this.app.workspace.openLinkText(match.fileName, noteFile.path, false),
      },
      {
        id: "jump",
        label: "Jump to occurrence",
        icon: "crosshair",
        inline: false,
        run: () =>
          this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length),
      },
      {
        id: "ignore",
        label: "Always ignore",
        icon: "eye-off",
        run: async () => {
          this.plugin.settings.blocklist.push(match.alias);
          await this.plugin.saveSettings();
          this.refresh();
        },
      },
      {
        id: "dismiss",
        label: "Dismiss",
        icon: "x",
        run: () => {
          this.dismissed.add(match.filePath);
          this.refresh();
        },
      }
    );
    this.renderRowActions(row, actionsEl, rowActions);

    // Bottom line: metadata
    const meta = row.createDiv("enfoliate-suggestion-meta");
    meta.createSpan({
      text: `(${match.positions.length} ${match.positions.length > 1 ? "mentions" : "mention"})`,
      cls: "enfoliate-meta-chunk",
    });
  }

  private async linkUnlinkedMatch(
    match: UnlinkedMatch,
    noteFile: TFile,
    linkAll: boolean
  ) {
    // Each occurrence links with its own surface form, so an alias hit becomes
    // [[Full Name|ZPD]] while a full-name hit links as itself.
    const positions = linkAll ? match.positions : [match.positions[0]];
    await this.applyLinks(noteFile, match.fileName, positions);
    const count = positions.length;
    new Notice(
      `Linked ${match.alias} (${count} ${count > 1 ? "occurrences" : "occurrence"})`
    );
    this.refreshAfterMetadataUpdate(noteFile);
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
    this.refreshAfterMetadataUpdate(noteFile);
  }

  private async renderLinkedTaxa(container: HTMLElement, file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links || [];
    const content = await this.app.vault.cachedRead(file);
    const bodyStart = bodyStartOffset(content);

    // Group linked taxa by mapping, collecting positions
    interface LinkedItem {
      title: string; // file basename incl. prefix, shown in the sidebar
      matchName: string; // link display text / alias, used to find plain-text occurrences
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
            // What appears in prose (alias or display text), used to find
            // plain-text occurrences; and the file's own title with prefix,
            // shown in the sidebar.
            const matchName = link.displayText || link.link;
            const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
            const title = dest ? dest.basename : link.link;
            // Keyed by offset so wikilink, display-name, and alias hits dedupe.
            const byOffset = new Map<number, MatchPosition>();

            // Find wikilink positions (the actual links to this file)
            const wikiPattern = `[[${link.link}`;
            let searchFrom = 0;
            while (searchFrom < content.length) {
              const idx = content.indexOf(wikiPattern, searchFrom);
              if (idx === -1) break;
              if (idx >= bodyStart) {
                byOffset.set(idx, { offset: idx, len: wikiPattern.length, surface: wikiPattern });
              }
              searchFrom = idx + wikiPattern.length;
            }
            const linkedCount = byOffset.size;

            // Find plain text occurrences of the match name. Use the same
            // word-boundary-aware finder as unlinked detection so a short alias
            // like "AI" doesn't match inside words ("faithful", "claim").
            if (matchName.length >= 2) {
              for (const idx of findUnlinkedPositions(content, matchName)) {
                // Skip frontmatter and positions overlapping a wikilink
                if (
                  idx >= bodyStart &&
                  !byOffset.has(idx) &&
                  ![...byOffset.keys()].some((p) => Math.abs(p - idx) < wikiPattern.length + 2)
                ) {
                  byOffset.set(idx, {
                    offset: idx,
                    len: matchName.length,
                    surface: content.substring(idx, idx + matchName.length),
                  });
                }
              }
            }

            // Fold in unlinked occurrences of this file's other aliases
            // (e.g. "ZPD" for an already-linked Zone of Proximal Development).
            if (this.plugin.settings.matchLinkedAliases && dest) {
              for (const mp of findFileMatchPositions(this.app, content, dest, mapping, bodyStart)) {
                if (!byOffset.has(mp.offset)) byOffset.set(mp.offset, mp);
              }
            }

            const positions = [...byOffset.values()].sort((a, b) => a.offset - b.offset);

            items.push({
              title,
              matchName,
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

    const { section, keys, collapseAllBtn } = this.makeSection(container, "Linked Mentions");

    for (const [mapping, items] of grouped) {
      if (items.length === 0) continue;

      const key = `linked:${mapping.prefix} ${mapping.label}`;
      keys.push(key);
      const groupContent = this.makeTaxaGroup(section, key, `${mapping.prefix} ${mapping.label}`);

      for (const item of items) {
        const row = groupContent.createDiv("enfoliate-linked-row");
        row.dataset.search = `${item.title} ${item.matchName} ${item.link}`.toLowerCase();
        const info = row.createDiv("enfoliate-linked-info");
        const nameSpan = info.createSpan({
          text: item.title,
          cls: "enfoliate-linked-name enfoliate-clickable",
        });
        const jumpKey = `linked:${item.link}`;
        nameSpan.addEventListener("click", (evt) => {
          this.handleItemClick(evt, item.link, file.path, () => {
            if (item.positions.length > 0) {
              this.jumpToOccurrence(jumpKey, item.positions, content, file, item.matchName.length);
            }
          });
        });
        if (item.positions.length > 0) {
          info.createSpan({
            text:
              item.unlinkedCount > 0
                ? ` (${item.positions.length}, ${item.unlinkedCount} unlinked)`
                : ` (${item.positions.length})`,
            cls: "enfoliate-match-count",
          });
        }

        const linkedActions = row.createDiv("enfoliate-linked-actions");

        // Plain-text (not-yet-linked) occurrences of this already-linked file.
        const unlinkedPositions = item.positions.filter((p) => !p.surface.startsWith("[["));

        const rowActions: RowAction[] = [];
        if (unlinkedPositions.length > 0) {
          rowActions.push({
            id: "linkAll",
            label: "Link all occurrences",
            icon: "replace-all",
            run: () => this.linkPositions(file, item.link, unlinkedPositions),
          });
        }
        rowActions.push(
          {
            id: "jump",
            label: "Jump to occurrence",
            icon: "crosshair",
            inline: false,
            run: () => {
              if (item.positions.length > 0) {
                this.jumpToOccurrence(jumpKey, item.positions, content, file, item.matchName.length);
              }
            },
          },
          {
            id: "unlink",
            label: "Unlink",
            icon: "unlink",
            run: () => this.unlinkTaxaFromNote(item.link, item.title, file),
          },
          {
            id: "open",
            label: "Open note",
            icon: "external-link",
            run: () => this.app.workspace.openLinkText(item.link, file.path, false),
          }
        );
        this.renderRowActions(row, linkedActions, rowActions);
      }
    }

    this.wireCollapseAll(collapseAllBtn, keys);
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
