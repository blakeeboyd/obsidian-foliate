/**
 * Derived views over the mention sets: document frequency, co-occurrence, NPMI.
 *
 * Phase 3 of the gating plan. NPMI is the v1 term of the foundation's linear
 * relevance score, not the whole of it: the neighbor lists below are defined
 * against "the score", so adding shared-tag or frontmatter signals later
 * changes what feeds this file, not what reads it.
 *
 * No Obsidian imports; this is arithmetic over sets.
 */

/**
 * A note whose mention set is larger than this is excluded from PAIR counting
 * (its document-frequency contribution still counts). An index or MOC that
 * mentions 400 taxa would contribute 80,000 pairs on its own and assert that
 * everything co-occurs with everything, which is the opposite of the signal.
 * The note is evidence that the terms exist, not that they are related.
 */
const MAX_PAIRS_PER_NOTE = 60;

/** Pairs seen in fewer notes than this never score. */
const MIN_PAIR_EVIDENCE = 3;

export interface CorpusStats {
  /** Notes that contained at least one mention. The N of the IDF/NPMI math. */
  noteCount: number;
  /** Taxa path to how many notes mention it. */
  df: Map<string, number>;
  /** "pathA pathB" (sorted) to how many notes mention both. */
  cooc: Map<string, number>;
  /** Taxa path to how many notes LINK it. */
  linkDf: Map<string, number>;
  /**
   * "pathA pathB" to how many notes link BOTH.
   *
   * The strongest relatedness evidence the vault contains. Two terms sharing a
   * page is circumstantial; the user linking both on that page is a deliberate
   * act performed twice, saying "this note is about both of these". Kept as its
   * own count rather than folded into cooc so the two can be weighted apart.
   */
  coLink: Map<string, number>;
}

/** Key for an unordered pair. Sorted so {a,b} and {b,a} land on one entry. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

export function computeStats(
  mentionSets: Set<string>[],
  linkSets: Set<string>[] = []
): CorpusStats {
  const df = new Map<string, number>();
  const cooc = new Map<string, number>();
  const linkDf = new Map<string, number>();
  const coLink = new Map<string, number>();
  let noteCount = 0;

  const tally = (
    sets: Set<string>[],
    single: Map<string, number>,
    pairs: Map<string, number>,
    countNotes: boolean
  ) => {
    for (const set of sets) {
      if (set.size === 0) continue;
      if (countNotes) noteCount++;
      for (const path of set) single.set(path, (single.get(path) ?? 0) + 1);

      if (set.size > MAX_PAIRS_PER_NOTE) continue;
      const arr = [...set];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = pairKey(arr[i], arr[j]);
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
      }
    }
  };

  tally(mentionSets, df, cooc, true);
  tally(linkSets, linkDf, coLink, false);

  return { noteCount, df, cooc, linkDf, coLink };
}

/**
 * How much a link outweighs a bare mention as evidence of a relationship.
 *
 * A mention is an accident of vocabulary: two words landed on one page. A link
 * is a deliberate act, and two links on one page is the user stating that the
 * page is about both. Five is a starting weight, not a derived constant; it is
 * exposed here so it can be tuned against real results rather than buried in an
 * expression.
 */
export const LINK_WEIGHT = 5;

/**
 * The most a co-link can add to a neighbour's NPMI score.
 *
 * NPMI spans [-1, 1], so 0.5 lets deliberate evidence outrank a moderately
 * better co-occurrence score without letting it overwhelm a genuinely strong
 * one.
 */
export const LINK_BONUS = 0.5;

/** Co-links at which the bonus reaches ~63% of its maximum. */
export const LINK_HALF_LIFE = 3;

/**
 * Notes relating two taxa, counting a co-link as LINK_WEIGHT notes.
 *
 * Used wherever "how strongly are these two related" is asked, so the answer
 * follows what the user actually connected rather than what merely co-occurred.
 */
export function weightedTogether(a: string, b: string, stats: CorpusStats): number {
  const key = pairKey(a, b);
  const mentions = stats.cooc.get(key) ?? 0;
  const links = stats.coLink.get(key) ?? 0;
  return mentions + links * LINK_WEIGHT;
}

/**
 * Inverse document frequency. High means rare, and a rare term is unambiguous:
 * it never needs gating. The gate's expensive path runs only on low-IDF terms,
 * which on the measured vault is 21 of 4,522 mentioned taxa.
 */
export function idf(path: string, stats: CorpusStats): number {
  const d = stats.df.get(path);
  if (!d) return Infinity;
  return Math.log10(stats.noteCount / d);
}

