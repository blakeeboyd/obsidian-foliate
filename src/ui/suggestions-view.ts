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
  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;

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
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener("scroll", this.scrollHandler);
    }
    this.scrollEl = null;
    this.scrollHandler = null;
  }

  /**
   * The visible document offset range of the active editor for `noteFile`, or
   * null when there's no source-mode editor to read (e.g. reading mode). Used to
   * scope mentions to what's on screen and to pick the link target.
   */
  private visibleRange(noteFile: TFile | null): { from: number; to: number } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== noteFile || view.getMode() !== "source") return null;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (!cm || !cm.scrollDOM) return null;
    const rect = cm.scrollDOM.getBoundingClientRect();
    const from = cm.posAtCoords({ x: rect.left + 4, y: rect.top + 4 });
    const to = cm.posAtCoords({ x: rect.left + 4, y: rect.bottom - 4 });
    if (from == null || to == null) return null;
    return { from: Math.min(from, to), to: Math.max(from, to) };
  }

  /**
   * Keep a scroll listener attached to the active editor when "Limit to visible
   * area" is on, so the sidebar re-scopes as the user scrolls. Idempotent:
   * removes any previous listener first.
   */
  private registerScrollListener() {
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener("scroll", this.scrollHandler);
    }
    this.scrollEl = null;
    this.scrollHandler = null;
    if (!this.plugin.settings.scopeToView) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== this.currentFile) return;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    const el = cm?.scrollDOM;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.refresh(), 150);
    };
    el.addEventListener("scroll", handler);
    this.scrollEl = el;
    this.scrollHandler = handler;
  }

  /** Sort entries within a category per the "Sort entries" setting. */
  private sortEntries<T>(arr: T[], name: (t: T) => string, count: (t: T) => number): T[] {
    const order = this.plugin.settings.sortOrder;
    return [...arr].sort((a, b) => {
      const na = name(a);
      const nb = name(b);
      switch (order) {
        case "name-asc":
          return na.localeCompare(nb);
        case "name-desc":
          return nb.localeCompare(na);
        case "mentions-asc":
          return count(a) - count(b) || na.localeCompare(nb);
        default: // mentions-desc
          return count(b) - count(a) || na.localeCompare(nb);
      }
    });
  }

  /** First occurrence within the viewport (or at/after its top), else the first. */
  private firstVisible(positions: MatchPosition[]): MatchPosition {
    const range = this.visibleRange(this.currentFile);
    if (range) {
      const within = positions.find((p) => p.offset >= range.from && p.offset <= range.to);
      if (within) return within;
      const after = positions.find((p) => p.offset >= range.from);
      if (after) return after;
    }
    return positions[0];
  }

  /**
   * Which occurrence the single "Link" action should wrap: the one the user last
   * jumped to for this term (if any), else the first in the viewport, else the
   * first in the document.
   */
  private linkTargetPosition(key: string, positions: MatchPosition[]): MatchPosition {
    const stored = this.jumpIndex.get(key);
    if (stored != null && stored > 0 && positions.length > 0) {
      return positions[(stored - 1) % positions.length];
    }
    return this.firstVisible(positions);
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

    // Wrap the matched text in a real span using the same class (and fade
    // animation) as the editor highlight, so reading mode matches edit mode for
    // color and fade. A span is also far more stable than a Custom Highlight
    // API Range, which invalidates when the preview relayouts. Returns true once
    // a highlight is placed.
    const place = (target: Range): boolean => {
      target.startContainer.parentElement?.scrollIntoView({ block: "center" });
      const span = document.createElement("span");
      span.className = "enfoliate-jump-highlight";
      const color = this.plugin.settings.highlightColor;
      if (color) span.style.setProperty("--enfoliate-highlight-color", color);
      span.style.setProperty(
        "--enfoliate-highlight-duration",
        `${this.plugin.settings.highlightDurationSeconds}s`
      );
      try {
        target.surroundContents(span);
      } catch {
        return false; // range crosses element boundaries; can't wrap cleanly
      }
      window.setTimeout(() => {
        // Unwrap, restoring the original text. Skip if Obsidian already
        // re-rendered the section (span detached).
        const parent = span.parentElement;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      }, this.highlightMs());
      return true;
    };

    const highlight = (): boolean => {
      const root = preview?.containerEl as HTMLElement | undefined;
      if (!root) return false;

      // Prefer resolving within the section containing the target line. Reading
      // view renders lazily, so a global count is unreliable; within one fully
      // rendered section the occurrence's index matches the rendered order.
      const section = this.findPreviewSection(preview, root, line);
      if (section) {
        const ranges = findRanges(section.el);
        if (ranges.length) {
          const index = countBefore(this.offsetOfLine(content, section.lineStart));
          return place(ranges[Math.min(index, ranges.length - 1)]);
        }
      }

      // Fallback: search the whole preview so highlighting still works even if
      // the section lookup comes up empty.
      const ranges = findRanges(root);
      if (!ranges.length) return false;
      const index = countBefore(bodyStartOffset(content));
      return place(ranges[Math.min(index, ranges.length - 1)]);
    };

    // Render the target first (applyScroll), then highlight. Reading view
    // renders lazily after the scroll, so retry until the section exists.
    if (preview && typeof preview.applyScroll === "function") {
      preview.applyScroll(line);
    }
    if (wantsHighlight) {
      let attempts = 0;
      const attempt = () => {
        if (highlight()) return;
        if (++attempts < 6) window.setTimeout(attempt, 80);
      };
      window.setTimeout(attempt, 50);
    }
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
   * Build the pinned header: the "Enfoliate" title, a toggle for limiting to the
   * visible area, and — when auto-scan is off — a Scan button.
   */
  private buildStickyHeader(stickyTop: HTMLElement) {
    const header = stickyTop.createDiv("enfoliate-suggestions-header");
    header.createEl("h4", { text: "Enfoliate" });

    const controls = header.createDiv("enfoliate-header-controls");

    const viewBtn = controls.createEl("button", {
      cls: "enfoliate-action-btn",
      attr: { "aria-label": "Limit to visible area" },
    });
    setIcon(viewBtn, "eye");
    if (this.plugin.settings.scopeToView) viewBtn.addClass("is-active");
    viewBtn.addEventListener("click", async () => {
      this.plugin.settings.scopeToView = !this.plugin.settings.scopeToView;
      await this.plugin.saveSettings();
      this.refresh();
    });

    if (!this.plugin.settings.autoScan) {
      const scanBtn = controls.createEl("button", {
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
    // Keep the scroll listener matched to the current setting and editor.
    this.registerScrollListener();

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
    // When "Limit to visible area" is on, scope mentions to the editor viewport.
    const viewRange = this.plugin.settings.scopeToView ? this.visibleRange(file) : null;

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
    await this.renderLinkedTaxa(container, file, viewRange);

    // Layer 1: Unlinked Matches. Already-linked files are excluded here so a
    // file never appears in both sections; its unlinked alias occurrences
    // surface under Linked Mentions instead (when "Match aliases" is on).
    let unlinkedMatches = findUnlinkedMatches(
      this.app,
      content,
      file,
      this.plugin.settings.taxaMappings,
      false
    ).filter((m) => !this.dismissed.has(m.filePath) && !this.plugin.settings.blocklist.includes(m.alias));

    // Scope to the viewport: keep only occurrences on screen, drop empty matches.
    if (viewRange) {
      unlinkedMatches = unlinkedMatches
        .map((m) => ({
          ...m,
          positions: m.positions.filter((p) => p.offset >= viewRange.from && p.offset <= viewRange.to),
        }))
        .filter((m) => m.positions.length > 0);
    }

    if (unlinkedMatches.length > 0) {
      const { section, keys, collapseAllBtn } = this.makeSection(container, "Unlinked Mentions");

      // Group by taxon
      const grouped = groupByTaxon(unlinkedMatches, this.plugin.settings.taxaMappings);
      for (const [taxon, matches] of grouped) {
        if (matches.length === 0) continue;
        const key = `unlinked:${taxon.prefix} ${taxon.label}`;
        keys.push(key);
        const groupContent = this.makeTaxaGroup(section, key, `${taxon.prefix} ${taxon.label}`);

        const sorted = this.sortEntries(matches, (m) => m.fileName, (m) => m.positions.length);
        for (const match of sorted) {
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
        label: "Link this occurrence",
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
    // [[Full Name|ZPD]] while a full-name hit links as itself. The single link
    // targets the occurrence the user last jumped to, else the first in view.
    const positions = linkAll
      ? match.positions
      : [this.linkTargetPosition(match.filePath, match.positions)];
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

  private async renderLinkedTaxa(
    container: HTMLElement,
    file: TFile,
    viewRange: { from: number; to: number } | null
  ) {
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

            const allPositions = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
            // When scoping to the viewport, keep only on-screen occurrences.
            const positions = viewRange
              ? allPositions.filter((p) => p.offset >= viewRange.from && p.offset <= viewRange.to)
              : allPositions;
            if (positions.length > 0) {
              // Linked (wikilink) positions have surface "[[…"; the rest are unlinked.
              const linkedVisible = positions.filter((p) => p.surface.startsWith("[[")).length;
              items.push({
                title,
                matchName,
                link: link.link,
                positions,
                unlinkedCount: positions.length - linkedVisible,
              });
            }
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

      const sortedItems = this.sortEntries(items, (i) => i.title, (i) => i.positions.length);
      for (const item of sortedItems) {
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
