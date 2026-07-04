import { App, Modal, PluginSettingTab, Setting, AbstractInputSuggest, ColorComponent, TFile, TFolder } from "obsidian";
import type FoliatePlugin from "./main";
import { TaxaMapping, ClickAction, SortOrder, INLINE_ACTION_OPTIONS, ContextConfig } from "./types";
import { DEFAULT_TAXA_MAPPINGS } from "./taxa";
import { mineContextTerms, fileTerms, taxonForFile } from "./services/context-mining";

class ConfirmModal extends Modal {
  private message: string;
  private confirmText: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, confirmText: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });
    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";
    row.style.marginTop = "12px";
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const ok = row.createEl("button", { text: this.confirmText, cls: "mod-warning" });
    ok.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SidebarSettingsModal extends Modal {
  constructor(app: App, private tab: FoliateSettingTab) {
    super(app);
  }
  onOpen() {
    this.modalEl.addClass("foliate-context-modal"); // reuse the wider modal width
    this.contentEl.createEl("h2", { text: "Sidebar settings" });
    this.tab.renderSidebarSettingsInto(this.contentEl);
  }
  onClose() {
    this.contentEl.empty();
  }
}

class BlocklistModal extends Modal {
  private plugin: FoliatePlugin;
  private onChangeCb?: () => void;

  constructor(app: App, plugin: FoliatePlugin, onChange?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChangeCb = onChange;
  }

  onOpen() {
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Blocklist" });
    contentEl.createEl("p", {
      text: "Terms that never appear as suggestions.",
      cls: "setting-item-description",
    });

    const addRow = contentEl.createDiv("foliate-blocklist-add");
    const input = addRow.createEl("input", {
      type: "text",
      placeholder: "Add a term to block",
    });
    const addBtn = addRow.createEl("button", { text: "Add", cls: "mod-cta" });

    const addTerm = async () => {
      const term = input.value.trim();
      if (!term) return;
      if (!this.plugin.settings.blocklist.includes(term)) {
        this.plugin.settings.blocklist.push(term);
        await this.plugin.saveSettings();
      }
      this.render();
    };
    addBtn.addEventListener("click", addTerm);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTerm();
    });

    const list = contentEl.createDiv("foliate-blocklist");
    const blocklist = this.plugin.settings.blocklist;

    if (blocklist.length === 0) {
      list.createEl("p", {
        text: "No blocked terms.",
        cls: "setting-item-description",
      });
    } else {
      for (let i = 0; i < blocklist.length; i++) {
        const row = list.createDiv("foliate-blocklist-row");
        row.createSpan({ text: blocklist[i] });
        const deleteBtn = row.createEl("button", { text: "✕" });
        deleteBtn.addEventListener("click", async () => {
          this.plugin.settings.blocklist.splice(i, 1);
          await this.plugin.saveSettings();
          this.render();
        });
      }
    }

    input.focus();
  }

  onClose() {
    this.contentEl.empty();
    this.onChangeCb?.();
  }
}

class ContextAwareModal extends Modal {
  private plugin: FoliatePlugin;
  private onChangeCb?: () => void;
  // Paths whose row is expanded. Kept on the instance so expansion survives the
  // full re-render that every edit triggers.
  private expanded = new Set<string>();

  constructor(app: App, plugin: FoliatePlugin, onChange?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChangeCb = onChange;
  }

  onOpen() {
    // Widen the default modal; the expanded term editors need the room.
    this.modalEl.addClass("foliate-context-modal");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Context-aware mentions" });
    contentEl.createEl("p", {
      text:
        "A gated term (a common word like \"work\") surfaces as an unlinked mention only when the note also contains one of the file's related terms. " +
        "Expand a file to toggle its gated terms and edit related terms.",
      cls: "setting-item-description",
    });

    const entries = Object.entries(this.plugin.settings.contextAware);

    if (entries.length === 0) {
      contentEl.createEl("p", {
        text: 'No context-aware files. Add one via a sidebar item\'s "Add to context-aware list" action.',
        cls: "setting-item-description",
      });
      return;
    }

    // Search: autocomplete over every term already present across all entries
    // (gated + related + file names). Picking a suggestion expands that file's
    // row and scrolls to it.
    this.renderSearch(contentEl, entries);

    const list = contentEl.createDiv("foliate-context-list");
    for (const [path, config] of entries) {
      this.renderCard(list, path, config);
    }
  }

