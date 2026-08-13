/**
 * The contested-term marker, tested where it can be tested: the fold and the
 * lookup. The rendering path needs Obsidian, but the two things that silently
 * broke it twice (a key built one way and read another, and a term that only
 * exists as display text) are pure logic.
 *
 * Run: npx tsx src/services/collision.test.ts
 */
import * as assert from "assert";

// Same implementation as file-operations.foldName, copied because that module
// imports obsidian and cannot load outside the app.
function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// The real vault case that failed: two files, each claiming the other's word
// with different capitalization.
const owners = new Map<string, string[]>();
const add = (term: string, path: string) => {
  const k = foldName(term);
  const list = owners.get(k);
  if (list) { if (!list.includes(path)) list.push(path); }
  else owners.set(k, [path]);
};

add("Metadata", "c/+Metadata.md");          // its name
add("metadata", "c/+Metadata.md");          // its alias
add("audio metadata", "c/+audio metadata.md");
add("Metadata", "c/+audio metadata.md");    // its alias, differing only in case

// Both files claim the same folded term.
assert.deepStrictEqual(
  owners.get("metadata"),
  ["c/+Metadata.md", "c/+audio metadata.md"],
  "case-differing claims must fold onto one key"
);

// A linked row's term is the link's DISPLAY text, not the target file name.
// [[+audio metadata|Metadata]] surfaces as "Metadata".
const displayText = "Metadata";
const claimants = owners.get(foldName(displayText));
assert.ok(claimants && claimants.length >= 2, "the display text resolves to the collision");

// The row is marked only when some OTHER file also claims the term.
const resolved = "c/+audio metadata.md";
const others = claimants!.filter((p) => p !== resolved);
assert.deepStrictEqual(others, ["c/+Metadata.md"], "the competing file is named");

// Keying with toLowerCase alone, the first bug, still works here but breaks on
// accents. This is why the fold has to be shared, not reimplemented.
assert.notStrictEqual(
  "Musique concrète".toLowerCase(),
  foldName("Musique concrète"),
  "toLowerCase and foldName disagree on accents, so a mixed pair misses silently"
);

// A term only one file claims is never marked.
add("oscilloscope", "c/+oscilloscope.md");
assert.strictEqual((owners.get("oscilloscope") ?? []).length, 1);

console.log("collision: all assertions passed");
