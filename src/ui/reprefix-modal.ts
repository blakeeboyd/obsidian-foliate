import { App, Modal, Notice, TFile } from "obsidian";
import { TaxaMapping } from "../types";
import { planReprefix, staleAliases, ReprefixPlan } from "../services/reprefix";
import { SymbolPickerModal } from "./symbol-picker";

/**
 * Change a taxon's prefix and rename every file that carries it.
 *
 * Separate from the settings field on purpose. Editing the prefix there is one
 * click away from a symbol picker and changes a setting; this renames upwards
 * of a thousand files and cannot be undone by the settings undo stack, so it
 * asks first and says how many. The two are different actions and only one of
 * them should be reachable by accident.
 *
 * Renaming goes through `fileManager.renameFile`, so Obsidian rewrites every
 * [[link]] itself. What this owns is going one file at a time.
 */
export class ReprefixModal extends Modal {
  constructor(
    app: App,
    private taxa: TaxaMapping[],
    private domain: TaxaMapping,
    /** Persist the new prefix once the files are renamed. */
    private onComplete: (taxon: TaxaMapping, newPrefix: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Change a taxon's prefix" });
    contentEl.createEl("p", {
      text:
        "Renames every file with the old prefix and updates links to them. " +
        "Aliases and folders are left alone.",
      cls: "setting-item-description",
    });

    const all = [...this.taxa, this.domain];
    for (const taxon of all) {
      if (!taxon.prefix) continue;
      const count = this.filesFor(taxon.prefix).length;
      const row = contentEl.createDiv("foliate-taxa-row");
      row.createSpan({ text: `${taxon.prefix}  ${taxon.label}` });
      const n = row.createSpan({
        text: count === 1 ? "1 file" : `${count.toLocaleString()} files`,
        cls: "setting-item-description",
      });
      n.style.marginLeft = "auto";
      n.style.marginRight = "8px";
      const btn = row.createEl("button", { text: "Change..." });
      btn.disabled = count === 0;
      btn.addEventListener("click", () => this.pickNewSymbol(taxon));
    }
  }

  private filesFor(prefix: string): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => f.basename.startsWith(prefix));
  }

  private pickNewSymbol(taxon: TaxaMapping) {
    new SymbolPickerModal(this.app, [...this.taxa, this.domain], taxon, (char) => {
      if (char === taxon.prefix) return;
      this.confirm(taxon, char);
    }).open();
  }

  private confirm(taxon: TaxaMapping, newPrefix: string) {
    const files = this.filesFor(taxon.prefix);
    const existing = new Set(this.app.vault.getAllLoadedFiles().map((f) => f.path));
    const { planned, blocked } = planReprefix(files, taxon.prefix, newPrefix, existing);

    // Aliases spelling the old prefix survive the rename and go stale. Counted
    // here so the confirmation can say so, rather than discovered later as
    // terms that resolve to a prefix no longer in use.
    const aliasesByPath = new Map<string, string[]>();
    for (const f of planned) {
      const fm = this.app.metadataCache.getFileCache(f.file)?.frontmatter;
      const raw = fm?.aliases ?? fm?.alias;
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
      aliasesByPath.set(f.file.path, list.map(String));
    }
    const stale = staleAliases(aliasesByPath, planned.map((p) => p.file.path), taxon.prefix);

    this.close();
    new ReprefixConfirmModal(
      this.app,
      taxon,
      newPrefix,
      planned,
      blocked,
      stale.length,
      async () => {
        await this.run(taxon, newPrefix, planned);
      }
    ).open();
  }

  /**
   * Rename one file at a time, waiting for the link graph to settle between
   * each.
   *
   * Not a parallel map, and this is the whole reason the operation needs code
   * rather than a loop. Renaming a taxa file triggers Obsidian's own pass
   * rewriting every link that points at it; issuing the next rename while that
   * pass is running races it and loses link updates. The same hazard is
   * documented on scheduleAutoMoveAfterLinksResolve, which handles the single
   * -file case for auto-move.
   */
  private async run(taxon: TaxaMapping, newPrefix: string, plans: ReprefixPlan[]) {
    const notice = new Notice(`Renaming 0/${plans.length}...`, 0);
    let done = 0;
    const failed: string[] = [];
    for (const plan of plans) {
      try {
        await this.app.fileManager.renameFile(plan.file, plan.to);
        await this.linksResolved();
        done++;
        if (done % 10 === 0 || done === plans.length) {
          notice.setMessage(`Renaming ${done}/${plans.length}...`);
        }
      } catch (e) {
        failed.push(`${plan.from}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // The setting follows the files. Doing it the other way round leaves every
    // renamed file unmatched by any taxon if a rename throws partway.
    await this.onComplete(taxon, newPrefix);
    notice.hide();
    const msg =
      failed.length > 0
        ? `Renamed ${done} of ${plans.length}. ${failed.length} failed, see console.`
        : `Renamed ${done} ${done === 1 ? "file" : "files"} to ${newPrefix}.`;
    new Notice(msg, 8000);
    if (failed.length > 0) console.error("Foliate re-prefix failures:\n" + failed.join("\n"));
  }

  /**
   * Resolve once Obsidian has finished rewriting links, or after a timeout.
   *
   * "resolved" does not fire when a rename had no links to update, which is the
   * common case for a taxa file nothing points at yet, so the timeout is the
   * normal path rather than the error path. Kept short because it is paid once
   * per file.
   */
  private linksResolved(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.app.metadataCache.offref(ref);
        window.clearTimeout(timer);
        resolve();
      };
      const ref = this.app.metadataCache.on("resolved", finish);
      const timer = window.setTimeout(finish, 300);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** The count, the collisions, and a button that says what it will do. */
class ReprefixConfirmModal extends Modal {
  constructor(
    app: App,
    private taxon: TaxaMapping,
    private newPrefix: string,
    private planned: ReprefixPlan[],
    private blocked: ReprefixPlan[],
    private staleAliasCount: number,
    private onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `${this.taxon.prefix} to ${this.newPrefix}` });

    const n = this.planned.length;
    contentEl.createEl("p", {
      text:
        n === 0
          ? "No files can be renamed."
          : `Rename ${n.toLocaleString()} ${n === 1 ? "file" : "files"} and update every link to them. This cannot be undone.`,
    });

    if (this.planned.length > 0) {
      const sample = contentEl.createEl("p", { cls: "setting-item-description" });
      const first = this.planned[0];
      sample.setText(`For example: ${first.file.name} becomes ${first.to.split("/").pop()}`);
    }

    if (this.blocked.length > 0) {
      const b = contentEl.createEl("p", { cls: "setting-item-description" });
      b.setText(
        `${this.blocked.length} skipped: a file with the new name already exists. ` +
          this.blocked
            .slice(0, 3)
            .map((p) => p.file.name)
            .join(", ") +
          (this.blocked.length > 3 ? ", ..." : "")
      );
    }

    if (this.staleAliasCount > 0) {
      contentEl.createEl("p", {
        text:
          `${this.staleAliasCount} of these files have an alias spelling the old prefix. ` +
          "Renaming leaves those aliases as they are.",
        cls: "setting-item-description",
      });
    }

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";
    row.style.marginTop = "12px";
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    if (this.planned.length > 0) {
      const ok = row.createEl("button", {
        text: `Rename ${this.planned.length.toLocaleString()}`,
        cls: "mod-warning",
      });
      ok.addEventListener("click", () => {
        this.close();
        void this.onConfirm();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
