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
}

/** Key for an unordered pair. Sorted so {a,b} and {b,a} land on one entry. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

export function computeStats(mentionSets: Set<string>[]): CorpusStats {
  const df = new Map<string, number>();
  const cooc = new Map<string, number>();
  let noteCount = 0;

  for (const set of mentionSets) {
    if (set.size === 0) continue;
    noteCount++;
    for (const path of set) df.set(path, (df.get(path) ?? 0) + 1);

    if (set.size > MAX_PAIRS_PER_NOTE) continue;
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j]);
        cooc.set(key, (cooc.get(key) ?? 0) + 1);
      }
    }
  }

  return { noteCount, df, cooc };
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

export interface Neighbor {
  path: string;
  score: number;
  /** Notes containing both. Kept so a readout can show the evidence. */
  cooccurrences: number;
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
    out.push({ path: other, score, cooccurrences: count });
  }

  out.sort((x, y) => y.score - x.score);
  return out.slice(0, k);
}
