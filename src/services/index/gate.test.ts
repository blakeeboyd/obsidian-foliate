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

// --- prominence: the note vouching for the term itself ---
{
  // A common term in a note whose other mentions are unrelated. Said once it is
  // withheld; said repeatedly the note is plainly about it.
  const unrelated = new Set(["c/+filler1.md"]);

  const once = gateDecision(COMMON, unrelated, stats, clusters, DEFAULT_GATE, 1);
  assert.strictEqual(once.surface, false, "one passing mention is not evidence");

  const many = gateDecision(COMMON, unrelated, stats, clusters, DEFAULT_GATE, 5);
  assert.strictEqual(many.surface, true, "repetition means the note is about it");
  assert.strictEqual(many.reason, "prominent");

  // Exactly at the threshold counts, since the bar is "this many or more".
  const atBar = gateDecision(COMMON, unrelated, stats, clusters, DEFAULT_GATE,
    DEFAULT_GATE.prominentOccurrences);
  assert.strictEqual(atBar.surface, true);

  // Prominence never rescues a term with too little vault evidence to judge:
  // that path already surfaces, and for a different reason.
  const thin = gateDecision("c/+filler0.md", unrelated, stats, clusters, DEFAULT_GATE, 9);
  assert.strictEqual(thin.reason, "cold");

  // Omitting the count keeps the old behaviour, so callers that cannot supply
  // it are unaffected.
  const noCount = gateDecision(COMMON, unrelated, stats, clusters);
  assert.strictEqual(noCount.surface, false);
}

console.log("gate: prominence assertions passed");

// --- prominence does not rescue a word that is simply everywhere ---
{
  // A term in a very large share of notes is common English, not a subject.
  // Repeating it says nothing, and the first version let exactly this through.
  const veryCommon = "c/+Time.md";
  const unrelated = new Set(["c/+filler1.md"]);
  const ratio = (stats.df.get(veryCommon) ?? 0) / stats.noteCount;

  const tight = { ...DEFAULT_GATE, ambiguousRatio: ratio / 3 };
  const v = gateDecision(veryCommon, unrelated, stats, clusters, tight, 20);
  assert.strictEqual(
    v.surface,
    false,
    "a term far above the ambiguity bar cannot be rescued by repetition"
  );
  assert.notStrictEqual(v.reason, "prominent");

  // Just above the bar, prominence still applies: that is the AI case.
  const loose = { ...DEFAULT_GATE, ambiguousRatio: ratio * 0.9 };
  const w = gateDecision(veryCommon, unrelated, stats, clusters, loose, 20);
  assert.strictEqual(w.surface, true);
  assert.strictEqual(w.reason, "prominent");
}

console.log("gate: bounded-prominence assertions passed");

// --- common words must not vouch for each other ---
{
  // The failure this pins, observed on a real 13,666-word note: 52 taxa were
  // "present", so every candidate found something related among them and only
  // 3 of 33 mentions were withheld. The cause was that the present-set included
  // the ambiguous words being judged, so "time", "place", "sense" and "care"
  // each stood as proof that the others belonged.
  //
  // Four common words that co-occur constantly, in a corpus where they are
  // everywhere and genuinely unrelated to each other's meaning.
  const commons = ["c/+time.md", "c/+place.md", "c/+sense.md", "c/+care.md"];
  const sets2: Set<string>[] = [];
  for (let i = 0; i < 300; i++) sets2.push(new Set(commons));
  for (let i = 0; i < 700; i++) sets2.push(new Set([`c/+specific${i % 200}.md`]));
  const st2 = computeStats(sets2);
  const cl2 = buildClusters(st2);

  // The old behaviour: judge a common word against the other common words.
  const naive = gateDecision(commons[0], new Set(commons.slice(1)), st2, cl2);
  assert.strictEqual(
    naive.surface,
    true,
    "with common words in the present-set they vouch for each other (the bug)"
  );

  // The fix: only terms below the ambiguity bar establish context. Filtering
  // the present-set the way the sidebar now does leaves nothing to vouch.
  const bar = DEFAULT_GATE.ambiguousRatio;
  const established = new Set(
    [...commons.slice(1)].filter(
      (p) => (st2.df.get(p) ?? 0) / st2.noteCount < bar
    )
  );
  assert.strictEqual(established.size, 0, "none of these are specific enough to vote");
  const fixed = gateDecision(commons[0], established, st2, cl2);
  assert.strictEqual(fixed.surface, false, "a common word alone in a note is withheld");
}

console.log("gate: established-context assertions passed");

// --- curation: the vault's own linking decides how much weak evidence is worth ---
{
  // Two terms mentioned equally often. One the user links regularly, the other
  // almost never. Measured on the real vault, that is the difference between
  // "phase" (1,565 unlinked / 53 linked) and "lei" (1,459 / 4): frequency
  // cannot tell them apart and this can.
  const curated = "c/+phase.md";
  const uncurated = "c/+lei.md";
  const peer = "c/+reverb.md";

  const mentions: Set<string>[] = [];
  for (let i = 0; i < 60; i++) mentions.push(new Set([curated, peer]));
  for (let i = 0; i < 60; i++) mentions.push(new Set([uncurated, peer]));
  for (let i = 0; i < 400; i++) mentions.push(new Set([`c/+f${i % 100}.md`]));
  // The curated term is linked in many of its notes; the other in almost none.
  const links: Set<string>[] = [];
  for (let i = 0; i < 20; i++) links.push(new Set([curated]));
  links.push(new Set([uncurated]));

  const st3 = computeStats(mentions, links);
  const cl3 = buildClusters(st3);

  // One cluster-mate present. The curated term is allowed through on it.
  const one = new Set([peer]);
  const a = gateDecision(curated, one, st3, cl3);
  assert.strictEqual(a.surface, true, "a term the user links passes on one association");

  // The uncurated term needs a second, so a single weak tie no longer carries it.
  const b = gateDecision(uncurated, one, st3, cl3);
  assert.strictEqual(b.surface, false, "a term the user never links needs more than one");

  // Repetition cannot rescue it either: repeating a word nobody links is what a
  // common word does.
  const c = gateDecision(uncurated, one, st3, cl3, DEFAULT_GATE, 20);
  assert.strictEqual(c.surface, false, "an uncurated term cannot coast on repetition");
  assert.notStrictEqual(c.reason, "prominent");
}

console.log("gate: curation assertions passed");