  /** Search box with an autocomplete drawn only from terms already in the modal. */
  private renderSearch(container: HTMLElement, entries: [string, ContextConfig][]) {
    // Build a term -> owning path index from the terms present in the modal.
    const termToPath = new Map<string, string>();
    for (const [path, config] of entries) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const name = file instanceof TFile ? file.basename : path;
      const taxon =
        file instanceof TFile ? taxonForFile(file, this.plugin.settings.taxaMappings) : null;
      const terms = [
        name,
        ...(file instanceof TFile && taxon ? fileTerms(this.app, file, taxon) : []),
        ...(config.gatedAliases ?? []),
        ...config.terms,
      ];
      for (const t of terms) {
        const key = t.toLowerCase();
        if (!termToPath.has(key)) termToPath.set(key, path);
      }
    }

    const field = container.createDiv("foliate-context-search");
    const input = field.createEl("input", {
      type: "text",
      placeholder: "Search terms in this list…",
    });
    new ContextTermSuggest(this.app, input, [...termToPath.keys()], (term) => {
      const path = termToPath.get(term.toLowerCase());
      if (!path) return;
      this.expanded.add(path);
      this.render();
      const card = this.contentEl.querySelector(`[data-path="${CSS.escape(path)}"]`);
      card?.scrollIntoView({ block: "center" });
    });
  }

  /** One file: a compact header (name link + gated terms) with an expandable body. */
  private renderCard(list: HTMLElement, path: string, config: ContextConfig) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const name = file instanceof TFile ? file.basename : path;
    const isOpen = this.expanded.has(path);

    const card = list.createDiv("foliate-context-card");
    card.dataset.path = path;

    // Header (always visible): expand toggle, file-name link, active gated terms.
    const header = card.createDiv("foliate-context-card-header");

    const toggle = header.createEl("button", {
      text: isOpen ? "▾" : "▸",
      cls: "foliate-context-expand",
    });
    toggle.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
    toggle.addEventListener("click", () => {
      if (isOpen) this.expanded.delete(path);
      else this.expanded.add(path);
      this.render();
    });

    const nameLink = header.createEl("a", { text: name, cls: "foliate-context-name" });
    nameLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.workspace.openLinkText(path, "", false);
      this.close();
    });

    const gated = config.gatedAliases ?? [];
    const gatedEl = header.createSpan("foliate-context-gated-summary");
    if (gated.length > 0) {
      for (const t of gated) gatedEl.createSpan({ text: t, cls: "foliate-context-chip is-gated" });
    } else {
      gatedEl.createSpan({ text: "no gated terms", cls: "setting-item-description" });
    }

    if (isOpen) this.renderCardBody(card, path, config, file);
  }

  /** Expanded body: full gated-term chip toggles, related-terms editor, buttons. */
  private renderCardBody(
    card: HTMLElement,
    path: string,
    config: ContextConfig,
    file: ReturnType<App["vault"]["getAbstractFileByPath"]>
  ) {
    const body = card.createDiv("foliate-context-card-body");

    const actions = body.createDiv("foliate-context-actions");
    const remineBtn = actions.createEl("button", { text: "Re-mine" });
    remineBtn.title = "Rebuild related terms from this file's links, discarding manual edits";
    remineBtn.addEventListener("click", async () => {
      if (file instanceof TFile) {
        config.terms = mineContextTerms(this.app, file, this.plugin.settings.taxaMappings);
        await this.plugin.saveSettings();
        this.render();
      }
    });
    const removeBtn = actions.createEl("button", { text: "Remove", cls: "mod-warning" });
    removeBtn.title = "Remove (this file's mentions surface normally again)";
    removeBtn.addEventListener("click", async () => {
      delete this.plugin.settings.contextAware[path];
      this.expanded.delete(path);
      await this.plugin.saveSettings();
      this.render();
    });

    // Gated terms: toggle list of the file's actual terms (name + aliases), so
    // only real terms can be picked and typos can't silently gate nothing.
    const gatedField = body.createDiv("foliate-context-field");
    gatedField.createEl("label", { text: "Gated terms (click to toggle)" });
    const chips = gatedField.createDiv("foliate-context-chips");
    const taxon =
      file instanceof TFile ? taxonForFile(file, this.plugin.settings.taxaMappings) : null;
    const available = file instanceof TFile && taxon ? fileTerms(this.app, file, taxon) : [];
    const gatedNow = new Set((config.gatedAliases ?? []).map((t) => t.toLowerCase()));
    // Include any gated term no longer among the file's aliases so it can still
    // be toggled off.
    const orphaned = (config.gatedAliases ?? []).filter(
      (g) => !available.some((a) => a.toLowerCase() === g.toLowerCase())
    );
    const allTerms = [...available, ...orphaned];

    if (allTerms.length === 0) {
      chips.createSpan({ text: "No aliases found for this file.", cls: "setting-item-description" });
    }
    for (const term of allTerms) {
      const isGated = gatedNow.has(term.toLowerCase());
      const chip = chips.createEl("button", {
        text: term,
        cls: isGated ? "foliate-context-chip is-gated" : "foliate-context-chip",
      });
      chip.addEventListener("click", async () => {
        const set = new Set(config.gatedAliases ?? []);
        const existing = [...set].find((t) => t.toLowerCase() === term.toLowerCase());
        if (existing) set.delete(existing);
        else set.add(term);
        config.gatedAliases = [...set];
        await this.plugin.saveSettings();
        this.render();
      });
    }

    // Related terms: the context vocabulary that must be present for a gated
    // term to surface.
    const relField = body.createDiv("foliate-context-field");
    relField.createEl("label", { text: "Related terms" });
    const relArea = relField.createEl("textarea");
    relArea.value = config.terms.join(", ");
    relArea.rows = 3;
    relArea.addEventListener("change", async () => {
      config.terms = relArea.value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      await this.plugin.saveSettings();
    });
  }

  onClose() {
    this.contentEl.empty();
    this.onChangeCb?.();
  }
}

