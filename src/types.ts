export interface TaxaMapping {
  prefix: string;
  label: string;
  folder: string;
  template?: string;
  /**
   * Color for links to this taxon's files. Unset means the theme decides:
   * no style is emitted at all, so the link keeps whatever --link-color
   * resolves to. Only set when the user deliberately picks a color.
   */
  linkColor?: string;
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
  /** Show a "Hidden connections" section listing mentions the gate withheld. */
  showHiddenConnections: boolean;
  /**
   * Show concepts recognised by their vocabulary rather than by their name.
   *
   * Display only: nothing is hidden on this evidence yet, because a signature
   * learned from notes that all share a register can learn the register.
   */
  showRelatedConcepts: boolean;
  /**
   * Folders whose notes teach concept signatures. Empty means the whole vault.
   *
   * Not derivable, which was measured rather than assumed: link density picks
   * the generated-scaffold folder first (14.4 taxa links per note), and that is
   * exactly the folder whose boilerplate a signature must not learn. Only the
   * user knows which of their notes are ABOUT their concepts rather than merely
   * mentioning them in passing.
   */
  signatureFolders: string[];
  /**
   * Prefix of the taxon whose files match on surname after their full name
   * appears in a note ("Dostoevsky" once "Vladimir Dostoevsky" is present).
   * Empty disables it. Scoped to one taxon because splitting a name on
   * whitespace only means something for people.
   */
  surnameMatchPrefix: string;
  /**
   * Treat "[[term]] (ACRONYM)" in a note as declaring that acronym for that
   * file, for the rest of that note. The note states the equivalence, so this
   * reads it rather than guessing.
   */
  matchDeclaredAcronyms: boolean;
  /**
   * Treat a trailing acronym in a FILENAME as an alias: "+Spectral band
   * replication (SBR)" matching a bare "SBR". Off by default. A parenthetical
   * is more often a qualifier than an abbreviation, and the guard against that
   * ("+attack (ADSR)" must not claim "ADSR") is a heuristic, so a wrong link is
   * possible. A frontmatter alias does the same job with no guessing.
   */
  matchFilenameAcronyms: boolean;
  /**
   * When a new taxa file's name carries accents or typographic punctuation, also
   * save its plain-ASCII spelling as an alias, so "musique concrete" reaches
   * "+musique concrète". Nothing is added when the name is already plain.
   */
  autoAddPlainAlias: boolean;
  highlightOnJump: boolean;
  highlightDurationSeconds: number;
  selectOnJump: boolean;
  showSearchBar: boolean;
  collapsedCategories: string[];
  highlightColor: string;
  /**
   * Taxa files the user has confirmed refer to one concept, kept as separate
   * files on purpose.
   *
   * Keyed by the path that stands for the group, valued by the other paths
   * folded into it. Scoring treats them as one node: two files for one idea
   * otherwise split its co-occurrence evidence in half and can land the halves
   * in different clusters.
   *
   * The plugin proposes these and never applies one on its own. It can see that
   * two files are used interchangeably; it cannot see whether that means they
   * are the same idea (+Noise and +noise (audio)) or two ideas that always
   * travel together (Ranganathan's hospitality in array and in chain). Only the
   * user knows, so the decision is theirs and stays visible and reversible here.
   *
   * Nothing is written to the vault: the files, their names, and their links are
   * untouched.
   */
  mergedConcepts: Record<string, string[]>;
  /**
   * Mark a sidebar row whose term another taxa file also answers to.
   *
   * On by default. A collision is already costing the user something (the
   * matcher offers two files for one word), so pointing at it is information
   * they are missing rather than noise being added. Off for anyone who
   * knowingly keeps colliding names.
   */
  markContestedTerms: boolean;
  /**
   * Hide mentions the index says this note establishes no context for.
   *
   * Off by default, and deliberately so: this is the only setting in the plugin
   * that REMOVES information from the sidebar. A wrongly hidden mention is
   * invisible in a way a wrongly shown one is not, so it stays opt-in until the
   * user has looked at what it would hide.
   */
  autoGateEnabled: boolean;
  /** Share of notes above which a term is treated as ambiguous enough to gate. */
  autoGateRatio: number;
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
 * A mention the matcher found in the note but deliberately did not surface.
 *
 * Context gating hides matches silently, which leaves no way to tell "the gate
 * decided this note is off-topic" from "nothing matched" from "something broke".
 * The matcher records each suppression here so the sidebar can list it under
 * Hidden connections and name the reason.
 *
 * `reason` is the branch that suppressed it and `detail` is the sentence shown
 * on the row. Mined signals will add reasons here rather than change the shape.
 */
export interface HiddenMatch {
  filePath: string;
  fileName: string;
  alias: string;
  taxon: TaxaMapping;
  /** The file's terms that matched the note but were withheld. */
  hiddenTerms: string[];
  /** How many occurrences of those terms the note contains. */
  occurrences: number;
  reason: "context-gate";
  detail: string;
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
