/**
 * Check prefix detection: find conventions already in the vault, ignore noise.
 *
 * Thresholds come from real data. Scanning this vault turns up 3613 files
 * starting with "+", 1351 with "@", 161 with "©", 122 with "∞", 3 with "~",
 * and exactly one each starting with 📝, ✈ and a smart quote. Conventions and
 * accidents are separated by a wide gap, so the count threshold only has to
 * sit inside it.
 *
 * Run: npx tsx src/services/detect-taxa.test.ts
 */
import * as assert from "assert";

const NOT_A_PREFIX = new Set([
  ".", ",", "-", "_", "(", ")", "[", "]", "{", "}", "'", '"', "`",
  "!", "?", ";", ":", "/", "\\", "|", "*", "#", "$", "%", "^", "=",
  "<", ">", "“", "”", "‘", "’", " ",
]);
const MIN_FILES = 3;

interface Fake { basename: string; folder: string }

function detect(files: Fake[], configured: string[]) {
  const taken = new Set(configured.filter(Boolean));
  const byPrefix = new Map<string, Fake[]>();
  for (const f of files) {
    const first = [...f.basename][0];
    if (!first || taken.has(first)) continue;
    if (/[\p{L}\p{N}]/u.test(first)) continue;
    if (NOT_A_PREFIX.has(first)) continue;
    const list = byPrefix.get(first);
    if (list) list.push(f);
    else byPrefix.set(first, [f]);
  }
  const out: { prefix: string; fileCount: number; folder: string }[] = [];
  for (const [prefix, group] of byPrefix) {
    if (group.length < MIN_FILES) continue;
    out.push({ prefix, fileCount: group.length, folder: commonFolder(group) });
  }
  return out.sort((a, b) => b.fileCount - a.fileCount);
}

function commonFolder(files: Fake[]): string {
  let parts: string[] | null = null;
  for (const f of files) {
    const p = f.folder.split("/").filter(Boolean);
    if (parts === null) { parts = p; continue; }
    let i = 0;
    while (i < parts.length && i < p.length && parts[i] === p[i]) i++;
    parts = parts.slice(0, i);
    if (parts.length === 0) break;
  }
  return (parts ?? []).join("/");
}

const mk = (basename: string, folder: string): Fake => ({ basename, folder });

// A convention is found, with the folder its files share.
{
  const files = [
    mk("@Ada Lovelace", "people"), mk("@Alan Turing", "people"), mk("@Grace Hopper", "people"),
  ];
  const r = detect(files, []);
  assert.deepStrictEqual(r, [{ prefix: "@", fileCount: 3, folder: "people" }]);
}

// Real noise from this vault: one file each, below the threshold.
{
  const files = [
    mk("\u{1F4DD}_Log", "inbox"),        // daily-note emoji
    mk("✈ Travel", "notes"),         // stray symbol
    mk("“Quoted title", "notes"),    // smart quote from a title
  ];
  assert.deepStrictEqual(detect(files, []), [], "single-file symbols are not conventions");
}

// An emoji used consistently IS a convention: the rule is count, not category.
{
  const files = Array.from({ length: 5 }, (_, i) => mk(`\u{1F4DD}Note ${i}`, "logs"));
  const r = detect(files, []);
  assert.strictEqual(r[0].prefix, "\u{1F4DD}", "emoji surrogate pair kept whole");
  assert.strictEqual(r[0].fileCount, 5);
}

// Already-configured prefixes are current state, not a suggestion.
{
  const files = [mk("@A", "people"), mk("@B", "people"), mk("@C", "people")];
  assert.deepStrictEqual(detect(files, ["@"]), [], "configured prefix is not offered");
}

// Ordinary filenames never look like conventions.
{
  const files = [
    mk("Meeting notes", "notes"), mk("2026-08-07 daily", "journal"),
    mk("- dashed", "notes"), mk("(parenthetical)", "notes"), mk("_underscore", "notes"),
  ];
  assert.deepStrictEqual(detect(files, []), [], "letters, digits and punctuation excluded");
}

// The folder is the common ancestor, not the most populated one. Works files
// here span three subfolders and the answer that covers them is "works".
{
  const files = [
    mk("©A", "works/audio-engineering"),
    mk("©B", "works/audio-engineering"),
    mk("©C", "works/pedagogy"),
    mk("©D", "works/embodied-cognition"),
  ];
  assert.strictEqual(detect(files, [])[0].folder, "works");
}

// Files scattered with no shared parent yield the root, not a wrong guess.
{
  const files = [mk("§A", "one"), mk("§B", "two"), mk("§C", "three")];
  assert.strictEqual(detect(files, [])[0].folder, "", "no common folder");
}

// Strongest convention first.
{
  const files = [
    ...Array.from({ length: 10 }, (_, i) => mk(`+c${i}`, "concept")),
    ...Array.from({ length: 4 }, (_, i) => mk(`≈d${i}`, "domains")),
  ];
  assert.deepStrictEqual(detect(files, []).map((x) => x.prefix), ["+", "≈"]);
}

console.log("taxa prefix detection: all assertions passed");
