/**
 * Check the duplicate-resolution sequence: trash the losers, then move the
 * keeper into the taxon folder. The ORDER is the thing under test. Trashing
 * first frees the target path, so a keeper moving into the folder doesn't
 * collide with a copy that was sitting there.
 *
 * Mirrors ResolveDuplicateModal.resolve, which needs an App.
 *
 * Run: npx tsx src/services/resolve-duplicate.test.ts
 */
import * as assert from "assert";

type File = { path: string; name: string; folder: string };

/** The resolve sequence, with a fake vault recording what happened. */
function resolve(files: File[], keeperPath: string, taxonFolder: string) {
  const present = new Map(files.map((f) => [f.path, f]));
  const trashed: string[] = [];
  const moves: { from: string; to: string }[] = [];
  let blocked = false;

  const keeper = present.get(keeperPath)!;

  // 1. Trash every other copy first.
  for (const f of files) {
    if (f.path === keeperPath) continue;
    present.delete(f.path);
    trashed.push(f.path);
  }

  // 2. Move the keeper into the taxon folder if it isn't already there.
  let finalPath = keeper.path;
  if (taxonFolder && keeper.folder !== taxonFolder) {
    const target = `${taxonFolder}/${keeper.name}`;
    if (present.has(target)) {
      blocked = true;
    } else {
      present.delete(keeper.path);
      present.set(target, { ...keeper, path: target, folder: taxonFolder });
      moves.push({ from: keeper.path, to: target });
      finalPath = target;
    }
  }

  return { trashed, moves, blocked, finalPath, remaining: [...present.keys()] };
}

const mk = (folder: string, name = "≈AI.md"): File => ({
  path: `${folder}/${name}`,
  name,
  folder,
});

// Keeper is the stray copy; the one already in the folder is trashed, which
// frees the path so the keeper can move in. This is why order matters: doing
// the move first would collide.
{
  const r = resolve([mk("Domains"), mk("Archive")], "Archive/≈AI.md", "Domains");
  assert.deepStrictEqual(r.trashed, ["Domains/≈AI.md"]);
  assert.deepStrictEqual(r.moves, [{ from: "Archive/≈AI.md", to: "Domains/≈AI.md" }]);
  assert.strictEqual(r.blocked, false, "target freed by the trash step");
  assert.deepStrictEqual(r.remaining, ["Domains/≈AI.md"], "one file survives, in the folder");
}

// Keeper is already in the taxon folder: trash the other, move nothing.
{
  const r = resolve([mk("Domains"), mk("Archive")], "Domains/≈AI.md", "Domains");
  assert.deepStrictEqual(r.trashed, ["Archive/≈AI.md"]);
  assert.deepStrictEqual(r.moves, [], "no move needed");
  assert.deepStrictEqual(r.remaining, ["Domains/≈AI.md"]);
}

// Three copies: all non-keepers are trashed.
{
  const r = resolve([mk("Domains"), mk("Archive"), mk("Inbox")], "Inbox/≈AI.md", "Domains");
  assert.strictEqual(r.trashed.length, 2);
  assert.strictEqual(r.finalPath, "Domains/≈AI.md");
  assert.deepStrictEqual(r.remaining, ["Domains/≈AI.md"], "exactly one file left");
}

// No taxon folder configured: trash the losers, leave the keeper where it is.
{
  const r = resolve([mk("Archive"), mk("Inbox")], "Archive/≈AI.md", "");
  assert.deepStrictEqual(r.trashed, ["Inbox/≈AI.md"]);
  assert.deepStrictEqual(r.moves, []);
  assert.strictEqual(r.finalPath, "Archive/≈AI.md", "keeper stays put with no folder set");
}

// Post-condition across every case: the name is no longer ambiguous.
for (const keeper of ["Domains/≈AI.md", "Archive/≈AI.md"]) {
  const r = resolve([mk("Domains"), mk("Archive")], keeper, "Domains");
  assert.strictEqual(r.remaining.length, 1, `one file remains when keeping ${keeper}`);
}

console.log("duplicate resolution sequence: all assertions passed");
