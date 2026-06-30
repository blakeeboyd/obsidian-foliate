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

  // Both of these depend only on the note text, not on any taxa file, so
  // compute them once for the whole scan. Recomputing findExcludedRegions per
  // taxa file (thousands of times) was the dominant cost of a refresh.
  const excluded = findExcludedRegions(noteContent);
  const bodyStart = bodyStartOffset(noteContent);

  // One vault file-list scan, partitioned by folder, instead of one per taxon.
  const filesByFolder = getTaxaFilesByFolder(app, taxaMappings);

  for (const taxon of taxaMappings) {
    const taxaFiles = filesByFolder.get(taxon) ?? [];

    for (const taxaFile of taxaFiles) {
      // Skip self-references
      if (taxaFile.path === noteFile.path) continue;
      // Skip already-linked files unless we're surfacing their aliases
      if (!includeLinkedFiles && alreadyLinked.has(taxaFile.path)) continue;

      const positions = findFileMatchPositions(app, noteContent, taxaFile, taxon, bodyStart, excluded);
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
 * Find the single existing taxa file whose name (without prefix) or one of its
 * aliases equals `text`, case-insensitively. Returns the file and its taxon, or
 * null when nothing matches or more than one does (ambiguous — leave it to the
 * picker). Used to auto-pick the taxon when linking selected text.
 */
export function findTaxaFileByText(
  app: App,
  text: string,
  taxaMappings: TaxaMapping[]
): { file: TFile; taxon: TaxaMapping } | null {
  const hits = findTaxaFilesByText(app, text, taxaMappings);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Every existing taxa file whose name (without prefix) or one of its aliases
 * equals `text`, case-insensitively. Unlike findTaxaFileByText this returns all
 * matches, so callers can disambiguate (e.g. open a picker) when a word maps to
 * more than one file.
 */
export function findTaxaFilesByText(
  app: App,
  text: string,
  taxaMappings: TaxaMapping[]
): { file: TFile; taxon: TaxaMapping }[] {
  const target = text.trim().toLowerCase();
  if (!target) return [];
  const hits: { file: TFile; taxon: TaxaMapping }[] = [];
  for (const taxon of taxaMappings) {
    for (const file of getTaxaFiles(app, taxon)) {
      const terms = getSearchTerms(app, file, taxon).map((t) => t.toLowerCase());
      if (terms.includes(target)) hits.push({ file, taxon });
    }
  }
  return hits;
}

/**
 * Offset where the note body begins, i.e. just past the closing fence of a
 * YAML frontmatter block. Returns 0 when there is no frontmatter. Used to keep
 * matches out of the properties block, which can't be navigated or linked.
 */
export function bodyStartOffset(content: string): number {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  return match ? match[0].length : 0;
}

/**
 * Find all unlinked occurrences of a single taxa file's name and aliases in the
 * text. Overlapping matches are resolved by keeping the longest and dropping any
 * that overlaps it, so an alias that sits inside a longer name occurrence (e.g.
 * "Moeller" within "Hans-Georg Moeller") is not linked twice. Positions inside
 * existing [[ ]] wikilinks, code, or markdown/bare links, or before bodyStart
 * (i.e. in frontmatter), are excluded. Used both for unlinked-mention detection
 * and for folding alias mentions into an already-linked file's entry.
 */
export function findFileMatchPositions(
  app: App,
  noteContent: string,
  taxaFile: TFile,
  taxon: TaxaMapping,
  bodyStart = 0,
  excludedRegions?: Region[]
): MatchPosition[] {
  const searchTerms = getSearchTerms(app, taxaFile, taxon);
  const candidates: MatchPosition[] = [];
  // The excluded regions (code, links) depend only on the note text. Callers
  // scanning many files over the same note pass them in (computed once);
  // single-shot callers let us derive them here so they stay correct.
  const excluded = excludedRegions ?? findExcludedRegions(noteContent);

  for (const term of searchTerms) {
    if (typeof term !== "string" || term.length < 2) continue;

    for (const offset of findUnlinkedPositions(noteContent, term, excluded)) {
      if (offset < bodyStart) continue;
      candidates.push({
        offset,
        len: term.length,
        surface: noteContent.substring(offset, offset + term.length),
      });
    }
  }

  // Resolve overlaps: take the longest match first, then drop any candidate
  // whose [offset, offset+len) range overlaps an already-kept one. This also
  // dedupes exact-offset collisions. Ranges that don't overlap are all kept.
  candidates.sort((a, b) => b.len - a.len || a.offset - b.offset);
  const kept: MatchPosition[] = [];
  for (const c of candidates) {
    const overlaps = kept.some(
      (k) => c.offset < k.offset + k.len && k.offset < c.offset + c.len
    );
    if (!overlaps) kept.push(c);
  }

  return kept.sort((a, b) => a.offset - b.offset);
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
 * Partition the vault's markdown files by taxon in a single pass over
 * getMarkdownFiles(), so a full-scan caller pays one file-list walk instead of
 * one per taxon. Taxa with no configured folder map to an empty list (they
 * match nothing, same as getTaxaFiles). A file under more than one taxon folder
 * is assigned to each, matching the per-taxon filter's behavior.
 */
function getTaxaFilesByFolder(
  app: App,
  taxaMappings: TaxaMapping[]
): Map<TaxaMapping, TFile[]> {
  const byFolder = new Map<TaxaMapping, TFile[]>();
  const withFolder: { taxon: TaxaMapping; prefix: string }[] = [];
  for (const taxon of taxaMappings) {
    byFolder.set(taxon, []);
    if (taxon.folder) withFolder.push({ taxon, prefix: taxon.folder + "/" });
  }
  if (withFolder.length === 0) return byFolder;

  for (const file of app.vault.getMarkdownFiles()) {
    for (const { taxon, prefix } of withFolder) {
      if (file.path.startsWith(prefix)) byFolder.get(taxon)!.push(file);
    }
  }
  return byFolder;
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
    // Aliases can hold non-string YAML values (numbers, null, nested lists).
    // Keep only strings so they don't crash the case-insensitive matcher.
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias === "string") terms.push(alias);
      }
    } else if (typeof aliases === "string") {
      terms.push(aliases);
    }
  }

  return terms;
}

