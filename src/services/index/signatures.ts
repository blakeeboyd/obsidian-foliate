/**
 * What words a concept keeps company with.
 *
 * The plugin matches words, and a word match has a ceiling: a concept can be
 * squarely present in a note that never contains its name, and a note can say
 * the name a dozen times while being about something else. No amount of scoring
 * on top of word matching sees either case, because the evidence is not in the
 * inputs.
 *
 * The missing evidence is the words AROUND a term rather than the term itself.
 * "approval", "boundaries", "age-appropriate" are not a parenting concept and
 * are not substitutable for it, but where enough of them appear together the
 * concept is in the room. The deer is not the tracks.
 *
 * That signal can be learned with no model and no configuration, because the
 * user has already labelled it: a LINK is a deliberate assertion that a note is
 * about a file. Take the notes where a concept is linked, count their words,
 * and compare against how those words behave across the whole vault. What is
 * over-represented is the concept's signature.
 *
 * This is the sparse count-based side of distributional semantics (PPMI over a
 * co-occurrence matrix), and structurally the same move as Rocchio relevance
 * feedback in information retrieval, except the relevance judgements are real
 * rather than pseudo. See 43.10.106 in the vault for the measurements.
 */

/** One concept's signature: over-represented word to its weight. */
export type Signature = Map<string, number>;

export interface SignatureResult {
  /** Taxa file path to its signature. Absent for files with too few links. */
  byPath: Map<string, Signature>;
  /** Word to the taxa files whose signature contains it, for scoring a note. */
  inverted: Map<string, string[]>;
  /** Files that had links but produced no usable signature, for diagnostics. */
  thin: string[];
}

export interface SignatureConfig {
  /**
   * Linked notes a concept needs before a signature is built at all.
   *
   * Below this the words that come out describe one or two documents, not a
   * concept. Insufficient evidence has to read as no information rather than as
   * a weak guess, which is the same rule the gate follows.
   */
  minLinkedNotes: number;
  /** How many words to keep per concept. */
  topWords: number;
  /**
   * Share of a concept's linked notes a word must appear in.
   *
   * A word in one note out of twenty says something about that note.
   */
  minLocalShare: number;
  /**
   * Notes a word must appear in vault-wide before it can carry weight.
   *
   * A word appearing twice in the vault has an enormous lift wherever it lands,
   * which is the same rare-pair inflation NPMI suffers and the reason evidence
   * floors exist at all.
   */
  minGlobalNotes: number;
  /**
   * Share of the vault above which a word informs nothing.
   *
   * The vault is its own stopword list: a word contributes only in proportion
   * to how much MORE it appears near the concept than it does generally, so
   * "the" cancels without a word list. This cap only saves the arithmetic.
   */
  maxGlobalRatio: number;
  /**
   * Minimum IDF for a word to enter a signature.
   *
   * Lift alone is not enough, and the reason is structural rather than a
   * threshold to nudge. In a mostly technical vault, pronouns are rare enough
   * vault-wide to look over-represented in any humanities note: "she" is in
   * 3.9% of notes but 44% of one writer's, a lift of 2.43 that is arithmetically
   * correct and says nothing. A signature word has to be both over-represented
   * AND specific, and IDF is what measures the second.
   *
   * Measured: "this" 0.63, "what" 0.91, "you" 1.18, "who" 1.52 against
   * "wavelength" 4.20, "parenting" 4.52, "poetry" 5.12. A floor of 2.5 keeps
   * the topic words and drops the function words.
   *
   * It does not solve everything: "anybody" scores 5.10 and is still filler,
   * because register words can be genuinely rare. That is the open problem, and
   * this is the part of it the data does justify fixing.
   */
  minIdf: number;
}

export const DEFAULT_SIGNATURES: SignatureConfig = {
  minLinkedNotes: 3,
  topWords: 50,
  minLocalShare: 0.3,
  minGlobalNotes: 3,
  maxGlobalRatio: 0.25,
  minIdf: 2.5,
};

/** A note's contribution to the signatures of the concepts it links. */
export interface NoteWords {
  path: string;
  words: Set<string>;
}

/**
 * Build a signature for every concept with enough linked notes to justify one.
 *
 * `linkedBy` is the ground truth: concept path to the notes that link it. It
 * comes from Obsidian's resolved link graph, so it is the user's own
 * assertions rather than anything inferred.
 */