/** Share of notes mentioning this term. The relative form of df. */
export function documentRatio(path: string, stats: CorpusStats): number {
  return (stats.df.get(path) ?? 0) / (stats.noteCount || 1);
}

/**
 * Normalized pointwise mutual information, in [-1, 1]: -1 never co-occur,
 * 0 independent, +1 always co-occur.
 *
 * Normalized rather than raw PMI for the fixed range, which is what lets one
 * threshold mean the same thing for a common term and a rare one. Returns null
 * when the pair is below the evidence floor: NPMI is biased high for rare
 * pairs, so two co-occurrences score near +1.0, maximum confidence from
 * minimum data. Insufficient evidence must read as "no signal", never as a
 * weak guess.
 */
export function npmi(a: string, b: string, stats: CorpusStats): number | null {
  const c = stats.cooc.get(pairKey(a, b)) ?? 0;
  if (c < MIN_PAIR_EVIDENCE) return null;

  const dfA = stats.df.get(a) ?? 0;
  const dfB = stats.df.get(b) ?? 0;
  if (dfA === 0 || dfB === 0) return null;

  const n = stats.noteCount;
  const pXY = c / n;
  const pX = dfA / n;
  const pY = dfB / n;
  // pXY === 1 (the pair is in every note) makes the denominator zero. Perfect
  // co-occurrence across the whole corpus is maximum association, so say so
  // rather than dividing by zero.
  const denom = -Math.log2(pXY);
  if (denom === 0) return 1;
  return Math.log2(pXY / (pX * pY)) / denom;
}

/**
 * How often a term that COULD have been linked actually was.
 *
 * The strongest available signal for "does this word mean the file it names",
 * and the one mention counts cannot give. Measured on this vault: `+phase` is
 * mentioned 1,596 times and linked 53 (3.3%); `+frequency (audio)` 1,375 and 73
 * (5.3%); `+Time` 3,211 times and linked once; `©Something` 1,810 times and
 * linked 6. Same order of frequency, opposite meaning. The first two are
 * concepts the user deliberately links; the last two are common words that
 * happen to own a file.
 *
 * This is the plan's "curation ratio", and it reads years of the user's own
 * linking as evidence rather than asking them to configure anything.
 *
 * Returns 0 when a term is never linked and 1 when every mention is a link.
 */
export function curationRatio(path: string, stats: CorpusStats): number {
  const linked = stats.linkDf.get(path) ?? 0;
  const unlinked = stats.df.get(path) ?? 0;
  const opportunities = linked + unlinked;
  if (opportunities === 0) return 0;
  // Notes where the term appears and IS linked, over notes where it appears at
  // all. Mentions are unlinked-only since the scan strips link syntax, so the
  // two are disjoint and their sum is every chance the user had to link it.
  return linked / opportunities;
}

/** Two taxa files whose usage across the vault is nearly interchangeable. */
export interface UsageOverlap {
  a: string;
  b: string;
  /** Share of their combined presence that is shared, in [0, 1]. */
  jaccard: number;
  /** Notes mentioning both. */
  together: number;
  /** Notes mentioning each. */
  dfA: number;
  dfB: number;
  /**
   * Terms both files answer to, if any.
   *
   * The difference between "one concept written twice" and "two ideas that
   * travel together", and it does not come from the co-occurrence data at all.
   * Two files claiming the same word are competing for it: every note saying
   * "noise" matches both, which is WHY they co-occur everywhere. The overlap is
   * a symptom of the collision, not evidence of sameness.
   *
   * Two files with no shared term that still co-occur are a different thing
   * entirely: two names for two ideas the user discusses together. Hospitality
   * in array and in chain, co-authors, philosophers in one tradition. Merging
   * those would be wrong.
   */
  sharedTerms: string[];
}

/**
 * Pairs of taxa that are mentioned in nearly the same notes.
 *
 * Jaccard, not NPMI, and the difference decides what this finds. NPMI answers
 * "do these co-occur more than chance would predict", which is high for things
 * that are genuinely related: two philosophers discussed in the same essays
 * score near 0.9 and are not duplicates. Jaccard asks what share of their
 * combined presence is shared, so it is high only when one is nearly always
 * accompanied by the other, which is what a concept written two ways looks
 * like.
 *
 * This finds duplicates the name check cannot see, because it never looks at
 * names: a middle initial, a leading article, reversed word order, a
 * translation ("+Objet Sonore" and "+sound object" share no characters).
 *
 * It is a suggestion, never a verdict. Genuinely inseparable pairs
 * (an organization and its founder, a philosopher and their central concept)
 * score high and are not duplicates, so a human decides.
 */
