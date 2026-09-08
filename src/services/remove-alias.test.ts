/**
 * Removing an alias edits the user's own file, so the cases that matter are the
 * ones where it must do nothing: a name it was not asked about, a list shaped
 * differently than expected, a term already gone.
 *
 * The mutation is copied here rather than imported, for the reason
 * collision.test.ts gives: file-operations imports Notice, moment and
 * apiVersion, which are runtime values, and the obsidian package is types only.
 * Keep this in step with removeAliasFromFile.
 *
 * Run: npx tsx src/services/remove-alias.test.ts
 */
import * as assert from "assert";

type FM = Record<string, unknown>;

/** The body of removeAliasFromFile's processFrontMatter callback. */
function removeAlias(fm: FM, alias: string): boolean {
  const wanted = alias.trim().toLowerCase();
  if (!fm.aliases) return false;
  const list = Array.isArray(fm.aliases) ? fm.aliases : [fm.aliases];
  const kept = list.filter(
    (a: unknown) => typeof a !== "string" || a.trim().toLowerCase() !== wanted
  );
  if (kept.length === list.length) return false;
  if (kept.length === 0) delete fm.aliases;
  else fm.aliases = kept;
  return true;
}

// The ordinary case: one alias of several goes, the rest stay.
{
  const fm: FM = { aliases: ["subwoofer", "sub", "LFE"] };
  assert.strictEqual(removeAlias(fm, "sub"), true);
  assert.deepStrictEqual(fm.aliases, ["subwoofer", "LFE"]);
}

// Case-insensitive: the row said "xue", the file says "Xue", one claim.
{
  const fm: FM = { aliases: ["Xue", "learning"] };
  assert.strictEqual(removeAlias(fm, "xue"), true);
  assert.deepStrictEqual(fm.aliases, ["learning"]);
}

// Not there: reports no change rather than a success it did not cause.
{
  const fm: FM = { aliases: ["subwoofer"] };
  assert.strictEqual(removeAlias(fm, "sub"), false);
  assert.deepStrictEqual(fm.aliases, ["subwoofer"]);
}

// No aliases at all, and a file with none must not gain an empty list.
{
  const fm: FM = { tags: ["audio"] };
  assert.strictEqual(removeAlias(fm, "sub"), false);
  assert.strictEqual("aliases" in fm, false);
}

// A single string rather than a list: valid YAML that would break a .filter().
{
  const fm: FM = { aliases: "sub" };
  assert.strictEqual(removeAlias(fm, "sub"), true);
  assert.strictEqual("aliases" in fm, false, "the last alias removes the key, not an empty list");
}

// Non-string entries survive untouched: the file is the user's, and a stray
// number in the list is not this function's to tidy away.
{
  const fm: FM = { aliases: ["sub", 42] };
  assert.strictEqual(removeAlias(fm, "sub"), true);
  assert.deepStrictEqual(fm.aliases, [42]);
}

// Whitespace and case in the file's own entry.
{
  const fm: FM = { aliases: ["  Sub  ", "LFE"] };
  assert.strictEqual(removeAlias(fm, "sub"), true);
  assert.deepStrictEqual(fm.aliases, ["LFE"]);
}

// The alias that IS the file's name is still removable: the modal never offers
// it, but nothing here should silently refuse a caller that asks.
{
  const fm: FM = { aliases: ["subwoofer"] };
  assert.strictEqual(removeAlias(fm, "subwoofer"), true);
  assert.strictEqual("aliases" in fm, false);
}

console.log("remove-alias: all assertions passed");
