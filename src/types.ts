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
  sidebarOpen: boolean;
  statusBarEnabled: boolean;
  aiEnabled: boolean;
  autoAnalyze: boolean;
  blocklist: string[];
  highlightOnJump: boolean;
  highlightColor: string;
}

export interface ExtractedEntity {
  text: string;
  type: string;
  suggestedName: string;
  confidence: number;
}

export interface UnlinkedMatch {
  matchText: string;
  filePath: string;
  fileName: string;
  alias: string;
  taxon: TaxaMapping;
  positions: number[];
}
