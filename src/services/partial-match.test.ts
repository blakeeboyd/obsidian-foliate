/**
 * Check partial (near-miss) taxa matching: selecting "Sarah" when the vault has
 * @Sarah Cavanagh and @Sarah Schnitker should offer both rather than creating a
 * third file. Word-boundary prefix only, so suggestions stay sensible.
 *
 * Mirrors findTaxaFilesByPartialText, which needs an App.
 *
 * Run: npx tsx src/services/partial-match.test.ts
 */
import * as assert from "assert";

function partialMatches(files: { name: string; terms: string[] }[], text: string, limit = 12) {
  const target = text.trim().toLowerCase();
  if (target.length < 2) return [];
  const hits: string[] = [];
  for (const f of files) {
    const terms = f.terms.map((t) => t.toLowerCase());
    if (terms.includes(target)) continue; // exact handled elsewhere
    if (terms.some((t) => t.startsWith(target))) hits.push(f.name);
    if (hits.length >= limit) break;
  }
  return hits;
}

const VAULT = [
  { name: "@Sarah Cavanagh", terms: ["Sarah Cavanagh", "Sarah Rose Cavanagh"] },
  { name: "@Sarah Elaine Eaton", terms: ["Sarah Elaine Eaton"] },
  { name: "@Sarah Schnitker", terms: ["Sarah Schnitker"] },
  { name: "@Alan Turing", terms: ["Alan Turing"] },
  { name: "+compact", terms: ["compact"] },
  { name: "+action", terms: ["action"] },
];

// The reported case: three Sarahs offered, nobody else.
{
  const r = partialMatches(VAULT, "Sarah");
  assert.deepStrictEqual(
    r.sort(),
    ["@Sarah Cavanagh", "@Sarah Elaine Eaton", "@Sarah Schnitker"],
    "every Sarah offered"
  );
}

// Case-insensitive.
assert.strictEqual(partialMatches(VAULT, "sarah").length, 3);

// A term matching exactly is NOT a partial match: the caller links it directly.
{
  const r = partialMatches(VAULT, "Sarah Schnitker");
  assert.deepStrictEqual(r, [], "exact match excluded from partials");
}

// Anchored at the START of a term: "act" offers "action" but never "compact".
{
  const r = partialMatches(VAULT, "act");
  assert.deepStrictEqual(r, ["+action"], "matches from the start, not mid-word");
}

// Partial typing is exactly when a suggestion helps, so "Sar" offers the Sarahs.
{
  const r = partialMatches(VAULT, "Sar");
  assert.strictEqual(r.length, 3, "an incomplete first word still suggests");
}

// A suffix matches nothing: the prefix must be at the start.
assert.deepStrictEqual(partialMatches(VAULT, "arah"), [], "no mid-word matching");

// Single characters are too vague to suggest anything.
assert.deepStrictEqual(partialMatches(VAULT, "S"), []);

// Hyphenated and underscored terms suggest from their first word.
{
  const hy = [{ name: "+well-being", terms: ["well-being"] }, { name: "+deep_work", terms: ["deep_work"] }];
  assert.deepStrictEqual(partialMatches(hy, "well"), ["+well-being"]);
  assert.deepStrictEqual(partialMatches(hy, "deep"), ["+deep_work"]);
}

// The limit caps a vague selection rather than listing the world.
{
  const many = Array.from({ length: 30 }, (_, i) => ({
    name: `@Test ${i}`,
    terms: [`Test ${i}`],
  }));
  assert.strictEqual(partialMatches(many, "Test", 12).length, 12, "capped at the limit");
}

console.log("partial taxa matching: all assertions passed");
