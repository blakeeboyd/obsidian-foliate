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

  constructor(app: App, domain: TaxaMapping, onChoose: (name: string) => void) {
    super(app);
    this.domain = domain;
    this.onChoose = onChoose;
    this.setPlaceholder("Add to domain…");
    // Existing domain files: markdown files whose name carries the ≈ prefix.
    this.names = app.vault
      .getMarkdownFiles()
      .filter((f) => f.basename.startsWith(domain.prefix))
      .map((f) => stripPrefix(f.basename, domain))
      .sort((a, b) => a.localeCompare(b));
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
    if (isNew) el.createEl("small", { text: "Create new domain" });
  }

  onChooseSuggestion(name: string): void {
    this.onChoose(name);
  }
}