/** Autocomplete input suggesting from a fixed pool of terms (the modal's own). */
class ContextTermSuggest extends AbstractInputSuggest<string> {
  private terms: string[];
  private onPick: (term: string) => void;

  constructor(app: App, input: HTMLInputElement, terms: string[], onPick: (term: string) => void) {
    super(app, input);
    this.terms = terms;
    this.onPick = onPick;
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.terms.filter((t) => t.includes(q)).slice(0, 50);
  }

  renderSuggestion(term: string, el: HTMLElement): void {
    el.setText(term);
  }

  selectSuggestion(term: string): void {
    this.setValue(term);
    this.onPick(term);
    this.close();
  }
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  getSuggestions(query: string): TFolder[] {
    const lowerQuery = query.toLowerCase();
    const folders: TFolder[] = [];
    const seen = new Set<string>();

    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f instanceof TFolder && f.path !== "/") {
        if (!seen.has(f.path) && f.path.toLowerCase().contains(lowerQuery)) {
          folders.push(f);
          seen.add(f.path);
        }
      }
    });

    folders.sort((a, b) => a.path.localeCompare(b.path));
    return folders.slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(folder.path);
    this.close();
  }
}

class FileSuggest extends AbstractInputSuggest<TFile> {
  getSuggestions(query: string): TFile[] {
    const lowerQuery = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().contains(lowerQuery))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(file.path);
    this.close();
  }
}

export class FoliateSettingTab extends PluginSettingTab {
  plugin: FoliatePlugin;

