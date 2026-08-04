/**
 * Check the domain picker's name grouping: one row per unique domain name, with
 * the folders retained so a name carried by several files can be flagged.
 * Mirrors the constructor's grouping (which needs an App, so the logic is
 * replicated here against the same shapes).
 *
 * Run: npx tsx src/ui/domain-picker-modal.test.ts
 */
import * as assert from "assert";

type FakeFile = { basename: string; parent: { path: string } | null };

/** The grouping under test, extracted from DomainPickerModal's constructor. */
function groupByName(files: FakeFile[], prefix: string) {
  const byName = new Map<string, string[]>();
  for (const f of files) {
    if (!f.basename.startsWith(prefix)) continue;
    const name = f.basename.slice(prefix.length);
    const folder = f.parent?.path ?? "/";
    const folders = byName.get(name);
    if (folders) folders.push(folder);
    else byName.set(name, [folder]);
  }
  return byName;
}

const PREFIX = "≈";

// The reported bug: two ≈AI files in different folders produced two identical rows.
const files: FakeFile[] = [
  { basename: "≈AI", parent: { path: "Work" } },
  { basename: "≈AI", parent: { path: "Research" } },
  { basename: "≈biology", parent: { path: "Work" } },
  { basename: "≈philosophy", parent: { path: "Work" } },
  { basename: "≈philosophy", parent: { path: "Archive" } },
  { basename: "+not a domain", parent: { path: "Work" } },
  { basename: "≈root", parent: null },
];

/** Folder scoping: the configured domain folder wins; no folder scans the vault. */
function scopedNames(
  files: { basename: string; path: string; parent: { path: string } | null }[],
  prefix: string,
  folder: string
) {
  const scope = folder.trim();
  return files
    .filter((f) => f.basename.startsWith(prefix))
    .filter((f) => (scope ? f.path.startsWith(scope + "/") : true))
    .map((f) => f.basename.slice(prefix.length));
}

{
  const withPaths = [
    { basename: "≈AI", path: "Domains/≈AI.md", parent: { path: "Domains" } },
    { basename: "≈AI", path: "Archive/≈AI.md", parent: { path: "Archive" } },
    { basename: "≈biology", path: "Domains/≈biology.md", parent: { path: "Domains" } },
    { basename: "+concept", path: "Domains/+concept.md", parent: { path: "Domains" } },
  ];

  // Folder configured: the stray copy outside it is not offered.
  assert.deepStrictEqual(
    scopedNames(withPaths, "≈", "Domains").sort(),
    ["AI", "biology"],
    "folder set: only files in that folder"
  );

  // No folder configured: fall back to scanning the whole vault by prefix.
  assert.deepStrictEqual(
    scopedNames(withPaths, "≈", "").sort(),
    ["AI", "AI", "biology"],
    "no folder set: whole vault by prefix"
  );
}

const grouped = groupByName(files, PREFIX);
const names = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

// One row per unique name, not one per file.
assert.deepStrictEqual(names, ["AI", "biology", "philosophy", "root"]);

// Duplicates keep every folder so the collision can be surfaced.
assert.deepStrictEqual(grouped.get("AI"), ["Work", "Research"]);
assert.deepStrictEqual(grouped.get("philosophy"), ["Work", "Archive"]);

// A name carried by a single file is not flagged.
assert.strictEqual(grouped.get("biology")?.length, 1);

// Non-domain files are excluded entirely.
assert.strictEqual(grouped.has("not a domain"), false);

// A file at the vault root still groups, under "/".
assert.deepStrictEqual(grouped.get("root"), ["/"]);

console.log("domain-picker grouping: all assertions passed");
