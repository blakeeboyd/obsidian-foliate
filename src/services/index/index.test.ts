/**
 * Check the scan and the statistics that gate everything downstream.
 *
 * The scan is the piece that replaced a 260-second per-taxa-file loop with a
 * 3.5-second inverted one, so "same answers" is the property under test, not
 * speed. The statistics are worth pinning because NPMI's failure mode is
 * silent: it returns a confident-looking number from two observations, which
 * is why the evidence floor exists and why it is asserted here.
 *
 * Run: npx tsx src/services/index/index.test.ts
 */
import * as assert from "assert";
import { buildDictionary, scanNote, tokenize } from "./scan";
import { computeStats, npmi, idf, topNeighbors, pairKey } from "./stats";

const DICT = buildDictionary([
  { path: "c/+phase.md", terms: ["phase"] },
  { path: "c/+phase cancellation.md", terms: ["phase cancellation"] },
  { path: "p/@Ada Lovelace.md", terms: ["Ada Lovelace", "Lovelace"] },
  { path: "c/+delay.md", terms: ["delay"] },
  { path: "c/+x.md", terms: ["x"] }, // below the 2-char floor, must be dropped
]);

// --- tokenize ---
{
  assert.deepStrictEqual(tokenize("Wet/dry mix"), ["wet", "dry", "mix"]);
  // Apostrophes and hyphens stay inside a word.
  assert.deepStrictEqual(tokenize("wide-band Kaluli's"), ["wide-band", "kaluli's"]);
}

// --- dictionary ---
{
  // A one-character term never enters the dictionary.
  assert.strictEqual(DICT.has("x"), false);
  // Both an alias and the name index the same file.
  assert.strictEqual(DICT.get("lovelace")?.[0].path, "p/@Ada Lovelace.md");
}

// --- single-word match ---
{
  const found = scanNote("A note about phase in audio.", DICT);
  assert.ok(found.has("c/+phase.md"));
  assert.strictEqual(found.has("c/+phase cancellation.md"), false);
}

// --- multi-word phrase, and the longer phrase does not suppress the shorter ---
{
  const found = scanNote("Discussion of phase cancellation here.", DICT);
  assert.ok(found.has("c/+phase cancellation.md"));
  // "phase" also genuinely appears; both are real mentions of real files, and
  // deciding which to SHOW is the matcher's job, not the index's.
  assert.ok(found.has("c/+phase.md"));
}

// --- a phrase that starts but does not complete is not a match ---
{
  const found = scanNote("The phase was fine.", DICT);
  assert.strictEqual(found.has("c/+phase cancellation.md"), false);
}

// --- alias match, and case insensitivity ---
{
  const found = scanNote("work by LOVELACE and others", DICT);
  assert.ok(found.has("p/@Ada Lovelace.md"));
}

// --- a set, not counts: repeats collapse ---
{
  const found = scanNote("phase phase phase", DICT);
  assert.strictEqual(found.size, 1);
}

// --- word boundaries: a term inside a longer word must not match ---
{
  const found = scanNote("The delayed train.", DICT);
  assert.strictEqual(
    found.has("c/+delay.md"),
    false,
    "tokenizing on word boundaries should stop 'delay' matching inside 'delayed'"
  );
}

// --- statistics ---
const A = "c/a.md", B = "c/b.md", C = "c/c.md";
{
  // A and B travel together in 4 notes; C appears widely and alone.
  const sets = [
    new Set([A, B]),
    new Set([A, B]),
    new Set([A, B]),
    new Set([A, B, C]),
    new Set([C]),
    new Set([C]),
    new Set([C]),
    new Set([C]),
  ];
  const stats = computeStats(sets);

  assert.strictEqual(stats.noteCount, 8);
  assert.strictEqual(stats.df.get(A), 4);
  assert.strictEqual(stats.df.get(C), 5);
  assert.strictEqual(stats.cooc.get(pairKey(A, B)), 4);

  // A always travels with B: maximum association.
  const ab = npmi(A, B, stats);
  assert.ok(ab !== null && ab > 0.9, `expected a strong A-B score, got ${ab}`);

  // A and C share only one note, below the evidence floor of 3: no signal, not
  // a weak one. This is the guard against NPMI's rare-pair inflation.
  assert.strictEqual(npmi(A, C, stats), null);

  // The rarer term carries the higher IDF.
  assert.ok(idf(A, stats) > idf(C, stats));

  // Neighbors are ranked, and the below-floor pair is absent entirely.
  const n = topNeighbors(A, stats);
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].path, B);
  assert.strictEqual(n[0].cooccurrences, 4);
}

// --- pair keys are order-independent, and survive paths containing spaces ---
{
  const p1 = "10-19_Knowledge/concept/+digital audio.md";
  const p2 = "10-19_Knowledge/people/@Ada Lovelace.md";
  assert.strictEqual(pairKey(p1, p2), pairKey(p2, p1));
  const stats = computeStats([new Set([p1, p2]), new Set([p1, p2]), new Set([p1, p2])]);
  assert.strictEqual(stats.cooc.get(pairKey(p1, p2)), 3);
  assert.ok(npmi(p1, p2, stats) !== null);
}

// --- an index-heavy note is excluded from pair counting but not from df ---
{
  const many = new Set(Array.from({ length: 80 }, (_, i) => `c/${i}.md`));
  const stats = computeStats([many]);
  assert.strictEqual(stats.df.get("c/0.md"), 1, "df still counts the note");
  assert.strictEqual(stats.cooc.size, 0, "an 80-mention note contributes no pairs");
}

console.log("index: all assertions passed");
