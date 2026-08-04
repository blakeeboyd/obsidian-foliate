import { App, SuggestModal } from "obsidian";
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

    // Existing domain files: markdown files whose name carries the ≈ prefix.
    // Several files can share a name (e.g. Work/≈AI.md and Research/≈AI.md), so
    // group by name: one row per name, with the folders kept for disambiguation.
    // A bare [[≈Name]] link can't address either file unambiguously, so a
    // duplicate here is a link-integrity problem the user needs to see.
    const byName = new Map<string, string[]>();
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.basename.startsWith(domain.prefix)) continue;
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
