export interface TaxaMapping {
  prefix: string;
  label: string;
  folder: string;
  template?: string;
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
export type ClickAction = "jump" | "copy" | OpenMode;

export interface EnfoliateSettings {
  taxaMappings: TaxaMapping[];
  autoMoveEnabled: boolean;
  createFolderIfMissing: boolean;
  sidebarOpen: boolean;
  autoScan: boolean;
  clickAction: ClickAction;
  modClickAction: ClickAction;
  altClickAction: ClickAction;
  shiftClickAction: ClickAction;
  inlineActions: string[];
  matchLinkedAliases: boolean;
  blocklist: string[];
  highlightOnJump: boolean;
  highlightDurationSeconds: number;
  selectOnJump: boolean;
  scopeToSelection: boolean;
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
  { id: "link", label: "Link (first occurrence)" },
  { id: "linkAll", label: "Link all occurrences" },
  { id: "open", label: "Open note" },
  { id: "unlink", label: "Unlink" },
  { id: "ignore", label: "Always ignore" },
  { id: "dismiss", label: "Dismiss" },
];
