import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import { EnfoliateSettings, TaxaMapping } from "../types";
import { stripPrefix } from "../taxa";

interface TaxaSuggestion {
  file: TFile;
  taxon: TaxaMapping;
  alias: string;
}

export class TaxaSuggest extends EditorSuggest<TaxaSuggestion> {
  private settings: EnfoliateSettings;

  constructor(app: App, settings: EnfoliateSettings) {
    super(app);
    this.settings = settings;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const textBefore = line.substring(0, cursor.ch);

    // Build a regex that matches any taxa prefix followed by text
    const prefixes = this.settings.taxaMappings
      .map((m) => escapeRegex(m.prefix))
      .join("|");
    if (!prefixes) return null;

    const pattern = new RegExp(`(?:^|[\\s(\\[])((${prefixes})(\\S*))$`);
    const match = textBefore.match(pattern);
    if (!match) return null;

    const fullMatch = match[1]; // prefix + query text
    const startCh = cursor.ch - fullMatch.length;

    return {
      start: { line: cursor.line, ch: startCh },
      end: cursor,
      query: fullMatch,
    };
  }

  async getSuggestions(
    context: EditorSuggestContext
  ): Promise<TaxaSuggestion[]> {
    const query = context.query;

    // Find which taxon prefix this matches
    let matchedTaxon: TaxaMapping | null = null;
    for (const mapping of this.settings.taxaMappings) {
      if (query.startsWith(mapping.prefix)) {
        matchedTaxon = mapping;
        break;
      }
    }
    if (!matchedTaxon) return [];

    const searchText = query.slice(matchedTaxon.prefix.length).toLowerCase();
    const folder = this.app.vault.getAbstractFileByPath(matchedTaxon.folder);
    if (!folder) return [];

    const suggestions: TaxaSuggestion[] = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (!file.path.startsWith(matchedTaxon.folder + "/")) continue;

      const basename = file.basename;
      const alias = stripPrefix(basename, matchedTaxon);

      // Match against both full name and alias
      if (
        basename.toLowerCase().contains(searchText) ||
        alias.toLowerCase().contains(searchText)
      ) {
        suggestions.push({
          file,
          taxon: matchedTaxon,
          alias,
        });
      }
    }

    return suggestions.slice(0, 20);
  }

  renderSuggestion(suggestion: TaxaSuggestion, el: HTMLElement): void {
    const container = el.createDiv("enfoliate-suggest-item");
    container.createSpan({
      text: suggestion.taxon.prefix,
      cls: "enfoliate-suggest-prefix",
    });
    container.createSpan({ text: " " });
    container.createSpan({
      text: suggestion.alias,
      cls: "enfoliate-suggest-name",
    });
  }

  selectSuggestion(
    suggestion: TaxaSuggestion,
    _evt: MouseEvent | KeyboardEvent
  ): void {
    if (!this.context) return;

    const wikilink = `[[${suggestion.file.basename}|${suggestion.alias}]]`;
    this.context.editor.replaceRange(
      wikilink,
      this.context.start,
      this.context.end
    );
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
