import { CorpusStats, npmi } from "./stats";
import { SignatureResult } from "./signatures";

/**
 * Does anything except the word match think this row belongs?
 *
 * The plugin computes three independent opinions about a note and lets one
 * decide. The matcher finds the string; signatures know what vocabulary the
 * concept keeps company with; the co-occurrence graph knows what it usually
 * appears beside. A row surfaced by the first with no support from either of
 * the others is the shape of a coincidence, and it is what made "+subwoofer"
 * appear on a daily note through the alias "sub".
 *
 * Measured on the reference vault, using the user's own links as ground truth
 * (a mention they linked is one they endorsed) and holding each note out of
 * training so the signature cannot recognise words it learned from that very
 * note: a signature fires on 69.9% of endorsed mentions against 28.8% of
 * unendorsed ones. Real signal, 2.4x, previously unused.
 *
 * Deliberately a WITHHOLDING rule and not a scoring one. Everything it stops
 * goes to Hidden connections carrying this reason, which is a list the user can
 * open, argue with and act on. That is the difference 43.10.106 draws between
 * hiding and notifying, and it is why this can ship while B3 stays blocked:
 * nothing disappears, and the evidence for every call is on the row.
 */

export type Corroboration =
  /** The concept's learned vocabulary fires in this note. */
  | "signature"
  /** It usually appears beside something this note is about. */
  | "association"
  /** The user already linked it here, so the question is settled. */
  | "linked"
  /** Nothing but the word itself. */
  | "none";

export interface CorroborationResult {
  kind: Corroboration;
  /** Signature words that fired, or the taxa it associates with. */
  evidence: string[];
}

export interface CorroborateInput {
  /** The taxa file the row is about. */
  path: string;
  /** Concepts this note links, which are settled evidence. */
  linked: Set<string>;
  /** Concepts whose signatures fire here, to their matched words. */
  signatureHits: Map<string, string[]>;
  /** What the note establishes: its links plus its specific mentions. */
  present: Set<string>;
  stats: CorpusStats;
  /** Association at or above this counts as support. */
  floor: number;
}

/**
 * What supports this row beyond the word that surfaced it.
 *
 * Ordered by strength, and the order matters: a link is the user's own
 * assertion and ends the question, a signature is evidence about this note's
 * subject, and association is the weakest because it reasons from what the
 * concept usually accompanies rather than from anything in the text.
 */
export function corroborate(input: CorroborateInput): CorroborationResult {
  const { path, linked, signatureHits, present, stats, floor } = input;

  if (linked.has(path)) return { kind: "linked", evidence: [] };

  const words = signatureHits.get(path);
  if (words && words.length > 0) return { kind: "signature", evidence: words.slice(0, 4) };

  // Association to what the note has ESTABLISHED, not to everything it
  // mentions. Every ambiguous word in the note is also a mention, so scoring
  // against all of them lets a clique of common words vouch for each other,
  // which is the failure the gate's own context set was rewritten to avoid.
  const supporters: { path: string; score: number }[] = [];
  for (const other of present) {
    if (other === path) continue;
    const score = npmi(path, other, stats);
    if (score !== null && score >= floor) supporters.push({ path: other, score });
  }
  if (supporters.length > 0) {
    supporters.sort((a, b) => b.score - a.score);
    return { kind: "association", evidence: supporters.slice(0, 3).map((s) => s.path) };
  }

  return { kind: "none", evidence: [] };
}

/**
 * Concepts whose signatures fire in a note, as a lookup from path to the words
 * that fired. Built once per render rather than per row.
 */
export function signatureWordsByPath(
  hits: { path: string; matched: string[] }[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const h of hits) out.set(h.path, h.matched);
  return out;
}

/**
 * Whether a row with no corroboration is worth withholding.
 *
 * A rare, specific term needs no second opinion: if a note says "convolution
 * reverb" it means convolution reverb, and asking a signature to confirm it
 * would hide real mentions for concepts too thinly linked to have one. So this
 * only applies where the word alone is weak evidence, which is the same
 * population the gate was built for.
 *
 * The signature has to exist, too. Two thirds of taxa files have too few links
 * to produce one, and "no signature fired" means nothing when there was no
 * signature to fire.
 */
export function shouldWithhold(
  result: CorroborationResult,
  opts: { ambiguous: boolean; hasSignature: boolean }
): boolean {
  if (result.kind !== "none") return false;
  return opts.ambiguous && opts.hasSignature;
}
