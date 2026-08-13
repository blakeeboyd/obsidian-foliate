/**
 * The inverted mention scan.
 *
 * The sidebar matcher asks, for each of ~5,000 taxa files, "does this note
 * contain it?" — 61.5M file-pair checks over this vault, measured at 260s for
 * a full build and that with substring tests alone. This asks the reverse:
 * tokenize the note once, then look each word up in a dictionary. Cost becomes
 * proportional to note length instead of vault size. Same answers, 3.5s.
 *
 * See 43.10.105 Index Measurements in the vault for the numbers.
 *
 * Deliberately free of Obsidian imports so it can be tested directly.
 */

/** A term's words, lowercased, plus the taxa file it belongs to. */
export interface DictEntry {
  words: string[];
  /** Vault path of the taxa file this term names. */
  path: string;
}

/**
 * Terms bucketed by first word. A note pays for a multi-word phrase check only
 * at positions where that phrase could actually start, so "Ada Lovelace" costs
 * nothing in a note that never says "ada".
 */
export type TermDictionary = Map<string, DictEntry[]>;

/** Terms shorter than this are skipped, matching the sidebar matcher. */
const MIN_TERM_LENGTH = 2;

/**
 * Split text into lowercased words on the same character class the matcher
 * treats as word characters. Apostrophes and hyphens stay inside a word so
 * "wet/dry" splits but "Kaluli's" and "wide-band" do not.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}'-]+/u);
}

export function buildDictionary(
  files: { path: string; terms: string[] }[]
): TermDictionary {
  const dict: TermDictionary = new Map();
  for (const file of files) {
    for (const term of file.terms) {
      if (typeof term !== "string" || term.length < MIN_TERM_LENGTH) continue;
      const words = tokenize(term).filter(Boolean);
      if (words.length === 0) continue;
      let bucket = dict.get(words[0]);
      if (!bucket) dict.set(words[0], (bucket = []));
      bucket.push({ words, path: file.path });
    }
  }
  return dict;
}

/**
 * Blank out spans that are not prose, replacing each with spaces so the
 * remaining text keeps its shape.
 *
 * Wikilinks are the reason this exists. Without it `[[+phase]]` tokenizes to
 * "phase" and counts exactly like the word in a sentence, so "how often is this
 * term written but not linked" cannot be asked: the two are one number.
 * Measured on this vault, `+phase` occurred 363 times inside link syntax and
 * 10,706 times in prose, silently pooled.
 *
 * Code goes too, for the reason the sidebar matcher already excludes it: a term
 * inside `code` is a literal, not a reference.
 */
function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    .replace(/\[\[[^\]\n]*\]\]/g, (m) => " ".repeat(m.length))
    .replace(/\]\([^)\n]*\)/g, (m) => " ".repeat(m.length));
}

/**
 * Every taxa file mentioned in `text` but NOT already linked there.
 *
 * Excluding linked occurrences is what makes the mention count comparable to
 * the link count. A concept the user links whenever they mean it and a common
 * word that keeps appearing and never gets linked have similar raw frequencies
 * and opposite meanings; only the unlinked count separates them.
 *
 * A set, not counts: the co-occurrence and document-frequency math downstream
 * is over set membership per note (the plan's section 2), so how many times a
 * note says "phase" never enters the index. That also makes the incremental
 * update a pure set diff, which is what keeps it exactly reversible.
 */
export function scanNote(text: string, dict: TermDictionary): Set<string> {
  const words = tokenize(stripNonProse(text));
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const bucket = dict.get(words[i]);
    if (!bucket) continue;
    for (const entry of bucket) {
      if (entry.words.length === 1) {
        found.add(entry.path);
        continue;
      }
      let matched = true;
      for (let k = 1; k < entry.words.length; k++) {
        if (words[i + k] !== entry.words[k]) {
          matched = false;
          break;
        }
      }
      if (matched) found.add(entry.path);
    }
  }
  return found;
}
