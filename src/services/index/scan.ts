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
 * Every taxa file mentioned in `text`, as a set of vault paths.
 *
 * A set, not counts: the co-occurrence and document-frequency math downstream
 * is over set membership per note (the plan's section 2), so how many times a
 * note says "phase" never enters the index. That also makes the incremental
 * update a pure set diff, which is what keeps it exactly reversible.
 */
export function scanNote(text: string, dict: TermDictionary): Set<string> {
  const words = tokenize(text);
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
