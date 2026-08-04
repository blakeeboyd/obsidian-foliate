import { App, SuggestModal, TFile } from "obsidian";
import { TaxaMapping } from "../types";
import { stripPrefix } from "../taxa";

/**
 * Pick a domain to add a taxa file to. Lists existing ≈ domain files by their
 * clean name; typing a name that matches nothing offers to create it. Returns
 * the chosen clean name (no ≈ prefix) via onChoose.
 */
export class DomainPickerModal extends SuggestModal<string> {
  private domain: TaxaMapping;
  private onChoose: (name: string) => void;
  private names: string[];
  /** Domain name -> folder paths of every file carrying it. Only names with
   * more than one entry are ambiguous; renderSuggestion shows those folders so
   * the collision is visible rather than silently merged. */
  private duplicates: Map<string, string[]>;

  constructor(app: App, domain: TaxaMapping, onChoose: (name: string) => void) {
    super(app);
    this.domain = domain;
    this.onChoose = onChoose;
    this.setPlaceholder("Add to domain…");

    // Existing domain files. When a domain folder is configured, that folder is
    // the authority: a ≈-named file elsewhere in the vault is a stray copy, not
    // a domain, and listing it invites adding membership to a file the domain
    // layer doesn't own. This also matches how the matcher scopes taxa files (by
    // folder, in getTaxaFilesByFolder). With no folder set, fall back to
    // scanning the vault by prefix, or an unconfigured domain would list nothing.
    const folderScope = domain.folder?.trim();
    const inScope = (f: TFile): boolean =>
      folderScope ? f.path.startsWith(folderScope + "/") : f.basename.startsWith(domain.prefix);

    // Two files can't share a name within one folder, so scoping usually makes
    // duplicates impossible. Across an unscoped vault they can, so still group
    // by name: one row per name, folders kept for disambiguation. A bare
    // [[≈Name]] link can't address either file, so a duplicate is a
    // link-integrity problem the user needs to see.
    const byName = new Map<string, string[]>();
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.basename.startsWith(domain.prefix)) continue;
      if (!inScope(f)) continue;
      const name = stripPrefix(f.basename, domain);
      const folder = f.parent?.path ?? "/";
      const folders = byName.get(name);
      if (folders) folders.push(folder);
      else byName.set(name, [folder]);
    }
    this.duplicates = byName;
    this.names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  }

  getSuggestions(query: string): string[] {
    const q = query.trim();
    const matches = this.names.filter((n) => n.toLowerCase().includes(q.toLowerCase()));
    // Offer to create a new domain when the typed name isn't an exact match.
    if (q && !this.names.some((n) => n.toLowerCase() === q.toLowerCase())) {
      matches.unshift(q);
    }
    return matches;
  }

  renderSuggestion(name: string, el: HTMLElement): void {
    const isNew = !this.names.some((n) => n.toLowerCase() === name.toLowerCase());
    el.createEl("div", { text: `${this.domain.prefix}${name}` });
    if (isNew) {
      el.createEl("small", { text: "Create new domain" });
      return;
    }
    // More than one file carries this name, so [[≈Name]] is ambiguous. Name the
    // folders so the user can merge or rename them.
    const folders = this.duplicates.get(name);
    if (folders && folders.length > 1) {
      el.createEl("small", {
        text: `${folders.length} files with this name: ${folders.join(", ")}`,
      });
    }
  }

  onChooseSuggestion(name: string): void {
    this.onChoose(name);
  }
}