/**
 * Find positions of a term in text that aren't inside wikilinks, code, or
 * markdown/bare links. Case-insensitive matching with word boundary checks, so
 * a short term like "AI" never matches inside a word ("faithful", "claim").
 * Exported so the sidebar's linked-file plain-text scan uses the same rules.
 *
 * The hyphen "-" is treated as a word character (not a boundary), so a term
 * like "Sub" does not match the fragment in "Sub-branch"; a hyphenated taxa
 * term ("Hans-Georg Moeller") still matches as a whole. The em dash "—", which
 * separates clauses rather than joining words, remains a boundary.
 *
 * `excluded` is the set of regions (code spans/blocks, markdown links, bare
 * URLs) to skip. Callers that scan many terms over the same text should compute
 * it once via findExcludedRegions and pass it in; when omitted it is derived
 * here so single-shot callers stay correct.
 */
export function findUnlinkedPositions(
  text: string,
  term: string,
  excluded?: Region[]
): number[] {
  const positions: number[] = [];
  const regions = excluded ?? findExcludedRegions(text);
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
    const isWordBoundaryBefore = /[\s,;:!?([\]"'—*_~`]/.test(charBefore) || idx === 0;
    const isWordBoundaryAfter =
      /[\s,;:!?)\]"'—.*_~`]/.test(charAfter) ||
      idx + termLen === text.length;

    if (isWordBoundaryBefore && isWordBoundaryAfter) {
      // Skip matches inside wikilinks, code, or links.
      if (!isInsideWikilink(text, idx) && !isInExcludedRegion(idx, idx + termLen, regions)) {
        positions.push(idx);
      }
    }

    searchFrom = idx + 1;
  }

  return positions;
}

/** A half-open [start, end) span of the note to keep matches out of. */
export interface Region {
  start: number;
  end: number;
}

/**
 * Build the list of regions where a wikilink doesn't belong: fenced code blocks,
 * inline code spans, markdown links ([label](url), the whole construct), and
 * bare/autolink URLs. Wikilinks themselves are handled separately by
 * isInsideWikilink. Regions may be returned unsorted and possibly overlapping;
 * isInExcludedRegion does a plain containment test so that's fine.
 *
 * Code is matched first and its spans suppress link/URL detection inside them by
 * being part of the same returned set (a URL inside a code span is already
 * excluded by the code region, so double-counting is harmless).
 */
export function findExcludedRegions(text: string): Region[] {
  const regions: Region[] = [];

  // Fenced code blocks: ``` or ~~~ runs, from an opening fence to the matching
  // closing fence on its own line (or end of text if never closed).
  const fenceOpen = /^[ \t]*(`{3,}|~{3,})[^\n]*\n/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fenceOpen.exec(text)) !== null) {
    const marker = fm[1];
    const blockStart = fm.index;
    const afterOpen = fenceOpen.lastIndex;
    // Find the closing fence of the same type on its own line.
    const closeRe = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`, "m");
    const rest = text.slice(afterOpen);
    const cm = rest.match(closeRe);
    const blockEnd =
      cm && cm.index !== undefined
        ? afterOpen + cm.index + cm[0].length
        : text.length;
    regions.push({ start: blockStart, end: blockEnd });
    fenceOpen.lastIndex = blockEnd;
  }

  // Inline code spans: `code` (allow multi-backtick runs `` ` ``).
  const inlineCode = /(`+)(?:[^`]|(?!\1)`)*?\1/g;
  let im: RegExpExecArray | null;
  while ((im = inlineCode.exec(text)) !== null) {
    regions.push({ start: im.index, end: im.index + im[0].length });
  }

  // Markdown links: [label](url) and [label][ref] — exclude the whole construct
  // (label and target). Image embeds ![alt](url) are covered by the same span
  // plus the leading "!".
  // The inner alternative is a single non-paren char (not `[^()\n]*`): an
  // unbounded quantifier there overlaps the outer `*` and backtracks
  // catastrophically on a half-typed link (`[label](` with no closing `)`),
  // which froze the editor. This form is linear and still matches one level of
  // nested parens, e.g. a URL like .../Social_(democracy).
  const mdLink = /!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = mdLink.exec(text)) !== null) {
    regions.push({ start: lm.index, end: lm.index + lm[0].length });
  }

  // Autolinks <https://…> and bare URLs (http/https/www) not already inside a
  // markdown link. The bare-URL run stops at whitespace or a closing bracket.
  const urls = /<[a-z][a-z0-9+.-]*:\/\/[^>\s]+>|(?:https?:\/\/|www\.)[^\s)\]<>"']+/gi;
  let um: RegExpExecArray | null;
  while ((um = urls.exec(text)) !== null) {
    regions.push({ start: um.index, end: um.index + um[0].length });
  }

  return regions;
}

/**
 * Whether [start, end) overlaps any excluded region. A match is rejected if any
 * part of it lands inside a region.
 */
function isInExcludedRegion(start: number, end: number, regions: Region[]): boolean {
  for (const r of regions) {
    if (start < r.end && r.start < end) return true;
  }
  return false;
}

/**
 * Check if a position in text falls inside a [[ ]] wikilink.
 */
export function isInsideWikilink(text: string, position: number): boolean {
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
