/**
 * Check misplaced-file detection: a taxa file counts as misplaced only when its
 * taxon has a folder configured and the file isn't in it. Mirrors
 * findMisplacedTaxaFiles, which needs an App.
 *
 * Run: npx tsx src/services/misplaced.test.ts
 */
import * as assert from "assert";

type Taxon = { prefix: string; label: string; folder: string };
type FakeFile = { basename: string; name: string; parent: { path: string } | null };

function findMisplaced(files: FakeFile[], taxa: Taxon[], existingPaths: Set<string>) {
  const scoped = taxa.filter((t) => t.folder?.trim());
  if (scoped.length === 0) return [];

  const out: { name: string; from: string; to: string; blocked: boolean }[] = [];
  for (const file of files) {
    const taxon = [...scoped]
      .sort((a, b) => b.prefix.length - a.prefix.length)
      .find((t) => file.basename.startsWith(t.prefix));
    if (!taxon) continue;

    const target = taxon.folder.trim();
    const current = file.parent?.path ?? "/";
    if (current === target) continue;

    out.push({
      name: file.basename,
      from: current,
      to: target,
      blocked: existingPaths.has(`${target}/${file.name}`),
    });
  }
  return out;
}

const f = (basename: string, folder: string | null): FakeFile => ({
  basename,
  name: `${basename}.md`,
  parent: folder === null ? null : { path: folder },
});

const TAXA: Taxon[] = [
  { prefix: "@", label: "People", folder: "People" },
  { prefix: "+", label: "Concepts", folder: "Concepts" },
  { prefix: "≈", label: "Domains", folder: "Domains" },
];

// A file outside its taxon's folder is misplaced; one inside it is not.
{
  const r = findMisplaced(
    [f("@Ada Lovelace", "Inbox"), f("@Alan Turing", "People"), f("+entropy", "Concepts")],
    TAXA,
    new Set()
  );
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0], { name: "@Ada Lovelace", from: "Inbox", to: "People", blocked: false });
}

// A file at the vault root is misplaced too (root is not the taxon folder).
{
  const r = findMisplaced([f("≈AI", null)], TAXA, new Set());
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].from, "/");
}

// Collision: a file already sits at the target path, so the move is blocked.
{
  const r = findMisplaced([f("@Ada Lovelace", "Inbox")], TAXA, new Set(["People/@Ada Lovelace.md"]));
  assert.strictEqual(r[0].blocked, true, "existing target file blocks the move");
}

// A taxon with no folder configured has no target, so nothing is misplaced.
{
  const noFolder: Taxon[] = [{ prefix: "@", label: "People", folder: "" }];
  const r = findMisplaced([f("@Ada Lovelace", "Inbox")], noFolder, new Set());
  assert.deepStrictEqual(r, [], "unconfigured taxon yields no misplaced files");
}

// Non-taxa files are ignored entirely.
{
  const r = findMisplaced([f("Meeting notes", "Inbox")], TAXA, new Set());
  assert.deepStrictEqual(r, []);
}

// Longest prefix wins, so a multi-char prefix isn't shadowed by a shorter one
// that happens to be its first character.
{
  const overlapping: Taxon[] = [
    { prefix: "+", label: "Concepts", folder: "Concepts" },
    { prefix: "++", label: "Meta", folder: "Meta" },
  ];
  const r = findMisplaced([f("++framework", "Inbox")], overlapping, new Set());
  assert.strictEqual(r[0].to, "Meta", "longest matching prefix picks the taxon");
}

console.log("misplaced-file detection: all assertions passed");

// ---- Duplicate detection ----

