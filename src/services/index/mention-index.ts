import { App, TFile } from "obsidian";
import { IDBPDatabase } from "idb";
import { TaxaMapping } from "../../types";
import { fileTerms, taxonForFile } from "../context-mining";
import { buildDictionary, scanNote, TermDictionary } from "./scan";
import { computeStats, CorpusStats, topNeighbors, Neighbor, idf, documentRatio } from "./stats";
import {
  openIndexDb,
  putMentionRecords,
  getAllMentionRecords,
  getMentionRecord,
  deleteMentionRecord,
  clearIndex,
  setMeta,
  getMeta,
  MentionRecord,
} from "./store";

/**
 * The shared index: which taxa each note mentions, and what that implies about
 * how taxa relate.
 *
 * One index read two directions, per the foundation doc. Context gating
 * thresholds the relevance score ("is this mention relevant enough to surface
 * here?"); related-documents ranks it ("which documents matter most for this
 * taxa file?"). Both read from here.
 *
 * Mention sets live in IndexedDB; the derived statistics are held in memory and
 * recomputed from those sets, which measured at 0.1s over ~12,000 notes.
 */

/** Notes under these are skipped: plugin data, trash, and the taxa files. */
function isIndexableNote(file: TFile, taxaFolders: string[]): boolean {
  if (file.extension !== "md") return false;
  const p = file.path;
  if (p.startsWith(".")) return false;
  // A taxa file mentioning other taxa is real signal, so they are NOT skipped.
  // This is only the folder guard for non-note attachments.
  return true;
}

export interface BuildProgress {
  scanned: number;
  total: number;
}

export class MentionIndex {
  private app: App;
  private db: IDBPDatabase | null = null;
  private dict: TermDictionary = new Map();
  private stats: CorpusStats | null = null;
  /** Note path to its mention set, the in-memory mirror of the store. */
  private sets = new Map<string, Set<string>>();
  private building = false;

  constructor(app: App) {
    this.app = app;
  }

  get ready(): boolean {
    return this.stats !== null;
  }

  get corpus(): CorpusStats | null {
    return this.stats;
  }

  async open(): Promise<void> {
    if (this.db) return;
    // appId is Obsidian's per-vault identifier; the cast is because it is not
    // in the public typings.
    const vaultId = (this.app as unknown as { appId?: string }).appId ?? "default";
    this.db = await openIndexDb(vaultId);
  }

  /**
   * Load a previously built index without rescanning. Returns false when there
   * is nothing stored, so the caller can decide whether to build.
   */
  async load(): Promise<boolean> {
    await this.open();
    if (!this.db) return false;
    const records = await getAllMentionRecords(this.db);
    if (records.length === 0) return false;
    this.sets = new Map(records.map((r) => [r.path, new Set(r.mentions)]));
    this.rebuildStats();
    return true;
  }