  constructor(app: App, plugin: FoliatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Title ---
    containerEl.createEl("h1", { text: "Foliate" });

    const intro = containerEl.createEl("p", { cls: "setting-item-description" });
    intro.appendText("Taxa basics, templates, and the full guide are on ");
    intro.createEl("a", {
      text: "GitHub",
      href: "https://github.com/blakeeboyd/obsidian-foliate",
    });
    intro.appendText(". Built to work alongside ");
    intro.createEl("a", {
      text: "Stowe Boyd's Folio knowledge management system",
      href: "https://www.workings.co/p/folio-how-notetaking-becomes-knowledge?utm_source=publication-search",
    });
    intro.appendText(".");

    this.renderMappingsSection(containerEl);
    this.renderFilesSection(containerEl);
    this.renderSidebarSection(containerEl);
    this.renderListsSection(containerEl);
    this.renderExperimentalSection(containerEl);
  }

  /** A titled section. Returns the body element to render settings into. */
  private section(containerEl: HTMLElement, title: string, desc?: string): HTMLElement {
    const wrap = containerEl.createDiv("foliate-settings-section");
    wrap.createEl("h2", { text: title });
    if (desc) wrap.createEl("p", { cls: "setting-item-description", text: desc });
    return wrap;
  }

  /** Column headers for a mappings table, widths matched to the row inputs. */
  private renderMappingHeader(el: HTMLElement): void {
    const head = el.createDiv("foliate-taxa-head");
    ([["Prefix", 50], ["Label", 100], ["Folder", 200], ["Template", 180]] as const).forEach(
      ([text, w]) => {
        const c = head.createSpan({ text });
        c.style.width = `${w}px`;
      }
    );
  }

  /** A bold sub-label with a description line, for groups within a section. */
  private subGroup(el: HTMLElement, title: string, desc: string): void {
    el.createEl("h3", { text: title, cls: "foliate-mapping-subhead" });
    el.createEl("p", { cls: "setting-item-description", text: desc });
  }

