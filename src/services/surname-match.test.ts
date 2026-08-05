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
  const bySurname = new Map<string, string[]>();
  for (const name of presentNames) {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const surname = parts[parts.length - 1];
    if (surname.length < 3) continue;
    const key = surname.toLowerCase();
    const list = bySurname.get(key);
    if (list) list.push(name);
    else bySurname.set(key, [name]);
  }
  const out: { surname: string; person: string }[] = [];
  for (const [, people] of bySurname) {
    if (people.length > 1) continue; // ambiguous here: skip, never guess
    const person = people[0];
    out.push({ surname: person.trim().split(/\s+/).pop()!, person });
  }
  return out;
}

// The case that motivated this: full name established, surname follows.
{
  const r = surnamesFor(["Vladimir Dostoevsky"]);
  assert.deepStrictEqual(r, [{ surname: "Dostoevsky", person: "Vladimir Dostoevsky" }]);
}

// Two people sharing a surname in one note: skipped rather than guessed.
{
  const r = surnamesFor(["Blake Boyd", "Stowe Boyd"]);
  assert.deepStrictEqual(r, [], "shared surname is ambiguous, so no match");
}

// Three Sarahs: surnames all differ, so each still resolves.
{
  const r = surnamesFor(["Sarah Cavanagh", "Sarah Elaine Eaton", "Sarah Schnitker"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname).sort(),
    ["Cavanagh", "Eaton", "Schnitker"],
    "distinct surnames each match; the shared FIRST name is never used"
  );
}

// A multi-part name uses only its last part, so "Elaine" never matches.
{
  const r = surnamesFor(["Sarah Elaine Eaton"]);
  assert.deepStrictEqual(r, [{ surname: "Eaton", person: "Sarah Elaine Eaton" }]);
}

// Single-word names have no separable surname.
{
  const r = surnamesFor(["Aristotle"]);
  assert.deepStrictEqual(r, [], "mononym contributes nothing");
}

// A middle initial doesn't interfere: the surname is still the last part.
{
  const r = surnamesFor(["Harry S Truman"]);
  assert.deepStrictEqual(r, [{ surname: "Truman", person: "Harry S Truman" }]);
}

// The length guard applies to the LAST part, so a trailing initial is skipped:
// "Ed" would otherwise match far too much prose.
{
  const r = surnamesFor(["Wilson Pickett Jr"]);
  assert.deepStrictEqual(r, [], "two-letter trailing part is not matched");
}

// Nobody established in the note means nothing to match.
assert.deepStrictEqual(surnamesFor([]), []);

// One ambiguous pair does not suppress an unrelated unambiguous person.
{
  const r = surnamesFor(["Blake Boyd", "Stowe Boyd", "Vladimir Dostoevsky"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname),
    ["Dostoevsky"],
    "only the ambiguous surname is dropped"
  );
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

// A person mentioned but NOT linked still gets an unlinked row.
{
  const r = unlinkedSurnameRows(["Pierre Schaeffer", "Pierre Henry"], ["Pierre Schaeffer"]);
  assert.deepStrictEqual(
    r.map((x) => x.surname),
    ["Henry"],
    "only the unlinked person surfaces under Unlinked Mentions"
  );
}

// A linked person still establishes the note, so an ambiguous surname shared
// with an unlinked person is skipped rather than attributed to the wrong one.
{
  const r = unlinkedSurnameRows(["Blake Boyd", "Stowe Boyd"], ["Blake Boyd"]);
  assert.deepStrictEqual(r, [], "shared surname stays ambiguous even when one is linked");
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
  assert.deepStrictEqual(
    forLinking.map((r) => r.surname).sort(),
    ["Henry", "Schaeffer"],
    "linking: a linked person's surname still resolves"
  );
}

console.log("linked/unlinked exclusivity: all assertions passed");