  /** Layer 1: every taxa file's terms, bucketed for the scan. */
  private buildTermDictionary(taxaMappings: TaxaMapping[]): void {
    const entries: { path: string; terms: string[] }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const taxon = taxonForFile(file, taxaMappings);
      if (!taxon) continue;
      entries.push({ path: file.path, terms: fileTerms(this.app, file, taxon) });
    }
    this.dict = buildDictionary(entries);
  }

  /**
   * Full rebuild: scan every note, persist, derive.
   *
   * Chunked with a yield between batches so Obsidian stays responsive. The
   * whole pass measured at 3.5s on a 12,000-note vault, which is why this runs
   * on the main thread and not in a worker: a worker cannot reach the App or
   * metadataCache the dictionary is built from, and 3.5s does not justify
   * marshalling the vault across that boundary.
   */
  async build(
    taxaMappings: TaxaMapping[],
    onProgress?: (p: BuildProgress) => void
  ): Promise<{ notes: number; taxa: number; pairs: number; ms: number }> {
    if (this.building) throw new Error("An index build is already running");
    this.building = true;
    const started = Date.now();

    try {
      await this.open();
      this.buildTermDictionary(taxaMappings);

      const files = this.app.vault.getMarkdownFiles().filter((f) => isIndexableNote(f, []));
      this.sets = new Map();
      const pending: MentionRecord[] = [];
      const BATCH = 200;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let text: string;
        try {
          text = await this.app.vault.cachedRead(file);
        } catch {
          continue;
        }
        const mentions = scanNote(text, this.dict);
        // A note never mentions itself.
        mentions.delete(file.path);
        this.sets.set(file.path, mentions);
        pending.push({ path: file.path, mentions: [...mentions], mtime: file.stat.mtime });

        if (pending.length >= BATCH) {
          if (this.db) await putMentionRecords(this.db, pending.splice(0));
          onProgress?.({ scanned: i + 1, total: files.length });
          // Yield so the UI can paint between batches.
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
      if (pending.length && this.db) await putMentionRecords(this.db, pending);

      this.rebuildStats();
      if (this.db) await setMeta(this.db, "builtAt", Date.now());

      return {
        notes: this.stats?.noteCount ?? 0,
        taxa: this.stats?.df.size ?? 0,
        pairs: this.stats?.cooc.size ?? 0,
        ms: Date.now() - started,
      };
    } finally {
      this.building = false;
    }
  }

  /**
   * Re-derive df/cooc/NPMI from the mention sets.
   *
   * Always a full recompute rather than an incremental delta on the statistics.
   * The plan's delta arithmetic is exactly reversible in principle, but it can
   * only stay correct if every edit is observed; a rebuild that takes 0.1s
   * removes the whole class of drift for a cost nobody can perceive. If the
   * vault grows enough for that to stop being true, the delta path in the plan
   * is the upgrade.
   */
  private rebuildStats(): void {
    this.stats = computeStats([...this.sets.values()]);
  }

  /**
   * Phase 2: one note changed. Rescan it and re-derive.
   *
   * Diffs against the STORED set, never a freshly re-parsed one, which is the
   * invariant that keeps the index from drifting away from the vault.
   */
  async updateNote(file: TFile, taxaMappings: TaxaMapping[]): Promise<void> {
    if (!this.ready || this.building) return;
    if (this.dict.size === 0) this.buildTermDictionary(taxaMappings);
    await this.open();

    let text: string;
    try {
      text = await this.app.vault.cachedRead(file);
    } catch {
      return;
    }
    const mentions = scanNote(text, this.dict);
    mentions.delete(file.path);
    this.sets.set(file.path, mentions);
    if (this.db) {
      await putMentionRecords(this.db, [
        { path: file.path, mentions: [...mentions], mtime: file.stat.mtime },
      ]);
    }
    this.rebuildStats();
  }

  async removeNote(path: string): Promise<void> {
    if (!this.ready) return;
    if (!this.sets.delete(path)) return;
    await this.open();
    if (this.db) await deleteMentionRecord(this.db, path);
    this.rebuildStats();
  }

  async renameNote(oldPath: string, file: TFile, taxaMappings: TaxaMapping[]): Promise<void> {
    await this.removeNote(oldPath);
    await this.updateNote(file, taxaMappings);
  }

  async clear(): Promise<void> {
    await this.open();
    if (this.db) await clearIndex(this.db);
    this.sets = new Map();
    this.stats = null;
  }

  async builtAt(): Promise<number | undefined> {
    await this.open();
    return this.db ? getMeta<number>(this.db, "builtAt") : undefined;
  }

  // --- Query surface: what the two features read ---

  /** The taxa a note mentions. */
  mentionsOf(notePath: string): Set<string> {
    return this.sets.get(notePath) ?? new Set();
  }

  /** The taxa most associated with this one, best first. */
  neighbors(taxaPath: string, k = 20): Neighbor[] {
    return this.stats ? topNeighbors(taxaPath, this.stats, k) : [];
  }

  /** How ambiguous a term is: high IDF means rare, so no gating needed. */
  idfOf(taxaPath: string): number {
    return this.stats ? idf(taxaPath, this.stats) : Infinity;
  }

  /** Share of notes mentioning this term. */
  ratioOf(taxaPath: string): number {
    return this.stats ? documentRatio(taxaPath, this.stats) : 0;
  }

  /**
   * The terms common enough to need gating at all, most common first. On the
   * measured vault this is 21 terms above a 5% ratio, out of 4,522 mentioned.
   */
  ambiguousTerms(minRatio = 0.05): { path: string; ratio: number; df: number }[] {
    if (!this.stats) return [];
    const out: { path: string; ratio: number; df: number }[] = [];
    for (const [path, d] of this.stats.df) {
      const ratio = d / this.stats.noteCount;
      if (ratio >= minRatio) out.push({ path, ratio, df: d });
    }
    out.sort((a, b) => b.ratio - a.ratio);
    return out;
  }
}
