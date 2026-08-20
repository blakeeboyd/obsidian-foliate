/**
 * All-caps terms match only in all caps.
 *
 * The case that forced this: "+OCT array" carries the alias "OCT", a microphone
 * technique. A meeting note listing "Oct 25th" and "Oct 27th" surfaced it,
 * because case-insensitively the two are the same three letters. Capitalisation
 * is the only thing that separates them, and an acronym written in prose keeps
 * its capitals, so requiring them removes the class at no cost.
 *
 * Run: npx tsx src/services/acronym-case.test.ts
 */
import * as assert from "assert";
import { isAcronymTerm, findUnlinkedPositions, needsCapital } from "./unlinked-matcher";

// --- what counts as an acronym ---
{
  assert.strictEqual(isAcronymTerm("OCT"), true);
  assert.strictEqual(isAcronymTerm("MIDI"), true);
  assert.strictEqual(isAcronymTerm("DAW"), true);
  // Digits and punctuation carry no case; the letters decide.
  assert.strictEqual(isAcronymTerm("AES3"), true);
  assert.strictEqual(isAcronymTerm("MS/TRS"), true);
  // Ordinary words and names are not acronyms, however capitalised.
  assert.strictEqual(isAcronymTerm("Oct"), false);
  assert.strictEqual(isAcronymTerm("Delay"), false);
  assert.strictEqual(isAcronymTerm("Ada Lovelace"), false);
  assert.strictEqual(isAcronymTerm("phase"), false);
  // A single letter is below the floor, and a bare number has no letters.
  assert.strictEqual(isAcronymTerm("A"), false);
  assert.strictEqual(isAcronymTerm("5.1"), false);
}

// --- the OCT case, end to end ---
{
  const note = "Oct 25th - Quinn Carson\nOct 27th - Marina Crute";
  assert.deepStrictEqual(
    findUnlinkedPositions(note, "OCT", undefined, true),
    [],
    "a month abbreviation must not match a microphone array"
  );
  // And the real acronym still matches when actually written.
  const real = "We used an OCT array for the ensemble.";
  assert.strictEqual(findUnlinkedPositions(real, "OCT", undefined, true).length, 1);
}

// --- case-insensitive matching is unchanged for ordinary terms ---
{
  const note = "Discussion of Phase and phase cancellation.";
  assert.strictEqual(
    findUnlinkedPositions(note, "phase", undefined, false).length,
    2,
    "ordinary terms still match regardless of case"
  );
}

// --- an acronym inside a longer word is still not a match ---
{
  assert.deepStrictEqual(findUnlinkedPositions("OCTAGON shapes", "OCT", undefined, true), []);
}

// A Capitalised ordinary word only means itself when capitalised. "@Waves
// Audio" carries the alias "Waves", which matched "waves" in a note about
// sound waves. Measured on the reference vault: capitalised 53 times, lowercase
// 744.
{
  assert.ok(needsCapital("Waves"), "a Capitalised word needs its capital");
  assert.ok(needsCapital("Something"), "however common the word");
  assert.ok(!needsCapital("waves"), "a lowercase term does not");
  assert.ok(!needsCapital("Waves Audio"), "multi-word terms are unambiguous already");
  assert.ok(!needsCapital("OCT"), "all-caps is the acronym rule's job");
  assert.ok(!needsCapital("McCartney"), "an internal capital is not this shape");

  const text = "Sound waves travel. Waves Audio makes plugins. More waves here.";
  const strict = findUnlinkedPositions(text, "Waves", undefined, true);
  assert.strictEqual(strict.length, 1, "only the capitalised occurrence matches");
  assert.strictEqual(text.slice(strict[0], strict[0] + 5), "Waves");
  const loose = findUnlinkedPositions(text, "Waves", undefined, false);
  assert.strictEqual(loose.length, 3, "and case-insensitively it would take all three");
}

console.log("acronym-case: all assertions passed");