function findDuplicates(files: (FakeFile & { path: string })[], taxa: Taxon[]) {
  const sorted = [...taxa].sort((a, b) => b.prefix.length - a.prefix.length);
  const byName = new Map<string, { taxon: Taxon; files: (FakeFile & { path: string })[] }>();
  for (const file of files) {
    const taxon = sorted.find((t) => t.prefix && file.basename.startsWith(t.prefix));
    if (!taxon) continue;
    const e = byName.get(file.basename);
    if (e) e.files.push(file);
    else byName.set(file.basename, { taxon, files: [file] });
  }
  const out: { name: string; count: number; canonical: string | null }[] = [];
  for (const [name, { taxon, files: fs }] of byName) {
    if (fs.length < 2) continue;
    const folder = taxon.folder?.trim();
    const inFolder = folder ? fs.filter((f) => f.parent?.path === folder) : [];
    out.push({ name, count: fs.length, canonical: inFolder.length === 1 ? inFolder[0].path : null });
  }
  return out;
}

const p = (basename: string, folder: string): FakeFile & { path: string } => ({
  basename,
  name: `${basename}.md`,
  parent: { path: folder },
  path: `${folder}/${basename}.md`,
});

// The reported bug: two ≈AI files in different folders.
{
  const r = findDuplicates([p("≈AI", "Domains"), p("≈AI", "Archive"), p("≈biology", "Domains")], TAXA);
  assert.strictEqual(r.length, 1, "one duplicated name");
  assert.strictEqual(r[0].name, "≈AI");
  assert.strictEqual(r[0].count, 2);
  // Exactly one copy is in the taxon folder, so it is the canonical keeper.
  assert.strictEqual(r[0].canonical, "Domains/≈AI.md");
}

// Neither copy is in the taxon folder: no canonical answer to offer.
{
  const r = findDuplicates([p("≈AI", "Archive"), p("≈AI", "Inbox")], TAXA);
  assert.strictEqual(r[0].canonical, null, "no copy in the taxon folder");
}

// Both in the taxon folder is impossible on a filesystem, but if the data ever
// says so, don't guess a canonical.
{
  const r = findDuplicates([p("≈AI", "Domains"), { ...p("≈AI", "Domains"), path: "Domains/≈AI 1.md" }], TAXA);
  assert.strictEqual(r[0].canonical, null, "ambiguous: two in the folder");
}

// Unique names are not reported.
{
  const r = findDuplicates([p("≈AI", "Domains"), p("≈biology", "Domains")], TAXA);
  assert.deepStrictEqual(r, []);
}

// Non-taxa files with the same name are ignored: this checks taxa only.
{
  const r = findDuplicates([p("Untitled", "A"), p("Untitled", "B")], TAXA);
  assert.deepStrictEqual(r, [], "non-taxa duplicates are out of scope");
}

console.log("duplicate-name detection: all assertions passed");

// ---- Folded duplicate detection ----
// Names that differ only by case or accents are the same concept written two
// ways, and a link can only reach one of the files.

function foldName(name: string): string {
  return name.normalize("NFD").replace(/\p{Mn}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function foldedDuplicates(basenames: string[]) {
  const byKey = new Map<string, string[]>();
  for (const b of basenames) {
    const k = foldName(b);
    const g = byKey.get(k);
    if (g) g.push(b);
    else byKey.set(k, [b]);
  }
  return [...byKey.values()].filter((g) => g.length > 1);
}

// The reported case: capital M and an accented e, one concept.
{
  const r = foldedDuplicates(["+Musique concrete", "+musique concrète"]);
  assert.strictEqual(r.length, 1, "case + accent difference is one duplicate group");
  assert.strictEqual(r[0].length, 2);
}

// Case alone.
assert.strictEqual(foldedDuplicates(["@Ada Lovelace", "@ada lovelace"]).length, 1);

// Accent alone.
assert.strictEqual(foldedDuplicates(["©Orphee", "©Orphée"]).length, 1);

// Genuinely different names stay separate.
assert.deepStrictEqual(foldedDuplicates(["+delay", "+reverb"]), []);

// Exact duplicates still group (the pre-existing behavior must not regress).
assert.strictEqual(foldedDuplicates(["©The Wild Bull", "©The Wild Bull"]).length, 1);

console.log("folded duplicate detection: all assertions passed");
