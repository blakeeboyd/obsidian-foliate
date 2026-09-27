/**
 * R5: can a concept's OWN body seed a signature where too few notes link it?
 *
 * The standing position is that a taxa file's body is not where its value
 * lives: buildSignatures reads the notes that LINK a concept, never the
 * concept's own prose. That is an accurate description of the implementation,
 * never tested as a claim about what could work.
 *
 * The cross-tabulation makes it worth testing. Of 3,247 taxa in scope, 1,919
 * are WRITTEN (>=300 chars of body) and under-linked (<3 links), against 191
 * genuinely thin. The vocabulary a signature wants is largely already in the
 * vault, sitting in the one file the builder ignores.
 *
 * Three arms on the same folds:
 *
 *   links   the shipped scorer, trained on notes that link the concept
 *   body    trained on the concept's own file alone, nothing else
 *   both    trained on the linking notes plus the concept's own file
 *
 * The comparison is only honest on concepts that HAVE links to train from,
 * which is why all three run on the baseline's concept set. If `body`
 * approaches `links` there, the body carries signal and seeding the 1,919 is
 * worth building. If `both` beats `links`, the body adds signal even where
 * links exist.
 *
 * The failure to watch for is the register problem with a sample size of one.
 * A body is written in one voice on one day; link-trained signatures average
 * over many notes by construction. A self-description could be idiosyncratic
 * rather than representative, which is exactly how the scope experiment failed
 * (52 textbook chapters drowning 8 vault notes).
 *
 * Run: FOLDS=200 npx tsx measure-body.ts
 */
import * as fs from "fs";
import * as path from "path";
import { buildSignatures, scoreNote, DEFAULT_SIGNATURES, NoteWords } from "./src/services/index/signatures";
import { noteWordCounts } from "./src/services/index/scan";

