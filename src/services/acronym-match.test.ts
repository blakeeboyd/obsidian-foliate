/**
 * Check the declared-acronym pattern: "[[term]] (ACRONYM)" states an
 * equivalence, so the acronym counts as a mention of that file in that note.
 *
 * The risk this guards against is the opposite of a miss. A parenthetical after
 * a link is USUALLY an editorial aside, not an alias, so the shape test has to
 * reject "(concept)", "(memory)", "(status: final)" and file paths. Real
 * examples on both sides are taken from the vault.
 *
 * Run: npx tsx src/services/acronym-match.test.ts
 */
import * as assert from "assert";

const DECLARATION = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\] ?\(([A-Z][A-Za-z]*\.?(?:[A-Z]\.?){1,6}s?)\)/g;

function declared(text: string) {
  return [...text.matchAll(DECLARATION)].map((m) => ({
    target: m[1].trim(),
    acronym: m[2],
  }));
}

// Real declarations from the vault.
{
  assert.deepStrictEqual(declared("[[+just noticeable difference]] (JND)"), [
    { target: "+just noticeable difference", acronym: "JND" },
  ]);
  assert.deepStrictEqual(declared("[[+common-mode rejection ratio]] (CMRR)"), [
    { target: "+common-mode rejection ratio", acronym: "CMRR" },
  ]);
  assert.deepStrictEqual(declared("[[@International Telecommunications Union]] (ITU)"), [
    { target: "@International Telecommunications Union", acronym: "ITU" },
  ]);
}

// The motivating example.
{
  const r = declared("[[+attention deficit hyperactivity disorder]] (ADHD) affects...");
  assert.strictEqual(r[0].acronym, "ADHD");
}

// Piped links resolve to the target, not the display text.
{
  const r = declared("[[11.14.2h the emotionally immature relationship system|14.2h]] (EIRS)");
  assert.strictEqual(r[0].target, "11.14.2h the emotionally immature relationship system");
  assert.strictEqual(r[0].acronym, "EIRS");
}

// No space between link and parenthesis still counts.
assert.strictEqual(declared("[[+directivity index]](DI)")[0].acronym, "DI");

// Periods are allowed: "U.S.A." style.
assert.strictEqual(declared("[[@United States]] (U.S.)")[0].acronym, "U.S.");

// A trailing plural "s" is part of the acronym.
assert.strictEqual(declared("[[+digital audio workstation]] (DAWs)")[0].acronym, "DAWs");

// --- Rejections: editorial asides seen in the vault ---
for (const aside of [
  "[[+habitability]] (concept)",
  "[[feedback_late_policy]] (memory)",
  "[[42.03.112 Exhibit Blurb (Final)]] (status: final)",
  "[[@Ludwig Wittgenstein]] (embodied-cognition/)",
  "[[+hype cycle]] (`10-19_Knowledge/concept/+hype cycle.md`)",
  "[[05.0068 Dictate mode]] (open — repetition loop bug)",
  "[[43.25.111 Design Principles]] (principle 6)",
]) {
  assert.deepStrictEqual(declared(aside), [], `must reject aside: ${aside}`);
}

// A single capital letter is too weak to be an acronym.
assert.deepStrictEqual(declared("[[+voltage]] (V)"), [], "one letter is not an acronym");

// Sentence-case words are asides, not acronyms.
assert.deepStrictEqual(declared("[[+delay]] (Echo)"), [], "capitalized word is not an acronym");

// A parenthetical not adjacent to the link is unrelated.
assert.deepStrictEqual(
  declared("[[+delay]] is used here (JND)"),
  [],
  "must be immediately after the link"
);

// Several declarations in one note are all found.
{
  const r = declared("[[+transmission loss]] (TL) and [[+Sound Transmission Class]] (STC)");
  assert.deepStrictEqual(r.map((x) => x.acronym), ["TL", "STC"]);
}

console.log("declared-acronym matching: all assertions passed");
