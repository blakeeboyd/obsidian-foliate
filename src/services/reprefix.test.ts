/**
 * Planning a bulk prefix change, and the cases where it must refuse.
 *
 * The assertions that matter are the refusals. A rename onto an existing file
 * destroys it, and Obsidian will not stop us, so a collision has to be found
 * here and reported rather than attempted. Everything else is arithmetic.
 *
 * Run: npx tsx src/services/reprefix.test.ts
 */
import * as assert from "assert";
import { planReprefix, staleAliases } from "./reprefix";

type Fake = { basename: string; extension: string; path: string; parent: { path: string } | null };
const f = (path: string): Fake => {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return {
    basename: name.slice(0, dot),
    extension: name.slice(dot + 1),
    path,
    parent: { path: slash === -1 ? "/" : path.slice(0, slash) },
  };
};
// The planner reads only these four fields, so a fake file is enough and the
// test needs no Obsidian runtime.
const plan = (files: Fake[], from: string, to: string, existing: string[] = []) =>
  planReprefix(files as never, from, to, new Set(existing));

// The ordinary case: every file keeps its folder and changes one character.
{
  const r = plan([f("concept/+economics.md"), f("concept/+phase.md")], "+", "≈");
  assert.strictEqual(r.planned.length, 2);
  assert.strictEqual(r.blocked.length, 0);
  assert.strictEqual(r.planned[0].to, "concept/≈economics.md");
  assert.strictEqual(r.planned[1].to, "concept/≈phase.md");
}

// Files without the old prefix are not touched, whatever else they are.
{
  const r = plan([f("concept/+economics.md"), f("people/@Ada.md"), f("daily/2026-09-09.md")], "+", "≈");
  assert.strictEqual(r.planned.length, 1);
  assert.strictEqual(r.planned[0].from, "concept/+economics.md");
}

// A target that already exists on disk: renaming onto it would destroy it.
{
  const r = plan([f("concept/+economics.md")], "+", "≈", ["concept/≈economics.md"]);
  assert.strictEqual(r.planned.length, 0);
  assert.strictEqual(r.blocked.length, 1);
  assert.strictEqual(r.blocked[0].blocked, "collision");
}

// Two files in the SAME batch claiming one target. The second is invisible to
// an on-disk check, because the first has not been written yet when we plan.
{
  const r = plan([f("a/+x.md"), f("a/+x.md")], "+", "≈");
  assert.strictEqual(r.planned.length, 1);
  assert.strictEqual(r.blocked.length, 1);
}

// Root-level files have no folder to preserve and must not gain a leading slash.
{
  const r = plan([f("+economics.md")], "+", "≈");
  assert.strictEqual(r.planned[0].to, "≈economics.md");
}

// A no-op change is nothing to do, not a vault-wide collision against itself.
{
  assert.strictEqual(plan([f("c/+x.md")], "+", "+").planned.length, 0);
  assert.strictEqual(plan([f("c/+x.md")], "+", "+").blocked.length, 0);
  assert.strictEqual(plan([f("c/+x.md")], "", "≈").planned.length, 0);
}

// Aliases still spelling the old prefix survive renameFile and go stale.
{
  const aliases = new Map([
    ["c/+economics.md", ["+economics", "economics"]],
    ["c/+phase.md", ["phase"]],
  ]);
  const stale = staleAliases(aliases, ["c/+economics.md", "c/+phase.md"], "+");
  assert.strictEqual(stale.length, 1);
  assert.deepStrictEqual(stale[0].aliases, ["+economics"]);
}

console.log("reprefix.test.ts: all assertions passed");