const VAULT = process.env.FOLIATE_VAULT ?? "/Users/harrisgb/Documents/Obsidian/EtchedInterim";
const BASE = (process.env.BASE ?? "10-19_Knowledge").split(",").filter(Boolean);
const TAXA_PREFIXES = ["@", "º", "~", "©", "+", "∞", "•", "≈", "¡", "◊"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = walk(VAULT);
const rel = (p: string) => path.relative(VAULT, p);
const byBasename = new Map<string, string>();
for (const f of files) {
  const base = path.basename(f, ".md");
  if (!byBasename.has(base)) byBasename.set(base, rel(f));
}
const isTaxa = (relPath: string) => TAXA_PREFIXES.some((p) => path.basename(relPath).startsWith(p));

interface Note { path: string; words: Set<string>; counts: Map<string, number>; links: Set<string> }
const notes: Note[] = [];
const LINK_RE = /\[\[([^\]|#]+)(?:[^\]]*)?\]\]/g;
for (const f of files) {
  let text: string;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const counts = noteWordCounts(text);
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    const target = byBasename.get(m[1].trim());
    if (target && isTaxa(target)) links.add(target);
  }
  notes.push({ path: rel(f), words: new Set(counts.keys()), counts, links });
}

const inScope = (p: string, scopes: string[]) =>
  scopes.length === 0 || scopes.some((s) => p === s || p.startsWith(s + "/"));

const scoped = notes.filter((n) => inScope(n.path, BASE));
const linkedBy = new Map<string, string[]>();
for (const n of scoped) {
  for (const t of n.links) {
    if (t === n.path) continue;
    let l = linkedBy.get(t);
    if (!l) linkedBy.set(t, (l = []));
    l.push(n.path);
  }
}
const noteWordsList: NoteWords[] = scoped.map((n) => ({ path: n.path, words: n.words }));
const cf = new Map<string, number>();
for (const n of scoped) for (const [w, c] of n.counts) cf.set(w, (cf.get(w) ?? 0) + c);

const sigs = buildSignatures(noteWordsList, linkedBy, DEFAULT_SIGNATURES, cf);
console.log(`signatures built (links): ${sigs.byPath.size}`);

const folds: [string, string][] = [];
for (const concept of sigs.byPath.keys()) {
  const linking = linkedBy.get(concept) ?? [];
  if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes + 1) continue;
  folds.push([concept, linking[0]]);
}
folds.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = folds.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [folds[i], folds[j]] = [folds[j], folds[i]]; }
const sample = folds.slice(0, Number(process.env.FOLDS ?? 200));
console.log(`folds available: ${folds.length}, evaluating ${sample.length}`);

// minLinkedNotes is a floor on how many notes teach a concept. Seeding from a
// single file cannot clear a floor of 3, so the body arms relax it to 1. That
// is the change under test, not a thumb on the scale: the question is whether
// one self-authored document teaches as well as three linking notes.
// Two floors block a single-document arm, and the first run missed the second.
// minLinkedNotes gates how many notes must teach a concept. Separately,
// buildSignatures requires a word to appear in `max(minLocalNotes, ceil(n *
// minLocalShare))` training notes, and minLocalNotes defaults to 2: with one
// training note that floor can never be met, so EVERY word is rejected and the
// arm scored a clean 0.0000 MRR. That was a harness bug, not a finding.
//
// Lowering it removes a real protection rather than working around a technical
// limit: the floor is what stops one note's vocabulary becoming a signature.
// With it at 1 the IDF floor, the global-ratio cap and the peer baseline carry
// the whole load, which is precisely the thing under test.
const ONE = { ...DEFAULT_SIGNATURES, minLinkedNotes: 1, minLocalNotes: 1 };

interface Acc { rr: number; t1: number; n: number }
const acc = (): Acc => ({ rr: 0, t1: 0, n: 0 });
const report = (l: string, a: Acc) =>
  console.log(`${l.padEnd(22)} ${String(a.n).padStart(5)}  ${(a.n ? a.rr / a.n : 0).toFixed(4)}  ${(a.n ? a.t1 / a.n * 100 : 0).toFixed(1)}%`);

const aLinks = acc(), aBody = acc(), aBoth = acc();

for (const [concept, held] of sample) {
  const linking = (linkedBy.get(concept) ?? []).filter((p) => p !== held);
  if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes) continue;
  const note = scoped.find((n) => n.path === held);
  if (!note) continue;
  // The held-out note is removed from training in every arm.
  const trainNotes = noteWordsList.filter((n) => n.path !== held);

  // --- links: the shipped arm
  {
    const tl = new Map(linkedBy);
    tl.set(concept, linking);
    const s = buildSignatures(trainNotes, tl, DEFAULT_SIGNATURES, cf);
    const hits = scoreNote(note.words, s, 3);
    const r = hits.findIndex((h) => h.path === concept) + 1;
    aLinks.n++;
    if (r > 0) { aLinks.rr += 1 / r; if (r === 1) aLinks.t1++; }
  }

  // --- body: train every concept from its OWN file only
  {
    const tl = new Map<string, string[]>();
    for (const c of linkedBy.keys()) tl.set(c, [c]);
    const s = buildSignatures(trainNotes, tl, ONE, cf);
    const hits = scoreNote(note.words, s, 3);
    const r = hits.findIndex((h) => h.path === concept) + 1;
    aBody.n++;
    if (r > 0) { aBody.rr += 1 / r; if (r === 1) aBody.t1++; }
  }

  // --- both: linking notes plus the concept's own file
  {
    const tl = new Map<string, string[]>();
    for (const [c, l] of linkedBy) tl.set(c, [...l, c]);
    tl.set(concept, [...linking, concept]);
    const s = buildSignatures(trainNotes, tl, ONE, cf);
    const hits = scoreNote(note.words, s, 3);
    const r = hits.findIndex((h) => h.path === concept) + 1;
    aBoth.n++;
    if (r > 0) { aBoth.rr += 1 / r; if (r === 1) aBoth.t1++; }
  }
}

console.log(`\n${"arm".padEnd(22)} served   MRR     top-1`);
report("links (shipped)", aLinks);
report("body only", aBody);
report("links + body", aBoth);

// Coverage, the reason the question was asked. How many taxa would hold a
// signature if the body could seed one?
const bodyOnly = new Map<string, string[]>();
for (const n of scoped) if (isTaxa(n.path)) bodyOnly.set(n.path, [n.path]);
const sBody = buildSignatures(noteWordsList, bodyOnly, ONE, cf);
const taxaInScope = scoped.filter((n) => isTaxa(n.path)).length;
console.log(`\ncoverage on ${taxaInScope} taxa in scope:`);
console.log(`  link-trained signatures: ${sigs.byPath.size}`);
console.log(`  body-seeded signatures:  ${sBody.byPath.size}`);
const union = new Set([...sigs.byPath.keys(), ...sBody.byPath.keys()]);
console.log(`  union:                   ${union.size}`);
console.log(`  body-only (no link-trained signature): ${[...sBody.byPath.keys()].filter((p) => !sigs.byPath.has(p)).length}`);
