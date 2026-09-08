/**
 * The section answers one question: which documents relate to this concept that
 * the reader has NOT already connected. So a document that links the concept is
 * excluded (it is a backlink, and the sidebar lists those separately) while a
 * document that merely shares vocabulary is exactly what belongs here.
 *
 * Run: npx tsx src/services/index/related-docs.test.ts
 */
import * as assert from "assert";
import { rankRelatedDocs, DEFAULT_RELATED } from "./related-docs";
import { buildSignatures, NoteWords } from "./signatures";

const CONCEPT = "c/+parenting.md";
const VOCAB = ["approval", "boundaries", "tantrum", "bedtime", "toddler"];

// A corpus where the concept is linked from some notes, mentioned in others,
// and a third group shares its vocabulary without naming it.
const notes: NoteWords[] = [];
const linked: string[] = [];
for (let i = 0; i < 8; i++) {
  const p = `linked/n${i}.md`;
  linked.push(p);
  notes.push({ path: p, words: new Set([...VOCAB, `body${i}`]) });
}
// Shares the vocabulary, never links or mentions the concept.
notes.push({ path: "unnamed/a.md", words: new Set([...VOCAB, "extra"]) });
// Shares nothing.
notes.push({ path: "unrelated/b.md", words: new Set(["wavelength", "hertz", "diaphragm"]) });
for (let i = 0; i < 200; i++) {
  notes.push({ path: `filler/f${i}.md`, words: new Set(["the", `topic${i % 40}`]) });
}

const signatures = buildSignatures(notes, new Map([[CONCEPT, linked]]));
assert.ok(signatures.byPath.get(CONCEPT), "fixture builds a signature");

const noteWords = new Map(notes.map((n) => [n.path, n.words]));
const linkSets = new Map<string, Set<string>>(linked.map((p) => [p, new Set([CONCEPT])]));
// One note mentions the concept without linking it.
const mentionSets = new Map<string, Set<string>>([["mentions/m.md", new Set([CONCEPT])]]);

const ranked = rankRelatedDocs(CONCEPT, mentionSets, linkSets, signatures, noteWords);
const at = (p: string) => ranked.findIndex((r) => r.path === p);

// A document the user already linked is a backlink, not a discovery. Listing it
// answered a question nobody asked and pushed out the answers to the one they
// did: two sources on entirely different subjects appeared as "related" because
// each independently linked the open file.
assert.ok(ranked.length > 0, "something ranks");
assert.ok(
  ranked.every((r) => !r.linked),
  "a document that links this concept is not offered as related to it"
);
assert.strictEqual(at(linked[0]), -1, "specifically, the linked documents are absent");

// The capability that does not exist without signatures: a document that never
// names the concept still appears.
assert.ok(at("unnamed/a.md") >= 0, "a document sharing only vocabulary is ranked");
assert.ok(
  ranked[at("unnamed/a.md")].matched.length >= DEFAULT_RELATED.minSignatureWords,
  "and it reports the words that put it there"
);

// A document with nothing in common must not appear at all.
assert.strictEqual(at("unrelated/b.md"), -1, "an unrelated document is not ranked");
assert.strictEqual(at("filler/f0.md"), -1, "filler is not ranked");

// A mention stays: a document that names the term without linking it is the
// unlinked relationship this list exists to surface.
assert.ok(at("mentions/m.md") >= 0, "a mentioning document is ranked");

// A concept with no signature still ranks its links and mentions rather than
// returning nothing: an absent signal contributes zero, never a penalty.
const noSig = rankRelatedDocs(
  "c/+unknown.md",
  new Map([["m.md", new Set(["c/+unknown.md"])]]),
  new Map([["l.md", new Set(["c/+unknown.md"])]]),
  { byPath: new Map(), inverted: new Map(), thin: [] },
  noteWords
);
assert.strictEqual(noSig.length, 1, "the mention ranks without a signature");
assert.strictEqual(noSig[0].path, "m.md", "and the linked document stays out");

// A concept nothing points at ranks nothing, and does not throw.
const empty = rankRelatedDocs("c/+nothing.md", new Map(), new Map(), signatures, noteWords);
assert.strictEqual(empty.length, 0, "an unused concept ranks nothing");

// The limit is honoured, and it caps what remains after the linked documents
// are excluded rather than before.
const capped = rankRelatedDocs(CONCEPT, mentionSets, linkSets, signatures, noteWords, {
  ...DEFAULT_RELATED,
  limit: 1,
});
assert.strictEqual(capped.length, 1, "the limit caps the list");
assert.ok(capped.every((r) => !r.linked), "and it never fills the cap with backlinks");

