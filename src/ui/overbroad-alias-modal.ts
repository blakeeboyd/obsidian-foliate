import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { removeAliasFromFile } from "../services/file-operations";

export interface OverbroadAliasInfo {
  file: TFile;
  /** The abbreviation that surfaced the row, as written in the note. */
  alias: string;
  /** The file's full name, which this note never says. */
  full: string;
  /** The file's other terms, which keep working if the alias goes. */
  alternatives: string[];
  /** Times the alias occurs in the open note. */
  hereCount: number;
}

/**
 * Explain one over-reaching alias and offer the fix, without leaving the note.
 *
 * The mark that opens this appears when an abbreviation surfaced a row and the
 * concept's own name is nowhere in the note: "sub" on a log about sub tasks
 * pulling in "+subwoofer". Clicking used to open the taxa file in a new tab,
 * which moved the reader somewhere else to make a decision they had not made
 * yet, and left them to edit YAML by hand once they got there.
 *
 * So the dialog states the case and offers the two answers that exist. Removing
 * the alias is offered first because it is the fix the plugin recommends over
 * gating: it holds in search, backlinks and every query that reads the vault,
 * not just in this sidebar. Opening the file stays available for the times the
 * right answer is something else, like renaming the concept.
 *
 * Deliberately not automatic. An alias is the user's own word for their own
 * concept, and the plugin's evidence is that it collides here, which is not the
 * same as knowing it is wrong.
 */
export class OverbroadAliasModal extends Modal {
  private info: OverbroadAliasInfo;
  private onChanged: () => void;

  constructor(app: App, info: OverbroadAliasInfo, onChanged: () => void) {
    super(app);
    this.info = info;
    this.onChanged = onChanged;
  }

  onOpen() {
    const { contentEl } = this;
    const { file, alias, full, alternatives, hereCount } = this.info;

    contentEl.createEl("h3", { text: `"${alias}" is a common word` });

    // The diagnosis first, because it is what the reader needs in order to
    // decide: this row is here because an ordinary word was claimed as a name
    // for a specific concept. Naming that is more use than describing the
    // mechanics of the match.
    const p = contentEl.createEl("p", { cls: "foliate-modal-lede" });
    p.appendText(`"${alias}" is listed as an alias of `);
    p.createEl("strong", { text: file.basename });
    p.appendText(
      `, so every use of it anywhere in the vault is read as a mention of that ` +
        `concept. It is an abbreviation of "${full}" and an ordinary word in its own ` +
        `right, which is why it turns up in writing that has nothing to do with the concept.`
    );

    const evidence = contentEl.createEl("p", { cls: "foliate-modal-detail" });
    evidence.appendText(`Here, this note uses "${alias}" `);
    evidence.createEl("strong", { text: `${hereCount} time${hereCount === 1 ? "" : "s"}` });
    evidence.appendText(` and never says "${full}".`);

    if (alternatives.length > 0) {
      contentEl.createEl("p", {
        cls: "foliate-modal-detail",
        text:
          `Removing the alias costs nothing: ${alternatives.slice(0, 6).join(", ")}` +
          `${alternatives.length > 6 ? `, and ${alternatives.length - 6} more` : ""} ` +
          `still reach this file, and the fix holds in search and backlinks too, ` +
          `not just here.`,
      });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(`Remove "${alias}" from aliases`)
          .setCta()
          .onClick(async () => {
            const removed = await removeAliasFromFile(this.app, file, alias);
            new Notice(
              removed
                ? `Removed "${alias}" from ${file.basename}.`
                : `"${alias}" was not in ${file.basename}'s aliases.`
            );
            this.close();
            if (removed) this.onChanged();
          })
      )
      .addButton((b) =>
        b.setButtonText("Open the file").onClick(() => {
          this.close();
          void this.app.workspace.getLeaf(true).openFile(file);
        })
      )
      .addButton((b) => b.setButtonText("Leave it").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
