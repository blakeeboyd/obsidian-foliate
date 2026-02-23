import { App, FuzzySuggestModal } from "obsidian";
import { TaxaMapping } from "../types";

export class TaxaPickerModal extends FuzzySuggestModal<TaxaMapping> {
  private onChoose: (taxon: TaxaMapping) => void;
  private mappings: TaxaMapping[];

  constructor(
    app: App,
    mappings: TaxaMapping[],
    onChoose: (taxon: TaxaMapping) => void
  ) {
    super(app);
    this.mappings = mappings;
    this.onChoose = onChoose;
    this.setPlaceholder("Choose taxa type...");
  }

  getItems(): TaxaMapping[] {
    return this.mappings;
  }

  getItemText(item: TaxaMapping): string {
    return `${item.prefix} ${item.label}`;
  }

  onChooseItem(item: TaxaMapping): void {
    this.onChoose(item);
  }
}
