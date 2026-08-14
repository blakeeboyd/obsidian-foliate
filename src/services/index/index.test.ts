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
import { buildDictionary, scanNote, tokenize, fingerprintEntries } from "./scan";
import {
  computeStats, npmi, idf, topNeighbors, pairKey, findUsageOverlaps, curationRatio,
  weightedTogether, LINK_WEIGHT,
} from "./stats";

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

// --- usage overlap: the duplicate-by-behaviour check ---
{
  const X = "c/+Noise.md", Y = "c/+noise (audio).md", Z = "c/+unrelated.md";
  // X and Y appear in the same 10 notes; Z shares only 2 of them.
  const sets: Set<string>[] = [];
  for (let i = 0; i < 10; i++) sets.push(new Set([X, Y]));
  for (let i = 0; i < 8; i++) sets.push(new Set([Z]));
  sets.push(new Set([X, Y, Z]));
  sets.push(new Set([X, Y, Z]));

  const overlaps = findUsageOverlaps(computeStats(sets), { minJaccard: 0.4, minDf: 5, minTogether: 3 });
  const names = overlaps.map((o: { a: string; b: string }) => [o.a, o.b]);
  assert.deepStrictEqual(names, [[X, Y]], "only the interchangeable pair should surface");
  assert.ok(overlaps[0].jaccard > 0.9);
}

// --- a pair with high co-occurrence but low overlap is NOT flagged ---
{
  // B always appears with A, but A appears in many notes without B. They are
  // related, not interchangeable, which is the founder/company case.
  const A = "c/a.md", B = "c/b.md";
  const sets: Set<string>[] = [];
  for (let i = 0; i < 6; i++) sets.push(new Set([A, B]));
  for (let i = 0; i < 30; i++) sets.push(new Set([A]));
  const overlaps = findUsageOverlaps(computeStats(sets), { minJaccard: 0.4, minDf: 5, minTogether: 3 });
  assert.strictEqual(overlaps.length, 0, "one-sided dependence is not duplication");
}

// --- thin evidence never counts, however perfect the ratio ---
{
  const A = "c/a.md", B = "c/b.md";
  // Perfect 1.0 overlap from 3 notes: the ratio looks certain, the data is not.
  const sets = [new Set([A, B]), new Set([A, B]), new Set([A, B])];
  const overlaps = findUsageOverlaps(computeStats(sets), { minJaccard: 0.4, minDf: 8, minTogether: 4 });
  assert.strictEqual(overlaps.length, 0);
}

console.log("index: overlap assertions passed");

// --- the taxon filter: a duplicate is a thing written twice, and a thing has
//     one type. Every cross-taxon pair this vault produced was a false positive
//     (an organization and its founder, a philosopher and their concept). ---
{
  const PREFIXES = ["@", "+", "º"];
  const prefixOf = (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return PREFIXES.find((p) => name.startsWith(p)) ?? "";
  };
  const org = "o/ºBellroy.md", person = "p/@JJ (Bellroy).md";
  const a = "c/+Noise.md", b = "c/+noise (audio).md";

  const sets: Set<string>[] = [];
  for (let i = 0; i < 12; i++) sets.push(new Set([org, person]));
  for (let i = 0; i < 12; i++) sets.push(new Set([a, b]));
  const stats = computeStats(sets);

  const unfiltered = findUsageOverlaps(stats, { minJaccard: 0.4, minDf: 5, minTogether: 3 });
  assert.strictEqual(unfiltered.length, 2, "both pairs overlap perfectly");

  const filtered = findUsageOverlaps(stats, {
    minJaccard: 0.4, minDf: 5, minTogether: 3, prefixOf,
  });
  assert.strictEqual(filtered.length, 1, "the cross-taxon pair is dropped");
  assert.deepStrictEqual([filtered[0].a, filtered[0].b], [a, b]);
}