export function buildSignatures(
  notes: NoteWords[],
  linkedBy: Map<string, string[]>,
  config: SignatureConfig = DEFAULT_SIGNATURES
): SignatureResult {
  const noteCount = notes.length;
  const byPath = new Map<string, Signature>();
  const inverted = new Map<string, string[]>();
  const thin: string[] = [];
  if (noteCount === 0) return { byPath, inverted, thin };

  const index = new Map<string, NoteWords>();
  for (const n of notes) index.set(n.path, n);

  // Vault-wide document frequency, computed once and read by every concept.
  const df = new Map<string, number>();
  for (const note of notes) {
    for (const word of note.words) df.set(word, (df.get(word) ?? 0) + 1);
  }

  for (const [conceptPath, linkingPaths] of linkedBy) {
    const training: NoteWords[] = [];
    for (const path of linkingPaths) {
      const note = index.get(path);
      if (note) training.push(note);
    }
    if (training.length < config.minLinkedNotes) {
      if (linkingPaths.length > 0) thin.push(conceptPath);
      continue;
    }

    const local = new Map<string, number>();
    for (const note of training) {
      for (const word of note.words) local.set(word, (local.get(word) ?? 0) + 1);
    }

    const n = training.length;
    const floor = Math.max(2, Math.ceil(n * config.minLocalShare));
    const scored: { word: string; weight: number }[] = [];
    for (const [word, count] of local) {
      if (count < floor) continue;
      const global = df.get(word) ?? 0;
      if (global < config.minGlobalNotes) continue;
      if (global / noteCount > config.maxGlobalRatio) continue;
      // Specific enough that knowing it is present tells you something. A word
      // in half the vault has lift wherever it is dense, and means nothing.
      if (Math.log(noteCount / global) < config.minIdf) continue;
      const lift = Math.log(count / n / (global / noteCount));
      if (lift <= 0) continue;
      // Weighted by how many notes back it up, so a word in 20 of 25 notes
      // outranks one in 2 of 3 that happens to be rarer. Lift alone is
      // maximised by the thinnest evidence.
      scored.push({ word, weight: lift * Math.log(1 + count) });
    }

    if (scored.length === 0) {
      thin.push(conceptPath);
      continue;
    }

    scored.sort((a, b) => b.weight - a.weight);
    const signature: Signature = new Map();
    for (const { word, weight } of scored.slice(0, config.topWords)) {
      signature.set(word, weight);
      let holders = inverted.get(word);
      if (!holders) inverted.set(word, (holders = []));
      holders.push(conceptPath);
    }
    byPath.set(conceptPath, signature);
  }

  return { byPath, inverted, thin };
}

/** One concept's signature firing in a note. */
export interface SignatureHit {
  path: string;
  /** Summed weight of the signature words present. */
  score: number;
  /** The words that fired, strongest first, for the "why" readout. */
  matched: string[];
}

/**
 * Which concepts' signatures fire in a note.
 *
 * Reads the inverted index rather than scanning every signature, so the cost is
 * proportional to the note's vocabulary and not to how many concepts exist.
 */
export function scoreNote(
  words: Set<string>,
  signatures: SignatureResult,
  minWords = 3
): SignatureHit[] {
  const totals = new Map<string, { score: number; matched: { word: string; weight: number }[] }>();
  for (const word of words) {
    const holders = signatures.inverted.get(word);
    if (!holders) continue;
    for (const path of holders) {
      const weight = signatures.byPath.get(path)?.get(word);
      if (weight === undefined) continue;
      let entry = totals.get(path);
      if (!entry) totals.set(path, (entry = { score: 0, matched: [] }));
      entry.score += weight;
      entry.matched.push({ word, weight });
    }
  }

  const hits: SignatureHit[] = [];
  for (const [path, entry] of totals) {
    // One shared word is a coincidence. Highly-linked concepts share vocabulary
    // (on the reference vault "being-in-the-world" sits in 92 signatures), so a
    // single hit has to mean nothing.
    if (entry.matched.length < minWords) continue;
    entry.matched.sort((a, b) => b.weight - a.weight);
    hits.push({ path, score: entry.score, matched: entry.matched.map((m) => m.word) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
