import { ItemView, Notice, TFile, WorkspaceLeaf, MarkdownView } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type PortfolioPlugin from "../main";
import { UnlinkedMatch, ExtractedEntity, TaxaMapping } from "../types";
import { findUnlinkedMatches } from "../services/unlinked-matcher";
import { OllamaService } from "../services/ollama";
import { createTaxaLink } from "../services/file-operations";
import { taxonForEntityType, stripPrefix } from "../taxa";

const addHighlight = StateEffect.define<{ from: number; to: number }>();
const clearHighlight = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(addHighlight)) {
        const mark = Decoration.mark({ class: "portfolio-jump-highlight" });
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

export const SUGGESTIONS_VIEW_TYPE = "portfolio-suggestions";

export class SuggestionsView extends ItemView {
  plugin: PortfolioPlugin;
  private dismissed: Set<string> = new Set();
  private currentFile: TFile | null = null;
  private llmEntities: ExtractedEntity[] = [];
  private llmCache: Map<string, ExtractedEntity[]> = new Map();
  private isAnalyzing = false;
  private selectionEditorCallback: (() => void) | null = null;
  private lastSelection = "";
  private jumpIndex: Map<string, number> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: PortfolioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SUGGESTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Portfolio: Suggestions";
  }

  getIcon(): string {
    return "link";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.onActiveFileChange();
        this.registerSelectionListener();
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.currentFile) {
          this.llmCache.delete(file.path);
          this.debounceRefresh();
        }
      })
    );

    this.registerSelectionListener();
    this.onActiveFileChange();
  }

  async onClose() {
    this.selectionEditorCallback = null;
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

  private async jumpToOccurrence(key: string, positions: number[], content: string, noteFile: TFile, matchLength?: number) {
    const view = await this.findEditorForFile(noteFile);
    if (!view) return;

    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    const editor = view.editor;

    const idx = (this.jumpIndex.get(key) ?? 0) % positions.length;
    this.jumpIndex.set(key, idx + 1);

    const pos = this.offsetToPos(content, positions[idx]);
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: pos }, true);

    if (this.plugin.settings.highlightOnJump && matchLength) {
      this.flashHighlight(editor, positions[idx], positions[idx] + matchLength);
    }
  }

  private flashHighlight(editor: any, fromOffset: number, toOffset: number) {
    const cm: EditorView = editor.cm;
    if (!cm) return;

    // Ensure the highlight field is installed
    if (!cm.state.field(highlightField, false)) {
      cm.dispatch({ effects: StateEffect.appendConfig.of(highlightField) });
    }

    // Apply custom color if set
    const color = this.plugin.settings.highlightColor;
    const el = cm.dom.closest(".cm-editor") as HTMLElement | null;
    if (el && color) {
      el.style.setProperty("--portfolio-highlight-color", color);
    }

    cm.dispatch({ effects: addHighlight.of({ from: fromOffset, to: toOffset }) });

    setTimeout(() => {
      cm.dispatch({ effects: clearHighlight.of(null) });
      if (el && color) {
        el.style.removeProperty("--portfolio-highlight-color");
      }
    }, 1500);
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.refresh();
    }, 1000);
  }

  private registerSelectionListener() {
    this.selectionEditorCallback = null;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return;

    const editor = view.editor;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    this.selectionEditorCallback = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const sel = editor.getSelection() || "";
        if (sel !== this.lastSelection) {
          this.lastSelection = sel;
          this.refresh();
        }
      }, 200);
    };

    const cm = (editor as any).cm;
    if (cm && cm.contentDOM) {
      cm.contentDOM.addEventListener("mouseup", this.selectionEditorCallback);
      cm.contentDOM.addEventListener("keyup", this.selectionEditorCallback);
    }
  }

  private onActiveFileChange() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file === this.currentFile) return;

    this.currentFile = file;
    this.dismissed.clear();
    this.jumpIndex.clear();
    this.lastSelection = "";

    const cached = this.llmCache.get(file.path);
    if (cached) {
      this.llmEntities = cached;
      this.refresh();
    } else {
      this.llmEntities = [];
      this.refresh();
      if (this.plugin.settings.aiEnabled && this.plugin.settings.autoAnalyze) {
        this.runLlmExtraction();
      }
    }
  }

  async refresh() {
    const container = this.contentEl;
    container.empty();

    const file = this.currentFile;
    if (!file) {
      container.createEl("p", {
        text: "Open a note to see suggestions.",
        cls: "portfolio-empty-state",
      });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view ? view.editor.getSelection() : "";
    const textToAnalyze = selection && selection.trim().length > 0
      ? selection.trim()
      : content;
    const isSelection = selection && selection.trim().length > 0;

    // Header
    const header = container.createDiv("portfolio-suggestions-header");
    const titleEl = header.createEl("h4", { text: "Suggestions" });
    if (isSelection) {
      titleEl.createSpan({
        text: " (selection)",
        cls: "portfolio-scope-indicator",
      });
    }

    const refreshBtn = header.createEl("button", {
      text: "\u21BB",
      cls: "portfolio-refresh-btn",
      attr: { "aria-label": "Refresh" },
    });
    refreshBtn.addEventListener("click", () => {
      this.llmEntities = [];
      this.refresh();
      if (this.plugin.settings.aiEnabled) {
        this.runLlmExtraction();
      }
    });

    // Layer 1: Unlinked Matches
    const unlinkedMatches = findUnlinkedMatches(
      this.app,
      textToAnalyze,
      file,
      this.plugin.settings.taxaMappings
    ).filter((m) => !this.dismissed.has(m.filePath) && !this.plugin.settings.blocklist.includes(m.alias));

    if (unlinkedMatches.length > 0) {
      const section = container.createDiv("portfolio-section");
      section.createEl("h5", { text: "Unlinked Mentions" });

      // Group by taxon
      const grouped = groupByTaxon(unlinkedMatches);
      for (const [taxon, matches] of grouped) {
        const groupEl = section.createDiv("portfolio-taxa-group");
        groupEl.createEl("h6", {
          text: `${taxon.prefix} ${taxon.label}`,
          cls: "portfolio-group-label",
        });

        for (const match of matches) {
          this.renderUnlinkedMatch(groupEl, match, file, content);
        }
      }
    }

    // Layer 2: LLM Suggestions (only when AI is enabled)
    if (this.plugin.settings.aiEnabled) {
      const llmSection = container.createDiv("portfolio-section");
      llmSection.createEl("h5", { text: "AI Taxa Extraction" });

      if (this.isAnalyzing) {
        llmSection.createEl("p", {
          text: "Analyzing...",
          cls: "portfolio-analyzing",
        });
      } else if (this.llmEntities.length > 0) {
        const filteredEntities = this.llmEntities.filter(
          (e) => !this.dismissed.has(`llm:${e.suggestedName}`) && !this.plugin.settings.blocklist.includes(e.suggestedName)
        );

        if (filteredEntities.length > 0) {
          for (const entity of filteredEntities) {
            this.renderLlmEntity(llmSection, entity, file, content);
          }
        } else {
          llmSection.createEl("p", {
            text: "No new taxa found.",
            cls: "portfolio-empty-state",
          });
        }
      } else {
        const ollamaService = new OllamaService(
          this.plugin.settings.ollamaUrl,
          this.plugin.settings.ollamaModel
        );
        const isConnected = await ollamaService.testConnection();
        if (!isConnected) {
          const msgEl = llmSection.createDiv("portfolio-ollama-status");
          msgEl.createEl("p", {
            text: "Ollama not available",
          });
          msgEl.createEl("p", {
            text: "Connect to see AI taxa suggestions.",
            cls: "portfolio-empty-state",
          });
          const retryBtn = msgEl.createEl("button", {
            text: "Retry",
            cls: "portfolio-retry-btn",
          });
          retryBtn.addEventListener("click", () => {
            this.runLlmExtraction();
          });
        } else {
          llmSection.createEl("p", {
            text: "Click refresh to analyze.",
            cls: "portfolio-empty-state",
          });
        }
      }
    }
  }

  private renderUnlinkedMatch(
    container: HTMLElement,
    match: UnlinkedMatch,
    noteFile: TFile,
    fullContent: string
  ) {
    const row = container.createDiv("portfolio-suggestion-row");

    const info = row.createDiv("portfolio-suggestion-info");
    const nameSpan = info.createSpan({
      text: match.alias,
      cls: "portfolio-match-text portfolio-clickable",
    });
    nameSpan.addEventListener("click", () => {
      this.jumpToOccurrence(match.filePath, match.positions, fullContent, noteFile, match.matchText.length);
    });
    info.createSpan({
      text: ` (${match.positions.length}${match.positions.length > 1 ? " mentions" : " mention"})`,
      cls: "portfolio-match-count",
    });

    const actions = row.createDiv("portfolio-suggestion-actions");

    // Link button
    const linkBtn = actions.createEl("button", {
      text: "Link",
      cls: "portfolio-action-btn",
    });
    linkBtn.addEventListener("click", async () => {
      await this.linkUnlinkedMatch(match, noteFile, false);
    });

    // Link all button (if multiple occurrences)
    if (match.positions.length > 1) {
      const linkAllBtn = actions.createEl("button", {
        text: "Link all",
        cls: "portfolio-action-btn",
      });
      linkAllBtn.addEventListener("click", async () => {
        await this.linkUnlinkedMatch(match, noteFile, true);
      });
    }

    // Dismiss button
    const dismissBtn = actions.createEl("button", {
      text: "\u2715",
      cls: "portfolio-dismiss-btn",
      attr: { "aria-label": "Dismiss" },
    });
    dismissBtn.addEventListener("click", () => {
      this.dismissed.add(match.filePath);
      this.refresh();
    });

    // Always ignore button
    const ignoreBtn = actions.createEl("button", {
      text: "Ignore",
      cls: "portfolio-ignore-btn",
      attr: { "aria-label": "Always ignore" },
    });
    ignoreBtn.addEventListener("click", async () => {
      this.plugin.settings.blocklist.push(match.alias);
      await this.plugin.saveSettings();
      this.refresh();
    });
  }

  private async linkUnlinkedMatch(
    match: UnlinkedMatch,
    noteFile: TFile,
    linkAll: boolean
  ) {
    const content = await this.app.vault.read(noteFile);
    const wikilink = `[[${match.fileName}|${match.alias}]]`;

    let newContent: string;
    if (linkAll) {
      // Replace all occurrences, working backwards to preserve positions
      newContent = content;
      const sortedPositions = [...match.positions].sort((a, b) => b - a);
      for (const pos of sortedPositions) {
        const before = newContent.substring(0, pos);
        const after = newContent.substring(pos + match.matchText.length);
        newContent = before + wikilink + after;
      }
    } else {
      // Replace first occurrence only
      const pos = match.positions[0];
      newContent =
        content.substring(0, pos) +
        wikilink +
        content.substring(pos + match.matchText.length);
    }

    await this.app.vault.modify(noteFile, newContent);
    const count = linkAll ? match.positions.length : 1;
    new Notice(
      `Linked ${match.alias} (${count} ${count > 1 ? "occurrences" : "occurrence"})`
    );
    this.plugin.updateStatusBar();
    this.refresh();
  }

  private renderLlmEntity(
    container: HTMLElement,
    entity: ExtractedEntity,
    noteFile: TFile,
    fullContent: string
  ) {
    const taxon = taxonForEntityType(
      entity.type,
      this.plugin.settings.taxaMappings
    );
    if (!taxon) return;

    // Collect positions of entity text in content
    const entityPositions: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = fullContent.indexOf(entity.text, searchFrom);
      if (idx === -1) break;
      entityPositions.push(idx);
      searchFrom = idx + entity.text.length;
    }

    const row = container.createDiv("portfolio-suggestion-row");

    const info = row.createDiv("portfolio-suggestion-info");
    const nameSpan = info.createSpan({
      text: entity.suggestedName,
      cls: "portfolio-match-text portfolio-clickable",
    });
    if (entityPositions.length > 0) {
      const jumpKey = `llm:${entity.suggestedName}`;
      nameSpan.addEventListener("click", () => {
        this.jumpToOccurrence(jumpKey, entityPositions, fullContent, noteFile, entity.text.length);
      });
      info.createSpan({
        text: ` (${entityPositions.length}${entityPositions.length > 1 ? " mentions" : " mention"})`,
        cls: "portfolio-match-count",
      });
    }
    info.createSpan({
      text: ` ${taxon.prefix} ${taxon.label}`,
      cls: "portfolio-entity-type",
    });
    if (entity.confidence < 0.7) {
      info.createSpan({
        text: " (low confidence)",
        cls: "portfolio-low-confidence",
      });
    }

    const actions = row.createDiv("portfolio-suggestion-actions");

    // Link button — creates the taxa file and links the first mention
    const linkBtn = actions.createEl("button", {
      text: "Link",
      cls: "portfolio-action-btn",
    });
    linkBtn.addEventListener("click", async () => {
      const view = await this.findEditorForFile(noteFile);
      if (!view) {
        new Notice("Could not open editor");
        return;
      }

      this.app.workspace.setActiveLeaf(view.leaf, { focus: true });

      const editor = view.editor;
      const content = editor.getValue();
      const idx = content.indexOf(entity.text);
      if (idx === -1) {
        new Notice(`Could not find "${entity.text}" in note`);
        return;
      }

      const pos = this.offsetToPos(content, idx);
      editor.setSelection(
        pos,
        { line: pos.line, ch: pos.ch + entity.text.length }
      );

      await createTaxaLink(
        this.app,
        editor,
        entity.text,
        taxon,
        this.plugin.settings
      );

      this.dismissed.add(`llm:${entity.suggestedName}`);
      this.plugin.updateStatusBar();
      this.refresh();
    });

    // Dismiss button
    const dismissBtn = actions.createEl("button", {
      text: "\u2715",
      cls: "portfolio-dismiss-btn",
      attr: { "aria-label": "Dismiss" },
    });
    dismissBtn.addEventListener("click", () => {
      this.dismissed.add(`llm:${entity.suggestedName}`);
      this.refresh();
    });

    // Always ignore button
    const ignoreBtn = actions.createEl("button", {
      text: "Ignore",
      cls: "portfolio-ignore-btn",
      attr: { "aria-label": "Always ignore" },
    });
    ignoreBtn.addEventListener("click", async () => {
      this.plugin.settings.blocklist.push(entity.suggestedName);
      await this.plugin.saveSettings();
      this.refresh();
    });
  }

  private async runLlmExtraction() {
    if (!this.currentFile) return;
    if (this.isAnalyzing) return;

    const ollamaService = new OllamaService(
      this.plugin.settings.ollamaUrl,
      this.plugin.settings.ollamaModel
    );

    const isConnected = await ollamaService.testConnection();
    if (!isConnected) {
      this.refresh();
      return;
    }

    this.isAnalyzing = true;
    this.refresh();

    try {
      const content = await this.app.vault.cachedRead(this.currentFile);
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const selection = view ? view.editor.getSelection() : "";
      const textToAnalyze =
        selection && selection.trim().length > 0
          ? selection.trim()
          : content;

      const entities = await ollamaService.extractEntities(textToAnalyze);

      // Filter out entities that already have taxa files
      const filtered: ExtractedEntity[] = [];
      for (const entity of entities) {
        const taxon = taxonForEntityType(
          entity.type,
          this.plugin.settings.taxaMappings
        );
        if (!taxon) continue;

        const fileName = `${taxon.prefix}${entity.suggestedName}`;
        const filePath = `${taxon.folder}/${fileName}.md`;
        const exists = this.app.vault.getAbstractFileByPath(filePath);
        if (!exists) {
          filtered.push(entity);
        }
      }

      this.llmEntities = filtered;
      if (this.currentFile) {
        this.llmCache.set(this.currentFile.path, filtered);
      }
    } catch (e) {
      new Notice(`Taxa extraction failed: ${e}`);
      this.llmEntities = [];
    } finally {
      this.isAnalyzing = false;
      this.refresh();
    }
  }
}

function groupByTaxon(
  matches: UnlinkedMatch[]
): Map<TaxaMapping, UnlinkedMatch[]> {
  const map = new Map<TaxaMapping, UnlinkedMatch[]>();
  for (const match of matches) {
    const existing = map.get(match.taxon) || [];
    existing.push(match);
    map.set(match.taxon, existing);
  }
  return map;
}
