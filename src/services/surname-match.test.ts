/**
 * Check second-reference surname matching: once a person's full name is present
 * in a note, a later bare surname counts as a mention of them. Evidence is
 * per-note, so nothing leaks into notes that never introduced the person.
 *
 * Mirrors addSurnameMatches, which needs an App.
 *
 * Run: npx tsx src/services/surname-match.test.ts
 */
import * as assert from "assert";

/** Surnames that should match in this note, given who the note establishes. */
function surnamesFor(presentNames: string[]) {
  const byPart = new Map<string, string[]>();
  for (const name of presentNames) {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    for (const part of parts) {
      if (part.length < 3) continue;
      const key = part.toLowerCase();
      const list = byPart.get(key);
      if (list) {
        if (!list.includes(name)) list.push(name);
      } else byPart.set(key, [name]);
    }
  }
  // Every candidate surfaces, including shared parts: the row exists so the
  // ambiguity is visible, and linking it opens the picker.
  const out: { surname: string; person: string }[] = [];
  for (const [part, people] of byPart) {
    for (const person of people) {
      const term = person.trim().split(/\s+/).find((w) => w.toLowerCase() === part)!;
      out.push({ surname: term, person });
    }
  }
  return out;
}

// The case that motivated this: full name established, a bare part follows.
// BOTH parts resolve now: prose says "Dostoevsky" on second reference, and a
// note that established one Bill says "Bill".
{
  const r = surnamesFor(["Vladimir Dostoevsky"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname).sort(),
    ["Dostoevsky", "Vladimir"],
    "every part of an unambiguous name resolves"
  );
}

// Two people sharing a surname: "Boyd" surfaces for BOTH, so the ambiguity is
// visible and linking it offers a choice. Dropping it hid the mention entirely.
{
  const r = surnamesFor(["Blake Boyd", "Stowe Boyd"]);
  const boyds = r.filter((x) => x.surname === "Boyd").map((x) => x.person).sort();
  assert.deepStrictEqual(boyds, ["Blake Boyd", "Stowe Boyd"], "both candidates surface");
  assert.ok(r.some((x) => x.surname === "Blake"), "distinct first names still resolve");
}

// Three Sarahs: each surname resolves to one person, and "Sarah" surfaces as a
// three-way choice rather than a guess or a silent drop.
{
  const r = surnamesFor(["Sarah Cavanagh", "Sarah Elaine Eaton", "Sarah Schnitker"]);
  assert.strictEqual(r.filter((x) => x.surname === "Sarah").length, 3, "all three offered");
  for (const s of ["Cavanagh", "Eaton", "Schnitker"]) {
    assert.strictEqual(r.filter((x) => x.surname === s).length, 1, `${s} is unambiguous`);
  }
}

// A one-person note resolves every part of their name, middle names included.
{
  const r = surnamesFor(["Sarah Elaine Eaton"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname).sort(),
    ["Eaton", "Elaine", "Sarah"],
    "unambiguous here, so all parts resolve"
  );
}

// The motivating case: one Bill established, so a bare "Bill" is not a question.
{
  const r = surnamesFor(["Bill Viola"]);
  assert.ok(r.some((x) => x.surname === "Bill"), "first name resolves when unique in the note");
}

// Two Bills in one note: "Bill" surfaces for both, so linking it asks which.
{
  const r = surnamesFor(["Bill Viola", "Bill Whitlock"]);
  assert.strictEqual(r.filter((x) => x.surname === "Bill").length, 2, "both Bills offered");
  assert.ok(r.some((x) => x.surname === "Viola"), "distinct surnames still resolve");
}

// Single-word names have no separable surname.
{
  const r = surnamesFor(["Aristotle"]);
  assert.deepStrictEqual(r, [], "mononym contributes nothing");
}

// Short parts are skipped wherever they sit: a middle initial "S", a "Jr".
{
  const r = surnamesFor(["Harry S Truman"]);
  assert.deepStrictEqual(r.map((x) => x.surname).sort(), ["Harry", "Truman"], "initial skipped");
}
{
  const r = surnamesFor(["Wilson Pickett Jr"]);
  assert.ok(!r.some((x) => x.surname === "Jr"), "two-letter suffix not matched");
}

// Nobody established in the note means nothing to match.
assert.deepStrictEqual(surnamesFor([]), []);

// An ambiguous part doesn't disturb unrelated unambiguous ones.
{
  const r = surnamesFor(["Blake Boyd", "Stowe Boyd", "Vladimir Dostoevsky"]);
  assert.strictEqual(r.filter((x) => x.surname === "Boyd").length, 2, "Boyd is a choice");
  assert.strictEqual(r.filter((x) => x.surname === "Dostoevsky").length, 1, "unaffected");
}

console.log("surname second-reference matching: all assertions passed");

// ---- Never in both sections ----
// A file must appear under Linked OR Unlinked Mentions, never both. An
// already-linked person's bare surnames belong to their Linked row as unlinked
// occurrences, so the unlinked scan must skip them.

function unlinkedSurnameRows(presentNames: string[], linkedNames: string[]) {
  const linked = new Set(linkedNames);
  return surnamesFor(presentNames).filter((r) => !linked.has(r.person));
}

// The reported case: both people linked by full name, surnames used later.
{
  const present = ["Pierre Schaeffer", "Pierre Henry"];
  const r = unlinkedSurnameRows(present, present);
  assert.deepStrictEqual(r, [], "linked people produce no unlinked surname rows");
}

// A person mentioned but NOT linked still gets unlinked rows, including their
// half of a shared part. The linked Pierre is visible in Linked Mentions, so
// the shared "Pierre" row is a suggestion the reader has context to judge.
{
  const r = unlinkedSurnameRows(["Pierre Schaeffer", "Pierre Henry"], ["Pierre Schaeffer"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname).sort(),
    ["Henry", "Pierre"],
    "only the unlinked person's rows surface"
  );
  assert.ok(r.every((x) => x.person === "Pierre Henry"), "no rows for the linked person");
}

// A linked person still establishes the note, so a part shared with an unlinked
// person stays ambiguous rather than being attributed to the wrong one.
{
  const r = unlinkedSurnameRows(["Blake Boyd", "Stowe Boyd"], ["Blake Boyd"]);
  // Blake is linked, so his rows are excluded from Unlinked Mentions; Stowe
  // isn't, so his stay, including his half of the shared "Boyd".
  assert.deepStrictEqual(
    r.map((x) => x.surname).sort(),
    ["Boyd", "Stowe"],
    "only the unlinked person's rows remain"
  );
}

// The exclusion is for the SIDEBAR only. The link commands ask what a word
// means, and there a linked person's surname must still resolve, or linking it
// offers to create a new file instead.
function surnamesForLinking(presentNames: string[], linkedNames: string[]) {
  // excludeLinked=false: linked people keep their surname rows.
  void linkedNames;
  return surnamesFor(presentNames);
}

{
  const present = ["Pierre Schaeffer", "Pierre Henry"];
  const forSidebar = unlinkedSurnameRows(present, present);
  const forLinking = surnamesForLinking(present, present);
  assert.deepStrictEqual(forSidebar, [], "sidebar: no duplicate rows");
  assert.ok(
    forLinking.some((r) => r.surname === "Schaeffer"),
    "linking: a linked person's surname still resolves"
  );
  assert.strictEqual(
    forLinking.filter((r) => r.surname === "Pierre").length,
    2,
    "linking: a shared first name offers both, rather than resolving to one"
  );
}

console.log("linked/unlinked exclusivity: all assertions passed");
