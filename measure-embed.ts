/**
 * Do embeddings rank concepts better than lexical signatures?
 *
 * Same question `measure-scope.ts` asks of a folder, asked of the scorer. The
 * signature arm is reproduced here exactly (same folds, same metric, same
 * leave-one-out retrain) so the two numbers are comparable; the embedding arm
 * swaps bag-of-words scoring for cosine over the vault MCP plugin's existing
 * index. Nothing is embedded here: `embeddings.jsonl` is already on disk,
 * built by TaylorAI/bge-micro-v2 at 384 dims, L2-normalized at write time.
 *
 * Why this is worth measuring rather than assuming. Embeddings should win on
 * recall: a note about "cancellation when two mics hear the same source"
 * scores near zero against "+phase" lexically unless it says "phase", and a
 * concept with no inbound links has no signature at all. They may well LOSE on
 * precision among near neighbours, which is what this metric measures: "+phase",
 * "+polarity" and "+comb filtering" sit in one small neighbourhood that a
 * general-purpose model has no reason to separate, while a signature trained on
 * this vault's own usage might.
 *
 * RESULT, 120 folds, 2026-09-18:
 *
 *   arm          served   MRR     top-1
 *   signature      120   0.3046   16.7%
 *   embed          120   0.3079   13.3%
 *
 * A tie on MRR (1% relative, inside noise at this fold count) and a signature
 * win on top-1. Read that as: the model reliably puts the right concept in the
 * neighbourhood but is worse at the last step of discrimination, which is the
 * near-neighbour compression predicted above. "+phase", "+phase shift",
 * "+phase cancellation" and "+comb filtering" all score within 0.06 of each
 * other on a phase note; a signature trained on this vault's own usage picks
 * between them slightly better.
 *
 * The coverage line is the finding, not the MRR:
 *
 *   taxa in scope 3242, with signature 986, with vector 3158
 *   vector but no signature: 2184.   neither: 72.
 *
 * 3.2x the concepts rankable, at equal average rank quality. "+phase" is in
 * that gap, which is what the scope experiment was trying and failing to fix.
 *
 * ON THE PATH-PREFIX CONFOUND. The indexer prepends the file path to every
 * chunk before embedding (semantic.ts chunkMarkdown), so a concept's vector
 * encodes the literal string "10-19_Knowledge/concept/+phase.md" and could
 * match on FILENAME rather than meaning. Testing this properly needs
 * re-embedding without the prefix, which needs the model; measured instead
 * against the existing index two ways:
 *
 *   - Holding content similarity constant (bucketed by content-word Jaccard),
 *     filename word overlap is worth +0.074 cosine on average, peaking at
 *     +0.13. That is large: the whole 1st-to-50th spread on a real query is
 *     about 0.11.
 *   - But on 40 real query notes, only 10% of top-1 hits shared a word with
 *     the QUERY's filename, because query notes are rarely named after the
 *     concept they discuss.
 *
 * So the confound is strong per-pair and weak in aggregate here. It inflates
 * the embed arm somewhat and the true embed MRR is likely a little below
 * 0.3079, which only widens the signature top-1 win. It does not touch the
 * coverage result at all.
 *
 * Folds come from the SIGNATURE arm's concepts, the trap 43.10.107 records: an
 * arm serving fewer concepts otherwise scores higher for having dropped the
 * hard ones. Embeddings can serve concepts that hold no signature at all, and
 * that coverage gain is reported separately rather than folded into MRR.
 *
 * Leakage: a concept's vector is its own file's text, so the held-out note
 * never trains it and no retrain is needed. That makes this arm much faster
 * than the signature arm, which rebuilds every fold.
 *
 * Run: FOLDS=120 npx tsx measure-embed.ts
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

// ---------------------------------------------------------------- signatures

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

// ---------------------------------------------------------------- embeddings

/** Mean-pool a file's chunk vectors and L2-renormalize, as the plugin does. */
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

/** Chunk vectors are unit-length, so cosine is a bare dot product. */
function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

function loadIndex(file: string): Map<string, Float32Array[]> {
  const byPath = new Map<string, Float32Array[]>();
  const raw = fs.readFileSync(file, "utf8");
  let n = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: { p: string; c: number; v: string };
    try { o = JSON.parse(line); } catch { continue; }
    const buf = Buffer.from(o.v, "base64");
    const vec = new Float32Array(buf.buffer, buf.byteOffset, DIM);
    // Copy: the Buffer's memory is reused across iterations otherwise.
    const owned = new Float32Array(vec);
    let l = byPath.get(o.p);
    if (!l) byPath.set(o.p, (l = []));
    l.push(owned);
    n++;
  }
  console.log(`embedding index: ${n} chunks over ${byPath.size} files`);
  return byPath;
}

