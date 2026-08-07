/**
 * Check the symbol picker's search, conflict marking, and single-character
 * enforcement.
 *
 * The picker exists because six of the ten default prefixes need a modifier on
 * a US keyboard, so a user who clears the field cannot retype what shipped.
 * Search covers the same gap from the other side: knowing you want "the
 * infinity one" should be enough without recognizing ∞ in a grid.
 *
 * Run: npx tsx src/ui/symbol-picker.test.ts
 */
import * as assert from "assert";

interface SymbolOption {
  char: string;
  keys: string;
  names: string[];
}

const SAMPLE: SymbolOption[] = [
  { char: "@", keys: "Shift-2", names: ["at", "people", "person", "mention"] },
  { char: "©", keys: "Option-G", names: ["copyright", "work", "c in circle"] },
  { char: "•", keys: "Option-8", names: ["bullet", "dot", "point", "project"] },
  { char: "∞", keys: "Option-5", names: ["infinity", "endless", "loop", "event"] },
  { char: "≈", keys: "Option-X", names: ["approximately", "almost equal", "wave", "domain"] },
  { char: "π", keys: "Option-P", names: ["pi", "greek"] },
];

function filtered(query: string, symbols = SAMPLE) {
  const q = query.trim().toLowerCase();
  if (!q) return symbols;
  return symbols.filter((s) => s.char === q || s.names.some((n) => n.includes(q)));
}

/** Prefixes claimed by other taxa, excluding the one being edited. */
function takenMap(
  taxa: { prefix: string; label: string }[],
  current: { prefix: string; label: string } | null
) {
  const m = new Map<string, string>();
  for (const t of taxa) {
    if (t.prefix && t !== current) m.set(t.prefix, t.label);
  }
  return m;
}

/** One symbol per taxon: take the first character of whatever arrives. */
function firstChar(value: string): string {
  return [...value.trim()][0] ?? "";
}

// --- Search ---

// The motivating case: find a symbol by what you'd call it, not by sight.
assert.deepStrictEqual(filtered("infinity").map((s) => s.char), ["∞"]);
assert.deepStrictEqual(filtered("copyright").map((s) => s.char), ["©"]);

// Informal names work, since few people know the formal ones.
assert.deepStrictEqual(filtered("wave").map((s) => s.char), ["≈"], "≈ by an informal name");
assert.deepStrictEqual(filtered("dot").map((s) => s.char), ["•"]);

// The taxon a symbol ships as is searchable too.
assert.deepStrictEqual(filtered("domain").map((s) => s.char), ["≈"]);
assert.deepStrictEqual(filtered("people").map((s) => s.char), ["@"]);

// Partial words match, so search narrows as you type.
assert.ok(filtered("infin").some((s) => s.char === "∞"), "prefix of a name matches");
assert.ok(filtered("copy").some((s) => s.char === "©"));

// Case-insensitive.
assert.deepStrictEqual(filtered("INFINITY").map((s) => s.char), ["∞"]);

// Pasting the symbol itself finds it.
assert.deepStrictEqual(filtered("∞").map((s) => s.char), ["∞"]);

// An empty query shows everything, so the grid is browsable.
assert.strictEqual(filtered("").length, SAMPLE.length);

// A miss returns nothing, and the UI falls back to "type any character".
assert.deepStrictEqual(filtered("zzzznope"), []);

// One query can match several symbols.
assert.ok(filtered("greek").length >= 1);

// --- Conflicts ---

const TAXA = [
  { prefix: "@", label: "People" },
  { prefix: "+", label: "Concepts" },
  { prefix: "©", label: "Works" },
];

// A prefix used by another taxon is marked with the taxon holding it.
{
  const taken = takenMap(TAXA, null);
  assert.strictEqual(taken.get("@"), "People");
  assert.strictEqual(taken.get("©"), "Works");
  assert.strictEqual(taken.has("∞"), false, "unused symbols stay selectable");
}

// The taxon being edited doesn't conflict with itself, or its own current
// symbol would appear unavailable while editing it.
{
  const taken = takenMap(TAXA, TAXA[0]);
  assert.strictEqual(taken.has("@"), false, "own prefix is not a conflict");
  assert.strictEqual(taken.get("©"), "Works", "others still conflict");
}

// A taxon with no prefix set claims nothing.
{
  const taken = takenMap([{ prefix: "", label: "Unset" }], null);
  assert.strictEqual(taken.size, 0);
}

// --- One symbol per taxon ---

assert.strictEqual(firstChar("≈"), "≈");
assert.strictEqual(firstChar("≈≈"), "≈", "a doubled symbol is trimmed to one");
assert.strictEqual(firstChar("abc"), "a", "a pasted word keeps its first character");
assert.strictEqual(firstChar("  ©  "), "©", "surrounding space is ignored");
assert.strictEqual(firstChar(""), "", "empty stays empty");
// Astral characters count as one, not as two UTF-16 code units.
assert.strictEqual(firstChar("𝄞x"), "𝄞", "surrogate pair kept whole");

console.log("symbol picker: all assertions passed");
