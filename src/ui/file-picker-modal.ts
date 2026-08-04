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
  private onCancel?: () => void;
  private chose = false;

  constructor(
    app: App,
    files: TFile[],
    onChoose: (file: TFile) => void,
    /**
     * Run when the picker is dismissed without a choice. Lets a caller offering
     * near-matches ("did you mean one of these?") fall through to creating a new
     * file, so escaping the picker doesn't silently cancel the whole action.
     */
    onCancel?: () => void,
    placeholder = "Multiple matches. Choose a file to link..."
  ) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.onCancel = onCancel;
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    const folder = file.parent?.path;
    return folder && folder !== "/" ? `${file.basename}  (${folder})` : file.basename;
  }

  onChooseItem(file: TFile): void {
    this.chose = true;
    this.onChoose(file);
  }

  onClose(): void {
    super.onClose();
    // onChooseItem runs before close, so `chose` separates a real pick from a
    // dismissal (escape, click-away).
    if (!this.chose) this.onCancel?.();
  }
}
