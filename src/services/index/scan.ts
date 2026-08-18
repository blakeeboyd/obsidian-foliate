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

/**
 * A short signature of the terms a dictionary was built from.
 *
 * A note's mention set depends on the note and on every taxa file's terms, so a
 * stored scan is only reusable while the dictionary still matches. Renaming a
 * taxa file, adding an alias, or creating one changes what an untouched note
 * mentions; without this, an incremental rebuild would keep stale sets forever
 * and the change would never appear.
 *
 * Order-independent and cheap: a running sum over each term's characters, so
 * the same terms in a different file order give the same value. Not a
 * cryptographic hash, and does not need to be, since it guards against ordinary
 * edits rather than deliberate collisions.
 */
export function fingerprintEntries(
  files: { path: string; terms: string[] }[]
): string {
  let count = 0;
  let sum = 0;

  // Two requirements pull in opposite directions, so each is handled at its own
  // level. ACROSS files the value must not depend on order, or a vault listing
  // its files differently would invalidate every stored scan. WITHIN a file it
  // must: term order decides matching order, so a reordering is a real change.
  //
  // So each file hashes to one value that includes its terms' positions, and
  // those per-file values are summed, which is order-independent.
  for (const file of files) {
    let fileHash = 2166136261;
    let position = 0;
    for (const term of file.terms) {
      if (typeof term !== "string" || term.length < 2) continue;
      count++;
      position++;
      fileHash ^= position;
      fileHash = Math.imul(fileHash, 16777619);
      for (let i = 0; i < term.length; i++) {
        fileHash ^= term.charCodeAt(i);
        fileHash = Math.imul(fileHash, 16777619);
      }
    }
    if (position > 0) sum = (sum + (fileHash >>> 0)) % 0xffffffff;
  }

  return `${count}:${sum}`;
}

/**
 * The note's distinct words, for concept signatures.
 *
 * Shares `stripNonProse` and `tokenize` with the mention scan so a word counts
 * here exactly when it would count there: link syntax and code are not prose,
 * and a term inside them is a literal rather than a reference.
 *
 * A set, not counts. A signature asks which notes a word appears in, never how
 * often within one, so saying a word twenty times in one note carries the same
 * weight as saying it once. That is what stops a single long note from
 * dominating the concept it links.
 *
 * Words of one or two characters are dropped: they are almost entirely
 * initials, units and articles, and they trade storage for no signal.
 */
export function noteWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of tokenize(stripNonProse(text))) {
    if (word.length < 3) continue;
    out.add(word);
  }
  return out;
}
