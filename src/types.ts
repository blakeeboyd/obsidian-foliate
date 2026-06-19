export interface TaxaMapping {
  prefix: string;
  label: string;
  folder: string;
  template?: string;
}

export interface PortfolioSettings {
  taxaMappings: TaxaMapping[];
  ollamaUrl: string;
  ollamaModel: string;
  autoMoveEnabled: boolean;
  createFolderIfMissing: boolean;
  editorSuggestEnabled: boolean;
  sidebarOpen: boolean;
  statusBarEnabled: boolean;
  aiEnabled: boolean;
  autoAnalyze: boolean;
  matchLinkedAliases: boolean;
  blocklist: string[];
  highlightOnJump: boolean;
  highlightColor: string;
  customPrompt: string;
}

export interface ExtractedEntity {
  text: string;
  type: string;
  suggestedName: string;
  confidence: number;
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
