import { App, Modal, PluginSettingTab, Setting, AbstractInputSuggest, TFile, TFolder } from "obsidian";
import type EnfoliatePlugin from "./main";
import { TaxaMapping, ClickAction, SortOrder, INLINE_ACTION_OPTIONS } from "./types";
import { DEFAULT_TAXA_MAPPINGS } from "./taxa";

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

class BlocklistModal extends Modal {
  private plugin: EnfoliatePlugin;
  private onChangeCb?: () => void;

  constructor(app: App, plugin: EnfoliatePlugin, onChange?: () => void) {
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

    const addRow = contentEl.createDiv("enfoliate-blocklist-add");
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

    const list = contentEl.createDiv("enfoliate-blocklist");
    const blocklist = this.plugin.settings.blocklist;

    if (blocklist.length === 0) {
      list.createEl("p", {
        text: "No blocked terms.",
        cls: "setting-item-description",
      });
    } else {
      for (let i = 0; i < blocklist.length; i++) {
        const row = list.createDiv("enfoliate-blocklist-row");
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

class HowToModal extends Modal {
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("enfoliate-howto");
    this.modalEl.addClass("enfoliate-howto-modal");

    contentEl.createEl("h2", { text: "How to use Enfoliate" });

    contentEl.createEl("p", {
      text: "Enfoliate organizes notes by taxa: prefix characters that mark a note's type (@ for people, + for concepts, and so on). In Taxa Mappings, define each prefix and the folder its files belong in. When you create or rename a note whose name starts with a prefix, Enfoliate moves it to that taxon's folder.",
    });

    const templates = contentEl.createEl("p");
    templates.createEl("strong", { text: "Templates. " });
    templates.appendText(
      "You can set a template file per taxon. New files of that type start from the template, with these tokens filled in: {{title}} (the note's name, also {{name}} or {{alias}}), {{prefix}} (the taxon's prefix character, such as @), and {{label}} (the taxon's name, such as People). Obsidian's built-in Templates tokens work too, including {{date}}, {{time}}, and formatted variants like {{date:YYYY-MM-DD}}. If Templater is installed, its <% %> commands run as well."
    );

    const note = contentEl.createEl("p");
    note.createEl("strong", { text: "No folder set? " });
    note.appendText(
      "If a taxon has no folder specified, its new files are created at the vault root and are not auto-moved. Set a folder to keep that type organized."
    );

    const sidebar = contentEl.createEl("p");
    sidebar.createEl("strong", { text: "The sidebar. " });
    sidebar.appendText(
      "Open the Enfoliate sidebar to see two sections for the active note: Linked Mentions (taxa already linked in the document) and Unlinked Mentions (existing taxa files whose names appear in the note but aren't linked yet). Right-click a row for its full set of actions (link, open, unlink, ignore, dismiss). You can choose which options show as inline buttons under Sidebar Buttons in settings."
    );

    const clicks = contentEl.createEl("p");
    clicks.createEl("strong", { text: "Clicking a term. " });
    clicks.appendText(
      "By default, clicking a term in the sidebar jumps to the next occurrence in the document. To open a term found in the sidebar, different options are available using modifier keys. These are all configurable under the 'Click Actions' section in the settings menu."
    );

    const inspired = contentEl.createEl("p", {
      cls: "setting-item-description",
    });
    inspired.appendText("Built to work alongside ");
    inspired.createEl("a", {
      text: "Stowe Boyd's Folio knowledge management system",
      href: "https://www.workings.co/p/folio-how-notetaking-becomes-knowledge?utm_source=publication-search",
    });
    inspired.appendText(".");

    const credit = contentEl.createEl("p", {
      cls: "setting-item-description",
    });
    credit.appendText("Icon by Jamie Serra from ");
    credit.createEl("a", {
      text: "the Noun Project",
      href: "https://thenounproject.com/icon/booklet-1624270/",
    });
    credit.appendText(".");
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class EnfoliateSettingTab extends PluginSettingTab {
  plugin: EnfoliatePlugin;

  constructor(app: App, plugin: EnfoliatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Title ---
    containerEl.createEl("h1", { text: "Enfoliate" });

    new Setting(containerEl)
      .setName("How to use Enfoliate")
      .setDesc("Taxa basics, templates, and where files go.")
      .addButton((btn) =>
        btn.setButtonText("Open guide").onClick(() => {
          new HowToModal(this.app).open();
        })
      );

    // --- Taxa Mappings ---
    containerEl.createEl("h2", { text: "Taxa Mappings" });

    const mappingsContainer = containerEl.createDiv("enfoliate-taxa-mappings");
    this.renderTaxaMappings(mappingsContainer);

    new Setting(containerEl)
      .addButton((btn) =>
        btn.setButtonText("Add Taxa").onClick(async () => {
          this.plugin.settings.taxaMappings.push({
            prefix: "",
            label: "",
            folder: "",
          });
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
                // Restore the default prefix/label set, but keep the folder the
                // user already assigned to each prefix; leave new taxa blank.
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

    // --- Linking ---
    containerEl.createEl("h2", { text: "Linking" });

    new Setting(containerEl)
      .setName("Auto-add alias")
      .setDesc(
        "When you create a taxa link, add the linked name to the target file's aliases so plain-text mentions of it resolve and surface as unlinked mentions."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoAddAlias)
          .onChange(async (value) => {
            this.plugin.settings.autoAddAlias = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Auto-Move ---
    containerEl.createEl("h2", { text: "Auto-Move" });

    new Setting(containerEl)
      .setName("Auto-Move File On Creation")
      .setDesc(
        "Automatically move files to taxa folders when created or renamed with a taxa prefix."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoMoveEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoMoveEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Create folders if missing")
      .setDesc("Create target folders that don't exist yet.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createFolderIfMissing)
          .onChange(async (value) => {
            this.plugin.settings.createFolderIfMissing = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Sidebar ---
    containerEl.createEl("h2", { text: "Sidebar" });

    new Setting(containerEl)
      .setName("Enable Sidebar")
      .setDesc(
        "Make the Enfoliate sidebar available. Turn off to use the plugin's commands and auto-move without the sidebar. Requires plugin reload."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sidebarEnabled)
          .onChange(async (value) => {
            this.plugin.settings.sidebarEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open sidebar on startup")
      .setDesc("Automatically open the Enfoliate sidebar when the plugin loads.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sidebarOpen)
          .onChange(async (value) => {
            this.plugin.settings.sidebarOpen = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-scan")
      .setDesc(
        "Scan the active note automatically as you switch files and edit. Turn off to scan only when you click Scan in the sidebar."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoScan)
          .onChange(async (value) => {
            this.plugin.settings.autoScan = value;
            await this.plugin.saveSettings();
            this.plugin.refreshSuggestionsView();
          })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Match aliases of linked files")
      .setDesc(
        'Under Linked Mentions, fold in unlinked alias occurrences of an already-linked file so you can cycle through them (for example, "USA" where the linked file is United States).'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.matchLinkedAliases)
          .onChange(async (value) => {
            this.plugin.settings.matchLinkedAliases = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Select text on jump")
      .setDesc("Select the matched text in the editor when jumping to an occurrence. Edit mode only.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.selectOnJump)
          .onChange(async (value) => {
            this.plugin.settings.selectOnJump = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show search bar")
      .setDesc("Show the filter box at the top of the Enfoliate sidebar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showSearchBar)
          .onChange(async (value) => {
            this.plugin.settings.showSearchBar = value;
            await this.plugin.saveSettings();
            this.plugin.refreshSuggestionsView();
          })
      );

    // --- Click Actions ---
    containerEl.createEl("h2", { text: "Click Actions" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Bind each click and modifier-click on a sidebar item to an action. When several modifiers are held, precedence is Cmd/Ctrl, then Option/Alt, then Shift.",
    });

    this.addClickActionSetting(
      containerEl,
      "Click action",
      "What a plain click on a sidebar item does.",
      () => this.plugin.settings.clickAction,
      (v) => (this.plugin.settings.clickAction = v)
    );
    this.addClickActionSetting(
      containerEl,
      "Shift+click action",
      "What a Shift + click does.",
      () => this.plugin.settings.shiftClickAction,
      (v) => (this.plugin.settings.shiftClickAction = v)
    );
    this.addClickActionSetting(
      containerEl,
      "Cmd/Ctrl+click action",
      "What a Cmd (macOS) / Ctrl (Windows/Linux) + click does.",
      () => this.plugin.settings.modClickAction,
      (v) => (this.plugin.settings.modClickAction = v)
    );
    this.addClickActionSetting(
      containerEl,
      "Option/Alt+click action",
      "What an Option (macOS) / Alt (Windows/Linux) + click does.",
      () => this.plugin.settings.altClickAction,
      (v) => (this.plugin.settings.altClickAction = v)
    );

    // --- Sidebar Buttons ---
    containerEl.createEl("h2", { text: "Sidebar Buttons" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Choose which action buttons appear inline on sidebar items. Every action is always available by right-clicking an item.",
    });

    for (const opt of INLINE_ACTION_OPTIONS) {
      new Setting(containerEl)
        .setName(opt.label)
        .addToggle((toggle) =>
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

    // --- Highlighting ---
    containerEl.createEl("h2", { text: "Highlighting" });

    new Setting(containerEl)
      .setName("Highlight on jump")
      .setDesc("Briefly highlight the matched text in the editor when clicking a suggestion name.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.highlightOnJump)
          .onChange(async (value) => {
            this.plugin.settings.highlightOnJump = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Highlight color")
      .setDesc("Color for the jump highlight. Leave empty to use Obsidian's default highlight color.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.highlightColor || "#7fd7f6")
          .onChange(async (value) => {
            this.plugin.settings.highlightColor = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.highlightColor = "";
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // --- Blocklist ---
    containerEl.createEl("h2", { text: "Blocklist" });

    new Setting(containerEl)
      .setName("Blocked terms")
      .setDesc("Terms that never appear as suggestions. Add them here or via the sidebar's \"Ignore\" button.")
      .addButton((btn) =>
        btn
          .setButtonText(`Manage (${this.plugin.settings.blocklist.length})`)
          .onClick(() => {
            new BlocklistModal(this.app, this.plugin, () => this.display()).open();
          })
      );
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

  private renderTaxaMappings(container: HTMLElement): void {
    container.empty();
    this.plugin.settings.taxaMappings.forEach(
      (mapping: TaxaMapping, index: number) => {
        const row = container.createDiv("enfoliate-taxa-row");
        row.style.display = "flex";
        row.style.flexWrap = "wrap";
        row.style.gap = "8px";
        row.style.alignItems = "center";
        row.style.marginBottom = "8px";

        const prefixInput = row.createEl("input", {
          type: "text",
          placeholder: "Prefix",
          value: mapping.prefix,
        });
        prefixInput.style.width = "50px";
        prefixInput.addEventListener("change", async () => {
          this.plugin.settings.taxaMappings[index].prefix = prefixInput.value;
          await this.plugin.saveSettings();
        });

        const labelInput = row.createEl("input", {
          type: "text",
          placeholder: "Label",
          value: mapping.label,
        });
        labelInput.style.width = "100px";
        labelInput.addEventListener("change", async () => {
          this.plugin.settings.taxaMappings[index].label = labelInput.value;
          await this.plugin.saveSettings();
        });

        const folderInput = row.createEl("input", {
          type: "text",
          placeholder: "Folder path",
          value: mapping.folder,
        });
        folderInput.style.width = "200px";
        folderInput.addEventListener("change", async () => {
          this.plugin.settings.taxaMappings[index].folder = folderInput.value;
          await this.plugin.saveSettings();
        });

        // Attach folder autocomplete
        const suggest = new FolderSuggest(this.app, folderInput);
        suggest.onSelect(async (folder) => {
          folderInput.value = folder.path;
          this.plugin.settings.taxaMappings[index].folder = folder.path;
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
          if (trimmed) this.plugin.settings.taxaMappings[index].template = trimmed;
          else delete this.plugin.settings.taxaMappings[index].template;
          await this.plugin.saveSettings();
        };
        templateInput.addEventListener("change", () => saveTemplate(templateInput.value));

        // Attach template-file autocomplete
        const fileSuggest = new FileSuggest(this.app, templateInput);
        fileSuggest.onSelect(async (file) => {
          templateInput.value = file.path;
          await saveTemplate(file.path);
        });

        const deleteBtn = row.createEl("button", { text: "\u2715" });
        deleteBtn.addEventListener("click", async () => {
          this.plugin.settings.taxaMappings.splice(index, 1);
          await this.plugin.saveSettings();
          this.renderTaxaMappings(container);
        });
      }
    );
  }
}
