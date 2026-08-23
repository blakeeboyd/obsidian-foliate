/**
 * A signature is learned from the user's own links, so a wrong one is learned
 * silently and never announces itself. These assertions pin what the feature
 * exists to do (recognise a concept in a note that never names it) and the
 * cases where it must refuse to answer.
 *
 * Run: npx tsx src/services/index/signatures.test.ts
 */
import * as assert from "assert";
import { buildSignatures, scoreNote, NoteWords, DEFAULT_SIGNATURES } from "./signatures";

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

// The register problem. A concept whose notes are all one kind of document
// learns that document's habits: measured on the reference vault, an
// interviewee's signature was "let's, incredibly, anybody, beautiful". Those
// words are rare vault-wide, so lift and IDF both pass them; they are ordinary
// among TRANSCRIPTS, which is the population that reveals them.
const registerNotes: NoteWords[] = [];
const CHATTER = ["lets", "anybody", "everybody", "incredibly"];
// 60 transcript-like notes: all use the chatter, each on its own subject.
for (let i = 0; i < 60; i++) {
  registerNotes.push({ path: `t/n${i}.md`, words: new Set([...CHATTER, `topic${i}`, "interview"]) });
}
// One speaker's 12 notes are transcripts too, plus their actual subject.
const speaker: string[] = [];
for (let i = 0; i < 12; i++) {
  const p = `t/s${i}.md`;
  speaker.push(p);
  registerNotes.push({ path: p, words: new Set([...CHATTER, "interview", "gamification", "scoring", `s${i}`]) });
}
// A large non-transcript remainder, so the chatter is rare VAULT-wide and only
// the peer population can expose it.
for (let i = 0; i < 500; i++) {
  registerNotes.push({ path: `w/w${i}.md`, words: new Set(["writing", `word${i % 90}`]) });
}
const registerSig = buildSignatures(registerNotes, new Map([["c/+speaker.md", speaker]]));
const sp = registerSig.byPath.get("c/+speaker.md");
assert.ok(sp, "the concept gets a signature");
assert.ok(sp!.has("gamification"), "subject vocabulary survives");
assert.ok(
  !sp!.has("lets") && !sp!.has("anybody"),
  "words ordinary among the concept's own kind of document are not its signature"
);

console.log("signatures.test.ts: all assertions passed");

// --- cross-concept damping ---
//
// A word many unrelated concepts claim is abstract register, not subject
// vocabulary: measured on the reference vault, "operates" and "engagement" each
// sit in nine signatures. Damping demotes them without evicting them.
{
  // Six concepts share "operates"; each also has one word of its own. The
  // padding is what makes the case real rather than arithmetic: "operates" has
  // to be rare enough vault-wide to clear the IDF floor (or the existing
  // filters remove it and there is nothing left to demote) while still being
  // claimed by many concepts. That combination is exactly the register problem.
  const dampNotes: NoteWords[] = [];
  const linkedBy = new Map<string, string[]>();
  const subjects = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
  subjects.forEach((subject, i) => {
    const paths: string[] = [];
    for (let k = 0; k < 4; k++) {
      const path = `n/${subject}-${k}.md`;
      dampNotes.push({ path, words: new Set([subject, "operates", `filler${k}`]) });
      paths.push(path);
    }
    linkedBy.set(`c/+${subject}.md`, paths);
  });
  // 600 unrelated notes: "operates" lands at 24/624, an IDF of 3.3 that clears
  // the floor, and under the 25% global ratio cap.
  for (let k = 0; k < 600; k++) dampNotes.push({ path: `pad/${k}.md`, words: new Set([`pad${k}`]) });

  const undamped = buildSignatures(dampNotes, linkedBy, { ...DEFAULT_SIGNATURES, crossConceptDamping: 0 });
  const damped = buildSignatures(dampNotes, linkedBy, { ...DEFAULT_SIGNATURES, crossConceptDamping: 0.25 });

  const before = undamped.byPath.get("c/+alpha.md");
  const after = damped.byPath.get("c/+alpha.md");
  assert.ok(before && after, "the concept still gets a signature");
  // The fixture is only meaningful if the shared word got in at all.
  assert.ok(before.has("operates"), "fixture: the shared word must reach a signature");
  // Membership is untouched: the word earned its place against the vault.
  assert.strictEqual(after.has("operates"), true, "damping reorders, it never evicts");
  // The shared word is worth strictly less; the private one is not.
  assert.ok(
    after.get("operates")! < before.get("operates")!,
    "a word six concepts claim loses weight"
  );
  assert.strictEqual(
    after.get("alpha"),
    before.get("alpha"),
    "a word only this concept claims is untouched"
  );
  // The point of the exercise.
  assert.ok(
    after.get("alpha")! > after.get("operates")!,
    "subject vocabulary outranks register once damped"
  );
}

// --- burstiness: a word the notes keep returning to outranks one they mention ---
//
// Church & Gale (1995): a word whose documents are ABOUT it is repeated as the
// discussion elaborates, while a word belonging to the register of the writing
// is said once and moved past. Their pair is "boycott" against "somewhat", each
// around a thousand occurrences in one corpus, one clumped and one spread, with
// matching IDF. Presence-only counting cannot tell them apart, which is why the
// interviewee's signature read "let's, incredibly, anybody".
{
  const burstNotes: NoteWords[] = [];
  const linkedBy = new Map<string, string[]>();
  const paths: string[] = [];
  for (let k = 0; k < 5; k++) {
    const path = `n/talk-${k}.md`;
    // Both words appear in exactly the same notes, so document frequency,
    // IDF, local share and peer rate are all identical: burstiness is the only
    // thing that can separate them.
    burstNotes.push({ path, words: new Set(["profilicity", "anybody", `filler${k}`]) });
    paths.push(path);
  }
  for (let k = 0; k < 600; k++) burstNotes.push({ path: `pad/${k}.md`, words: new Set([`pad${k}`]) });
  linkedBy.set("c/+profilicity.md", paths);

  // The subject word is returned to; the register word is said once per note.
  const cf = new Map<string, number>([["profilicity", 40], ["anybody", 5]]);

  const flat = buildSignatures(burstNotes, linkedBy, { ...DEFAULT_SIGNATURES, burstiness: 0 }, cf);
  const weighted = buildSignatures(burstNotes, linkedBy, DEFAULT_SIGNATURES, cf);

  const before = flat.byPath.get("c/+profilicity.md");
  const after = weighted.byPath.get("c/+profilicity.md");
  assert.ok(before && after, "the concept gets a signature either way");
  // Identical inputs make them indistinguishable without the repeat rate.
  assert.strictEqual(
    before.get("profilicity"),
    before.get("anybody"),
    "fixture: without burstiness the two words are exactly tied"
  );
  assert.ok(
    after.get("profilicity")! > after.get("anybody")!,
    "a word the notes keep returning to outranks one they merely mention"
  );
  // Membership is untouched: this reorders, it never evicts.
  assert.strictEqual(after.has("anybody"), true, "burstiness demotes, it does not filter");

  // No collection frequency means no information, not a guess: signatures come
  // out exactly as they did before counting existed.
  const none = buildSignatures(burstNotes, linkedBy, DEFAULT_SIGNATURES);
  assert.strictEqual(
    none.byPath.get("c/+profilicity.md")!.get("profilicity"),
    before.get("profilicity"),
    "without counts the weighting is inert"
  );
}

console.log("signatures: burstiness assertions passed");