// --- curation ratio: same mention count, opposite meaning ---
{
  const concept = "c/+phase.md", common = "c/+Time.md";
  // Both are WRITTEN in 100 notes. The concept is also linked in 40 of them;
  // the common word is linked in 1. Same frequency, opposite meaning.
  const mentions: Set<string>[] = [];
  for (let i = 0; i < 100; i++) mentions.push(new Set([concept]));
  for (let i = 0; i < 100; i++) mentions.push(new Set([common]));
  const links: Set<string>[] = [];
  for (let i = 0; i < 40; i++) links.push(new Set([concept]));
  links.push(new Set([common]));

  const stats = computeStats(mentions, links);
  assert.ok(curationRatio(concept, stats) > 0.25, "a linked concept reads as curated");
  assert.ok(curationRatio(common, stats) < 0.02, "a word never linked reads as uncurated");
  // A term nobody has ever written or linked has no ratio rather than a NaN.
  assert.strictEqual(curationRatio("c/absent.md", stats), 0);
}

// --- a co-link outranks bare co-occurrence ---
{
  const target = "c/+phase.md";
  const linkedPeer = "c/+phase cancellation.md";
  const mentionedPeer = "c/+Time.md";

  const mentions: Set<string>[] = [];
  // The merely-mentioned peer shares MORE pages than the linked one.
  for (let i = 0; i < 12; i++) mentions.push(new Set([target, mentionedPeer]));
  for (let i = 0; i < 8; i++) mentions.push(new Set([target, linkedPeer]));
  for (let i = 0; i < 40; i++) mentions.push(new Set([mentionedPeer]));
  for (let i = 0; i < 40; i++) mentions.push(new Set([linkedPeer]));
  // But the user linked both of the second pair together, repeatedly.
  const links: Set<string>[] = [];
  for (let i = 0; i < 8; i++) links.push(new Set([target, linkedPeer]));

  const stats = computeStats(mentions, links);
  assert.strictEqual(stats.coLink.get(pairKey(target, linkedPeer)), 8);
  assert.strictEqual(stats.coLink.get(pairKey(target, mentionedPeer)), undefined);

  const ranked = topNeighbors(target, stats, 5);
  assert.strictEqual(
    ranked[0].path,
    linkedPeer,
    "the pair the user linked should outrank the pair that only co-occurred"
  );
  assert.strictEqual(ranked[0].linkedTogether, 8);
}

// --- weightedTogether counts a co-link as several mentions ---
{
  const a = "c/a.md", b = "c/b.md";
  const stats = computeStats(
    [new Set([a, b]), new Set([a, b])],
    [new Set([a, b])]
  );
  assert.strictEqual(weightedTogether(a, b, stats), 2 + LINK_WEIGHT);
}

console.log("index: taxon-filter and curation assertions passed");

// --- merged concepts: two files, one node ---
{
  // The user has confirmed these name one idea, kept as two files.
  const a = "c/+Open Sound Control.md";
  const b = "c/+Open Sound Control (OSC).md";
  const peer = "c/+Max MSP.md";

  // Each half is mentioned in its own notes, so the evidence is split.
  const raw: Set<string>[] = [];
  for (let i = 0; i < 5; i++) raw.push(new Set([a, peer]));
  for (let i = 0; i < 5; i++) raw.push(new Set([b, peer]));

  const split = computeStats(raw);
  assert.strictEqual(split.df.get(a), 5);
  assert.strictEqual(split.df.get(b), 5);
  assert.strictEqual(split.cooc.get(pairKey(a, peer)), 5, "half the evidence");

  // Folding onto the keeper is what the index does before deriving stats.
  const canonical = new Map([[b, a]]);
  const fold = (s: Set<string>) =>
    new Set([...s].map((p) => canonical.get(p) ?? p));
  const merged = computeStats(raw.map(fold));

  assert.strictEqual(merged.df.get(a), 10, "both halves now count as one concept");
  assert.strictEqual(merged.df.get(b), undefined, "the folded path is gone");
  assert.strictEqual(
    merged.cooc.get(pairKey(a, peer)),
    10,
    "the relationship carries its full weight instead of being halved"
  );
}

console.log("index: merge assertions passed");