  private renderMappingsSection(containerEl: HTMLElement): void {
    const el = this.section(containerEl, "Mappings");

    // Domain: the single higher-order taxon that groups other taxa.
    this.subGroup(
      el,
      "Domains",
      "Higher-order taxa that group other taxa, rather than classifying source documents. There is one domain type."
    );
    this.renderMappingHeader(el);
    const domainContainer = el.createDiv("foliate-taxa-mappings");
    this.renderMappingRow(domainContainer, this.plugin.settings.domain);

    // Taxa: the prefixes that classify knowledge files by type.
    this.subGroup(
      el,
      "Taxa",
      "Prefix characters that classify a file by type. Each maps a prefix to a label and a folder, so every file of that type lives in the same place."
    );
    this.renderMappingHeader(el);
    const taxaContainer = el.createDiv("foliate-taxa-mappings");
    this.renderTaxaMappings(taxaContainer, this.plugin.settings.taxaMappings);

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText("Add taxa").onClick(async () => {
          this.plugin.settings.taxaMappings.push({ prefix: "", label: "", folder: "" });
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Restore defaults")
          .setWarning()
          .onClick(() => {
            new ConfirmModal(
              this.app,
              "Restore the default set of taxa (prefixes and labels)? Your existing folder paths are kept; newly added taxa start with an empty folder for you to set. This does not move or rename any files.",
              "Restore defaults",
              async () => {
                const folders = new Map(
                  this.plugin.settings.taxaMappings.map((m) => [m.prefix, m.folder])
                );
                this.plugin.settings.taxaMappings = DEFAULT_TAXA_MAPPINGS.map((m) => ({
                  prefix: m.prefix,
                  label: m.label,
                  folder: folders.get(m.prefix) ?? "",
                }));
                await this.plugin.saveSettings();
                this.display();
              }
            ).open();
          })
      );
  }

  private renderFilesSection(containerEl: HTMLElement): void {
    const el = this.section(containerEl, "Files");
    new Setting(el)
      .setName("Auto-add alias")
      .setDesc(
        "When you create a taxa link, add the linked name to the target file's aliases so plain-text mentions of it resolve and surface as unlinked mentions."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoAddAlias).onChange(async (value) => {
          this.plugin.settings.autoAddAlias = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Auto-move files on creation")
      .setDesc("Move files to taxa folders when created or renamed with a taxa prefix.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoMoveEnabled).onChange(async (value) => {
          this.plugin.settings.autoMoveEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Create folders if missing")
      .setDesc("Create target folders that don't exist yet.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.createFolderIfMissing).onChange(async (value) => {
          this.plugin.settings.createFolderIfMissing = value;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderSidebarSection(containerEl: HTMLElement): void {
    const el = this.section(containerEl, "Sidebar");

    // Core toggles: whether / when the sidebar runs. Display, click, and
    // highlight options live in the "Sidebar settings" modal (button below).
    new Setting(el)
      .setName("Enable sidebar")
      .setDesc(
        "Make the Foliate sidebar available. Turn off to use the plugin's commands and auto-move without the sidebar. Requires plugin reload."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebarEnabled).onChange(async (value) => {
          this.plugin.settings.sidebarEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Open on startup")
      .setDesc("Open the Foliate sidebar automatically when the plugin loads.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebarOpen).onChange(async (value) => {
          this.plugin.settings.sidebarOpen = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Auto-scan")
      .setDesc(
        "Scan the active note automatically as you switch files and edit. Turn off to scan only when you click Scan in the sidebar."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoScan).onChange(async (value) => {
          this.plugin.settings.autoScan = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSuggestionsView();
        })
      );

    new Setting(el)
      .setName("More sidebar settings")
      .setDesc("Display, click actions, inline buttons, and jump highlight.")
      .addButton((btn) =>
        btn.setButtonText("Open…").onClick(() => new SidebarSettingsModal(this.app, this).open())
      );
  }

  /**
   * Everything about how the sidebar looks and behaves: display options, click
   * bindings, which inline buttons show, and the jump highlight. Rendered into
   * whatever container is passed (a modal), since most users set these once.
   */
  renderSidebarSettingsInto(el: HTMLElement): void {
    new Setting(el).setName("Display").setHeading();

    new Setting(el)
      .setName("Limit to visible area")
      .setDesc(
        "Only show mentions whose occurrences are in the editor's current view, updating as you scroll. Also toggleable from the eye button in the sidebar header. Edit mode only."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.scopeToView).onChange(async (value) => {
          this.plugin.settings.scopeToView = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSuggestionsView();
        })
      );

    new Setting(el)
      .setName("Sort entries")
      .setDesc("Order of entries within each taxa category in the sidebar.")
      .addDropdown((dd) =>
        dd
          .addOption("mentions-desc", "Mentions, high to low")
          .addOption("mentions-asc", "Mentions, low to high")
          .addOption("name-asc", "Name, A to Z")
          .addOption("name-desc", "Name, Z to A")
          .setValue(this.plugin.settings.sortOrder)
          .onChange(async (value) => {
            this.plugin.settings.sortOrder = value as SortOrder;
            await this.plugin.saveSettings();
            this.plugin.refreshSuggestionsView();
          })
      );

    new Setting(el)
      .setName("Match aliases of linked files")
      .setDesc(
        'Under Linked Mentions, fold in unlinked alias occurrences of an already-linked file so you can cycle through them (for example, "USA" where the linked file is United States).'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.matchLinkedAliases).onChange(async (value) => {
          this.plugin.settings.matchLinkedAliases = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Show search bar")
      .setDesc("Show the filter box at the top of the Foliate sidebar.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showSearchBar).onChange(async (value) => {
          this.plugin.settings.showSearchBar = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSuggestionsView();
        })
      );

    new Setting(el).setName("Click actions").setHeading();
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Bind each click and modifier-click on a sidebar item to an action. When several modifiers are held, precedence is Cmd/Ctrl, then Option/Alt, then Shift.",
    });
    this.addClickActionSetting(
      el,
      "Click",
      "What a plain click on a sidebar item does.",
      () => this.plugin.settings.clickAction,
      (v) => (this.plugin.settings.clickAction = v)
    );
    this.addClickActionSetting(
      el,
      "Shift + click",
      "What a Shift + click does.",
      () => this.plugin.settings.shiftClickAction,
      (v) => (this.plugin.settings.shiftClickAction = v)
    );
    this.addClickActionSetting(
      el,
      "Cmd/Ctrl + click",
      "What a Cmd (macOS) / Ctrl (Windows/Linux) + click does.",
      () => this.plugin.settings.modClickAction,
      (v) => (this.plugin.settings.modClickAction = v)
    );
    this.addClickActionSetting(
      el,
      "Option/Alt + click",
      "What an Option (macOS) / Alt (Windows/Linux) + click does.",
      () => this.plugin.settings.altClickAction,
      (v) => (this.plugin.settings.altClickAction = v)
    );

    new Setting(el).setName("Inline buttons").setHeading();
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Which action buttons appear inline on sidebar items. Every action is always available by right-clicking an item.",
    });
    for (const opt of INLINE_ACTION_OPTIONS) {
      new Setting(el).setName(opt.label).addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inlineActions.includes(opt.id))
          .onChange(async (value) => {
            const set = new Set(this.plugin.settings.inlineActions);
            if (value) set.add(opt.id);
            else set.delete(opt.id);
            this.plugin.settings.inlineActions = [...set];
            await this.plugin.saveSettings();
            this.plugin.refreshSuggestionsView();
          })
      );
    }

    new Setting(el).setName("Jump highlight").setHeading();
    new Setting(el)
      .setName("Highlight on jump")
      .setDesc("Briefly highlight the matched text in the editor when clicking a suggestion name.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.highlightOnJump).onChange(async (value) => {
          this.plugin.settings.highlightOnJump = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Highlight duration")
      .setDesc("How long the jump highlight stays before fading, in seconds.")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 10, 0.5)
          .setValue(this.plugin.settings.highlightDurationSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightDurationSeconds = value;
            await this.plugin.saveSettings();
          })
      );

