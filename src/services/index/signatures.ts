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
  /**
   * How many notes form the peer population a concept is judged against.
   *
   * The vault is the wrong yardstick for a word's ordinariness when a concept's
   * notes are all one kind of document. Measured here: "she" appears in 3.9% of
   * the vault and 44% of one writer's notes, a lift of 2.43 that is
   * arithmetically correct and says nothing, because the writer's notes are
   * prose about people and "she" is ordinary in all of them. The same holds for
   * transcripts, where "let's", "anybody" and "everybody" are unremarkable.
   *
   * So each concept is compared against the notes that most resemble its own
   * training set rather than against everything. Filler cancels because the
   * peers use it just as much; subject vocabulary survives because they do not.
   *
   * Measured: "@C. Thi Nguyen" loses "anybody, incredibly, everybody, let's"
   * and gains "standardization, beauty, playful, engineered". Held-out
   * retrieval improves from 0.493 to 0.512 MRR, top-1 from 37% to 41%.
   *
   * Derived from the vault's own text, so no folders, labels or configuration
   * are involved: the peers are simply the notes sharing the most vocabulary
   * with the training set, which is what "same kind of document" means
   * distributionally.
   *
   * 150 rather than 400 because it is the whole cost of the feature and the
   * quality is the same. Building one population per concept is 400 notes'
   * vocabulary counted per concept, which measured at 26s over this vault
   * against 13s at 150 and 0.4s with no peer baseline at all. The signatures at
   * 150 and 400 are the same words in a slightly different order.
   */
  peerPopulation: number;
  /**
   * How hard to demote a word many unrelated concepts claim as distinctive.
   *
   * peerBaseline judges a word against documents of the same kind, which
   * removes the filler a register shares. What it cannot see is the word that
   * is genuinely over-represented for MANY concepts at once: measured on the
   * reference vault, "operates", "engagement", "capability", "criterion" and
   * "selection" each sit in the signatures of six to nine unrelated files.
   * Abstract academic vocabulary is distinctive against every peer population
   * and discriminating between none of them.
   *
   * A word's weight is therefore divided by how many signatures hold it, raised
   * to this power. Subject vocabulary clusters in a few related concepts and
   * barely moves; the abstract-register words are spread across many and sink.
   *
   * Fractional because the full reciprocal overcorrects: shared vocabulary
   * between genuinely related concepts is real evidence, and at power 1 the
   * measurement got worse (0.5111) than doing nothing. Held-out retrieval at
   * 0.25 reads 0.5337 MRR and 37.1% top-1 against 0.5194 and 33.7%, on 89 folds
   * where a handful of rank changes moves the number, so this is adopted for
   * what it does to the READOUT rather than on the strength of that margin.
   */
  crossConceptDamping: number;
  /**
   * How hard to favour words that REPEAT inside the notes that contain them.
   *
   * The register problem's remaining half. peerBaseline cancels the filler a
   * document type shares, and cross-concept damping demotes the abstractions
   * many concepts claim. Neither can see the word that is genuinely rare,
   * genuinely clustered in one concept's notes, and still not what the notes
   * are about: "anybody" scores 5.10 IDF and is filler.
   *
   * Church & Gale (1995) named the discriminator and it is not rarity. A word
   * whose documents are ABOUT it gets repeated as the discussion elaborates; a
   * word belonging to the register is said once and moved past. Their pair is
   * "boycott" against "somewhat", each around a thousand occurrences in the
   * same corpus, one clumped and one evenly spread, with matching IDF. Katz
   * (1996) adds the property that makes this worth having: the repeat rate
   * tracks topicality and NOT frequency, so it is orthogonal to the IDF floor
   * rather than another way of saying it.
   *
   * The statistic is the simplest one in that literature, collection frequency
   * over document frequency: how many times the word occurs in an average note
   * that has it at all. Measured on this vault, thirteen known register words
   * average 2.02 and thirteen known signature words 4.09.
   *
   * A weight rather than a filter, deliberately. The two populations separate
   * on average but overlap at the edges ("let's" scores 3.32, "zettelkasten"
   * 1.80), so a floor would cut real vocabulary to catch filler. Held-out
   * retrieval is flat from 0.5 to 1.5, which says the exponent is a broad
   * optimum rather than a tuned point.
   *
   * Measured, charged for coverage under true leave-one-out: MRR 0.5947 to
   * 0.6159 and top-1 43.8% to 47.2%, with no concept losing its signature.
   * Independent of peerBaseline rather than redundant with it: neither 0.5600,
   * burstiness alone 0.5746, peers alone 0.5947, both 0.6159.
   */
  burstiness: number;
  /**
   * How much the concepts a note LINKS may promote the ones it does not.
   *
   * Expressed as a share of the note's own strongest lexical score, so it is
   * scale-free (see NeighbourContext.weight).
   *
   * Measured on the reference vault, split by whether a fold has any neighbour
   * evidence at all, because a gain concentrated in a few folds must not be
   * reported as a global one:
   *
   *   with evidence (12 of 89): MRR 0.3736 to 0.7083, top-1 8.3% to 50.0%
   *   without      (77 of 89): MRR 0.6485 to 0.6485, unchanged
   *
   * The 12 are the hardest folds in the set: lexical alone scores 0.37 on them
   * against 0.65 for the rest, so they are notes whose own words do not
   * identify the concept, which is the case signatures exist for.
   *
   * 0.7 rather than the 0.9 that maximises the headline. At 0.9 the hard folds
   * reach 0.83 and two of the other 77 are demoted a place or two; at 0.7 the
   * rest are untouched. Association is meant to break ties among candidates
   * that already earned their place lexically, and the conservative value is
   * the one that keeps that true.
   */
  neighbourWeight: number;
}

