import { MarkdownPostProcessorContext } from "obsidian";
import { ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TaxaMapping } from "../types";
import { findTaxonByPrefix } from "../taxa";

/**
 * Color resolved wikilinks by taxon.
 *
 * An uncolored taxon emits nothing at all: no class, no custom property, no
 * inline style. The link then renders in whatever the user's theme resolves
 * --link-color to, which is the theme-correct default in both light and dark
 * without this file knowing anything about themes. Colors are opt-in, and the
 * default is the absence of behavior rather than a color we chose.
 */

/** The taxa whose links carry a color, in prefix order. Empty when none do. */
function coloredTaxa(mappings: TaxaMapping[]): TaxaMapping[] {
  return mappings.filter((t) => t.prefix && t.linkColor);
}

/**
 * Reading view: Obsidian renders [[target]] as <a data-href="target">. Read
 * data-href rather than the link text, since [[@Ada|she]] displays an alias
 * that carries no prefix.
 *
 * Unresolved links are left alone. They already have their own theme color
 * (--link-unresolved-color) that signals "this file does not exist", and
 * overriding it would hide a broken link behind a taxon color.
 */
export function buildLinkColorPostProcessor(
  getTaxa: () => TaxaMapping[]
): (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
  return (el: HTMLElement) => {
    const taxa = coloredTaxa(getTaxa());
    if (taxa.length === 0) return;

    for (const link of Array.from(el.querySelectorAll("a.internal-link"))) {
      if (link.classList.contains("is-unresolved")) continue;
      const href = link.getAttribute("data-href") ?? "";
      if (!href) continue;
      const taxon = findTaxonByPrefix(href, taxa);
      if (!taxon) continue;
      const el2 = link as HTMLElement;
      el2.classList.add("foliate-link");
      el2.style.setProperty("--foliate-link-color", taxon.linkColor as string);
    }
  };
}

/**
 * Editor (live preview / source): scan the visible ranges for [[…]] and mark
 * the whole link, brackets included, matching what reading view colors.
 *
 * Scoped to visibleRanges so the cost is a screenful of text per update, not
 * the document. A note is one string here; the matcher's exclusion machinery
 * is not reused because a [[ ]] inside a code fence is not a link Obsidian
 * renders, and marking it is the smaller wrong than pulling the whole matcher
 * into a per-keystroke path.
 */
/** A wikilink found in a text slice, with the taxon that colors it. */
export interface LinkSpan {
  from: number;
  to: number;
  taxon: TaxaMapping;
}

/**
 * Find every [[…]] in `text` whose target carries a colored taxon's prefix,
 * as offsets relative to `text`. Split out from the decoration builder so the
 * scanning rules are testable without a CodeMirror view.
 */
export function findLinkSpans(text: string, taxa: TaxaMapping[]): LinkSpan[] {
  const spans: LinkSpan[] = [];
  if (taxa.length === 0) return spans;

  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf("[[", pos);
    if (open < 0) break;
    const close = text.indexOf("]]", open + 2);
    if (close < 0) break;

    const target = text.slice(open + 2, close);
    // A newline between the brackets means this "]]" closes a later link, not
    // this "[[": the user is mid-typing an unclosed one. Resume just after the
    // failed "[[" rather than past the "]]", or the real link that owns those
    // closing brackets is skipped and never colored.
    if (target.includes("\n") || target.length === 0) {
      pos = open + 2;
      continue;
    }

    const taxon = findTaxonByPrefix(target, taxa);
    if (taxon) spans.push({ from: open, to: close + 2, taxon });
    pos = close + 2;
  }
  return spans;
}

function buildDecorations(view: EditorView, taxa: TaxaMapping[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (taxa.length === 0) return builder.finish();

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const span of findLinkSpans(text, taxa)) {
      builder.add(
        from + span.from,
        from + span.to,
        Decoration.mark({
          class: "foliate-link",
          attributes: { style: `--foliate-link-color: ${span.taxon.linkColor}` },
        })
      );
    }
  }
  return builder.finish();
}

export function buildLinkColorExtension(getTaxa: () => TaxaMapping[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, coloredTaxa(getTaxa()));
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, coloredTaxa(getTaxa()));
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}
