import { App, TFile } from "obsidian";
import { TaxaMapping } from "../types";
import { stripPrefix } from "../taxa";

/**
 * All search terms a taxa file contributes to another note: its name without
 * prefix, plus its frontmatter aliases (strings only). Mirrors the matcher's
 * getSearchTerms, but exported here so context mining reuses the same notion of
 * "the words that stand for this file."
 */
export function fileTerms(app: App, file: TFile, taxon: TaxaMapping): string[] {
  const terms: string[] = [stripPrefix(file.basename, taxon)];
  const aliases = app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
  if (Array.isArray(aliases)) {
    for (const a of aliases) if (typeof a === "string") terms.push(a);
  } else if (typeof aliases === "string") {
    terms.push(aliases);
  }
  return terms;
}

/** Which taxon a file belongs to (by folder), or null if it's not in one. */
export function taxonForFile(file: TFile, taxaMappings: TaxaMapping[]): TaxaMapping | null {
  for (const taxon of taxaMappings) {
    if (taxon.folder && file.path.startsWith(taxon.folder + "/")) return taxon;
  }
  return null;
}

/**
 * Mine the context vocabulary for a taxa file from the Obsidian graph.
 *
 * Phase 1 tiers (both trusted, no threshold):
 *   1. Outgoing links — every file this note links to contributes its
 *      name + aliases.
 *   2. Taxa backlinks — every file that links to this note AND is itself a
 *      taxa file (lives in a taxa folder) contributes its name + aliases.
 *
 * Non-taxa backlinks are deliberately ignored for now; the percentage-threshold
 * tier that would admit them is a planned follow-up. The file's own terms are
 * excluded (a file can't be its own context). Result is deduped
 * case-insensitively, sorted, and stripped of terms shorter than 2 chars.
 */
export function mineContextTerms(
  app: App,
  file: TFile,
  taxaMappings: TaxaMapping[]
): string[] {
  const ownTerms = new Set(
    fileTerms(app, file, taxonForFile(file, taxaMappings) ?? taxaMappings[0]).map((t) =>
      t.toLowerCase()
    )
  );
  const collected = new Map<string, string>(); // lowercase -> display form

  const add = (terms: string[]) => {
    for (const t of terms) {
      const key = t.trim().toLowerCase();
      if (key.length < 2 || ownTerms.has(key)) continue;
      if (!collected.has(key)) collected.set(key, t.trim());
    }
  };

  // Tier 1: outgoing links from this file's body.
  const cache = app.metadataCache.getFileCache(file);
  for (const link of cache?.links ?? []) {
    const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    if (!dest) continue;
    const taxon = taxonForFile(dest, taxaMappings);
    add(taxon ? fileTerms(app, dest, taxon) : [dest.basename]);
  }

  // Tier 2: backlinks from other taxa files only.
  for (const [sourcePath, links] of Object.entries(
    // resolvedLinks maps source path -> { destPath: count }
    app.metadataCache.resolvedLinks
  )) {
    if (!(file.path in links)) continue;
    const source = app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) continue;
    const taxon = taxonForFile(source, taxaMappings);
    if (!taxon) continue; // non-taxa backlinks deferred to the threshold tier
    add(fileTerms(app, source, taxon));
  }

  return [...collected.values()].sort((a, b) => a.localeCompare(b));
}