// ---------------------------------------------------------------- evaluation

type Fold = [string, string];

function evalSignature(arm: ReturnType<typeof run>, folds: Fold[]) {
  let rr = 0, top1 = 0, served = 0;
  for (const [concept, held] of folds) {
    const linking = (arm.linkedBy.get(concept) ?? []).filter((p) => p !== held);
    if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes) continue;
    const trainLinked = new Map(arm.linkedBy);
    trainLinked.set(concept, linking);
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

/**
 * Rank every candidate concept against the held-out note by cosine.
 *
 * `candidates` is fixed across folds so every fold ranks against the same
 * field, the way the signature arm ranks against every signature.
 */
function evalEmbed(
  noteVecs: Map<string, Float32Array>,
  conceptVecs: Map<string, Float32Array>,
  candidates: string[],
  folds: Fold[]
) {
  let rr = 0, top1 = 0, served = 0, missing = 0;
  for (const [concept, held] of folds) {
    const q = noteVecs.get(held);
    const target = conceptVecs.get(concept);
    if (!q || !target) { missing++; continue; }
    // Rank by counting how many candidates beat the target rather than
    // sorting: same rank, no allocation per fold.
    const targetScore = cosine(q, target);
    let better = 0;
    for (const c of candidates) {
      if (c === concept) continue;
      const v = conceptVecs.get(c);
      if (!v) continue;
      if (cosine(q, v) > targetScore) better++;
    }
    const rank = better + 1;
    served++;
    rr += 1 / rank;
    if (rank === 1) top1++;
  }
  return { served, missing, mrr: served ? rr / served : 0, top1: served ? top1 / served : 0 };
}

// ---------------------------------------------------------------- main

const base = run(`baseline ${BASE.join(", ")}`, BASE);
console.log(`signatures built: ${base.sigs.byPath.size}`);

const folds: Fold[] = [];
for (const concept of base.sigs.byPath.keys()) {
  const linking = base.linkedBy.get(concept) ?? [];
  if (linking.length < DEFAULT_SIGNATURES.minLinkedNotes + 1) continue;
  folds.push([concept, linking[0]]);
}
const SAMPLE = Number(process.env.FOLDS ?? 120);
folds.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = folds.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [folds[i], folds[j]] = [folds[j], folds[i]]; }
const sample = folds.slice(0, SAMPLE);
console.log(`folds available: ${folds.length}, evaluating ${sample.length}`);

const idx = loadIndex(INDEX);

// Note vectors: mean-pooled per file, as find_related_notes does.
const noteVecs = new Map<string, Float32Array>();
for (const [p, vecs] of idx) {
  const v = meanUnit(vecs);
  if (v) noteVecs.set(p, v);
}

// Candidates are the signature arm's concepts, so both arms rank against the
// same field. A concept missing from the index cannot be ranked by either
// embedding arm; counted and reported rather than silently dropped.
const candidates = [...base.sigs.byPath.keys()];
const conceptVecs = new Map<string, Float32Array>();
for (const c of candidates) {
  const v = noteVecs.get(c);
  if (v) conceptVecs.set(c, v);
}
console.log(`candidate concepts: ${candidates.length}, with vectors: ${conceptVecs.size}`);

const rs = evalSignature(base, sample);
const re = evalEmbed(noteVecs, conceptVecs, candidates, sample);

console.log(`\n${"arm".padEnd(16)} served  missing   MRR     top-1`);
console.log(`${"signature".padEnd(16)} ${String(rs.served).padStart(5)}        -  ${rs.mrr.toFixed(4)}  ${(rs.top1 * 100).toFixed(1)}%`);
console.log(`${"embed".padEnd(16)} ${String(re.served).padStart(5)}  ${String(re.missing).padStart(7)}  ${re.mrr.toFixed(4)}  ${(re.top1 * 100).toFixed(1)}%`);

// Coverage, reported separately: concepts an embedding can rank that hold no
// signature. This is the number the scope experiment could not honestly fold
// into MRR, and the reason embeddings are interesting even if they lose here.
const allTaxa = notes.filter((n) => isTaxa(n.path) && inScope(n.path, BASE)).map((n) => n.path);
const withSig = new Set(base.sigs.byPath.keys());
const embeddable = allTaxa.filter((p) => noteVecs.has(p));
const onlyEmbed = embeddable.filter((p) => !withSig.has(p));
console.log(`\ncoverage: ${allTaxa.length} taxa in scope`);
console.log(`  with signature: ${withSig.size}`);
console.log(`  with vector:    ${embeddable.length}`);
console.log(`  vector but no signature: ${onlyEmbed.length}`);
console.log(`  neither: ${allTaxa.filter((p) => !withSig.has(p) && !noteVecs.has(p)).length}`);
