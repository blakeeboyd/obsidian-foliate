import { App, Modal } from "obsidian";
import { TaxaMapping } from "../types";

/**
 * A symbol offered as a taxa prefix.
 *
 * `keys` is the US-layout combination that types it, shown as a hint. It is
 * layout-specific and will be wrong on other keyboards, which is acceptable
 * because it is a hint beside a clickable symbol rather than the only way in.
 *
 * `names` are the search terms. A person hunting for ≈ is more likely to type
 * "approximately" or "wave" than to know it is called "almost equal to", so
 * every symbol carries its formal name plus the words people actually reach
 * for.
 */
interface SymbolOption {
  char: string;
  keys: string;
  names: string[];
}

/**
 * Symbols worth offering as prefixes: reachable with Option or Option-Shift on
 * a US layout, distinct at small sizes, and unlikely to appear at the start of
 * an ordinary filename.
 *
 * Ordered by likely use rather than code point, since the top of the list is
 * what most people will take. The plugin's own defaults come first.
 */
const SYMBOLS: SymbolOption[] = [
  { char: "@", keys: "Shift-2", names: ["at", "people", "person", "mention"] },
  { char: "+", keys: "Shift-=", names: ["plus", "add", "concept"] },
  { char: "~", keys: "Shift-`", names: ["tilde", "squiggle", "place"] },
  { char: "©", keys: "Option-G", names: ["copyright", "work", "c in circle"] },
  { char: "•", keys: "Option-8", names: ["bullet", "dot", "point", "project"] },
  { char: "¡", keys: "Option-1", names: ["inverted exclamation", "upside down", "image"] },
  { char: "º", keys: "Option-0", names: ["masculine ordinal", "degree", "organization"] },
  { char: "∞", keys: "Option-5", names: ["infinity", "endless", "loop", "event"] },
  { char: "≈", keys: "Option-X", names: ["approximately", "almost equal", "wave", "domain"] },
  { char: "&", keys: "Shift-7", names: ["ampersand", "and", "contact"] },
  { char: "§", keys: "Option-6", names: ["section", "paragraph", "legal"] },
  { char: "¶", keys: "Option-7", names: ["pilcrow", "paragraph"] },
  { char: "†", keys: "Option-T", names: ["dagger", "cross", "obelisk"] },
  { char: "‡", keys: "Option-Shift-7", names: ["double dagger", "diesis"] },
  { char: "◊", keys: "Option-Shift-V", names: ["lozenge", "diamond", "rhombus"] },
  { char: "∆", keys: "Option-J", names: ["delta", "triangle", "change", "difference"] },
  { char: "∑", keys: "Option-W", names: ["sigma", "sum", "total"] },
  { char: "π", keys: "Option-P", names: ["pi", "greek"] },
  { char: "µ", keys: "Option-M", names: ["mu", "micro", "greek"] },
  { char: "ø", keys: "Option-O", names: ["slashed o", "empty set", "null"] },
  { char: "å", keys: "Option-A", names: ["a with ring", "angstrom", "nordic"] },
  { char: "ß", keys: "Option-S", names: ["eszett", "sharp s", "german"] },
  { char: "∂", keys: "Option-D", names: ["partial derivative", "curly d"] },
  { char: "ƒ", keys: "Option-F", names: ["florin", "function", "f hook"] },
  { char: "®", keys: "Option-R", names: ["registered", "trademark", "r in circle"] },
  { char: "™", keys: "Option-2", names: ["trademark", "tm"] },
  { char: "°", keys: "Option-Shift-8", names: ["degree", "temperature", "ring"] },
  { char: "≤", keys: "Option-,", names: ["less than or equal"] },
  { char: "≥", keys: "Option-.", names: ["greater than or equal"] },
  { char: "≠", keys: "Option-=", names: ["not equal", "inequality"] },
  { char: "±", keys: "Option-Shift-=", names: ["plus minus", "tolerance"] },
  { char: "÷", keys: "Option-/", names: ["divide", "division", "obelus"] },
  { char: "√", keys: "Option-V", names: ["square root", "radical", "check"] },
  { char: "∫", keys: "Option-B", names: ["integral", "calculus"] },
  { char: "¬", keys: "Option-L", names: ["not", "negation", "logical not"] },
  { char: "¿", keys: "Option-Shift-/", names: ["inverted question", "upside down question"] },
  { char: "ª", keys: "Option-9", names: ["feminine ordinal"] },
  { char: "«", keys: "Option-\\", names: ["left guillemet", "quote", "angle quote"] },
  { char: "»", keys: "Option-Shift-\\", names: ["right guillemet", "quote", "angle quote"] },
  { char: "◦", keys: "(paste)", names: ["white bullet", "hollow dot", "ring"] },
];

