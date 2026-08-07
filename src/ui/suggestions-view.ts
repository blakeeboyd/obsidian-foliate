import { Editor, ItemView, Menu, Notice, TFile, WorkspaceLeaf, MarkdownView, setIcon } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type FoliatePlugin from "../main";
import { UnlinkedMatch, TaxaMapping, MatchPosition, HiddenMatch } from "../types";
import { findUnlinkedMatches, findFileMatchPositions, findUnlinkedPositions, findExcludedRegions, bodyStartOffset, isInsideWikilink } from "../services/unlinked-matcher";
import { createTaxaFile, addAliasToFile } from "../services/file-operations";
import { mineContextTerms, fileTerms } from "../services/context-mining";
import { stripPrefix, findTaxonByPrefix } from "../taxa";
import { FOLIATE_ICON_ID } from "../icon";

const addHighlight = StateEffect.define<{ from: number; to: number }>();
const clearHighlight = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(addHighlight)) {
        const mark = Decoration.mark({ class: "foliate-jump-highlight" });
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

export const SUGGESTIONS_VIEW_TYPE = "foliate-suggestions";

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
  // Show as an inline button regardless of the user's inlineActions allowlist.
  // For intrinsic affordances (e.g. "Create file" on an unresolved row) that
  // aren't user-configurable inline actions.
  forceInline?: boolean;
  // Draw a divider in the context menu just above this item, to set apart the
  // actions below it (e.g. the removal actions) from the safe ones above.
  // Ignored by the inline-button renderer.
  separatorBefore?: boolean;
}

export class SuggestionsView extends ItemView {
  plugin: FoliatePlugin;
  private dismissed: Set<string> = new Set();
  private currentFile: TFile | null = null;
  private searchQuery = "";
  private stickyObserver: ResizeObserver | null = null;
  private jumpIndex: Map<string, number> = new Map();
  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  // Hidden-connection groups already defaulted to collapsed this session, so a
  // group the user deliberately expanded isn't re-collapsed on the next render.
  private seenHiddenKeys: Set<string> = new Set();
  private lastContent = "";

  constructor(leaf: WorkspaceLeaf, plugin: FoliatePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SUGGESTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Foliate";
  }

  getIcon(): string {
    return FOLIATE_ICON_ID;
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
    const cm = this.editorViewFor(noteFile);
    if (!cm) return null;
    const ranges = cm.visibleRanges;
    if (!ranges.length) return null;
    return { from: ranges[0].from, to: ranges[ranges.length - 1].to };
  }

