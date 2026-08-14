import { CorpusStats, idf, npmi } from "./stats";
import { ClusterResult } from "./clusters";

/**
 * The threshold read of the shared index: given a note, which mentions are
 * relevant enough to surface here.
 *
 * "Delay" is the case. It is the correct name of an audio concept, not an
 * over-broad alias to blocklist, but the word appears in scheduling notes and
 * travel notes where it means nothing of the kind. Deciding by the company a
 * term keeps is what separates the two, and the vault already records that
 * company in how concepts co-occur.
 *
 * Four branches, and two of them surface freely for opposite reasons: a
 * specific term needs no gate, and a term with too little evidence must not be
 * gated on a guess. Only the middle two actually withhold anything.
 */

export type GateReason =
  /** Specific enough that context cannot change what it means. */
  | "unambiguous"
  /** Not enough evidence yet to judge; the ramp has not started. */
  | "cold"
  /** Its cluster is settled and this note is about that cluster. */
  | "cluster-match"
  /** Its cluster is settled and this note is not about it. */
  | "cluster-miss"
  /** No settled cluster, but a strong neighbour appears here. */
  | "neighbour-match"
  /** No settled cluster and no neighbour here. */
  | "neighbour-miss";

export interface GateVerdict {
  surface: boolean;
  reason: GateReason;
  /** The taxa that decided it, for the "why is this hidden" readout. */
  evidence: string[];
}

export interface GateConfig {
  /**
   * Terms in more than this share of notes are ambiguous enough to gate.
   *
   * Relative, never absolute: "appears in more than 5% of notes" means the same
   * thing in a 200-note vault and a 20,000-note one, where "appears in 600
   * notes" does not. On the reference vault this leaves roughly 60 of 4,000
   * mentioned taxa subject to gating at all.
   */
  ambiguousRatio: number;
  /** Minimum NPMI for a neighbour to count as evidence in the warming branch. */
  neighbourFloor: number;
  /** Notes a term must appear in before it is judged at all. */
  minEvidence: number;
}

export const DEFAULT_GATE: GateConfig = {
  ambiguousRatio: 0.05,
  neighbourFloor: 0.3,
  minEvidence: 5,
};

/**
 * Should `candidate` surface in a note that already mentions `present`?
 *
 * `present` is the note's other taxa: what the note has established it is
 * about. The candidate is judged against that, never against the note's raw
 * text, so the decision reads the same structure everything else does.
 */
export function gateDecision(
  candidate: string,
  present: Set<string>,
  stats: CorpusStats,
  clusters: ClusterResult,
  config: GateConfig = DEFAULT_GATE
): GateVerdict {
  // A term nobody has written enough to judge. Surfacing it costs a little
  // clutter; hiding it on this much data would be acting on noise, and a
  // wrongly hidden mention is invisible in a way a wrongly shown one is not.
  const df = stats.df.get(candidate) ?? 0;
  if (df < config.minEvidence) {
    return { surface: true, reason: "cold", evidence: [] };
  }

  // Specific terms are the overwhelming majority and never need gating: if a
  // note says "convolution reverb" it means convolution reverb. This is the
  // single biggest saving in the pipeline, and it comes first so the expensive
  // branches run on a handful of terms.
  const ratio = df / (stats.noteCount || 1);
  if (ratio < config.ambiguousRatio) {
    return { surface: true, reason: "unambiguous", evidence: [] };
  }

  // Confident: the term sits in a settled cluster, so ask whether this note is
  // about that cluster.
  const clusterId = clusters.membership.get(candidate);
  if (clusterId !== undefined && clusters.settled.has(clusterId)) {
    const matches: string[] = [];
    for (const other of present) {
      if (other === candidate) continue;
      if (clusters.membership.get(other) === clusterId) matches.push(other);
    }
    if (matches.length > 0) {
      return { surface: true, reason: "cluster-match", evidence: matches };
    }
    // A cluster miss is not the end of the question. Clustering assigns each
    // term to exactly one group, and a term that genuinely belongs to two gets
    // put in whichever it co-occurs with marginally more; in the other it then
    // looks like an intruder. Measured on a fixture where a term appeared
    // equally in both groups, it landed in one and was hidden in the other
    // despite an NPMI of 0.8 with the terms actually present.
    //
    // So the neighbour check below runs as a second opinion rather than as a
    // fallback for unclustered terms only. A strong direct association
    // overrides a cluster boundary, which is the right precedence: the cluster
    // is a summary of associations, and the association is the evidence.
  }

  // Warming, and the second opinion above. The term's strongest co-occurrents
  // in this note, if any.
  const neighbours: string[] = [];
  for (const other of present) {
    if (other === candidate) continue;
    const score = npmi(candidate, other, stats);
    if (score !== null && score >= config.neighbourFloor) neighbours.push(other);
  }
  if (neighbours.length > 0) {
    return { surface: true, reason: "neighbour-match", evidence: neighbours };
  }
  // Nothing related is here, by either reading.
  return clusterId !== undefined && clusters.settled.has(clusterId)
    ? { surface: false, reason: "cluster-miss", evidence: [] }
    : { surface: false, reason: "neighbour-miss", evidence: [] };
}

/** A sentence naming why a mention was withheld, for the sidebar row. */
export function explainVerdict(verdict: GateVerdict, name: (path: string) => string): string {
  switch (verdict.reason) {
    case "unambiguous":
      return "Specific enough to surface anywhere.";
    case "cold":
      return "Not enough of this term in the vault yet to judge it.";
    case "cluster-match":
      return `This note also mentions ${verdict.evidence.slice(0, 3).map(name).join(", ")}, which sits in the same group.`;
    case "cluster-miss":
      return "This note mentions nothing else from its group.";
    case "neighbour-match":
      return `This note also mentions ${verdict.evidence.slice(0, 3).map(name).join(", ")}, which it usually appears with.`;
    case "neighbour-miss":
      return "None of the terms this usually appears with are in this note.";
  }
}

/** How ambiguous a term is, exposed so the settings UI can show the count. */
export function ambiguousCount(stats: CorpusStats, config: GateConfig = DEFAULT_GATE): number {
  let n = 0;
  for (const [, df] of stats.df) {
    if (df >= config.minEvidence && df / (stats.noteCount || 1) >= config.ambiguousRatio) n++;
  }
  return n;
}
