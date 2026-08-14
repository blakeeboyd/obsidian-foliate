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

    // How mention frequency is distributed. A single threshold hides the shape
    // of this, and the shape is the point: nothing special happens at any one
    // percentage, so the cutoff is a dial rather than a fact about the vault.
    const bands: [number, number, string][] = [
      [0.2, 1.01, "20%+"],
      [0.1, 0.2, "10-20%"],
      [0.05, 0.1, "5-10%"],
      [0.02, 0.05, "2-5%"],
      [0.01, 0.02, "1-2%"],
      [0.005, 0.01, "0.5-1%"],
      [0.001, 0.005, "0.1-0.5%"],
      [0, 0.001, "under 0.1%"],
    ];
    const all = this.index.ambiguousTerms(0);
    contentEl.createEl("h3", { text: "How often taxa are mentioned" });
    const dist = contentEl.createDiv("foliate-index-dist");
    const widest = Math.max(
      ...bands.map(([lo, hi]) => all.filter((t) => t.ratio >= lo && t.ratio < hi).length)
    );
    for (const [lo, hi, label] of bands) {
      const count = all.filter((t) => t.ratio >= lo && t.ratio < hi).length;
      const bar = dist.createDiv("foliate-index-band");
      bar.createSpan({ text: label, cls: "foliate-index-band-label" });
      const track = bar.createDiv("foliate-index-band-track");
      const fill = track.createDiv("foliate-index-band-fill");
      fill.style.width = `${widest ? (count / widest) * 100 : 0}%`;
      bar.createSpan({ text: String(count), cls: "foliate-index-band-count" });
    }

    contentEl.createEl("h3", { text: "Common terms" });

    // One control, not two. A share and a count are the same number read two
    // ways over a fixed corpus, so offering both as separate thresholds forced
    // a choice between AND (the stricter bar wins and the other does nothing)
    // and OR (two bars to reason about). A slider showing both at once removes
    // the question: move it, and read the share, the note count, and how many
    // terms clear it.
    //
    // Logarithmic, because the useful range is 0.1% to 20% and half of a linear
    // slider's travel would sit above 5%, where almost nothing lives.
    const MIN_RATIO = 0.001;
    const MAX_RATIO = 0.2;
    const toRatio = (pos: number) =>
      MIN_RATIO * Math.pow(MAX_RATIO / MIN_RATIO, pos / 1000);
    const toPos = (ratio: number) =>
      Math.round((1000 * Math.log(ratio / MIN_RATIO)) / Math.log(MAX_RATIO / MIN_RATIO));

    const controls = contentEl.createDiv("foliate-index-controls");
    const slider = controls.createEl("input", { type: "range" });
    slider.min = "0";
    slider.max = "1000";
    slider.value = String(toPos(0.05));
    slider.addClass("foliate-index-slider");
    slider.setAttribute("aria-label", "How common a term has to be to be listed");

    const readout = controls.createSpan({ cls: "foliate-index-readout" });
    const caption = contentEl.createEl("p", { cls: "setting-item-description" });
    const list = contentEl.createDiv("foliate-index-list");

    const render = () => {
      const ratio = toRatio(Number(slider.value));
      // The count the share works out to in this vault, which is the number
      // that actually means something when judging whether a bar is sensible.
      const notes = Math.round(ratio * (stats.noteCount || 0));
      const terms = this.index.ambiguousTerms(ratio);

      // Below 1% a single decimal collapses distinct positions to "0.1%", so
      // the precision follows the magnitude.
      const pct = ratio * 100;
      const shown = pct < 1 ? pct.toFixed(2) : pct.toFixed(1);
      readout.setText(`${shown}% \u2248 ${notes.toLocaleString()} notes`);
      caption.setText(
        `${terms.length} of ${all.length} mentioned taxa appear in more than ${notes} of your ${stats.noteCount.toLocaleString()} notes. Those are the ones common enough that context has to decide what they mean; the rest are specific enough to surface freely.`
      );
      list.empty();
      this.renderTerms(list, terms);
    };
    slider.addEventListener("input", render);
    render();

    const footer = contentEl.createDiv("foliate-index-footer");
    const copy = footer.createEl("button", { text: "Copy report" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(
        this.buildTextReport(this.index.ambiguousTerms(toRatio(Number(slider.value))))
      );
      new Notice("Index report copied");
    });
  }

  private renderTerms(
    list: HTMLElement,
    terms: { path: string; ratio: number; df: number }[]
  ): void {
    for (const t of terms.slice(0, 60)) {
      const item = list.createDiv("foliate-index-item");
      const head = item.createDiv("foliate-index-item-head");
      head.createSpan({
        text: `${(t.ratio * 100).toFixed(1)}%`,
        cls: "foliate-index-ratio",
      });
      const nameEl = head.createSpan({ text: basename(t.path), cls: "foliate-index-name" });
      nameEl.style.minWidth = "0";
      const linked = this.index.linkedNoteCount(t.path);
      const curation = this.index.curationOf(t.path);
      const count = head.createSpan({
        text: `${t.df} unlinked, ${linked} linked`,
        cls: "foliate-index-count",
      });
      // Under 1% linked means the word keeps appearing without ever meaning
      // this file, which is the shape of a common word that owns a file.
      if (curation < 0.01) count.addClass("is-uncurated");
      count.setAttribute(
        "aria-label",
        `${(curation * 100).toFixed(1)}% of mentions are links`
      );

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
            .map(
              (n) =>
                `${basename(n.path)} (${n.score.toFixed(2)}${n.linkedTogether ? `, ${n.linkedTogether} co-linked` : ""})`
            )
            .join(", ")
        );
      }
    }
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
