export interface TaxaMapping {
  prefix: string;
  label: string;
  folder: string;
  template?: string;
}

/**
 * Per-file context-gating config, keyed by taxa file path in
 * settings.contextAware. A gated file surfaces its mentions in a note only when
 * that note also contains at least one of `terms` — the file's related
 * vocabulary, so a common-word alias like "sync" appears when the note is about
 * audio (mentions SMPTE, DAW, wordclock) and stays quiet otherwise.
 *
 * `terms` is the effective, user-editable list the matcher actually checks.
 *
 * `gatedAliases` names which of the file's own terms are context-gated: only
 * these are suppressed when the note lacks a related term. It's seeded from the
 * surface text that surfaced the file in the sidebar (the common word the user
 * reacted to, e.g. "sync") and is user-editable. Terms not listed here — the
 * full name, unambiguous aliases — always match. An entry with an empty
 * gatedAliases gates nothing.
 */
export interface ContextConfig {
  terms: string[];
  gatedAliases: string[];
}

/**
 * How to open a taxa note:
 * - "replace": in the current tab (standard link behavior)
 * - "tab": in a new tab, then focus it
 * - "split": in a split pane beside the current one
 * - "window": in a new window
 */
export type OpenMode = "replace" | "tab" | "split" | "window";

/**
 * What a click (or modifier-click) on a sidebar item does: jump to the next
 * occurrence in the document, copy a wikilink to the note, or open the note in
 * one of the open modes.
 */
export type ClickAction = "jump" | "copy" | "menu" | OpenMode;

/** Order of entries within each taxa category in the sidebar. */
export type SortOrder = "mentions-desc" | "mentions-asc" | "name-asc" | "name-desc";

export interface FoliateSettings {
  taxaMappings: TaxaMapping[];
  // The single domain type: a higher-order taxon that groups other taxa. Same
  // shape as a taxon, but there is only ever one.
  domain: TaxaMapping;
  autoMoveEnabled: boolean;
  createFolderIfMissing: boolean;
  autoAddAlias: boolean;
  sidebarEnabled: boolean;
  sidebarOpen: boolean;
  autoScan: boolean;
  scopeToView: boolean;
  sortOrder: SortOrder;
  clickAction: ClickAction;
  modClickAction: ClickAction;
  altClickAction: ClickAction;
  shiftClickAction: ClickAction;
  inlineActions: string[];
  matchLinkedAliases: boolean;
  blocklist: string[];
  // Experimental. When false, context-aware gating is fully dormant: the gate
  // never runs, and the sidebar action and settings manager are hidden. Saved
  // contextAware entries are preserved and reactivate when re-enabled.
  contextAwareEnabled: boolean;
  contextAware: Record<string, ContextConfig>;
  highlightOnJump: boolean;
  highlightDurationSeconds: number;
  selectOnJump: boolean;
  showSearchBar: boolean;
  collapsedCategories: string[];
  highlightColor: string;
}

/**
 * A single occurrence of a match in the note text. Each occurrence carries its
 * own length and surface form so that mixed-length matches (a file's full name
 * plus its shorter aliases, e.g. "Zone of Proximal Development" and "ZPD") can
 * be highlighted and linked correctly per occurrence.
 */
export interface MatchPosition {
  offset: number;
  len: number;
  surface: string;
}

export interface UnlinkedMatch {
  matchText: string;
  filePath: string;
  fileName: string;
  alias: string;
  taxon: TaxaMapping;
  positions: MatchPosition[];
}

/**
 * Row actions that can be shown as inline buttons in the sidebar. Every action
 * is always available by right-clicking a row; this list controls which ones
 * also appear as inline buttons (via the `inlineActions` setting). Jump is
 * intentionally excluded — clicking a row name already jumps.
 */
export const INLINE_ACTION_OPTIONS: { id: string; label: string }[] = [
  { id: "link", label: "Link (single occurrence)" },
  { id: "linkAll", label: "Link all occurrences" },
  { id: "unlink", label: "Unlink" },
  { id: "open", label: "Open note" },
  { id: "ignore", label: "Add to blocklist" },
  { id: "dismiss", label: "Dismiss" },
];