export const DEFAULT_SIGNATURES: SignatureConfig = {
  minLinkedNotes: 3,
  topWords: 50,
  minLocalShare: 0.3,
  minGlobalNotes: 3,
  maxGlobalRatio: 0.25,
  minIdf: 2.5,
  peerPopulation: 150,
  crossConceptDamping: 0.25,
  burstiness: 0.5,
  neighbourWeight: 0.7,
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
  config: SignatureConfig = DEFAULT_SIGNATURES,
  /**
   * Total occurrences of each word across the corpus, against the per-note
   * presence in `notes`. Optional: without it every word looks as though it
   * occurs once per note, the burstiness factor is a constant, and signatures
   * come out exactly as they did before. Absence of the signal reads as no
   * information, which is the same rule the gate and the peer baseline follow.
   */
  collectionFreq?: Map<string, number>
): SignatureResult {
  const noteCount = notes.length;
  const byPath = new Map<string, Signature>();
  const inverted = new Map<string, string[]>();
  const thin: string[] = [];
  if (noteCount === 0) return { byPath, inverted, thin };

  const index = new Map<string, NoteWords>();
  for (const n of notes) index.set(n.path, n);

  // Word to the notes containing it, so a peer population can be found by
  // walking posting lists instead of rescanning the corpus per concept.
  //
  // Posting lists hold note INDICES rather than note objects, so the peer
  // search can accumulate overlaps into a typed array instead of a Map. The
  // probe words are by construction the highest-document-frequency words in the
  // corpus (the peer probe wants register, and register is common), so these are
  // the longest lists there are: on this vault the busiest covers 4,669 of 4,875
  // notes, and the search runs once per concept. Measured, that swap is 5.1x.
  const wordIndex = new Map<string, number[]>();
  notes.forEach((note, i) => {
    for (const word of note.words) {
      let list = wordIndex.get(word);
      if (!list) wordIndex.set(word, (list = []));
      list.push(i);
    }
  });
  // One buffer for every concept's peer search, cleared between uses. Allocating
  // per concept would hand the collector 1,500 arrays of vault length.
  const overlapScratch = new Int32Array(notes.length);

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

    // What counts as ordinary, for this concept. Judged against the notes that
    // read like its own training notes rather than against the whole vault, so
    // a word every transcript uses cannot look distinctive just because the
    // vault is mostly not transcripts.
    const peers = peerBaseline(
      wordIndex, notes, overlapScratch, local, n, df, noteCount, config
    );

    const scored: { word: string; weight: number }[] = [];
    for (const [word, count] of local) {
      if (count < floor) continue;
      const global = df.get(word) ?? 0;
      if (global < config.minGlobalNotes) continue;
      if (global / noteCount > config.maxGlobalRatio) continue;
      // Specific enough that knowing it is present tells you something. A word
      // in half the vault has lift wherever it is dense, and means nothing.
      if (Math.log(noteCount / global) < config.minIdf) continue;
      // A word the peers barely use is the strongest signal there is, so a
      // low peer count must never disqualify it. The vault-wide floor above
      // already guarantees the word is real; this only asks how ordinary it is
      // among documents of the same kind, and "not at all" is a real answer.
      //
      // Smoothed by half a note so a word absent from every peer gets a large
      // finite lift rather than an infinite one, which would let a single
      // unusual word outrank everything.
      const peerCount = peers.df.get(word) ?? 0;
      const peerRate = (peerCount + 0.5) / (peers.size + 1);
      if (peerRate > config.maxGlobalRatio) continue;
      const lift = Math.log(count / n / peerRate);
      if (lift <= 0) continue;
      // Weighted by how many notes back it up, so a word in 20 of 25 notes
      // outranks one in 2 of 3 that happens to be rarer. Lift alone is
      // maximised by the thinnest evidence.
      // How often the word repeats where it appears: the topicality signal the
      // set-membership counts above cannot see. Falls to 1 (no effect) when no
      // collection frequency was supplied or the word occurs once per note.
      let burst = 1;
      if (collectionFreq && config.burstiness > 0) {
        const occurrences = collectionFreq.get(word) ?? global;
        const repeatRate = global > 0 ? occurrences / global : 1;
        if (repeatRate > 1) burst = Math.pow(repeatRate, config.burstiness);
      }
      scored.push({ word, weight: lift * Math.log(1 + count) * burst });
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

  // Demote words that many unrelated concepts claim, now that every signature
  // exists and the spread is knowable. A second pass rather than part of the
  // scoring above, because "how many concepts think this word is theirs" is not
  // answerable until all of them have been built.
  //
  // Order within a signature can change; membership never does. The word earned
  // its place against the vault and its peers, and this only asks how much that
  // place is worth relative to the others in the same list.
  if (config.crossConceptDamping > 0) {
    const holders = new Map<string, number>();
    for (const sig of byPath.values()) {
      for (const word of sig.keys()) holders.set(word, (holders.get(word) ?? 0) + 1);
    }
    for (const sig of byPath.values()) {
      for (const [word, weight] of sig) {
        const n = holders.get(word) ?? 1;
        if (n > 1) sig.set(word, weight / Math.pow(n, config.crossConceptDamping));
      }
    }
  }

  return { byPath, inverted, thin };
}

/**
 * The population a concept's vocabulary is judged against.
 *
 * Notes that resemble its training notes, found from text alone: take the words
 * the training set has in common, then take the notes across the vault that
 * share the most of them. No folders, labels or configuration, which matters
 * because "what kind of document is this" is not something the vault records.
 *
 * Falls back to the whole corpus when the training set has no common
 * vocabulary to probe with, so a concept is never judged against nothing.
 */
function peerBaseline(
  wordIndex: Map<string, number[]>,
  notes: NoteWords[],
  overlap: Int32Array,
  local: Map<string, number>,
  trainingSize: number,
  df: Map<string, number>,
  noteCount: number,
  config: SignatureConfig
): { df: Map<string, number>; size: number } {
  // The probe has to describe the KIND of document, never its subject. The
  // first version took every word most training notes shared, which included
  // "nguyen", "game" and "playing" for a writer on games: the peer set became
  // "notes about Nguyen", his own vocabulary looked ordinary against it, and
  // the signature emptied.
  //
  // Register words are the common ones. A word specific enough to be a
  // signature candidate is specific enough to be excluded from the probe, so
  // the two sets are disjoint by construction and the baseline cannot eat the
  // signal it exists to measure.
  const probe: { word: string; df: number }[] = [];
  for (const [word, count] of local) {
    if (count < Math.max(2, trainingSize * 0.5)) continue;
    const global = df.get(word) ?? 0;
    if (global < 5) continue;
    // Anything specific enough to survive the IDF floor is subject matter, not
    // register, and must not shape the population.
    if (Math.log(noteCount / global) >= config.minIdf) continue;
    probe.push({ word, df: global });
  }
  // Commonest first: the strongest markers of "this kind of writing".
  probe.sort((a, b) => b.df - a.df);
  const words = probe.slice(0, PROBE_WORDS).map((p) => p.word);
  if (probe.length === 0) return { df, size: noteCount };

  // Count overlaps by walking the probe words' posting lists rather than every
  // note: a note with no probe word cannot be a peer, and most are not.
  //
  // Into a typed array rather than a Map. These posting lists are the longest in
  // the corpus and this runs once per concept, so the hashing dominated: same
  // peers, 5.1x faster, measured.
  overlap.fill(0);
  let touched = 0;
  for (const word of words) {
    const postings = wordIndex.get(word);
    if (!postings) continue;
    for (const i of postings) {
      if (overlap[i] === 0) touched++;
      overlap[i]++;
    }
  }
  if (touched === 0) return { df, size: noteCount };

  const candidates: number[] = [];
  for (let i = 0; i < overlap.length; i++) if (overlap[i] > 0) candidates.push(i);
  // Ties broken by note index, explicitly, because the cut is not clean: on this
  // vault twelve notes sit exactly on the 150th place, so WHICH of them are kept
  // decided part of the baseline. That used to fall out of Map insertion order,
  // which is first-seen across the probe words' posting lists, so it changed
  // whenever the probe order changed and could not be reasoned about. Note index
  // is just as arbitrary a rule and it is a stated one, so the same vault gives
  // the same peers twice.
  candidates.sort((a, b) => overlap[b] - overlap[a] || a - b);
  // Too few peers to describe a population: judge against the whole corpus
  // rather than against a handful of notes, which would make everything look
  // ordinary and empty the signature.
  const peers = candidates.slice(0, config.peerPopulation);
  if (peers.length < MIN_PEERS) return { df, size: noteCount };

  const peerDf = new Map<string, number>();
  for (const i of peers) {
    for (const word of notes[i].words) peerDf.set(word, (peerDf.get(word) ?? 0) + 1);
  }
  return { df: peerDf, size: peers.length };
}

/** How many shared words describe a kind of document. */
const PROBE_WORDS = 80;

/**
 * Below this the peer set is too small to say what is ordinary, so the whole
 * corpus is used instead. A concept is never judged against a handful of notes:
 * with few peers every word looks unremarkable and the signature empties.
 */
const MIN_PEERS = 50;

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
/**
 * Evidence from the concepts a note LINKS, for scoring the ones it does not.
 *
 * Tier 3 in 43.10.106's table: other taxa that travel with a concept. Supplied
 * separately from the note's words because it answers a different question, and
 * because it must never be the only answer.
 */
export interface NeighbourContext {
  /** Taxa files this note links, from Obsidian's own graph. */
  linked: Set<string>;
  /** Association between two taxa paths, 0 or less meaning none. */
  association: (a: string, b: string) => number;
  /**
   * The neighbour term's share of the note's own strongest lexical evidence.
   *
   * A share rather than an absolute number, because the two quantities live on
   * different scales: NPMI runs 0 to 0.6 and a lexical score is a sum of
   * signature weights running 70 to 170 on this vault. An absolute bonus
   * measured as no effect at all, which read as a null result and was a unit
   * error.
   */
  weight: number;
}

export function scoreNote(
  words: Set<string>,
  signatures: SignatureResult,
  minWords = 3,
  /**
   * What the note links, used to promote concepts near those.
   *
   * A note that links "@Ocean Vuong" is about that neighbourhood, so concepts
   * beside Vuong deserve to rank even where the note's own words are thin. That
   * is exactly the case lexical scoring fails: measured on the reference vault,
   * folds with neighbour evidence score 0.37 MRR on words alone against 0.65
   * for the rest, and this takes them to 0.71.
   *
   * Deliberately subordinate, and that is the whole design. Tier 3 can only see
   * concepts the user has ALREADY FILED as files, so it can never be what finds
   * the unfiled, which is the plugin's reason to exist. 43.10.106 diagnosed the
   * gate's failure as tier-3 data doing tier-2 work: it was asked to SUBSTITUTE
   * for evidence that did not exist, in a decision that HID things. Here tier 2
   * exists and leads, tier 3 only reorders, and nothing is hidden on it.
   *
   * A concept the note already links is skipped: its signature was trained
   * partly on this note, so it is guaranteed to fire and means nothing.
   */
  neighbours?: NeighbourContext
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

  // Promote what sits near the concepts this note links. After the lexical sort
  // and the minWords floor, so a concept still has to earn its place on words
  // before association can move it: association reorders candidates, it never
  // admits one.
  if (neighbours && neighbours.weight > 0 && neighbours.linked.size > 0 && hits.length > 0) {
    const top = hits[0].score;
    for (const hit of hits) {
      if (neighbours.linked.has(hit.path)) continue;
      let association = 0;
      for (const linked of neighbours.linked) {
        const strength = neighbours.association(hit.path, linked);
        if (strength > 0) association += strength;
      }
      if (association > 0) hit.score += neighbours.weight * top * association;
    }
    hits.sort((a, b) => b.score - a.score);
  }
  return hits;
}
