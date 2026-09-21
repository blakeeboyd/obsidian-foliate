/**
 * Does a two-stage retriever beat either scorer alone?
 *
 * measure-embed.ts found the two methods tie on MRR and signatures win top-1,
 * which reads as "embeddings lose" and is the wrong reading. The rank
 * distribution says what is actually happening:
 *
 *   recall@1 13.0%   @3 35.5%   @5 51.5%   @10 68.5%   @20 83.5%   @50 93.0%
 *   median rank 5 of 722
 *   median cosine gap between top-1 and the correct concept: 0.0835
 *
 * The model narrows 722 concepts to a handful that nearly always contains the
 * right one, then cannot order the last few: the gap between the winner and
 * the correct answer is a rounding error. That is a recall engine with a
 * precision problem, and signatures are a precision engine with a coverage
 * problem (986 of 3242 taxa). They fail in opposite directions.
 *
 * So: embeddings propose, signatures dispose. Take the embedding top-K, rerank
 * that shortlist with the lexical scorer, report top-1.
 *
 * ANSWERED 2026-09-21, and the answer is no. 200 folds:
 *
 *   signature (full)   MRR 0.3255   top-1 20.0%   <- best top-1
 *   embed (full)       MRR 0.3060   top-1 13.5%
 *   rerank@5           MRR 0.3029   top-1 16.5%
 *   rerank@10          MRR 0.3397   top-1 19.0%   <- best MRR
 *   rerank@20          MRR 0.3263   top-1 17.0%
 *   rerank@50          MRR 0.3236   top-1 17.5%
 *
 * Every rerank variant loses to the signature arm on top-1. rerank@10 wins MRR
 * by 0.014, which at 200 folds is not a result worth a pipeline.
 *
 * The recall ceiling says why: @5 53.5%, @10 69.0%, @20 79.0%, @50 89.5%. At
 * K=10 the correct concept is ABSENT from the shortlist 31% of the time, and
 * no reranker recovers a candidate it was never handed. Scoring the full 986
 * never has that problem. Shortlisting throws away more than reranking gains,
 * and raising K to keep recall gives the reranker back the field it started
 * with, which is just the signature arm with extra steps.
 *
 * The backoff arm scored identically to strict at every K, which is correct
 * and uninformative: folds are built from concepts that HAVE signatures, so
 * nothing ever backs off. It would only differ on the 2184 concepts that hold
 * no signature, and those cannot appear in these folds by construction.
 *
 * What survives is not a ranking result. 986 concepts have signatures, 3158
 * have vectors, and 2184 can be ranked by embedding alone. For those 2184 the
 * comparison is not "embeddings versus signatures" but "embeddings versus
 * nothing", which is the only place a second scorer earns its keep here.
 *
 * Arms:
 *   signature      full-field lexical, the 16.7% top-1 baseline
 *   embed          full-field cosine, the 13.3% baseline
 *   rerank@K       embedding top-K, reordered by signature score
 *   rerank@K+back  same, but concepts with NO signature keep their embedding
 *                  rank rather than dropping out. This is the arm that matters
 *                  for shipping: 2184 concepts hold no signature, and an arm
 *                  that silently drops them is measuring a vault that does not
 *                  exist.
 *
 * Folds and metric are measure-embed.ts's, so numbers compare directly.
 *
 * Run: FOLDS=200 npx tsx measure-rerank.ts
 */
import * as fs from "fs";
import * as path from "path";
import { buildSignatures, scoreNote, DEFAULT_SIGNATURES, NoteWords } from "./src/services/index/signatures";
import { noteWordCounts } from "./src/services/index/scan";

const VAULT = process.env.FOLIATE_VAULT ?? "/Users/harrisgb/Documents/Obsidian/EtchedInterim";
const BASE = (process.env.BASE ?? "10-19_Knowledge").split(",").filter(Boolean);
const INDEX =
  process.env.EMBED_INDEX ??
  path.join(VAULT, ".obsidian/plugins/obsidian-vault-mcp/embeddings.jsonl");
const TAXA_PREFIXES = ["@", "º", "~", "©", "+", "∞", "•", "≈", "¡", "◊"];
const DIM = 384;
const KS = (process.env.KS ?? "5,10,20,50").split(",").map(Number);

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
console.log(`signatures built: ${sigs.byPath.size}`);

// ---------------------------------------------------------------- embeddings

function meanUnit(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const sum = new Float32Array(DIM);
  for (const v of vectors) for (let i = 0; i < DIM; i++) sum[i] += v[i];
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = sum[i] / norm;
  return out;
}
function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

const idxByPath = new Map<string, Float32Array[]>();
{
  const raw = fs.readFileSync(INDEX, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: { p: string; v: string };
    try { o = JSON.parse(line); } catch { continue; }
    const buf = Buffer.from(o.v, "base64");
    const owned = new Float32Array(new Float32Array(buf.buffer, buf.byteOffset, DIM));
    let l = idxByPath.get(o.p);
    if (!l) idxByPath.set(o.p, (l = []));
    l.push(owned);
  }
}
const noteVecs = new Map<string, Float32Array>();
for (const [p, vecs] of idxByPath) {
  const v = meanUnit(vecs);
  if (v) noteVecs.set(p, v);
}

// ---------------------------------------------------------------- folds

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

