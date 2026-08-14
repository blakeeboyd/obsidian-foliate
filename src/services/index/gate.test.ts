/**
 * The gate decides what the user never sees, which makes a wrong "hide" worse
 * than a wrong "show": one is invisible, the other is merely noise. These
 * assertions pin the four branches and, more importantly, the cases where the
 * gate must refuse to act.
 *
 * Run: npx tsx src/services/index/gate.test.ts
 */
import * as assert from "assert";
import { computeStats } from "./stats";
import { buildClusters } from "./clusters";
import { gateDecision, DEFAULT_GATE } from "./gate";

const AUDIO = ["c/+phase.md", "c/+reverb.md", "c/+gain.md", "c/+delay.md"];
const PEDAGOGY = ["c/+rubric.md", "c/+backward design.md", "c/+bloom.md", "c/+transfer.md"];
const COMMON = "c/+Time.md"; // in many notes across both worlds

// Enough filler that the two topic groups are a small share of the corpus,
// which is what a real vault looks like: most concepts are specific, a few
// words are everywhere. Without it every term reads as "common" and the
// unambiguous branch never fires.
const sets: Set<string>[] = [];
for (let i = 0; i < 40; i++) sets.push(new Set([...AUDIO, COMMON]));
for (let i = 0; i < 40; i++) sets.push(new Set([...PEDAGOGY, COMMON]));
for (let i = 0; i < 1200; i++) sets.push(new Set([`c/+filler${i % 300}.md`]));

const stats = computeStats(sets);
const clusters = buildClusters(stats);

// A specific term surfaces anywhere: it is in too few notes to be ambiguous.
{
  const v = gateDecision("c/+rubric.md", new Set(AUDIO), stats, clusters);
  assert.strictEqual(v.surface, true);
  assert.strictEqual(v.reason, "unambiguous");
}

// A term nobody has written much is never hidden, however unrelated the note.
{
  const v = gateDecision("c/+filler0.md", new Set(AUDIO), stats, clusters);
  assert.strictEqual(v.surface, true);
  assert.strictEqual(v.reason, "cold", "thin evidence must surface, not hide");
}

// The real case: a common term in a note about its own cluster surfaces...
{
  const v = gateDecision(COMMON, new Set(AUDIO), stats, clusters);
  assert.strictEqual(v.surface, true);
  assert.ok(v.evidence.length > 0, "it should name what convinced it");
}

// ...and a note that establishes nothing related hides it.
{
  const v = gateDecision(COMMON, new Set(["c/+filler1.md"]), stats, clusters);
  assert.strictEqual(v.surface, false, "a common term with no related company is withheld");
  assert.ok(v.reason === "cluster-miss" || v.reason === "neighbour-miss");
}

// A note mentioning nothing at all cannot establish context, so an ambiguous
// term is withheld rather than surfaced by default.
{
  const v = gateDecision(COMMON, new Set(), stats, clusters);
  assert.strictEqual(v.surface, false);
}

// A term never judges itself: a note mentioning only the candidate must not
// count that as evidence for surfacing it.
{
  const v = gateDecision(COMMON, new Set([COMMON]), stats, clusters);
  assert.strictEqual(v.surface, false, "a term cannot be its own context");
}

// Raising the ambiguity bar above a term's share exempts it entirely, which is
// how the setting stays a dial rather than an on/off switch.
{
  const v = gateDecision(COMMON, new Set(["c/+filler1.md"]), stats, clusters, {
    ...DEFAULT_GATE,
    ambiguousRatio: 0.9,
  });
  assert.strictEqual(v.reason, "unambiguous");
  assert.strictEqual(v.surface, true);
}

// With no clusters at all the gate still works, on neighbours alone.
{
  const empty = { membership: new Map(), members: new Map(), settled: new Set<number>() };
  const hit = gateDecision(COMMON, new Set(AUDIO), stats, empty);
  assert.strictEqual(hit.reason, "neighbour-match");
  assert.strictEqual(hit.surface, true);

  const miss = gateDecision(COMMON, new Set(["c/+filler2.md"]), stats, empty);
  assert.strictEqual(miss.reason, "neighbour-miss");
  assert.strictEqual(miss.surface, false);
}

console.log("gate: all assertions passed");