// The finding that shaped this. Linked documents also score well on vocabulary,
// since the signature was learned partly from them, so in one list they take
// every slot at any weighting: measured on the reference vault, at a signature
// weight of 30 exactly one unlinked document reached the top eight for "+phase".
// Reserving slots for them was the first answer; excluding them is the right
// one, because the backlink section already lists them.
{
  // The corpus has to be large enough that the concept's vocabulary is still
  // unusual against the notes that resemble its training set. With 28 linked
  // notes and 200 filler ones, "approval" is ordinary among the peers and the
  // signature correctly empties, which is the peer baseline working rather
  // than a ranking bug.
  const many: NoteWords[] = [];
  const manyLinked: string[] = [];
  for (let i = 0; i < 28; i++) {
    const p = `more/linked${i}.md`;
    manyLinked.push(p);
    many.push({ path: p, words: new Set([...VOCAB, `x${i}`]) });
  }
  many.push({ path: "hidden/gem.md", words: new Set([...VOCAB, "unnoticed"]) });
  for (let i = 0; i < 900; i++) {
    many.push({ path: `bulk/b${i}.md`, words: new Set([`w${i % 200}`, `v${i % 130}`]) });
  }
  const sig2 = buildSignatures(many, new Map([[CONCEPT, manyLinked]]));
  const words2 = new Map(many.map((n) => [n.path, n.words]));
  const links2 = new Map<string, Set<string>>(manyLinked.map((p) => [p, new Set([CONCEPT])]));
  const r = rankRelatedDocs(CONCEPT, new Map(), links2, sig2, words2, {
    ...DEFAULT_RELATED,
    limit: 9,
  });
  assert.ok(
    r.some((d) => d.path === "hidden/gem.md"),
    "an unlinked document appears even when 28 linked ones would have crowded it out"
  );
  assert.ok(
    r.every((d) => !d.linked),
    "and none of those 28 take a slot, because the backlink list already has them"
  );
}

// A taxa file is not a document. "@Becky Kennedy relates to +personal
// boundary" is a link between concepts; "@Becky Kennedy is discussed in 19.188"
// is a source about her. The first version ranked both in one list, so a
// concept was offered as though it were a document.
{
  // Mentions rather than links, since a linked file is now excluded outright
  // and this is about how the rows that remain are classified.
  const mentions = new Map<string, Set<string>>([
    ["10-19/concept/+boundary.md", new Set([CONCEPT])],
    ["19 Sources/19.1 interview.md", new Set([CONCEPT])],
  ]);
  const r = rankRelatedDocs(CONCEPT, mentions, new Map(), signatures, noteWords, {
    ...DEFAULT_RELATED,
    taxaFolders: ["10-19/concept"],
  });
  const kind = (p: string) => r.find((d) => d.path === p)?.kind;
  assert.strictEqual(kind("10-19/concept/+boundary.md"), "taxa", "a file in a taxa folder is taxa");
  assert.strictEqual(kind("19 Sources/19.1 interview.md"), "document", "anything else is a document");
}

// Documents can be scoped to chosen folders; taxa never are, since the taxa
// layer is the vault's own vocabulary and needs no scoping.
{
  // Mentions, for the same reason as above.
  const mentions = new Map<string, Set<string>>([
    ["10-19/concept/+boundary.md", new Set([CONCEPT])],
    ["19 Sources/19.1 interview.md", new Set([CONCEPT])],
    ["session-logs/2026-01-01.md", new Set([CONCEPT])],
  ]);
  const r = rankRelatedDocs(CONCEPT, mentions, new Map(), signatures, noteWords, {
    ...DEFAULT_RELATED,
    taxaFolders: ["10-19/concept"],
    documentFolders: ["19 Sources"],
  });
  const paths = r.map((d) => d.path);
  assert.ok(paths.includes("19 Sources/19.1 interview.md"), "a document in scope is ranked");
  assert.ok(!paths.includes("session-logs/2026-01-01.md"), "a document out of scope is not");
  assert.ok(paths.includes("10-19/concept/+boundary.md"), "taxa are ranked regardless of scope");
}

console.log("related-docs.test.ts: all assertions passed");

