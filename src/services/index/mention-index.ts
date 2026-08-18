import { App, TFile } from "obsidian";
import { IDBPDatabase } from "idb";
import { TaxaMapping } from "../../types";
import { fileTerms, taxonForFile } from "../context-mining";
import { buildDictionary, scanNote, noteWords, TermDictionary, fingerprintEntries } from "./scan";
import {
  buildSignatures,
  scoreNote,
  SignatureResult,
  SignatureHit,
  Signature,
} from "./signatures";
import { buildClusters, ClusterResult, EMPTY_CLUSTERS, clusterPeers } from "./clusters";
import { findOverbroadAliases, OverbroadAlias } from "./overbroad";
import {
  computeStats,
  CorpusStats,
  topNeighbors,
  Neighbor,
  idf,
  documentRatio,
  findUsageOverlaps,
  UsageOverlap,
  curationRatio,
  pairKey,
} from "./stats";
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
  /** Note path to its unlinked-mention set, the in-memory mirror of the store. */
  private sets = new Map<string, Set<string>>();
  /**
   * Note path to its distinct words, the input to concept signatures.
   *
   * Held beside the mention sets rather than inside them because it answers a
   * different question. A mention set is what the note says about taxa the user
   * has already filed; this is the vocabulary around them, which is what lets a
   * concept be recognised in a note that never names it.
   *
   * Only notes that LINK a taxa file are kept, because only those train a
   * signature. Measured on the reference vault that is 31% of notes and 12MB
   * against 29MB for all of them. Scoring a note does not read this: it
   * tokenizes the open note directly, since only one note is ever scored.
   */
  private words = new Map<string, Set<string>>();
  /**
   * Alternate path to the path that stands for its concept, from the user's
   * confirmed merges. Empty until they confirm one.
   */
  private canonical = new Map<string, string>();
  /**
   * Note path to the taxa it LINKS, from Obsidian's own graph.
   *
   * Kept apart from mentions because it is stronger evidence in kind, not
   * degree. A mention says two terms share a page; a link says the user
   * asserted this page is about that file. Two taxa both linked from one note
   * is the user connecting them, which is the closest thing to a ground truth
   * this index has.
   */
  private links = new Map<string, Set<string>>();
  private building = false;
  /** Folders whose notes teach signatures; empty means the whole vault. */
  signatureFolders: string[] = [];

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
    this.words = new Map(
      records
        .filter((r) => r.words && r.words.length > 0)
        .map((r) => [r.path, new Set(r.words)])
    );
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
    this.dictFingerprint = fingerprintEntries(entries);
  }

  /**
   * Identifies the dictionary a stored scan was produced with.
   *
   * A note's mention set depends on the note AND on every taxa file's terms.
   * Renaming a taxon, adding an alias, or creating a taxa file changes what an
   * untouched note mentions, so skipping unmodified notes is only safe while
   * the dictionary is the one they were scanned against. When it differs, every
   * note has to be rescanned however recently it was touched.
   */
  private dictFingerprint = "";

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
    onProgress?: (p: BuildProgress) => void,
    options: { force?: boolean } = {}
  ): Promise<{ notes: number; taxa: number; pairs: number; ms: number; scanned: number }> {
    if (this.building) throw new Error("An index build is already running");
    this.building = true;
    const started = Date.now();

    try {
      await this.open();
      this.buildTermDictionary(taxaMappings);

      // Reuse stored scans when the note has not changed since it was scanned
      // AND the dictionary that produced it still matches. A rebuild after
      // editing a handful of notes then costs a handful of scans instead of
      // twelve thousand.
      const storedFingerprint = this.db
        ? await getMeta<string>(this.db, "dictFingerprint")
        : undefined;
      const dictUnchanged = storedFingerprint === this.dictFingerprint;
      const previous = new Map<string, MentionRecord>();
      if (!options.force && dictUnchanged && this.db) {
        for (const rec of await getAllMentionRecords(this.db)) previous.set(rec.path, rec);
      }

      const files = this.app.vault.getMarkdownFiles().filter((f) => isIndexableNote(f, []));
      this.sets = new Map();
      this.words = new Map();
      const pending: MentionRecord[] = [];
      const BATCH = 200;
      let scanned = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const cached = previous.get(file.path);
        // A record written before signatures existed has no words, so it is
        // rescanned once however recent its mtime is. Without this the field
        // would stay empty for every note the user has not edited since.
        if (cached && cached.mtime === file.stat.mtime && cached.words) {
          this.sets.set(file.path, new Set(cached.mentions));
          this.words.set(file.path, new Set(cached.words));
          continue;
        }

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
        // Only notes that link a taxon train a signature, so only those carry
        // a stored vocabulary. Measured, that is 31% of notes and less than
        // half the storage.
        const trains = this.trainsASignature(file, taxaMappings);
        const words = trains ? noteWords(text) : null;
        if (words) this.words.set(file.path, words);
        pending.push({
          path: file.path,
          mentions: [...mentions],
          mtime: file.stat.mtime,
          words: words ? [...words] : [],
        });
        scanned++;

        if (pending.length >= BATCH) {
          if (this.db) await putMentionRecords(this.db, pending.splice(0));
          onProgress?.({ scanned: i + 1, total: files.length });
          // Yield so the UI can paint between batches.
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
      if (pending.length && this.db) await putMentionRecords(this.db, pending);

      // Notes deleted while the index was not watching leave stale records.
      if (this.db) {
        const live = new Set(files.map((f) => f.path));
        for (const path of previous.keys()) {
          if (!live.has(path)) await deleteMentionRecord(this.db, path);
        }
      }

      this.rebuildStats();
      if (this.db) {
        await setMeta(this.db, "builtAt", Date.now());
        await setMeta(this.db, "dictFingerprint", this.dictFingerprint);
      }

      return {
        notes: this.stats?.noteCount ?? 0,
        taxa: this.stats?.df.size ?? 0,
        pairs: this.stats?.cooc.size ?? 0,
        ms: Date.now() - started,
        scanned,
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
  /**
   * Record which taxa files the user has confirmed are one concept.
   *
   * Applied when the statistics are derived, not when notes are scanned, so the
   * stored mention sets stay a faithful record of what each note actually says
   * and a merge can be undone by recomputing rather than rescanning the vault.
   */
  setMergedConcepts(merges: Record<string, string[]>): void {
    this.canonical = new Map();
    for (const [keeper, others] of Object.entries(merges)) {
      for (const other of others) this.canonical.set(other, keeper);
    }
    if (this.stats) this.rebuildStats();
  }

  /** Fold a set onto its canonical paths, collapsing merged concepts into one. */
  private fold(set: Set<string>): Set<string> {
    if (this.canonical.size === 0) return set;
    const out = new Set<string>();
    for (const path of set) out.add(this.canonical.get(path) ?? path);
    return out;
  }

  /** Concept signatures, rebuilt with the statistics they sit beside. */
  private signatureResult: SignatureResult = { byPath: new Map(), inverted: new Map(), thin: [] };

  /** One concept's signature, or undefined when it has too few links to have one. */
  signatureFor(taxaPath: string): Signature | undefined {
    return this.signatureResult.byPath.get(taxaPath);
  }

  /**
   * Concepts whose signatures fire in this text, strongest first.
   *
   * Takes the note's text rather than its path because scoring happens for one
   * note at a time, on demand, so tokenizing it costs less than storing every
   * note's vocabulary forever.
   */
  signatureHits(text: string): SignatureHit[] {
    if (this.signatureResult.byPath.size === 0) return [];
    return scoreNote(noteWords(text), this.signatureResult);
  }

  /** How many concepts have a signature, and how many were too thin for one. */
  get signatureCoverage(): { built: number; thin: number } {
    return { built: this.signatureResult.byPath.size, thin: this.signatureResult.thin.length };
  }

  /** The latent clusters, rebuilt with the statistics they are derived from. */
  private clusterResult: ClusterResult = EMPTY_CLUSTERS;

  get clusters(): ClusterResult {
    return this.clusterResult;
  }

  private rebuildStats(): void {
    // Link sets first: the statistics take them as a second input, so the graph
    // has to be read before the counts are derived from it.
    this.rebuildLinkSets();
    this.stats = computeStats(
      [...this.sets.values()].map((s) => this.fold(s)),
      [...this.links.values()].map((s) => this.fold(s))
    );
    this.linkCounts = null;
    // Measured at 8ms on a 1,760-node graph, so this rides along with every
    // rebuild rather than being scheduled separately.
    this.clusterResult = this.stats ? buildClusters(this.stats) : EMPTY_CLUSTERS;
    this.rebuildSignatures();
  }

  /**
   * Does this note link any taxa file? Only such notes train a signature, so
   * only their words are worth keeping.
   *
   * Read from Obsidian's metadata cache rather than the resolved-link graph,
   * because during a build the graph has not been re-read yet and a note's own
   * frontmatter and body links are available immediately.
   */
  private trainsASignature(file: TFile, taxaMappings: TaxaMapping[]): boolean {
    // Outside the configured folders a note teaches nothing, so its vocabulary
    // is never read and never stored.
    const scope = this.signatureFolders;
    if (scope.length > 0 && !scope.some((f) => file.path === f || file.path.startsWith(f + "/"))) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links ?? [];
    for (const link of links) {
      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (target && taxonForFile(target, taxaMappings)) return true;
    }
    const frontLinks = cache?.frontmatterLinks ?? [];
    for (const link of frontLinks) {
      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (target && taxonForFile(target, taxaMappings)) return true;
    }
    return false;
  }

  /**
   * Learn each concept's vocabulary from the notes where the user links it.
   *
   * Links rather than mentions, deliberately. A mention says a note contains a
   * word; a link says the user asserted this note is about that file. Only the
   * second is a label worth learning from, and the user produced it by working
   * normally rather than by configuring anything.
   */
  private rebuildSignatures(): void {
    // Which notes are allowed to teach. Measured on the reference vault,
    // restricting this to the knowledge folders more than doubled retrieval
    // quality (held-out MRR 0.18 to 0.41): session logs, daily reports and
    // generated project files mention concepts in passing, and a signature
    // learned from them picks up the register of the note type rather than the
    // subject of the concept.
    const scope = this.signatureFolders;
    const inScope = (notePath: string) =>
      scope.length === 0 || scope.some((f) => notePath === f || notePath.startsWith(f + "/"));

    const linkedBy = new Map<string, string[]>();
    for (const [notePath, targets] of this.links) {
      if (!inScope(notePath)) continue;
      for (const target of targets) {
        const concept = this.canonical.get(target) ?? target;
        let sources = linkedBy.get(concept);
        if (!sources) linkedBy.set(concept, (sources = []));
        sources.push(notePath);
      }
    }
    // The baseline is scoped too. "How unusual is this word" has to be asked of
    // the same body of writing the signatures are learned from, or a word that
    // is ordinary in knowledge notes but rare vault-wide reads as distinctive.
    const notes: { path: string; words: Set<string> }[] = [];
    for (const [path, words] of this.words) {
      if (inScope(path)) notes.push({ path, words });
    }
    this.signatureResult = buildSignatures(notes, linkedBy);
  }

  /**
   * Aliases that claim an ordinary word, with the file's better terms beside
   * them. The problem no amount of scoring fixes, since the claim is in the
   * data rather than in how it is read.
   */
  overbroadAliases(taxaMappings: TaxaMapping[]): OverbroadAlias[] {
    if (!this.stats) return [];
    const files: { path: string; terms: string[] }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const taxon = taxonForFile(file, taxaMappings);
      if (!taxon) continue;
      files.push({ path: file.path, terms: fileTerms(this.app, file, taxon) });
    }
    return findOverbroadAliases(files, this.stats);
  }

  /** Taxa sharing a settled cluster with this one. Empty when unsettled. */
  peersOf(taxaPath: string): string[] {
    return clusterPeers(taxaPath, this.clusterResult);
  }

  /**
   * Read the per-note link sets out of Obsidian's resolved graph, keeping only
   * links to taxa files the index knows about.
   */
  private rebuildLinkSets(): void {
    const resolved = this.app.metadataCache.resolvedLinks;
    const known = this.stats?.df;
    this.links = new Map();
    for (const source of Object.keys(resolved)) {
      const targets = Object.keys(resolved[source]).filter(
        (t) => !known || known.has(t) || this.sets.has(t)
      );
      if (targets.length) this.links.set(source, new Set(targets));
    }
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
    const words = this.trainsASignature(file, taxaMappings) ? noteWords(text) : null;
    if (words) this.words.set(file.path, words);
    else this.words.delete(file.path);
    if (this.db) {
      await putMentionRecords(this.db, [
        {
          path: file.path,
          mentions: [...mentions],
          mtime: file.stat.mtime,
          words: words ? [...words] : [],
        },
      ]);
    }
    this.rebuildStats();
  }

  async removeNote(path: string): Promise<void> {
    if (!this.ready) return;
    if (!this.sets.delete(path)) return;
    this.words.delete(path);
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
    this.words = new Map();
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
   * How many notes link to a taxa file, from Obsidian's own resolved link
   * graph. Counted on demand rather than stored: the link graph is already an
   * index Obsidian maintains, and duplicating it here would be a second copy to
   * keep in sync for no gain.
   */
  inboundLinks(taxaPath: string): number {
    return this.inboundLinkCounts().get(taxaPath) ?? 0;
  }

  /**
   * Inbound link counts for every file, built in one pass and cached.
   *
   * Walking the link graph per term meant one full pass per row rendered, which
   * is the same quadratic shape the scan was rewritten to avoid. Invalidated
   * whenever the statistics are rebuilt, so it never outlives its data.
   */
  private linkCounts: Map<string, number> | null = null;
  private inboundLinkCounts(): Map<string, number> {
    if (this.linkCounts) return this.linkCounts;
    const counts = new Map<string, number>();
    const resolved = this.app.metadataCache.resolvedLinks;
    for (const source of Object.keys(resolved)) {
      for (const target of Object.keys(resolved[source])) {
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
    }
    this.linkCounts = counts;
    return counts;
  }

  /**
   * The share of a term's mentions that the user actually linked. Near zero
   * means the word keeps appearing without ever meaning the file, which is the
   * signature of a common word that owns a file.
   */
  curationOf(taxaPath: string): number {
    return this.stats ? curationRatio(taxaPath, this.stats) : 0;
  }

  /** Notes that link this taxa file, per the index's own link sets. */
  linkedNoteCount(taxaPath: string): number {
    return this.stats?.linkDf.get(taxaPath) ?? 0;
  }

  /**
   * Taxa pairs used so similarly across the vault that they may be one concept
   * written two ways. Restricted to pairs within one taxon: a duplicate is a
   * thing written twice, and a thing has one type.
   */
  usageOverlaps(minJaccard = 0.4, taxaMappings?: TaxaMapping[]): UsageOverlap[] {
    if (!this.stats) return [];
    const prefixes = (taxaMappings ?? [])
      .map((t) => t.prefix)
      .filter((p): p is string => Boolean(p));
    const prefixOf = prefixes.length
      ? (path: string) => {
          const name = path.slice(path.lastIndexOf("/") + 1);
          return prefixes.find((p) => name.startsWith(p)) ?? "";
        }
      : undefined;
    // A merged pair is a settled question. Folding already collapsed them into
    // one node, so they cannot co-occur with themselves and would not surface
    // anyway; the explicit filter keeps that true if folding ever changes.
    const merged = new Set<string>();
    for (const [keeper, others] of this.canonical) merged.add(pairKey(keeper, others));
    // Terms come from the same dictionary the scan uses, so "shared term" means
    // exactly what the matcher would collide on.
    const termsOf = (path: string): string[] => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return [];
      const taxon = taxonForFile(file, taxaMappings ?? []);
      if (!taxon) return [];
      return fileTerms(this.app, file, taxon).map((t) => t.toLowerCase());
    };

    return findUsageOverlaps(this.stats, { minJaccard, prefixOf, termsOf }).filter(
      (o) => !merged.has(pairKey(o.a, o.b))
    );
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
      // One bar, expressed as a share. An absolute count was a second parameter
      // for a while, which forced a choice between AND (the stricter bar wins
      // and the other does nothing) and OR (two bars to reason about). Over a
      // fixed corpus the two are the same number, so the caller converts and
      // shows both instead.
      if (ratio >= minRatio) out.push({ path, ratio, df: d });
    }
    out.sort((a, b) => b.ratio - a.ratio);
    return out;
  }
}
