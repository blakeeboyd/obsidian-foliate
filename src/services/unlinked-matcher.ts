import { App, TFile, CachedMetadata } from "obsidian";
import { TaxaMapping, UnlinkedMatch, MatchPosition } from "../types";
import { stripPrefix } from "../taxa";

/**
 * Scan note text for mentions of existing taxa files that aren't linked.
 * Matches against filenames (without prefix) and frontmatter aliases.
 *
 * When includeLinkedFiles is true, files that are already linked in the note
 * are still scanned, so their unlinked alias occurrences (e.g. "ZPD" for an
 * already-linked Zone of Proximal Development) surface for linking.
 */
export function findUnlinkedMatches(
  app: App,
  noteContent: string,
  noteFile: TFile,
  taxaMappings: TaxaMapping[],
  includeLinkedFiles = false
): UnlinkedMatch[] {
  const matches: UnlinkedMatch[] = [];
  const alreadyLinked = getLinkedFiles(app, noteFile);

  for (const taxon of taxaMappings) {
    const taxaFiles = getTaxaFiles(app, taxon);

    for (const taxaFile of taxaFiles) {
      // Skip self-references
      if (taxaFile.path === noteFile.path) continue;
      // Skip already-linked files unless we're surfacing their aliases
      if (!includeLinkedFiles && alreadyLinked.has(taxaFile.path)) continue;

      const positions = findFileMatchPositions(app, noteContent, taxaFile, taxon);
      if (positions.length > 0) {
        matches.push({
          matchText: positions[0].surface,
          filePath: taxaFile.path,
          fileName: taxaFile.basename,
          alias: stripPrefix(taxaFile.basename, taxon),
          taxon,
          positions,
        });
      }
    }
  }

  // Sort by number of occurrences descending
  matches.sort((a, b) => b.positions.length - a.positions.length);
  return matches;
}

/**
 * Find all unlinked occurrences of a single taxa file's name and aliases in the
 * text, deduped by offset (keeping the longest term at each offset). Positions
 * inside existing [[ ]] wikilinks are excluded. Used both for unlinked-mention
 * detection and for folding alias mentions into an already-linked file's entry.
 */
export function findFileMatchPositions(
  app: App,
  noteContent: string,
  taxaFile: TFile,
  taxon: TaxaMapping
): MatchPosition[] {
  const searchTerms = getSearchTerms(app, taxaFile, taxon);
  // Keyed by offset so overlapping terms dedupe; keep the longest match.
  const byOffset = new Map<number, MatchPosition>();

  for (const term of searchTerms) {
    if (term.length < 2) continue;

    for (const offset of findUnlinkedPositions(noteContent, term)) {
      const existing = byOffset.get(offset);
      if (!existing || term.length > existing.len) {
        byOffset.set(offset, {
          offset,
          len: term.length,
          surface: noteContent.substring(offset, offset + term.length),
        });
      }
    }
  }

  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * Get all files that are already linked from this note.
 */
function getLinkedFiles(app: App, file: TFile): Set<string> {
  const linked = new Set<string>();
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.links) return linked;

  for (const link of cache.links) {
    const dest = app.metadataCache.getFirstLinkpathDest(
      link.link,
      file.path
    );
    if (dest) {
      linked.add(dest.path);
    }
  }
  return linked;
}

/**
 * Get all markdown files in a taxon's folder.
 */
function getTaxaFiles(app: App, taxon: TaxaMapping): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) =>
    f.path.startsWith(taxon.folder + "/")
  );
}

/**
 * Get all terms to search for a given taxa file:
 * the name without prefix, plus all frontmatter aliases.
 */
function getSearchTerms(
  app: App,
  file: TFile,
  taxon: TaxaMapping
): string[] {
  const terms: string[] = [];
  const nameWithoutPrefix = stripPrefix(file.basename, taxon);
  terms.push(nameWithoutPrefix);

  const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);
  if (cache?.frontmatter?.aliases) {
    const aliases = cache.frontmatter.aliases;
    if (Array.isArray(aliases)) {
      terms.push(...aliases);
    } else if (typeof aliases === "string") {
      terms.push(aliases);
    }
  }

  return terms;
}

/**
 * Find positions of a term in text that aren't inside wikilinks.
 * Case-insensitive matching with word boundary checks.
 */
function findUnlinkedPositions(text: string, term: string): number[] {
  const positions: number[] = [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const termLen = term.length;

  let searchFrom = 0;
  while (searchFrom < lowerText.length) {
    const idx = lowerText.indexOf(lowerTerm, searchFrom);
    if (idx === -1) break;

    // Check word boundaries
    const charBefore = idx > 0 ? text[idx - 1] : " ";
    const charAfter =
      idx + termLen < text.length ? text[idx + termLen] : " ";
    const isWordBoundaryBefore = /[\s,;:!?([\]"'\-—*_~`]/.test(charBefore) || idx === 0;
    const isWordBoundaryAfter =
      /[\s,;:!?)\]"'\-—.*_~`]/.test(charAfter) ||
      idx + termLen === text.length;

    if (isWordBoundaryBefore && isWordBoundaryAfter) {
      // Check if we're inside a wikilink
      if (!isInsideWikilink(text, idx)) {
        positions.push(idx);
      }
    }

    searchFrom = idx + 1;
  }

  return positions;
}

/**
 * Check if a position in text falls inside a [[ ]] wikilink.
 */
function isInsideWikilink(text: string, position: number): boolean {
  // Look backwards for [[ or ]]
  let i = position - 1;
  while (i >= 1) {
    if (text[i] === "[" && text[i - 1] === "[") {
      // Found opening [[ — check if there's a closing ]] after our position
      const closeIdx = text.indexOf("]]", position);
      if (closeIdx !== -1) return true;
      return false;
    }
    if (text[i] === "]" && text[i - 1] === "]") {
      // Found closing ]] before us — we're not inside
      return false;
    }
    i--;
  }
  return false;
}