// Candidates: every concept the signature arm knows. Both arms rank the same
// field, so neither is credited for serving a smaller one.
const candidates = [...sigs.byPath.keys()];
const candVecs: [string, Float32Array][] = [];
for (const c of candidates) {
  const v = noteVecs.get(c);
  if (v) candVecs.push([c, v]);
}
console.log(`candidates: ${candidates.length}, with vectors: ${candVecs.length}`);

// ---------------------------------------------------------------- arms

interface Res { served: number; mrr: number; top1: number }
const acc = () => ({ rr: 0, t1: 0, n: 0 });
const fin = (a: { rr: number; t1: number; n: number }): Res =>
  ({ served: a.n, mrr: a.n ? a.rr / a.n : 0, top1: a.n ? a.t1 / a.n : 0 });

const aSig = acc();
const aEmb = acc();
const aRe: Record<number, ReturnType<typeof acc>> = {};
const aReB: Record<number, ReturnType<typeof acc>> = {};
for (const k of KS) { aRe[k] = acc(); aReB[k] = acc(); }

for (const [concept, held] of sample) {
  const linking = (linkedBy.get(concept) ?? []).filter((p) => p !== held);
  if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes) continue;

  // Retrain without the held-out note, exactly as the other harnesses do.
  const trainLinked = new Map(linkedBy);
  trainLinked.set(concept, linking);
  const trainNotes = noteWordsList.filter((n) => n.path !== held);
  const s = buildSignatures(trainNotes, trainLinked, DEFAULT_SIGNATURES, cf);
  const note = scoped.find((n) => n.path === held);
  if (!note) continue;

  // --- signature, full field
  const sigHits = scoreNote(note.words, s, 3);
  const sigRank = sigHits.findIndex((h) => h.path === concept) + 1;
  aSig.n++;
  if (sigRank > 0) { aSig.rr += 1 / sigRank; if (sigRank === 1) aSig.t1++; }

  // --- embedding, full field
  const q = noteVecs.get(held);
  if (!q) continue;
  const embScored: [string, number][] = [];
  for (const [c, v] of candVecs) embScored.push([c, cosine(q, v)]);
  embScored.sort((a, b) => b[1] - a[1]);
  const embRank = embScored.findIndex(([c]) => c === concept) + 1;
  aEmb.n++;
  if (embRank > 0) { aEmb.rr += 1 / embRank; if (embRank === 1) aEmb.t1++; }

  // --- rerank: take the embedding top-K, reorder by signature score
  const sigScore = new Map<string, number>();
  for (const h of sigHits) sigScore.set(h.path, h.score);

  for (const k of KS) {
    const shortlist = embScored.slice(0, k);

    // Strict: a concept with no signature score falls to the bottom. This is
    // the arm that flatters reranking, because on these folds every concept
    // HAS a signature by construction.
    const strict = [...shortlist].sort(
      (x, y) => (sigScore.get(y[0]) ?? -1) - (sigScore.get(x[0]) ?? -1)
    );
    const rs = strict.findIndex(([c]) => c === concept) + 1;
    aRe[k].n++;
    if (rs > 0) { aRe[k].rr += 1 / rs; if (rs === 1) aRe[k].t1++; }

    // Backoff: no signature means keep the embedding position. Ranks the
    // shortlist by signature where one exists and by cosine where it does
    // not, which is what shipping would actually do given 2184 concepts
    // have no signature at all.
    const backoff = [...shortlist]
      .map(([c, cos], i) => ({ c, cos, i, sig: sigScore.get(c) }))
      .sort((x, y) => {
        const xs = x.sig !== undefined, ys = y.sig !== undefined;
        if (xs && ys) return (y.sig as number) - (x.sig as number);
        if (xs !== ys) return xs ? -1 : 1;   // scored beats unscored
        return x.i - y.i;                    // both unscored: embedding order
      });
    const rb = backoff.findIndex((e) => e.c === concept) + 1;
    aReB[k].n++;
    if (rb > 0) { aReB[k].rr += 1 / rb; if (rb === 1) aReB[k].t1++; }
  }
}

// ---------------------------------------------------------------- report

const rows: [string, Res][] = [
  ["signature (full)", fin(aSig)],
  ["embed (full)", fin(aEmb)],
];
for (const k of KS) rows.push([`rerank@${k}`, fin(aRe[k])]);
for (const k of KS) rows.push([`rerank@${k} backoff`, fin(aReB[k])]);

console.log(`\n${"arm".padEnd(22)} served   MRR     top-1`);
for (const [l, r] of rows) {
  console.log(`${l.padEnd(22)} ${String(r.served).padStart(5)}  ${r.mrr.toFixed(4)}  ${(r.top1 * 100).toFixed(1)}%`);
}

// Ceiling: how often is the right concept in the embedding top-K at all? No
// reranker can beat this, so it bounds what stage 2 could ever deliver.
console.log(`\nembedding recall (the rerank ceiling):`);
for (const k of KS) {
  let hit = 0, n = 0;
  for (const [concept, held] of sample) {
    const q = noteVecs.get(held);
    if (!q) continue;
    const sc: [string, number][] = [];
    for (const [c, v] of candVecs) sc.push([c, cosine(q, v)]);
    sc.sort((a, b) => b[1] - a[1]);
    n++;
    if (sc.slice(0, k).some(([c]) => c === concept)) hit++;
  }
  console.log(`  recall@${String(k).padEnd(3)} ${(hit / n * 100).toFixed(1)}%`);
}