/**
 * Pick a taxa prefix by clicking rather than by knowing a key combination.
 *
 * Six of the plugin's ten default prefixes need a modifier on a US keyboard,
 * so a user who clears the field cannot retype what shipped. Search covers the
 * same gap from the other side: someone who knows they want "the infinity one"
 * should not have to recognize ∞ in a grid.
 *
 * Symbols already used by another taxon are shown but not selectable, since two
 * taxa sharing a prefix means one of them can never match.
 */
export class SymbolPickerModal extends Modal {
  private onChoose: (char: string) => void;
  private taken: Map<string, string>;
  private query = "";
  private gridEl: HTMLElement | null = null;

  constructor(
    app: App,
    /** Every taxon, used to mark prefixes already in use. */
    taxa: TaxaMapping[],
    /** The taxon being edited, whose own prefix is not a conflict. */
    current: TaxaMapping | null,
    onChoose: (char: string) => void
  ) {
    super(app);
    this.onChoose = onChoose;
    this.taken = new Map();
    for (const t of taxa) {
      if (t.prefix && t !== current) this.taken.set(t.prefix, t.label);
    }
  }

  onOpen() {
    this.modalEl.addClass("foliate-symbol-modal");
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Choose a prefix" });

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "foliate-symbol-search",
      placeholder: "Search by name: infinity, bullet, copyright…",
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.renderGrid();
    });
    // Enter takes the first match, so a search can be completed without
    // reaching for the mouse.
    search.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter") return;
      const first = this.filtered()[0];
      if (first && !this.taken.has(first.char)) {
        this.onChoose(first.char);
        this.close();
      }
    });

    this.gridEl = contentEl.createDiv("foliate-symbol-grid");
    this.renderGrid();
    search.focus();
  }

  /** Symbols matching the query, by character or by any of its names. */
  private filtered(): SymbolOption[] {
    if (!this.query) return SYMBOLS;
    return SYMBOLS.filter(
      (s) => s.char === this.query || s.names.some((n) => n.includes(this.query))
    );
  }

  private renderGrid() {
    const grid = this.gridEl;
    if (!grid) return;
    grid.empty();

    const matches = this.filtered();
    if (matches.length === 0) {
      grid.createEl("p", {
        cls: "foliate-symbol-empty",
        text: "No symbol matches that name. Type any character into the field to use it.",
      });
      return;
    }

    for (const sym of matches) {
      const takenBy = this.taken.get(sym.char);
      const cell = grid.createDiv("foliate-symbol-cell");
      if (takenBy) cell.addClass("is-taken");

      cell.createDiv({ cls: "foliate-symbol-char", text: sym.char });
      cell.createDiv({ cls: "foliate-symbol-keys", text: sym.keys });
      // The primary name only: the rest are search terms, not labels.
      cell.createDiv({ cls: "foliate-symbol-name", text: sym.names[0] });

      if (takenBy) {
        cell.setAttribute("aria-label", `Already used by ${takenBy}`);
        cell.createDiv({ cls: "foliate-symbol-taken", text: takenBy });
        continue;
      }

      cell.setAttribute("aria-label", `${sym.names[0]} (${sym.keys})`);
      cell.addEventListener("click", () => {
        this.onChoose(sym.char);
        this.close();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