    let colorPicker: ColorComponent;
    new Setting(el)
      .setName("Highlight color")
      .setDesc("Color for the jump highlight. Leave empty to use Obsidian's default highlight color.")
      .addColorPicker((picker) => {
        colorPicker = picker;
        picker.setValue(this.plugin.settings.highlightColor || "#7fd7f6").onChange(async (value) => {
          this.plugin.settings.highlightColor = value;
          await this.plugin.saveSettings();
        });
      })
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(async () => {
          // Reset the value and swatch in place; no full tab rebuild, so scroll
          // position is preserved.
          this.plugin.settings.highlightColor = "";
          await this.plugin.saveSettings();
          colorPicker.setValue("#7fd7f6");
        })
      );
  }

  private renderListsSection(containerEl: HTMLElement): void {
    const el = this.section(containerEl, "Blocklist");
    new Setting(el)
      .setName("Blocked terms")
      .setDesc('Terms that never appear as suggestions. Add them here or via a sidebar item\'s "Add to blocklist" action.')
      .addButton((btn) =>
        btn
          .setButtonText(`Manage (${this.plugin.settings.blocklist.length})`)
          .onClick(() => {
            new BlocklistModal(this.app, this.plugin, () => this.display()).open();
          })
      );
  }

  private renderExperimentalSection(containerEl: HTMLElement): void {
    const el = this.section(
      containerEl,
      "Experimental",
      "Features still in development. Off by default; enable at your own discretion."
    );

    // The "Context-aware files" row lives in its own container so the toggle can
    // show/hide it in place, without rebuilding the whole tab (which would reset
    // scroll). Created detached; appended after the toggle below.
    const contextFilesRow = createDiv();
    const renderContextFilesRow = () => {
      contextFilesRow.empty();
      contextFilesRow.toggle(this.plugin.settings.contextAwareEnabled);
      if (!this.plugin.settings.contextAwareEnabled) return;
      new Setting(contextFilesRow)
        .setName("Context-aware files")
        .setDesc(
          "Set one up via a sidebar item's \"Add to context-aware list\" action, then edit its gated and related terms here."
        )
        .addButton((btn) =>
          btn
            .setButtonText(`Manage (${Object.keys(this.plugin.settings.contextAware).length})`)
            .onClick(() => {
              new ContextAwareModal(this.app, this.plugin, () => renderContextFilesRow()).open();
            })
        );
    };

    new Setting(el)
      .setName("Context-aware mentions")
      .setDesc(
        "A file's common-word alias (like \"work\") surfaces as an unlinked mention only in notes that also mention one of the file's related terms. When off, this gating is fully dormant and its sidebar action is hidden; any files you've configured are kept and reactivate when you turn it back on."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.contextAwareEnabled).onChange(async (value) => {
          this.plugin.settings.contextAwareEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSuggestionsView();
          renderContextFilesRow();
        })
      );

    el.appendChild(contextFilesRow);
    renderContextFilesRow();
  }

  private addClickActionSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    get: () => ClickAction,
    set: (v: ClickAction) => void
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((dd) =>
        dd
          .addOption("jump", "Jump to term in the document")
          .addOption("replace", "Open in the current tab")
          .addOption("tab", "Open in a new tab")
          .addOption("split", "Open in Split View")
          .addOption("window", "Open in a new window")
          .addOption("copy", "Copy wikilink")
          .addOption("menu", "Open options menu")
          .setValue(get())
          .onChange(async (value) => {
            set(value as ClickAction);
            await this.plugin.saveSettings();
          })
      );
  }

  private renderTaxaMappings(container: HTMLElement, mappings: TaxaMapping[]): void {
    container.empty();
    mappings.forEach((mapping, index) => {
      this.renderMappingRow(container, mapping, async () => {
        mappings.splice(index, 1);
        await this.plugin.saveSettings();
        this.renderTaxaMappings(container, mappings);
      });
    });
  }

  /**
   * One prefix/label/folder/template row, editing `mapping` in place. Pass
   * `onDelete` to show a delete button (taxa rows); omit it for the single
   * domain row, which can't be deleted.
   */
  private renderMappingRow(
    container: HTMLElement,
    mapping: TaxaMapping,
    onDelete?: () => void | Promise<void>
  ): void {
    const row = container.createDiv("foliate-taxa-row");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.marginBottom = "8px";

    const prefixInput = row.createEl("input", { type: "text", placeholder: "Prefix", value: mapping.prefix });
    prefixInput.style.width = "50px";
    prefixInput.addEventListener("change", async () => {
      mapping.prefix = prefixInput.value;
      await this.plugin.saveSettings();
    });

    const labelInput = row.createEl("input", { type: "text", placeholder: "Label", value: mapping.label });
    labelInput.style.width = "100px";
    labelInput.addEventListener("change", async () => {
      mapping.label = labelInput.value;
      await this.plugin.saveSettings();
    });

    const folderInput = row.createEl("input", { type: "text", placeholder: "Folder path", value: mapping.folder });
    folderInput.style.width = "200px";
    folderInput.addEventListener("change", async () => {
      mapping.folder = folderInput.value;
      await this.plugin.saveSettings();
    });
    new FolderSuggest(this.app, folderInput).onSelect(async (folder) => {
      folderInput.value = folder.path;
      mapping.folder = folder.path;
      await this.plugin.saveSettings();
    });

    const templateInput = row.createEl("input", {
      type: "text",
      placeholder: "Template (optional)",
      value: mapping.template || "",
    });
    templateInput.style.width = "180px";
    const saveTemplate = async (value: string) => {
      const trimmed = value.trim();
      if (trimmed) mapping.template = trimmed;
      else delete mapping.template;
      await this.plugin.saveSettings();
    };
    templateInput.addEventListener("change", () => saveTemplate(templateInput.value));
    new FileSuggest(this.app, templateInput).onSelect(async (file) => {
      templateInput.value = file.path;
      await saveTemplate(file.path);
    });

    if (onDelete) {
      const deleteBtn = row.createEl("button", { text: "\u2715" });
      deleteBtn.addEventListener("click", () => void onDelete());
    }
  }
}
