/**
 * What counts as a note's vocabulary. Both assertions below pin bugs that
 * reached a real preview: a signature is learned silently, so anything that
 * pollutes its input is invisible until the output is wrong.
 *
 * Run: npx tsx src/services/index/scan.test.ts
 */
import * as assert from "assert";
import { noteWords } from "./scan";

// YAML field NAMES are the problem, not their values. They appear in every note
// built from a given template, so they look exactly like shared vocabulary and
// were the top signature words for several concepts.
const withFrontmatter = `---
zettelkastenID: "14.7m"
provenance: literature
review_status: pending
---

A parent who wonders aloud is not permitting the behavior.
`;
const words = noteWords(withFrontmatter);
assert.ok(!words.has("zettelkastenid"), "frontmatter field names are not vocabulary");
assert.ok(!words.has("provenance"), "nor are their values");
assert.ok(words.has("parent"), "the body still counts");
assert.ok(words.has("permitting"), "the body still counts");

// Hyphens stay inside a word so "wide-band" survives tokenizing, which lets a
// horizontal rule through as a token. It appears in most notes.
assert.ok(!noteWords("text\n\n---\n\nmore text").has("---"), "punctuation is not a word");
assert.ok(noteWords("a wide-band signal").has("wide-band"), "hyphenated words survive");

// Link syntax and code are not prose: a term inside them is a literal.
assert.ok(!noteWords("see [[+phase]] here").has("phase"), "wikilink targets are not prose");
assert.ok(!noteWords("run `npm install` now").has("install"), "code is not prose");

// Too short to carry meaning: initials, units, articles.
assert.ok(!noteWords("a is an ok word").has("ok"), "two-letter tokens are dropped");

console.log("scan.test.ts: all assertions passed");

// --- URLs are not prose ---
//
// A bare URL looks like prose to a tokenizer: "https://youtu.be/xyz" splits
// into "https", "youtu", "be", and those clear every downstream filter, since
// they are rare vault-wide and shared by exactly the notes citing the same kind
// of source. Observed on the reference vault as "+living in the whipped cream"
// carrying "youtu, https" as signature words.
{
  const words = (t: string) => [...noteWords(t)];

  assert.ok(!words("Watch https://www.youtube.com/watch?v=3W7 for this").includes("https"));
  assert.ok(!words("See https://youtu.be/abc123 here").includes("youtu"));
  assert.ok(!words("Link <https://i.ytimg.com/vi/x.jpg> here").includes("ytimg"));
  assert.ok(!words("Visit www.example.com/page today").includes("www"));
  // An image CDN escapes a URL inside its own, so the outer strip leaves the
  // inner one behind; "%3A" never occurs in prose, unlike a long compound word.
  assert.ok(!words("steep/https%3A%2F%2Fsubstack-post-media/x").includes("substack-post-media"));

  // What must survive: the prose around the link, and the vault's real
  // vocabulary, including the long hyphenated compounds it is full of.
  const kept = words("See [the talk](https://youtu.be/abc) about gratitude");
  assert.ok(kept.includes("gratitude") && kept.includes("talk"));
  assert.ok(
    words("On Alien-Penumbral-Umbral-Penumbral-Alien structure").includes(
      "alien-penumbral-umbral-penumbral-alien"
    ),
    "a long compound is vocabulary, not a URL: no length cap"
  );
  // A colon does not make a scheme.
  assert.ok(words("Note: this has a colon").includes("note"));
  // Prose that genuinely says a protocol name still says it.
  assert.ok(words("The streamable HTTP transport starts here").includes("http"));
}
