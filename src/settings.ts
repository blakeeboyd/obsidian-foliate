import { App, PluginSettingTab, Setting, AbstractInputSuggest, TFolder } from "obsidian";
import type PortfolioPlugin from "./main";
import { TaxaMapping } from "./types";

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

export class PortfolioSettingTab extends PluginSettingTab {
  plugin: PortfolioPlugin;

  constructor(app: App, plugin: PortfolioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Taxa Mappings ---
    containerEl.createEl("h2", { text: "Taxa Mappings" });

    const attribution = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    attribution.appendText("Inspired by ");
    attribution.createEl("a", {
      text: "Stowe Boyd's Portfolio knowledge management system",
      href: "https://www.workings.co/p/portfolio-a-knowledge-base-built",
    });
    attribution.appendText(". Define prefix characters and their target folders. Files starting with a prefix will be auto-moved to the corresponding folder.");

    const mappingsContainer = containerEl.createDiv("portfolio-taxa-mappings");
    this.renderTaxaMappings(mappingsContainer);

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add mapping").onClick(async () => {
        this.plugin.settings.taxaMappings.push({
          prefix: "",
          label: "",
          folder: "",
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );

    // --- Editor ---
    containerEl.createEl("h2", { text: "Editor" });

    new Setting(containerEl)
      .setName("Enable taxa suggestions")
      .setDesc(
        "Show autocomplete suggestions when typing a taxa prefix character (e.g. @, +, ~). Requires plugin reload."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.editorSuggestEnabled)
          .onChange(async (value) => {
            this.plugin.settings.editorSuggestEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Auto-Move ---
    containerEl.createEl("h2", { text: "Auto-Move" });

    new Setting(containerEl)
      .setName("Enable auto-move")
      .setDesc(
        "Automatically move files to taxa folders when created or renamed."
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
      .setName("Open suggestions on startup")
      .setDesc("Automatically open the suggestions sidebar when the plugin loads.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sidebarOpen)
          .onChange(async (value) => {
            this.plugin.settings.sidebarOpen = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Match aliases of linked files")
      .setDesc(
        'In Unlinked Mentions, also surface unlinked alias occurrences of a file that is already linked in the note, so you can cycle through and link them (e.g. "ZPD" for an already-linked Zone of Proximal Development).'
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

    // --- Status Bar ---
    containerEl.createEl("h2", { text: "Status Bar" });

    new Setting(containerEl)
      .setName("Show status bar")
      .setDesc("Show taxa link counts in the status bar. Click to see a summary. Requires plugin reload.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.statusBarEnabled)
          .onChange(async (value) => {
            this.plugin.settings.statusBarEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Blocklist ---
    containerEl.createEl("h2", { text: "Blocklist" });
    containerEl.createEl("p", {
      text: "Terms that will never appear as suggestions. Added via the sidebar's \"Ignore\" button.",
      cls: "setting-item-description",
    });

    const blocklistContainer = containerEl.createDiv("portfolio-blocklist");
    this.renderBlocklist(blocklistContainer);
  }

  private renderBlocklist(container: HTMLElement): void {
    container.empty();
    const blocklist = this.plugin.settings.blocklist;

    if (blocklist.length === 0) {
      container.createEl("p", {
        text: "No blocked terms.",
        cls: "setting-item-description",
      });
      return;
    }

    for (let i = 0; i < blocklist.length; i++) {
      const row = container.createDiv("portfolio-blocklist-row");
      row.createSpan({ text: blocklist[i] });
      const deleteBtn = row.createEl("button", { text: "\u2715" });
      deleteBtn.addEventListener("click", async () => {
        this.plugin.settings.blocklist.splice(i, 1);
        await this.plugin.saveSettings();
        this.renderBlocklist(container);
      });
    }
  }

  private renderTaxaMappings(container: HTMLElement): void {
    container.empty();
    this.plugin.settings.taxaMappings.forEach(
      (mapping: TaxaMapping, index: number) => {
        const row = container.createDiv("portfolio-taxa-row");
        row.style.display = "flex";
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
