/**
 * Does widening `signatureFolders` beyond the knowledge folders help or hurt?
 *
 * Answered 2026-09-08, and the answer is hurt. Adding `40-49_Projects/44 AI
 * Skills` (658 concept-analysis files) measured MRR 0.2896 to 0.2135 and top-1
 * 17.5% to 11.7% over 120 folds, both arms serving all 120. Recorded as
 * closed-negative in 43.10.107.
 *
 * Worth keeping because the idea recurs: two thirds of taxa files are too
 * thinly linked to produce a signature, and the analyses that discuss those
 * concepts are RIGHT THERE, outside scope. Coverage does rise, 963 signatures
 * to 1433, and the resulting signatures LOOK better. "+phase" goes from
 * "tuning 2.42, phase 1.91" to "in-phase 4.17, spl 2.71, wavelength 2.59",
 * which reads as a fix and is not one: that is the vocabulary of the textbook
 * chapters ABOUT phase, and 52 of them swamp the 8 notes the vault wrote
 * itself. Every audio concept converges on a shared textbook-acoustics
 * register, so the signatures discriminate less while looking more expert.
 *
 * The lesson is the method, not the setting. Inspecting a signature's top words
 * cannot tell you whether it discriminates, because a plausible word list is
 * exactly what a shared register produces. Only rank measures that. Probing for
 * named boilerplate ("osc", "bloom", the OSC address fragments) found none
 * leaking and was the wrong test for the same reason: it rules out the register
 * words you thought of, not register.
 *
 * Method: leave-one-out. For each concept, hide one note that links it, rank
 * every signature against that note's words, report where the concept lands.
 * Both arms are evaluated on the BASELINE's concept set, which is the
 * measurement trap 43.10.107 records: a variant serving fewer concepts
 * otherwise scores higher for having dropped the hard ones. Here the wide arm
 * serves every baseline fold, so the comparison is honest and it simply loses.
 *
 * Costs a full signature rebuild per fold per arm, so it is minutes, not
 * seconds: ~57 min for 120 folds on this vault. FOLDS caps the sample.
 *
 * Run: FOLDS=120 npx tsx measure-scope.ts
 */
import * as fs from "fs";
import * as path from "path";
import { buildSignatures, scoreNote, DEFAULT_SIGNATURES, NoteWords } from "./src/services/index/signatures";
import { noteWordCounts } from "./src/services/index/scan";

// The reference vault by default; FOLIATE_VAULT points it elsewhere, matching
// the deploy script's variable.
const VAULT = process.env.FOLIATE_VAULT ?? "/Users/harrisgb/Documents/Obsidian/EtchedInterim";
// The arms. BASE is what the plugin ships with here; ADD is the folder under
// test, so the next scope question needs no edit to this file.
const BASE = (process.env.BASE ?? "10-19_Knowledge").split(",").filter(Boolean);
const ADD = (process.env.ADD ?? "40-49_Projects/44 AI Skills").split(",").filter(Boolean);
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
console.log(`vault: ${files.length} markdown files`);

// basename -> full relative path, for resolving [[wikilinks]]
const byBasename = new Map<string, string>();
const rel = (p: string) => path.relative(VAULT, p);
for (const f of files) {
  const base = path.basename(f, ".md");
  if (!byBasename.has(base)) byBasename.set(base, rel(f));
}

const isTaxa = (relPath: string) => TAXA_PREFIXES.some((p) => path.basename(relPath).startsWith(p));

// Read every file once: its words, and the taxa it links.
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

function run(label: string, scopes: string[]) {
  const scoped = notes.filter((n) => inScope(n.path, scopes));
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
  return { label, scopes, scoped, linkedBy, noteWordsList, cf, sigs };
}

// Leave-one-out over a fixed set of (concept, heldOutNote) folds.
function evaluate(arm: ReturnType<typeof run>, folds: [string, string][]) {
  let rr = 0, top1 = 0, served = 0;
  for (const [concept, held] of folds) {
    const linking = (arm.linkedBy.get(concept) ?? []).filter((p) => p !== held);
    if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes) continue; // cannot serve this fold
    const trainLinked = new Map(arm.linkedBy);
    trainLinked.set(concept, linking);
    // Retrain without the held-out note present at all.
    const trainNotes = arm.noteWordsList.filter((n) => n.path !== held);
    const s = buildSignatures(trainNotes, trainLinked, DEFAULT_SIGNATURES, arm.cf);
    const note = arm.scoped.find((n) => n.path === held);
    if (!note) continue;
    const hits = scoreNote(note.words, s, 3);
    const rank = hits.findIndex((h) => h.path === concept) + 1;
    served++;
    if (rank > 0) { rr += 1 / rank; if (rank === 1) top1++; }
  }
  return { served, mrr: served ? rr / served : 0, top1: served ? top1 / served : 0 };
}

const base = run(`baseline ${BASE.join(", ")}`, BASE);
const wide = run(`wide +${ADD.join(", ")}`, [...BASE, ...ADD]);

console.log(`\nsignatures built: baseline ${base.sigs.byPath.size}, wide ${wide.sigs.byPath.size}`);
console.log(`thin (had links, no signature): baseline ${base.sigs.thin.length}, wide ${wide.sigs.thin.length}`);

// Folds come from the BASELINE's concepts only, so the wide arm is charged for
// every concept the baseline could serve and gets no credit for new ones.
const folds: [string, string][] = [];
for (const concept of base.sigs.byPath.keys()) {
  const linking = base.linkedBy.get(concept) ?? [];
  if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes + 1) continue;
  folds.push([concept, linking[0]]); // deterministic: first linking note
}
// Deterministic sample: a full retrain per fold over ~5k notes is hours.
const SAMPLE = Number(process.env.FOLDS ?? 120);
folds.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = folds.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [folds[i], folds[j]] = [folds[j], folds[i]]; }
const sample = folds.slice(0, SAMPLE);
console.log(`folds available: ${folds.length}, evaluating ${sample.length}`);

const rb = evaluate(base, sample);
const rw = evaluate(wide, sample);
console.log(`\n${"arm".padEnd(28)} served   MRR     top-1`);
for (const [l, r] of [["baseline", rb], ["wide (+44)", rw]] as const) {
  console.log(`${l.padEnd(28)} ${String(r.served).padStart(5)}  ${r.mrr.toFixed(4)}  ${(r.top1 * 100).toFixed(1)}%`);
}