export function findUsageOverlaps(
  stats: CorpusStats,
  options: {
    minJaccard?: number;
    minDf?: number;
    minTogether?: number;
    /**
     * Given a taxa path, its taxon prefix. Pairs from different taxa are
     * dropped, because a duplicate is a thing written twice and a thing has one
     * type. Across the pairs this vault produced, EVERY cross-taxon hit was a
     * false positive: an organization and its founder, a philosopher and their
     * central concept. Related, and obviously not the same file.
     */
    prefixOf?: (path: string) => string;
    /** Every term a taxa file answers to: its name and aliases, lowercased. */
    termsOf?: (path: string) => string[];
  } = {}
): UsageOverlap[] {
  const { minJaccard = 0.4, minDf = 8, minTogether = 4, prefixOf, termsOf } = options;
  const out: UsageOverlap[] = [];

  for (const [key, together] of stats.cooc) {
    const sep = key.indexOf("\n");
    if (sep < 0) continue;
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    const dfA = stats.df.get(a) ?? 0;
    const dfB = stats.df.get(b) ?? 0;

    // A shared term needs no statistical support: it is observed, not inferred.
    // The evidence bars below exist to stop a thin co-occurrence pattern from
    // looking certain, which is a different problem.
    const shared = termsOf
      ? (() => {
          const tb = new Set(termsOf(b));
          return termsOf(a).filter((t) => tb.has(t));
        })()
      : [];

    if (shared.length === 0) {
      if (together < minTogether) continue;
      // Both must be established. Two notes that each mention a pair once give
      // a perfect-looking Jaccard from no evidence at all.
      if (dfA < minDf || dfB < minDf) continue;
    }

    if (prefixOf) {
      const pa = prefixOf(a);
      const pb = prefixOf(b);
      if (!pa || !pb || pa !== pb) continue;
    }

    const union = dfA + dfB - together;
    if (union <= 0) continue;
    const jaccard = together / union;
    // A shared term is direct evidence and stands on its own: two files
    // answering to one word is a fact about the vault, not an inference from
    // how often they happen to appear together. Requiring the overlap bar too
    // would hide exactly the pairs the sidebar marks but the modal cannot show.
    if (jaccard < minJaccard && shared.length === 0) continue;

    out.push({ a, b, jaccard, together, dfA, dfB, sharedTerms: shared });
  }

  // A shared term first, then overlap. A name collision is the stronger claim
  // and deserves the top of the list.
  return out.sort(
    (x, y) =>
      Number(y.sharedTerms.length > 0) - Number(x.sharedTerms.length > 0) ||
      y.jaccard - x.jaccard
  );
}

export interface Neighbor {
  path: string;
  score: number;
  /** Notes mentioning both. Kept so a readout can show the evidence. */
  cooccurrences: number;
  /** Notes LINKING both: the deliberate version of the same relationship. */
  linkedTogether: number;
}

/**
 * The top-k taxa most associated with `path`, best first.
 *
 * Walks only the pairs this term participates in. That is a full pass over the
 * pair map today, which at ~318k pairs is milliseconds; if it ever matters,
 * the fix is an adjacency index, not a cleverer scan.
 */
export function topNeighbors(path: string, stats: CorpusStats, k = 20): Neighbor[] {
  const out: Neighbor[] = [];

  for (const [key, count] of stats.cooc) {
    const sep = key.indexOf("\n");
    if (sep < 0) continue;
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    let other: string;
    if (a === path) other = b;
    else if (b === path) other = a;
    else continue;

    const score = npmi(path, other, stats);
    if (score === null) continue;
    const linkedTogether = stats.coLink.get(key) ?? 0;
    out.push({ path: other, score, cooccurrences: count, linkedTogether });
  }

  // Rank by NPMI plus a bonus for the pairs the user linked together.
  //
  // Additive, not multiplicative, and that is not a style choice. NPMI is in
  // [-1, 1] and is routinely negative for a pair that co-occurs less than
  // chance predicts. Scaling a negative score by a link bonus drives it further
  // down, so the deliberate evidence made the pair rank WORSE: a pair linked 8
  // times lost to one merely co-mentioned 12 times. A bonus has to be added to
  // the score, never multiplied through it.
  //
  // The bonus saturates: the difference between 0 and 1 co-links is the whole
  // point, the difference between 20 and 40 is noise, and without damping a
  // heavily cross-linked hub would top every list it appears in.
  const weight = (n: Neighbor) =>
    n.score + LINK_BONUS * (1 - Math.exp(-n.linkedTogether / LINK_HALF_LIFE));
  out.sort((x, y) => weight(y) - weight(x) || y.score - x.score);
  return out.slice(0, k);
}
