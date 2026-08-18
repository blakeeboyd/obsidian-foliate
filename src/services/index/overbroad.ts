import { CorpusStats } from "./stats";

/**
 * Aliases that claim an ordinary word for a specific concept.
 *
 * The problem the gate cannot solve. "+care" carries the alias "care" beside
 * "Sorge" and "care-structure"; "+equipment" carries "equipment" beside "Zeug".
 * The distinctive aliases are precise and would never misfire, while the bare
 * word asserts that every use of it in the vault means this file. No amount of
 * context scoring undoes that, because the claim is in the data rather than in
 * the reading of it.
 *
 * Twenty files in the reference vault have exactly this shape, and they are the
 * source of nearly all the noise: care, place, sense, mood, equipment, phase,
 * feedback, delay, threshold, channel, current, cut, loop, gain, bleed.
 *
 * Detected from the vault's own usage rather than a word list, so it works for
 * any language and any vocabulary: a term is over-broad when it appears
 * constantly, is almost never linked, and the file has other terms that carry
 * the meaning properly.
 */

export interface OverbroadAlias {
  /** Vault path of the taxa file. */
  path: string;
  /** The alias doing the damage. */
  alias: string;
  /** Notes where it appears unlinked. */
  unlinked: number;
  /** Notes where the file is linked. */
  linked: number;
  /** Share of appearances that are links. */
  curation: number;
  /** The file's other terms, which keep working if this one is removed. */
  alternatives: string[];
}

export interface OverbroadOptions {
  /** Minimum share of notes the term appears in to be worth reporting. */
  minRatio?: number;
  /** Curation at or above this means the user does link it deliberately. */
  curationFloor?: number;
  /** A file needs at least this many other terms before one can be dropped. */
  minAlternatives?: number;
}

/**
 * Find single-word aliases that behave like ordinary vocabulary.
 *
 * Three conditions together, and each rules out a different innocent case:
 * appearing everywhere (a rare word is nobody's problem), almost never linked
 * (a term the user links deliberately is doing its job, however common), and
 * having other terms (removing the only way to reach a file helps nobody).
 */
export function findOverbroadAliases(
  files: { path: string; terms: string[] }[],
  stats: CorpusStats,
  options: OverbroadOptions = {}
): OverbroadAlias[] {
  const { minRatio = 0.03, curationFloor = 0.02, minAlternatives = 1 } = options;
  const out: OverbroadAlias[] = [];

  for (const file of files) {
    const unlinked = stats.df.get(file.path) ?? 0;
    if (unlinked === 0) continue;
    const ratio = unlinked / (stats.noteCount || 1);
    if (ratio < minRatio) continue;

    const linked = stats.linkDf.get(file.path) ?? 0;
    const total = linked + unlinked;
    const curation = total > 0 ? linked / total : 0;
    if (curation >= curationFloor) continue;

    // Which of the file's terms is the one misfiring?
    //
    // Not simply "the single-word ones": "Sorge" is a single word and is
    // exactly the alias worth keeping, because nobody writes it by accident.
    // The test caught this by asserting that Sorge survives, and the first
    // version would have offered to delete it.
    //
    // The distinguishing feature is that the term is the file's OWN NAME as an
    // ordinary word, or a lowercase word matching it. A term the file is named
    // after, written plainly, is what every note collides with; a foreign or
    // technical synonym is not. So the candidate is a single word that is a
    // case-insensitive match for part of the file's name.
    const stem = file.path
      .slice(file.path.lastIndexOf("/") + 1)
      .replace(/\.md$/, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .toLowerCase();
    const bare = file.terms.filter((t) => {
      const term = t.trim();
      if (!/^[\p{L}]+$/u.test(term)) return false;
      const lower = term.toLowerCase();
      // The plain word the file is named for, e.g. "care" in "+care", or
      // "phase" in "+phase". A synonym like "Sorge" is not part of the name.
      return stem === lower || stem.startsWith(lower + " ") || stem.includes(" " + lower);
    });
    if (bare.length === 0) continue;

    const alternatives = file.terms.filter((t) => !bare.includes(t));
    if (alternatives.length < minAlternatives) continue;

    for (const alias of bare) {
      out.push({ path: file.path, alias, unlinked, linked, curation, alternatives });
    }
  }

  return out.sort((a, b) => b.unlinked - a.unlinked);
}
