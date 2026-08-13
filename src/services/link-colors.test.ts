/**
 * Check which wikilinks per-taxon coloring claims.
 *
 * The scan runs on every visible-range update while the user types, so it sees
 * half-written links constantly: an unclosed "[[", an empty "[[]]", a bracket
 * on one line and its partner three lines down. Each of those has a wrong
 * answer that looks fine until you hit it, so they are pinned here.
 *
 * Run: npx tsx src/services/link-colors.test.ts
 */
import * as assert from "assert";
import { findLinkSpans } from "./link-colors";
import { TaxaMapping } from "../types";

const PEOPLE: TaxaMapping = { prefix: "@", label: "People", folder: "", linkColor: "#7c3aed" };
const CONCEPTS: TaxaMapping = { prefix: "+", label: "Concepts", folder: "", linkColor: "#0891b2" };
const TAXA = [PEOPLE, CONCEPTS];

// A plain link to a colored taxon, brackets included: the mark covers "[[@Ada]]"
// so the brackets take the color too, matching what reading view shows.
{
  const text = "see [[@Ada Lovelace]] here";
  const spans = findLinkSpans(text, TAXA);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(text.slice(spans[0].from, spans[0].to), "[[@Ada Lovelace]]");
  assert.strictEqual(spans[0].taxon, PEOPLE);
}

// An alias displays text with no prefix; the target still decides the color.
{
  const spans = findLinkSpans("[[@Ada Lovelace|she]]", TAXA);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(spans[0].taxon, PEOPLE);
}

// Each taxon claims only its own prefix.
{
  const spans = findLinkSpans("[[@Ada]] and [[+entropy]]", TAXA);
  assert.deepStrictEqual(spans.map((s) => s.taxon.label), ["People", "Concepts"]);
}

// A link with no taxa prefix is left alone, so ordinary links keep the theme color.
{
  assert.deepStrictEqual(findLinkSpans("[[Daily Note]]", TAXA), []);
}

// An uncolored taxon is not in the list the caller passes, so it matches nothing.
{
  assert.deepStrictEqual(findLinkSpans("[[@Ada]]", []), []);
}

// Half-typed link: "[[@Ad" with no closing bracket must not run to end of text.
{
  assert.deepStrictEqual(findLinkSpans("writing [[@Ad", TAXA), []);
}

// Empty brackets have no target to read a prefix from.
{
  assert.deepStrictEqual(findLinkSpans("[[]]", TAXA), []);
}

// The killer case: an unclosed "[[" on one line must not pair with a "]]"
// belonging to a real link further down. Without the newline guard the span
// would swallow both lines and paint the text between them.
{
  const text = "[[@unclosed\nsome prose\n[[+entropy]]";
  const spans = findLinkSpans(text, TAXA);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(text.slice(spans[0].from, spans[0].to), "[[+entropy]]");
}

// Two links back to back: the second is found after the first closes.
{
  const spans = findLinkSpans("[[@A]][[+b]]", TAXA);
  assert.strictEqual(spans.length, 2);
  assert.strictEqual(spans[1].taxon, CONCEPTS);
}

// Offsets are relative to the slice, and the caller adds the range start.
{
  const spans = findLinkSpans("xx [[@Ada]]", TAXA);
  assert.strictEqual(spans[0].from, 3);
}

console.log("link-colors: all assertions passed");