// --- a bare mention of a common word is not evidence ---
//
// A mention created a row with no further test. That is right for a term nobody
// writes by accident and close to meaningless for one they do: "+phase" is in
// 15.9% of the reference vault, so "this document says phase" ranked an
// interview about recovery ("the early phase of recovery") and an essay on AI
// ("mature past this phase") beside a mastering source.
{
  const AMB = "c/+phase.md";
  const mentions = new Map<string, Set<string>>([
    ["docs/ordinary-english.md", new Set([AMB])],
    ["docs/really-about-it.md", new Set([AMB])],
  ]);
  // Only the second shares the concept's vocabulary.
  const notes: NoteWords[] = [];
  const trained: string[] = [];
  for (let i = 0; i < 6; i++) {
    const p = `train/${i}.md`;
    notes.push({ path: p, words: new Set(["wavelength", "harmonic", "cancellation", "waveform", "hertz", "polarity"]) });
    trained.push(p);
  }
  for (let i = 0; i < 300; i++) notes.push({ path: `pad/${i}.md`, words: new Set([`pad${i}`]) });
  notes.push({ path: "docs/ordinary-english.md", words: new Set(["recovery", "boundary", "parent"]) });
  notes.push({
    path: "docs/really-about-it.md",
    words: new Set(["wavelength", "harmonic", "cancellation", "waveform", "hertz", "polarity"]),
  });
  const sig = buildSignatures(notes, new Map([[AMB, trained]]));
  const words = new Map(notes.map((n) => [n.path, n.words]));

  // Without the ambiguity hint, both rank: this is how it behaved before. The
  // training notes rank too, on their own vocabulary, so this asks about the
  // two documents rather than the length of the list.
  const blind = rankRelatedDocs(AMB, mentions, new Map(), sig, words).map((r) => r.path);
  assert.ok(blind.includes("docs/ordinary-english.md"), "a bare mention ranks when ambiguity is unknown");
  assert.ok(blind.includes("docs/really-about-it.md"));

  // Told the term is in 16% of notes, the bare mention has to bring more.
  const judged = rankRelatedDocs(AMB, mentions, new Map(), sig, words, DEFAULT_RELATED, {
    df: 1532,
    noteCount: 9649,
  });
  const paths = judged.map((r) => r.path);
  assert.ok(
    !paths.includes("docs/ordinary-english.md"),
    "a bare mention of a common word is dropped"
  );
  assert.ok(
    paths.includes("docs/really-about-it.md"),
    "a mention backed by the concept's vocabulary survives"
  );

  // A RARE term keeps its bare mentions: nobody writes "convolution reverb" by
  // accident, and asking it for corroboration would hide real relationships.
  const rare = rankRelatedDocs(AMB, mentions, new Map(), sig, words, DEFAULT_RELATED, {
    df: 30,
    noteCount: 9649,
  }).map((r) => r.path);
  assert.ok(
    rare.includes("docs/ordinary-english.md"),
    "a rare term keeps its bare mentions: nobody writes it by accident"
  );
}

console.log("related-docs: ambiguous-mention assertions passed");

// --- a concept with no signature is not penalised for silence ---
//
// A taxa file is not required to say anything: its job is to show where a
// concept appears, and many are deliberately a name and a set of backlinks. A
// concept too thinly linked to have learned any vocabulary has produced no
// evidence against a document either, so demanding corroboration from it would
// silence the thinnest files hardest, which is backwards. Measured on the
// reference vault, 13 of the 22 files the ambiguity rule can reach have no
// signature at all.
{
  const BARE = "c/+interface.md";
  const mentions = new Map<string, Set<string>>([["docs/a.md", new Set([BARE])]]);
  const notes: NoteWords[] = [
    { path: "docs/a.md", words: new Set(["screen", "button", "layout"]) },
  ];
  for (let i = 0; i < 300; i++) notes.push({ path: `pad/${i}.md`, words: new Set([`pad${i}`]) });
  const words = new Map(notes.map((n) => [n.path, n.words]));
  // Two links is below minLinkedNotes, so no signature is built.
  const noSignature = buildSignatures(notes, new Map([[BARE, ["pad/0.md", "pad/1.md"]]]));
  assert.strictEqual(noSignature.byPath.has(BARE), false, "fixture: no signature exists");

  const ranked = rankRelatedDocs(BARE, mentions, new Map(), noSignature, words, DEFAULT_RELATED, {
    // Well above the ambiguity bar: the rule would apply if it could.
    df: 573,
    noteCount: 9649,
  });
  assert.ok(
    ranked.some((r) => r.path === "docs/a.md"),
    "an absent signature contributes zero rather than a penalty"
  );
}

console.log("related-docs: absent-signature assertions passed");
