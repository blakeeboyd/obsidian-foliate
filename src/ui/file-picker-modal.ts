import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Pick one file from a set of candidates. Used when a word under the cursor
 * matches more than one existing taxa file, so the user chooses which to link
 * instead of the plugin guessing. Each row shows the file's basename (prefix
 * included) and its parent folder, so same-named files in different taxa folders
 * are distinguishable.
 */
export class FilePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder("Multiple matches. Choose a file to link...");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    const folder = file.parent?.path;
    return folder && folder !== "/" ? `${file.basename}  (${folder})` : file.basename;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
