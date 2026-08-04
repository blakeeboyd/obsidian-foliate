import { App, Modal, Notice } from "obsidian";

/**
 * Show the debug report on screen, with a button to copy it.
 *
 * Copying straight to the clipboard meant the only way to read the report was to
 * paste it somewhere, so a user checking their own setup had to take a detour
 * through another document. Showing it first makes the report useful to the
 * person running it, not just to whoever receives the paste.
 */
export class DebugReportModal extends Modal {
  private report: string;

  constructor(app: App, report: string) {
    super(app);
    this.report = report;
  }

  onOpen() {
    this.modalEl.addClass("foliate-debug-modal");
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Foliate debug report" });

    // Problems are the reason to read this, so say up front whether there are
    // any rather than making the user scroll to the end to find out.
    const problemCount = this.report
      .split("\n")
      .filter((l) => l.startsWith("  - ")).length;
    contentEl.createEl("p", {
      cls: "foliate-debug-summary",
      text:
        problemCount > 0
          ? `${problemCount} problem${problemCount === 1 ? "" : "s"} found. Paste this into a bug report.`
          : "No problems found. Paste this into a bug report if you're reporting an issue.",
    });

    contentEl.createEl("pre", { cls: "foliate-debug-body" }).setText(this.report);

    const footer = contentEl.createDiv("foliate-debug-footer");
    const close = footer.createEl("button", { text: "Close" });
    close.addEventListener("click", () => this.close());

    const copy = footer.createEl("button", { cls: "mod-cta", text: "Copy to clipboard" });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.report);
        copy.setText("Copied");
        window.setTimeout(() => copy.setText("Copy to clipboard"), 1500);
      } catch (e) {
        new Notice(`Could not copy: ${e}`);
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
