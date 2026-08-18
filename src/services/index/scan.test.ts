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
