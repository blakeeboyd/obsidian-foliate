/**
 * The second opinion, and the cases where it must decline to have one.
 *
 * This decides what disappears from Unlinked Mentions into Hidden connections,
 * so the assertions that matter are the ones asserting it does NOT fire: on a
 * rare term, on a concept with no signature to consult, and on anything the
 * user has already linked.
 *
 * Run: npx tsx src/services/index/corroborate.test.ts
 */
import * as assert from "assert";
import { corroborate, shouldWithhold, signatureWordsByPath } from "./corroborate";
import { computeStats } from "./stats";

// A corpus where +reverb and +delay travel together and +subwoofer stands apart.
const sets: Set<string>[] = [];
for (let i = 0; i < 40; i++) sets.push(new Set(["c/+reverb.md", "c/+delay.md"]));
for (let i = 0; i < 40; i++) sets.push(new Set(["c/+subwoofer.md"]));
for (let i = 0; i < 200; i++) sets.push(new Set([`c/+pad${i}.md`]));
const stats = computeStats(sets, sets);
const FLOOR = 0.3;

// Nothing supports it: the word alone.
{
  const r = corroborate({
    path: "c/+subwoofer.md",
    linked: new Set(),
    signatureHits: new Map(),
    present: new Set(["c/+reverb.md"]),
    stats,
    floor: FLOOR,
  });
  assert.strictEqual(r.kind, "none");
  assert.strictEqual(
    shouldWithhold(r, { ambiguous: true, hasSignature: true }),
    true,
    "an ambiguous term with a signature that stays silent is withheld"
  );
}

// A signature firing is support, and it names the words.
{
  const r = corroborate({
    path: "c/+subwoofer.md",
    linked: new Set(),
    signatureHits: signatureWordsByPath([
      { path: "c/+subwoofer.md", matched: ["lfe", "crossover", "bass"] },
    ]),
    present: new Set(),
    stats,
    floor: FLOOR,
  });
  assert.strictEqual(r.kind, "signature");
  assert.deepStrictEqual(r.evidence, ["lfe", "crossover", "bass"]);
  assert.strictEqual(shouldWithhold(r, { ambiguous: true, hasSignature: true }), false);
}

// Association to what the note is about is support.
{
  const r = corroborate({
    path: "c/+reverb.md",
    linked: new Set(),
    signatureHits: new Map(),
    present: new Set(["c/+delay.md"]),
    stats,
    floor: FLOOR,
  });
  assert.strictEqual(r.kind, "association");
  assert.deepStrictEqual(r.evidence, ["c/+delay.md"]);
}

// A link is the user's own assertion and ends the question.
{
  const r = corroborate({
    path: "c/+subwoofer.md",
    linked: new Set(["c/+subwoofer.md"]),
    signatureHits: new Map(),
    present: new Set(),
    stats,
    floor: FLOOR,
  });
  assert.strictEqual(r.kind, "linked");
  assert.strictEqual(shouldWithhold(r, { ambiguous: true, hasSignature: true }), false);
}

// --- the cases where it must decline to judge ---
{
  const none = corroborate({
    path: "c/+subwoofer.md",
    linked: new Set(),
    signatureHits: new Map(),
    present: new Set(),
    stats,
    floor: FLOOR,
  });
  // A rare, specific term: if a note says "convolution reverb" it means it, and
  // no second opinion is needed or wanted.
  assert.strictEqual(
    shouldWithhold(none, { ambiguous: false, hasSignature: true }),
    false,
    "a specific term is never withheld for lack of corroboration"
  );
  // Two thirds of taxa files have too few links to have a signature. "It did
  // not fire" means nothing when there was none to fire.
  assert.strictEqual(
    shouldWithhold(none, { ambiguous: true, hasSignature: false }),
    false,
    "a concept with no signature cannot fail to corroborate"
  );
}

// A concept never associates with itself, however present it is.
{
  const r = corroborate({
    path: "c/+reverb.md",
    linked: new Set(),
    signatureHits: new Map(),
    present: new Set(["c/+reverb.md"]),
    stats,
    floor: FLOOR,
  });
  assert.strictEqual(r.kind, "none", "self-association is not evidence");
}

console.log("corroborate: all assertions passed");