// --- shared terms separate "one concept" from "two things discussed together" ---
{
  const noiseA = "c/+Noise.md", noiseB = "c/+noise (audio).md";
  const hospA = "c/+Hospitality in array.md", hospB = "c/+Hospitality in chain.md";
  // Both pairs overlap perfectly in the notes: co-occurrence alone cannot tell
  // them apart, which is the whole reason this signal exists.
  const sets: Set<string>[] = [];
  for (let i = 0; i < 12; i++) sets.push(new Set([noiseA, noiseB]));
  for (let i = 0; i < 12; i++) sets.push(new Set([hospA, hospB]));
  const stats = computeStats(sets);

  const TERMS: Record<string, string[]> = {
    // Each file claims the other's name: any note saying "noise" hits both.
    [noiseA]: ["noise"],
    [noiseB]: ["noise (audio)", "noise"],
    // Distinct names, no collision. Two ideas, always discussed together.
    [hospA]: ["hospitality in array"],
    [hospB]: ["hospitality in chain"],
  };
  const overlaps = findUsageOverlaps(stats, {
    minJaccard: 0.4, minDf: 5, minTogether: 3,
    termsOf: (p) => TERMS[p] ?? [],
  });

  const noise = overlaps.find((o) => o.a === noiseA || o.b === noiseA);
  const hosp = overlaps.find((o) => o.a === hospA || o.b === hospA);
  assert.deepStrictEqual(noise?.sharedTerms, ["noise"], "a name collision is detected");
  assert.deepStrictEqual(hosp?.sharedTerms, [], "distinct names share nothing");
  // The collision is the stronger claim, so it is listed first even at equal overlap.
  assert.ok(overlaps.indexOf(noise!) < overlaps.indexOf(hosp!));
}

console.log("index: shared-term assertions passed");

// --- a shared term qualifies a pair on its own ---
{
  // Two files claiming one word, barely co-occurring: below every statistical
  // bar. The sidebar marks this pair, so the modal has to contain it, or
  // clicking the mark opens a list that does not include what was clicked.
  const a = "c/+bleed.md", b = "c/+bleed (audio).md";
  const stats = computeStats([new Set([a, b])]);

  const withoutTerms = findUsageOverlaps(stats, {});
  assert.strictEqual(withoutTerms.length, 0, "co-occurrence alone is far too thin");

  const withTerms = findUsageOverlaps(stats, {
    termsOf: (p) => (p === a ? ["bleed"] : ["bleed (audio)", "bleed"]),
  });
  assert.strictEqual(withTerms.length, 1, "the shared term qualifies it regardless");
  assert.deepStrictEqual(withTerms[0].sharedTerms, ["bleed"]);
}

console.log("index: shared-term-qualifies assertions passed");


// --- the dictionary fingerprint: what makes skipping unchanged notes safe ---
{
  const base = [
    { path: "c/+phase.md", terms: ["phase", "phasing"] },
    { path: "p/@Ada.md", terms: ["Ada Lovelace"] },
  ];

  // Same terms, same fingerprint, however the files are ordered.
  assert.strictEqual(
    fingerprintEntries(base),
    fingerprintEntries([base[1], base[0]]),
    "file order must not change the fingerprint, or every rebuild rescans"
  );

  // An added alias changes it: untouched notes may now mention that file.
  assert.notStrictEqual(
    fingerprintEntries(base),
    fingerprintEntries([
      { path: "c/+phase.md", terms: ["phase", "phasing", "phase shift"] },
      base[1],
    ]),
    "a new alias must invalidate stored scans"
  );

  // A rename changes it too.
  assert.notStrictEqual(
    fingerprintEntries(base),
    fingerprintEntries([{ path: "c/+phase.md", terms: ["phase", "phasing"] },
                        { path: "p/@Ada.md", terms: ["Ada Byron"] }]),
    "a renamed taxa file must invalidate stored scans"
  );

  // A new taxa file changes it.
  assert.notStrictEqual(
    fingerprintEntries(base),
    fingerprintEntries([...base, { path: "c/+delay.md", terms: ["delay"] }]),
    "a new taxa file must invalidate stored scans"
  );

  // Reordering the terms WITHIN a file is a real change to matching order and
  // is treated as one; the weighting is positional so this is not a collision.
  assert.notStrictEqual(
    fingerprintEntries(base),
    fingerprintEntries([{ path: "c/+phase.md", terms: ["phasing", "phase"] }, base[1]])
  );

  // Terms below the length floor never enter the dictionary, so they must not
  // move the fingerprint either.
  assert.strictEqual(
    fingerprintEntries(base),
    fingerprintEntries([...base, { path: "c/+x.md", terms: ["x"] }]),
    "a term the dictionary ignores must not invalidate anything"
  );
}

console.log("index: fingerprint assertions passed");
