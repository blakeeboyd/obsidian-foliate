/**
 * A signature is learned from the user's own links, so a wrong one is learned
 * silently and never announces itself. These assertions pin what the feature
 * exists to do (recognise a concept in a note that never names it) and the
 * cases where it must refuse to answer.
 *
 * Run: npx tsx src/services/index/signatures.test.ts
 */
import * as assert from "assert";
import { buildSignatures, scoreNote, NoteWords } from "./signatures";

const notes: NoteWords[] = [];
function note(path: string, words: string[]): string {
  notes.push({ path, words: new Set(words) });
  return path;
}

// Two worlds plus filler, so a topic word is genuinely over-represented in its
// own notes rather than merely present in a small corpus.
const AUDIO = ["wavelength", "loudspeaker", "frequencies", "hertz", "diaphragm"];
const PARENTING = ["approval", "boundaries", "tantrum", "bedtime", "toddler"];

const audioNotes: string[] = [];
for (let i = 0; i < 12; i++) {
  audioNotes.push(note(`audio/note${i}.md`, [...AUDIO, "the", "and", `unique${i}`]));
}
const parentNotes: string[] = [];
for (let i = 0; i < 12; i++) {
  parentNotes.push(note(`family/note${i}.md`, [...PARENTING, "the", "and", `other${i}`]));
}
for (let i = 0; i < 300; i++) {
  note(`filler/f${i}.md`, ["the", "and", `filler${i % 60}`]);
}

const sigs = buildSignatures(
  notes,
  new Map([
    ["c/+phase.md", audioNotes],
    ["c/+parenting.md", parentNotes],
  ])
);

// The vault is its own stopword list: a word counts only in proportion to how
// much MORE it appears near the concept than it does generally, so the words
// that are everywhere fall out with no word list involved.
const phase = sigs.byPath.get("c/+phase.md");
assert.ok(phase, "a concept with 12 linked notes gets a signature");
assert.ok(phase!.has("wavelength"), "over-represented topic words are kept");
assert.ok(!phase!.has("the"), "words that are everywhere carry no lift");
assert.ok(!phase!.has("approval"), "the other world's vocabulary stays out");

// The whole point of the feature. Word matching cannot do this.
const unnamed = new Set(["approval", "boundaries", "tantrum", "unrelated"]);
const hits = scoreNote(unnamed, sigs);
assert.strictEqual(hits[0]?.path, "c/+parenting.md", "signature fires without the name present");
assert.ok(hits[0].matched.length >= 3, "the matching words are reported for the readout");
assert.ok(
  !hits.some((h) => h.path === "c/+phase.md"),
  "an unrelated concept does not fire on the same note"
);

// One shared word is a coincidence. Highly-linked concepts share vocabulary, so
// a single hit has to mean nothing.
const oneWord = scoreNote(new Set(["wavelength", "nothing", "else"]), sigs);
assert.strictEqual(oneWord.length, 0, "a single signature word does not fire a concept");

// Below the evidence floor there is nothing to learn, and a guess is worse than
// silence: insufficient evidence reads as no information, never as a weak
// answer. The same rule the gate follows.
const thinSigs = buildSignatures(notes, new Map([["c/+thin.md", [audioNotes[0], audioNotes[1]]]]));
assert.strictEqual(thinSigs.byPath.size, 0, "two linked notes are too few to build a signature");
assert.deepStrictEqual(thinSigs.thin, ["c/+thin.md"], "and the file is reported as thin");

// A word appearing twice in the whole vault has an enormous lift wherever it
// lands, which is the rare-pair inflation NPMI suffers from and the reason
// evidence floors exist at all.
const rare: NoteWords[] = [];
for (let i = 0; i < 6; i++) rare.push({ path: `r/n${i}.md`, words: new Set(["shared", `hapax${i}`]) });
for (let i = 0; i < 200; i++) rare.push({ path: `r/f${i}.md`, words: new Set(["the"]) });
const rareSig = buildSignatures(rare, new Map([["c/+r.md", rare.slice(0, 6).map((n) => n.path)]]));
assert.ok(
  !rareSig.byPath.get("c/+r.md")?.has("hapax0"),
  "a word too rare vault-wide cannot enter a signature"
);

// Absence of the signal reads as no information, never as evidence against.
const empty = buildSignatures([], new Map([["c/+a.md", ["x.md"]]]));
assert.strictEqual(empty.byPath.size, 0, "an empty corpus produces no signatures and does not throw");
assert.strictEqual(scoreNote(new Set(["anything"]), empty).length, 0, "and nothing scores");

// Function words have real lift in a vault whose subject matter is narrow:
// measured, "she" is in 3.9% of notes but 44% of one writer's, which is
// arithmetically over-represented and says nothing. Specificity is the second
// requirement, and IDF is what measures it.
const pronouny: NoteWords[] = [];
for (let i = 0; i < 20; i++) {
  pronouny.push({ path: `w/n${i}.md`, words: new Set(["she", "her", "nurturance", `body${i}`]) });
}
// "she"/"her" are moderately common vault-wide; "nurturance" is not.
for (let i = 0; i < 120; i++) {
  pronouny.push({ path: `w/f${i}.md`, words: new Set(["she", "her", `topic${i % 30}`]) });
}
for (let i = 0; i < 400; i++) {
  pronouny.push({ path: `w/x${i}.md`, words: new Set([`other${i % 80}`]) });
}
const pronounSig = buildSignatures(
  pronouny,
  new Map([["c/+writer.md", pronouny.slice(0, 20).map((n) => n.path)]])
);
const writer = pronounSig.byPath.get("c/+writer.md");
assert.ok(writer, "the concept still gets a signature");
assert.ok(writer!.has("nurturance"), "a specific word survives");
assert.ok(!writer!.has("she"), "a word too common to be informative is dropped despite its lift");

console.log("signatures.test.ts: all assertions passed");
