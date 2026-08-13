import { App, Modal, Notice, TFile } from "obsidian";
import { MentionIndex } from "../services/index/mention-index";

/**
 * What the index actually learned, in a form that can be judged.
 *
 * The index is invisible by design: it decides what to surface and what to
 * rank, and a user cannot see why. This is the inspect affordance for it,
 * built at the same time as the index rather than after, because a derived
 * structure nobody can read is a derived structure nobody can debug.
 */
export class IndexReportModal extends Modal {
  private index: MentionIndex;

  constructor(app: App, index: MentionIndex) {
    super(app);
    this.index = index;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("foliate-index-report");
    contentEl.createEl("h2", { text: "Mention index" });

    const stats = this.index.corpus;
    if (!stats) {
      contentEl.createEl("p", {
        text: "No index yet. Run “Build mention index” first.",
      });
      return;
    }

    const summary = contentEl.createDiv("foliate-index-summary");
    const row = (label: string, value: string) => {
      const d = summary.createDiv("foliate-index-stat");
      d.createSpan({ text: label, cls: "foliate-index-stat-label" });
      d.createSpan({ text: value, cls: "foliate-index-stat-value" });
    };
    row("Notes indexed", stats.noteCount.toLocaleString());
    row("Taxa mentioned", stats.df.size.toLocaleString());
    row("Pairs observed", stats.cooc.size.toLocaleString());

    // The terms common enough to need gating. On the measured vault this is a
    // couple of dozen out of thousands, which is the finding that makes the
    // whole gate cheap.
    const ambiguous = this.index.ambiguousTerms(0.05);
    contentEl.createEl("h3", { text: `Common terms (${ambiguous.length})` });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Mentioned in more than 5% of notes, so common enough that context decides whether they mean anything. Everything else is specific enough to surface freely.",
    });

    const list = contentEl.createDiv("foliate-index-list");
    for (const t of ambiguous.slice(0, 30)) {
      const item = list.createDiv("foliate-index-item");
      const head = item.createDiv("foliate-index-item-head");
      head.createSpan({
        text: `${(t.ratio * 100).toFixed(1)}%`,
        cls: "foliate-index-ratio",
      });
      const nameEl = head.createSpan({ text: basename(t.path), cls: "foliate-index-name" });
      nameEl.style.minWidth = "0";
      head.createSpan({ text: `${t.df} notes`, cls: "foliate-index-count" });

      // The neighbours are the readable evidence: a term whose top neighbours
      // are its own domain is gateable, one whose neighbours are unrelated is
      // a common word that happens to have a file.
      const neighbors = this.index.neighbors(t.path, 6);
      const line = item.createDiv("foliate-index-neighbors");
      if (neighbors.length === 0) {
        line.createSpan({ text: "no pairs above the evidence floor" });
      } else {
        line.setText(
          neighbors
            .map((n) => `${basename(n.path)} (${n.score.toFixed(2)})`)
            .join(", ")
        );
      }
    }

    const footer = contentEl.createDiv("foliate-index-footer");
    const copy = footer.createEl("button", { text: "Copy report" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.buildTextReport(ambiguous));
      new Notice("Index report copied");
    });
  }

  private buildTextReport(
    ambiguous: { path: string; ratio: number; df: number }[]
  ): string {
    const stats = this.index.corpus;
    const lines: string[] = [];
    lines.push("Foliate mention index");
    lines.push(`notes: ${stats?.noteCount ?? 0}`);
    lines.push(`taxa mentioned: ${stats?.df.size ?? 0}`);
    lines.push(`pairs: ${stats?.cooc.size ?? 0}`);
    lines.push("");
    lines.push(`Common terms (>5% of notes): ${ambiguous.length}`);
    for (const t of ambiguous) {
      lines.push(`  ${(t.ratio * 100).toFixed(1)}%  ${basename(t.path)}  (${t.df} notes)`);
      for (const n of this.index.neighbors(t.path, 8)) {
        lines.push(`      ${n.score.toFixed(3)}  ${n.cooccurrences}x  ${basename(n.path)}`);
      }
    }
    return lines.join("\n");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
