export interface TaxaMapping {
  prefix: string;
  label: string;
  folder: string;
  template?: string;
}

export interface EnfoliateSettings {
  taxaMappings: TaxaMapping[];
  autoMoveEnabled: boolean;
  createFolderIfMissing: boolean;
  autoCreateTaxaFolder: boolean;
  sidebarOpen: boolean;
  autoScan: boolean;
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