  /** The CodeMirror view of an open source-mode editor for the file, or null. */
  private editorViewFor(noteFile: TFile | null): EditorView | null {
    if (!noteFile) return null;
    let found: EditorView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (
        !found &&
        view instanceof MarkdownView &&
        view.file === noteFile &&
        view.getMode() === "source"
      ) {
        found = (view.editor as unknown as { cm?: EditorView }).cm ?? null;
      }
    });
    return found;
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

    const cm = this.editorViewFor(this.currentFile);
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

  /** Show a row's full action set as a context menu at the event position. */
  private showActionMenu(evt: MouseEvent, actions: RowAction[]) {
    const menu = new Menu();
    for (const action of actions) {
      if (action.separatorBefore) menu.addSeparator();
      menu.addItem((mi) =>
        mi.setTitle(action.label).setIcon(action.icon).onClick(() => void action.run())
      );
    }
    menu.showAtMouseEvent(evt);
  }

  /**
   * Run the configured action for a click on a sidebar item, choosing the
   * binding by held modifier (precedence: Cmd/Ctrl, then Alt/Option, then Shift,
   * else plain click). Jumps to the next occurrence, opens the note (current
   * tab / new tab / split / new window), copies a wikilink, or opens the row's
   * options menu. openLinkText handles link resolution and main-area targeting.
   */
  private handleItemClick(
    evt: MouseEvent,
    linkText: string,
    sourcePath: string,
    jump: () => void,
    showMenu: () => void
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
    if (action === "menu") {
      showMenu();
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
      span.className = "foliate-jump-highlight";
      const color = this.plugin.settings.highlightColor;
      if (color) span.style.setProperty("--foliate-highlight-color", color);
      span.style.setProperty(
        "--foliate-highlight-duration",
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
        "--foliate-highlight-duration",
        `${this.plugin.settings.highlightDurationSeconds}s`
      );
      if (color) el.style.setProperty("--foliate-highlight-color", color);
    }

    cm.dispatch({ effects: addHighlight.of({ from: fromOffset, to: toOffset }) });

    setTimeout(() => {
      cm.dispatch({ effects: clearHighlight.of(null) });
      if (el) {
        el.style.removeProperty("--foliate-highlight-duration");
        if (color) el.style.removeProperty("--foliate-highlight-color");
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

    // Only markdown notes can be scanned. Reading a non-note (PDF, image,
    // canvas, audio) would feed binary/non-markdown content to the scanner and
    // hang the main thread, which froze Obsidian and starved other plugins
    // (e.g. PDF++). Treat anything else as "nothing to scan".
    if (file.extension !== "md") {
      this.currentFile = null;
      this.dismissed.clear();
      this.jumpIndex.clear();
      this.renderEmptyState("Open a note to see suggestions.");
      return;
    }

    this.currentFile = file;
    this.dismissed.clear();
    this.jumpIndex.clear();

    if (this.plugin.settings.autoScan) {
      this.refresh();
    } else {
      this.renderScanPrompt();
    }
  }

  /** Render a simple idle/empty message, clearing any prior content. */
  private renderEmptyState(message: string) {
    const container = this.contentEl;
    container.empty();
    container.createEl("p", { text: message, cls: "foliate-empty-state" });
  }

  /**
   * Build the pinned header: the "Foliate" title, a shortcut to Foliate's
   * settings, and two conditional buttons. The eye appears only when
   * view-scoping is on, the Scan button only when auto-scan is off.
   */
  private buildStickyHeader(stickyTop: HTMLElement) {
    const header = stickyTop.createDiv("foliate-suggestions-header");
    header.createEl("h4", { text: "Foliate" });

    const controls = header.createDiv("foliate-header-controls");

    // Only once the feature is enabled. The button is a quick way to turn
    // view-scoping off again while using it, which is worth a header slot only
    // to someone who turned it on in the first place.
    if (this.plugin.settings.scopeToView) {
      const viewBtn = controls.createEl("button", {
        cls: "foliate-action-btn is-active",
        attr: { "aria-label": "Limit to visible area" },
      });
      setIcon(viewBtn, "eye");
      viewBtn.addEventListener("click", async () => {
        this.plugin.settings.scopeToView = false;
        await this.plugin.saveSettings();
        this.refresh();
      });
    }

    // Foliate's own settings, rather than Obsidian's plugin list. Most of what
    // the sidebar shows is governed by them, so reaching them from here saves a
    // trip through Settings > Community plugins.
    const settingsBtn = controls.createEl("button", {
      cls: "foliate-action-btn",
      attr: { "aria-label": "Foliate settings" },
    });
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => {
      const app = this.app as unknown as {
        setting: {
          open: () => void;
          openTabById: (id: string) => void;
        };
      };
      app.setting.open();
      app.setting.openTabById(this.plugin.manifest.id);
    });

    if (!this.plugin.settings.autoScan) {
      const scanBtn = controls.createEl("button", {
        cls: "foliate-scan-btn mod-cta",
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
        cls: "foliate-empty-state",
      });
      return;
    }
    const stickyTop = container.createDiv("foliate-sticky-top");
    this.buildStickyHeader(stickyTop);
    container.createEl("p", {
      text: "Auto-scan is off. Click Scan to analyze this note.",
      cls: "foliate-empty-state",
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
        cls: "foliate-empty-state",
      });
      return;
    }
    // Guard: never read or scan a non-markdown file (see onActiveFileChange).
    if (file.extension !== "md") {
      container.createEl("p", {
        text: "Open a note to see suggestions.",
        cls: "foliate-empty-state",
      });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    // Kept so the "Why is this shown?" report can re-check context terms against
    // the same text the scan used, without another read.
    this.lastContent = content;
    // When "Limit to visible area" is on, scope mentions to the editor viewport.
    const viewRange = this.plugin.settings.scopeToView ? this.visibleRange(file) : null;

    // Sticky top bar: title + search stay pinned as the list scrolls.
    const stickyTop = container.createDiv("foliate-sticky-top");

    this.buildStickyHeader(stickyTop);

    // Search / filter box (optional)
    if (this.plugin.settings.showSearchBar) {
      const searchWrap = stickyTop.createDiv("foliate-search");
      const searchInput = searchWrap.createEl("input", {
        type: "text",
        cls: "foliate-search-input",
        attr: { placeholder: "Filter taxa..." },
      });
      searchInput.value = this.searchQuery;

      // Clear button — shown only while there's a query.
      const clearBtn = searchWrap.createEl("button", {
        cls: "foliate-search-clear",
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
    // Collected only when the section is on, so the extra position scan for
    // suppressed terms is skipped entirely when nobody will look at it.
    const hiddenMatches: HiddenMatch[] = [];
    let unlinkedMatches = findUnlinkedMatches(
      this.app,
      content,
      file,
      this.plugin.settings.taxaMappings,
      {
        contextAware: this.plugin.activeContextAware(),
        hidden: this.plugin.settings.showHiddenConnections ? hiddenMatches : undefined,
        surnameTaxon: this.plugin.surnameTaxon(),
        matchDeclaredAcronyms: this.plugin.settings.matchDeclaredAcronyms,
      }
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

    // Hidden connections: mentions the gate found but withheld. Collapsed by
    // default, so the gating stays out of the way while remaining inspectable.
    this.renderHiddenConnections(container, hiddenMatches);

    // Backlinks: on a taxa/domain file, the other taxa/domain files that link to
    // it, grouped by type. Filters out source-note backlinks (the native pane
    // has those); shows the taxa relationships without the noise.
    this.renderTaxaBacklinks(container, file);

    // Apply any active search filter to the freshly rendered rows.
    this.applyFilter();

    // Measure now and again next frame, once layout has flushed (offsetHeight
    // can read 0 synchronously on the very first render).
    this.updateStickyOffsets();
    window.requestAnimationFrame(() => this.updateStickyOffsets());
  }

  /**
   * Explain why a mention surfaced in this note: the data behind the decision,
   * not just the verdict. Counterpart to the Hidden connections section, which
   * explains the withheld ones.
   *
   * Today the gate has one input (hand-entered context terms), so the report is
   * short. It is written to grow: as mined signals land, each contributes a line
   * here, which is what makes the scoring inspectable rather than a black box.
   */
  /**
   * Whether the text that surfaced this row is one of the file's own terms (its
   * name or a saved alias). False means a note-local rule matched it: a declared
   * acronym or a second-reference surname. Those are the ones worth offering to
   * save as an alias, since saving an existing term would be a no-op.
   */
  private isOwnTerm(match: UnlinkedMatch): boolean {
    const file = this.app.vault.getAbstractFileByPath(match.filePath);
    if (!(file instanceof TFile)) return true;
    const terms = fileTerms(this.app, file, match.taxon).map((t) => t.toLowerCase());
    return terms.includes(match.matchText.toLowerCase());
  }

  private explainMatch(match: UnlinkedMatch) {
    const lines: string[] = [];
    const gate = this.plugin.activeContextAware()[match.filePath];

    lines.push(`${match.fileName} — ${match.positions.length} mention${match.positions.length === 1 ? "" : "s"} in this note`);

    if (!this.plugin.settings.contextAwareEnabled) {
      lines.push("Context gating is off, so every match surfaces.");
    } else if (!gate) {
      lines.push("Not context-gated: its terms always surface when they match.");
    } else if (this.isTermGated(match)) {
      const present = (gate.terms ?? []).filter(
        (t) => t.length >= 2 && findUnlinkedPositions(this.lastContent, t).length > 0
      );
      lines.push(`"${match.matchText}" is context-gated for this file.`);
      lines.push(
        present.length > 0
          ? `Shown because this note mentions: ${present.slice(0, 8).join(", ")}${present.length > 8 ? ", …" : ""}`
          : "Shown because a related term was found in this note."
      );
    } else {
      const gated = gate.gatedAliases ?? [];
      lines.push(
        gated.length > 0
          ? `"${match.matchText}" is not gated for this file (gated: ${gated.join(", ")}), so it always surfaces.`
          : "This file has a context entry but gates no terms, so everything surfaces."
      );
    }

    new Notice(lines.join("\n"), 10000);
  }

  /**
   * Render "Hidden connections": mentions found in the note that the context
   * gate withheld. Without this, a gated mention just vanishes and there is no
   * way to tell a deliberate decision from a bug, or to notice a connection the
   * gate got wrong. Each row names the reason, so the gating is inspectable
   * without being intrusive: the section is collapsed unless expanded, and off
   * entirely unless the setting is on.
   */
  private renderHiddenConnections(container: HTMLElement, hidden: HiddenMatch[]) {
    if (!this.plugin.settings.showHiddenConnections || hidden.length === 0) return;

    const { section, keys, collapseAllBtn } = this.makeSection(container, "Hidden connections");
    section.addClass("foliate-hidden-section");

    const grouped = new Map<TaxaMapping, HiddenMatch[]>();
    for (const h of hidden) {
      const list = grouped.get(h.taxon);
      if (list) list.push(h);
      else grouped.set(h.taxon, [h]);
    }

    for (const [taxon, items] of grouped) {
      const key = `hidden:${taxon.prefix} ${taxon.label}`;
      keys.push(key);
      const groupContent = this.makeTaxaGroup(section, key, `${taxon.prefix} ${taxon.label}`);

      for (const item of [...items].sort((a, b) => b.occurrences - a.occurrences)) {
        const row = groupContent.createDiv("foliate-row foliate-hidden-row");
        row.dataset.search = `${item.fileName} ${item.filePath}`.toLowerCase();

        const title = row.createDiv("foliate-hidden-title");
        title.createSpan({ text: item.fileName });
        title.createSpan({
          cls: "foliate-hidden-count",
          text: item.occurrences === 1 ? "1 mention" : `${item.occurrences} mentions`,
        });

        // The reason is available on demand, not printed under every row. What
        // the reader wants at a glance is WHICH mentions were withheld; why any
        // particular one was is a follow-up question, and spelling it out for
        // each made the section louder than the mentions above it.
        row.setAttribute("aria-label", item.detail);

        // Opening the file is the fix path: the user judges the call and edits
        // the file's context terms if the gate got it wrong.
        row.addEventListener("click", () => {
          const f = this.app.vault.getAbstractFileByPath(item.filePath);
          if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
        });

        // Right-click for the reason, matching "Why is this shown?" on a
        // visible row.
        row.addEventListener("contextmenu", (evt) => {
          evt.preventDefault();
          const menu = new Menu();
          menu.addItem((mi) =>
            mi
              .setTitle("Why is this hidden?")
              .setIcon("help-circle")
              .onClick(() => new Notice(`${item.fileName}\n\n${item.detail}`, 10000))
          );
          menu.addItem((mi) =>
            mi
              .setTitle("Open note")
              .setIcon("file-text")
              .onClick(() => {
                const f = this.app.vault.getAbstractFileByPath(item.filePath);
                if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
              })
          );
          menu.showAtMouseEvent(evt);
        });
      }
    }

    // Collapsed on first sight: visible when looked for, quiet otherwise.
    const stored = new Set(this.plugin.settings.collapsedCategories);
    let changed = false;
    for (const k of keys) {
      if (!stored.has(k) && !this.seenHiddenKeys.has(k)) {
        stored.add(k);
        this.seenHiddenKeys.add(k);
        changed = true;
      }
    }
    if (changed) {
      this.plugin.settings.collapsedCategories = [...stored];
      void this.plugin.saveSettings();
    }

    this.wireCollapseAll(collapseAllBtn, keys);
  }

  /**
   * On a taxa or domain file, render a "Backlinks" section: the other taxa and
   * domain files that link to this one, grouped by taxon type. Source-note
   * backlinks are excluded (the native Backlinks pane covers those); this shows
   * only the taxa-to-taxa relationships, which for a domain file are its members.
   * Hidden entirely when the active file isn't a taxon or domain.
   */
  private renderTaxaBacklinks(container: HTMLElement, file: TFile) {
    const mappings = [...this.plugin.settings.taxaMappings, this.plugin.settings.domain];
    // Only on taxa/domain files.
    if (!findTaxonByPrefix(file.basename, mappings)) return;

    // Reverse-walk resolvedLinks: sources that link to this file, kept only when
    // the source is itself a taxa/domain file (carries a matching prefix).
    const resolved = this.app.metadataCache.resolvedLinks;
    const backTaxa: { file: TFile; taxon: TaxaMapping }[] = [];
    for (const [sourcePath, dests] of Object.entries(resolved)) {
      if (!(file.path in dests)) continue;
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof TFile)) continue;
      const taxon = findTaxonByPrefix(source.basename, mappings);
      if (taxon) backTaxa.push({ file: source, taxon });
    }
    if (backTaxa.length === 0) return;

    const { section, keys, collapseAllBtn } = this.makeSection(container, "Backlinks");
    for (const mapping of mappings) {
      const members = backTaxa.filter((b) => b.taxon === mapping);
      if (members.length === 0) continue;
      const key = `backlinks:${mapping.prefix} ${mapping.label}`;
      keys.push(key);
      const group = this.makeTaxaGroup(section, key, `${mapping.prefix} ${mapping.label}`);
      const sorted = [...members].sort((a, b) => a.file.basename.localeCompare(b.file.basename));
      for (const { file: bf } of sorted) {
        const row = group.createDiv("foliate-linked-row");
        // applyFilter only considers rows carrying data-search; without it a
        // search query would match nothing here and hide the whole section.
        row.dataset.search = `${bf.basename} ${bf.path}`.toLowerCase();
        const name = row.createDiv("foliate-linked-info");
        name.createSpan({ text: bf.basename, cls: "foliate-linked-name foliate-clickable" });
        name.addEventListener("click", () =>
          this.app.workspace.openLinkText(bf.path, file.path, false)
        );
      }
    }
    this.wireCollapseAll(collapseAllBtn, keys);
  }

  /**
   * Measure the pinned top bar and a section header, then publish their heights
   * as CSS variables so the nested sticky headers (section, then category)
   * stack flush beneath each other.
   */
  private updateStickyOffsets() {
    const stickyTop = this.contentEl.querySelector<HTMLElement>(".foliate-sticky-top");
    if (!stickyTop) return;
    const topH = stickyTop.offsetHeight;
    const sectionHeader = this.contentEl.querySelector<HTMLElement>(".foliate-section-header");
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
    const groups = this.contentEl.querySelectorAll<HTMLElement>(".foliate-taxa-group");
    groups.forEach((group) => {
      const content = group.querySelector<HTMLElement>(".foliate-group-content");
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
    const sections = this.contentEl.querySelectorAll<HTMLElement>(".foliate-section");
    sections.forEach((section) => {
      if (!query) {
        section.style.display = "";
        return;
      }
      const visible = Array.from(
        section.querySelectorAll<HTMLElement>(".foliate-taxa-group")
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
    const groupEl = parent.createDiv("foliate-taxa-group");
    groupEl.dataset.collapseKey = key;
    const isCollapsed = this.plugin.settings.collapsedCategories.includes(key);

    const header = groupEl.createDiv("foliate-group-header foliate-clickable");
    const chevron = header.createSpan({ cls: "foliate-group-chevron" });
    setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
    header.createSpan({ text: labelText, cls: "foliate-group-label" });

    const content = groupEl.createDiv("foliate-group-content");
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
    const section = container.createDiv("foliate-section");
    const head = section.createDiv("foliate-section-header");
    head.createEl("h5", { text: title });
    const collapseAllBtn = head.createEl("button", {
      cls: "foliate-collapse-all-btn",
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
  /**
   * Whether the term that surfaced this match in the current note (its matched
   * surface text) is currently context-gated for that file. Used to toggle the
   * row's context action label and behavior.
   */
  private isTermGated(match: UnlinkedMatch): boolean {
    const gate = this.plugin.settings.contextAware[match.filePath];
    if (!gate) return false;
    const term = match.matchText.toLowerCase();
    return (gate.gatedAliases ?? []).some((a) => a.toLowerCase() === term);
  }

  private renderRowActions(row: HTMLElement, container: HTMLElement, actions: RowAction[]) {
    for (const action of actions) {
      if (action.inline === false) continue;
      if (!action.forceInline && !this.plugin.settings.inlineActions.includes(action.id)) continue;
      const btn = container.createEl("button", {
        cls: "foliate-action-btn",
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
      this.showActionMenu(e, actions);
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
    // Drop the alias when the surface already equals the target (e.g. a
    // prefix-carrying match "@Paul Krugman" of the @Paul Krugman file), so the
    // result is the tidy [[@Paul Krugman]] rather than a redundant piped form.
    const wikilinkFor = (p: MatchPosition) =>
      p.surface === linkTarget ? `[[${linkTarget}]]` : `[[${linkTarget}|${p.surface}]]`;

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
    const row = container.createDiv("foliate-suggestion-row");
    row.dataset.search = `${match.fileName} ${match.alias} ${match.matchText}`.toLowerCase();

    // Top line: name + action buttons
    const top = row.createDiv("foliate-suggestion-top");

    const info = top.createDiv("foliate-suggestion-info");
    const nameSpan = info.createSpan({
      // Show the file's title including its taxa prefix, not the bare alias.
      text: match.fileName,
      cls: "foliate-match-text foliate-clickable",
    });

    const actionsEl = top.createDiv("foliate-suggestion-actions");

    const rowActions: RowAction[] = [
      {
        id: "jump",
        label: "Jump to occurrence",
        icon: "crosshair",
        inline: false,
        run: () =>
          this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length),
      },
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
    rowActions.push({
      id: "open",
      label: "Open note",
      icon: "external-link",
      run: () => this.app.workspace.openLinkText(match.fileName, noteFile.path, false),
    });
    // The matched text isn't one of the file's own terms, so it surfaced only
    // because this note established it: an acronym the note declares, or a
    // surname after the full name. Saving it as an alias makes it match
    // everywhere, which is the durable version of what the note did locally.
    if (!this.isOwnTerm(match)) {
      rowActions.push({
        id: "alias",
        label: `Add "${match.matchText}" as an alias`,
        icon: "plus-circle",
        inline: false,
        separatorBefore: true,
        run: async () => {
          const file = this.app.vault.getAbstractFileByPath(match.filePath);
          if (!(file instanceof TFile)) return;
          await addAliasToFile(this.app, file, match.matchText);
          new Notice(`Added "${match.matchText}" as an alias of ${file.basename}.`);
          this.refresh();
        },
      });
    }

    // Experimental: the context-aware action only appears when the feature is
    // enabled, so the whole feature is dormant (no entry point) when off.
    if (this.plugin.settings.showHiddenConnections) {
      rowActions.push({
        // The counterpart to the Hidden connections section: that explains what
        // was withheld, this explains what was shown. Together they make every
        // gating decision on the note inspectable from the row it concerns.
        id: "why",
        label: "Why is this shown?",
        icon: "help-circle",
        inline: false,
        separatorBefore: true,
        run: () => this.explainMatch(match),
      });
    }

    if (this.plugin.settings.contextAwareEnabled) {
      rowActions.push({
        // Gate the specific term that surfaced this row in THIS note (the
        // matched surface text, e.g. "sync"), not the file name. That term is
        // suppressed elsewhere unless the note also mentions a related term;
        // the file's other terms (its full name, unambiguous aliases) keep
        // matching normally.
        id: "context",
        label: this.isTermGated(match)
          ? `Remove "${match.matchText}" from context-aware list`
          : `Add "${match.matchText}" to context-aware list`,
        icon: "git-branch",
        inline: false,
        // Divider above: the context-aware action is set apart from the plain
        // link/open actions.
        separatorBefore: true,
        run: async () => {
          const ca = this.plugin.settings.contextAware;
          const existing = ca[match.filePath];
          const term = match.matchText;
          if (existing && this.isTermGated(match)) {
            // Toggle off: ungate this term; drop the entry if it was the last.
            const remaining = (existing.gatedAliases ?? []).filter(
              (a) => a.toLowerCase() !== term.toLowerCase()
            );
            if (remaining.length === 0) delete ca[match.filePath];
            else ca[match.filePath] = { ...existing, gatedAliases: remaining };
            new Notice(`No longer gating "${term}".`);
          } else if (existing) {
            // File already gated for other terms; add this one.
            const set = new Set(existing.gatedAliases ?? []);
            set.add(term);
            ca[match.filePath] = { ...existing, gatedAliases: [...set] };
            new Notice(`"${term}" now shows only near a related term.`);
          } else {
            const taxaFile = this.app.vault.getAbstractFileByPath(match.filePath);
            const terms =
              taxaFile instanceof TFile
                ? mineContextTerms(this.app, taxaFile, this.plugin.settings.taxaMappings)
                : [];
            ca[match.filePath] = {
              terms,
              gatedAliases: [term],
            };
            new Notice(
              terms.length > 0
                ? `"${term}" now shows only near: ${terms.slice(0, 6).join(", ")}${terms.length > 6 ? "…" : ""}`
                : `"${term}" gated, but no related terms were found. Add some in settings, or it will never surface.`
            );
          }
          await this.plugin.saveSettings();
          this.refresh();
        },
      });
    }
    rowActions.push(
      {
        id: "dismiss",
        label: "Dismiss",
        icon: "x",
        // Divider: everything below removes this row (temporarily or for good),
        // set apart from the link/open/context actions above so it isn't
        // clicked by accident.
        separatorBefore: true,
        run: () => {
          this.dismissed.add(match.filePath);
          this.refresh();
        },
      },
      {
        id: "ignore",
        // Name the file so it's clear exactly what gets blocklisted. Blocklist
        // suppresses the whole file (all its terms), so the file name is the
        // accurate label, not the single surfaced word.
        label: `Add ${match.fileName} to blocklist`,
        icon: "eye-off",
        run: async () => {
          this.plugin.settings.blocklist.push(match.alias);
          await this.plugin.saveSettings();
          this.refresh();
        },
      }
    );
    nameSpan.addEventListener("click", (evt) => {
      this.handleItemClick(
        evt,
        match.fileName,
        noteFile.path,
        () =>
          this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length),
        () => this.showActionMenu(evt, rowActions)
      );
    });
    this.renderRowActions(row, actionsEl, rowActions);

    // Bottom line: metadata
    const meta = row.createDiv("foliate-suggestion-meta");
    meta.createSpan({
      text: `(${match.positions.length} ${match.positions.length > 1 ? "mentions" : "mention"})`,
      cls: "foliate-meta-chunk",
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

  /**
   * Create the file for a wikilink whose target doesn't exist yet, using the
   * taxon's folder and template (same path as "Create taxa link", minus the
   * editor). The row's "no file yet" marker comes from getFirstLinkpathDest,
   * which resolves against the file list as soon as the file exists on disk, so
   * we refresh immediately rather than waiting on the metadata-resolution pass.
   */
  private async createMissingTaxaFile(
    link: string,
    mapping: TaxaMapping
  ) {
    // Reduce the link to its base name: drop any folder path and a trailing
    // #heading or ^block ref, then strip the taxon prefix.
    const base = (link.split("#")[0].split("/").pop() ?? link).trim();
    const cleanName = stripPrefix(base, mapping);
    const created = await createTaxaFile(this.app, cleanName, mapping, this.plugin.settings);
    if (!created) return;
    new Notice(`Created ${created.basename}`);
    // createTaxaFile awaited vault.create, so the file now exists and the link
    // resolves; refresh right away to clear the marker and show "Open note".
    this.refresh();
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
    // Computed once for all linked files' alias scans below.
    const excluded = findExcludedRegions(content);

    // Group linked taxa by mapping, collecting positions
    interface LinkedItem {
      title: string; // file basename incl. prefix, shown in the sidebar
      matchName: string; // link display text / alias, used to find plain-text occurrences
      link: string;
      mapping: TaxaMapping; // the taxon this link belongs to (for "Create file")
      exists: boolean; // false when the link points to a file that doesn't exist yet
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
              for (const mp of findFileMatchPositions(this.app, content, dest, mapping, bodyStart, excluded)) {
                if (!byOffset.has(mp.offset)) byOffset.set(mp.offset, mp);
              }
            }

            // Fold in bare surnames of an already-linked person ("Henry" after
            // "[[@Pierre Henry]]"). The unlinked scan deliberately skips linked
            // files, so without this the occurrences would be counted nowhere.
            // Case-sensitive, matching the unlinked rule: "Wood" is the person,
            // "wood" is lumber.
            const surnameTaxon = this.plugin.surnameTaxon();
            if (dest && surnameTaxon && mapping.prefix === surnameTaxon.prefix) {
              const parts = stripPrefix(dest.basename, mapping).trim().split(/\s+/);
              const surname = parts.length > 1 ? parts[parts.length - 1] : "";
              if (surname.length >= 3) {
                for (const idx of findUnlinkedPositions(content, surname, excluded, true)) {
                  if (idx < bodyStart || byOffset.has(idx)) continue;
                  // Skip occurrences sitting inside the wikilink itself.
                  if ([...byOffset.keys()].some((p) => idx > p && idx < p + wikiPattern.length + 2)) continue;
                  byOffset.set(idx, { offset: idx, len: surname.length, surface: surname });
                }
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
                mapping,
                exists: dest !== null,
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
        const row = groupContent.createDiv("foliate-linked-row");
        row.dataset.search = `${item.title} ${item.matchName} ${item.link}`.toLowerCase();
        const info = row.createDiv("foliate-linked-info");
        const nameSpan = info.createSpan({
          text: item.title,
          cls: "foliate-linked-name foliate-clickable",
        });
        // A link whose target file doesn't exist yet: dim it and say so on hover,
        // matching how Obsidian renders unresolved links.
        if (!item.exists) {
          nameSpan.addClass("foliate-unresolved");
          nameSpan.setAttribute("aria-label", "No file yet");
          nameSpan.title = "No file yet";
        }
        const jumpKey = `linked:${item.link}`;
        if (item.positions.length > 0) {
          info.createSpan({
            text:
              item.unlinkedCount > 0
                ? ` (${item.positions.length}, ${item.unlinkedCount} unlinked)`
                : ` (${item.positions.length})`,
            cls: "foliate-match-count",
          });
        }

        const linkedActions = row.createDiv("foliate-linked-actions");

        // Plain-text (not-yet-linked) occurrences of this already-linked file.
        const unlinkedPositions = item.positions.filter((p) => !p.surface.startsWith("[["));

        const rowActions: RowAction[] = [];
        // The link points to a file that doesn't exist yet: offer to create it,
        // the same way the "Create taxa link" command would. Shown inline so the
        // button is always visible on these rows.
        if (!item.exists) {
          rowActions.push({
            id: "create",
            label: "Create file",
            icon: "file-plus",
            inline: true,
            forceInline: true,
            run: () => this.createMissingTaxaFile(item.link, item.mapping),
          });
        }
        if (unlinkedPositions.length > 0) {
          rowActions.push({
            id: "linkAll",
            label: "Link all occurrences",
            icon: "replace-all",
            run: () => this.linkPositions(file, item.link, unlinkedPositions),
          });
        }
        rowActions.push({
          id: "jump",
          label: "Jump to occurrence",
          icon: "crosshair",
          inline: false,
          run: () => {
            if (item.positions.length > 0) {
              this.jumpToOccurrence(jumpKey, item.positions, content, file, item.matchName.length);
            }
          },
        });
        // "Open note" only makes sense once the file exists.
        if (item.exists) {
          rowActions.push({
            id: "open",
            label: "Open note",
            icon: "external-link",
            run: () => this.app.workspace.openLinkText(item.link, file.path, false),
          });
        }
        // Unlink goes last, below a divider, so the removal action is set apart
        // from the safe ones above and isn't clicked by accident.
        rowActions.push({
          id: "unlink",
          label: "Unlink",
          icon: "unlink",
          separatorBefore: true,
          run: () => this.unlinkTaxaFromNote(item.link, item.title, file),
        });
        nameSpan.addEventListener("click", (evt) => {
          this.handleItemClick(
            evt,
            item.link,
            file.path,
            () => {
              if (item.positions.length > 0) {
                this.jumpToOccurrence(jumpKey, item.positions, content, file, item.matchName.length);
              }
            },
            () => this.showActionMenu(evt, rowActions)
          );
        });
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
