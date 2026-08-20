/**
 * The rank read: given a taxa file, which documents matter most for it.
 *
 * The other direction of the same primitive the gate thresholds. Gating asks
 * "is this mention relevant enough to surface here" and cuts a list down;
 * this asks "which documents are most about this concept" and orders a list up.
 * Both read the shared index, per the foundation doc.
 *
 * Ranking is the safer direction, which is why it is built before signature
 * evidence reaches the gate. A wrong rank puts a document at position eight,
 * where the reader sees it and moves on. A wrong threshold makes a document
 * invisible, and nobody can see what they were not shown.
 */

import { SignatureResult, Signature } from "./signatures";

export interface RelatedDoc {
  /** Vault path of the document. */
  path: string;
  score: number;
  /** The user linked the concept here, rather than merely mentioning it. */
  linked: boolean;
  /** Times the concept's terms appear in this note. 0 when only linked. */
  mentions: number;
  /** Signature words present, strongest first, for the "why" readout. */
  matched: string[];
}

export interface RelatedConfig {
  /**
   * Weight on an explicit link.
   *
   * A link is the user asserting this document is about the concept, which is
   * the strongest evidence the vault holds and the reason clustering reads
   * links rather than co-mentions. Ranked above any amount of vocabulary
   * overlap, because inference should never outrank a statement.
   */
  linkWeight: number;
  /** Weight on the concept's terms appearing in the note at all. */
  mentionWeight: number;
  /**
   * Weight on the signature score, which is the only term that can rank a
   * document that never names the concept.
   */
  signatureWeight: number;
  /** Signature words a note needs before its signature score counts at all. */
  minSignatureWords: number;
  /** How many documents to return. */
  limit: number;
}

export const DEFAULT_RELATED: RelatedConfig = {
  linkWeight: 10,
  mentionWeight: 1,
  signatureWeight: 3,
  minSignatureWords: 3,
  limit: 25,
};

/**
 * Rank the documents most related to a taxa file.
 *
 * Three signals, combined linearly so the reason stays separable and a row can
 * say why it is there. The foundation doc settled this shape: an absent signal
 * contributes zero rather than a penalty, so a concept with no signature still
 * ranks its linked and mentioning documents correctly.
 *
 * Ranked in two bands rather than one list, which is what the measurement
 * forced. A document the user linked outranks any amount of vocabulary overlap,
 * and it also scores well on vocabulary, since the signature was learned partly
 * from it. In a single list the linked documents therefore take every slot at
 * any weighting: at signatureWeight 30 exactly one unlinked document reached
 * the top eight for `+phase`, and raising the weight further only lifted the
 * linked ones with it.
 *
 * So known and inferred are ranked separately and concatenated. The reader sees
 * what they already connected first, then what the vault suggests they might
 * not have noticed, which is the only part they could not have found by
 * themselves.
 */
export function rankRelatedDocs(
  taxaPath: string,
  mentionSets: Map<string, Set<string>>,
  linkSets: Map<string, Set<string>>,
  signatures: SignatureResult,
  /** Note path to its vocabulary. Only notes that can train a signature have one. */
  noteWords: Map<string, Set<string>>,
  config: RelatedConfig = DEFAULT_RELATED
): RelatedDoc[] {
  const signature = signatures.byPath.get(taxaPath);
  const rows = new Map<string, RelatedDoc>();

  const row = (path: string): RelatedDoc => {
    let r = rows.get(path);
    if (!r) rows.set(path, (r = { path, score: 0, linked: false, mentions: 0, matched: [] }));
    return r;
  };

  // Links first: the user's own assertion, and the only signal that cannot be
  // wrong about what a document is about.
  for (const [notePath, targets] of linkSets) {
    if (notePath === taxaPath) continue;
    if (!targets.has(taxaPath)) continue;
    const r = row(notePath);
    r.linked = true;
    r.score += config.linkWeight;
  }

  for (const [notePath, mentioned] of mentionSets) {
    if (notePath === taxaPath) continue;
    if (!mentioned.has(taxaPath)) continue;
    const r = row(notePath);
    r.mentions = 1;
    r.score += config.mentionWeight;
  }

  // Signature overlap, which is what lets a document rank without ever naming
  // the concept. Scored against the note's own vocabulary, so it applies to
  // documents that neither link nor mention it.
  if (signature) {
    for (const [notePath, words] of noteWords) {
      if (notePath === taxaPath) continue;
      let sum = 0;
      const hit: { word: string; weight: number }[] = [];
      for (const [word, weight] of signature) {
        if (!words.has(word)) continue;
        sum += weight;
        hit.push({ word, weight });
      }
      if (hit.length < config.minSignatureWords) continue;
      hit.sort((a, b) => b.weight - a.weight);
      const r = row(notePath);
      // Normalized by the signature's own total so a concept with a large
      // signature does not outrank one with a small sharp signature.
      r.score += config.signatureWeight * (sum / signatureMass(signature));
      r.matched = hit.slice(0, 8).map((h) => h.word);
    }
  }

  const known: RelatedDoc[] = [];
  const inferred: RelatedDoc[] = [];
  for (const r of rows.values()) (r.linked || r.mentions ? known : inferred).push(r);
  known.sort((a, b) => b.score - a.score);
  inferred.sort((a, b) => b.score - a.score);

  // Both bands get room. Reserving a share for inferred results is the point of
  // the feature: a list of documents the user already linked tells them nothing
  // they did not know.
  const inferredSlots = Math.min(inferred.length, Math.max(1, Math.floor(config.limit / 3)));
  return [
    ...known.slice(0, config.limit - inferredSlots),
    ...inferred.slice(0, inferredSlots),
  ];
}

/** Total weight in a signature, for normalizing an overlap against it. */
function signatureMass(signature: Signature): number {
  let total = 0;
  for (const weight of signature.values()) total += weight;
  return total || 1;
}
