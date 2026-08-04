import { App, TFile, CachedMetadata } from "obsidian";
import { TaxaMapping, UnlinkedMatch, MatchPosition, ContextConfig, HiddenMatch } from "../types";
import { stripPrefix } from "../taxa";

/**
 * Scan note text for mentions of existing taxa files that aren't linked.
 * Matches against filenames (without prefix) and frontmatter aliases.
 *
 * When includeLinkedFiles is true, files that are already linked in the note
 * are still scanned, so their unlinked alias occurrences (e.g. "ZPD" for an
 * already-linked Zone of Proximal Development) surface for linking.
 *
 * Only files matching `taxaMappings` are scanned. The domain (settings.domain)
 * is deliberately not passed here, so domain files (≈…) never surface as
 * mentions in source notes: domains group taxa, they don't belong in source
 * prose. Passing the domain in would opt them back in.
 */
export function findUnlinkedMatches(
  app: App,
  noteContent: string,
  noteFile: TFile,
  taxaMappings: TaxaMapping[],
  includeLinkedFiles = false,
  contextAware: Record<string, ContextConfig> = {},
  hidden?: HiddenMatch[],
  /** Taxon whose files get second-reference surname matching (People). */
  surnameTaxon?: TaxaMapping,
  /** Honor acronyms the note declares as "[[term]] (ACRONYM)". */
  matchDeclaredAcronyms = false
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

      const gate = contextAware[taxaFile.path];
      // Only collect suppressions when the caller asked for them and this file
      // is actually gated, so an ungated file costs nothing extra.
      const suppressed = hidden && gate ? { terms: [] as string[], occurrences: 0 } : undefined;
      const positions = findFileMatchPositions(
        app,
        noteContent,
        taxaFile,
        taxon,
        bodyStart,
        excluded,
        gate,
        suppressed
      );
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
      // A file can surface some terms and have others withheld, so report the
      // suppression regardless of whether anything else matched.
      if (hidden && suppressed && suppressed.terms.length > 0) {
        hidden.push({
          filePath: taxaFile.path,
          fileName: taxaFile.basename,
          alias: stripPrefix(taxaFile.basename, taxon),
          taxon,
          hiddenTerms: suppressed.terms,
          occurrences: suppressed.occurrences,
          reason: "context-gate",
          detail:
            `"${suppressed.terms.join('", "')}" is context-gated for this file, and this note ` +
            `mentions none of its related terms` +
            (gate?.terms?.length ? ` (${gate.terms.slice(0, 6).join(", ")}${gate.terms.length > 6 ? ", …" : ""})` : ""),
        });
      }
    }
  }

  if (surnameTaxon) {
    addSurnameMatches(app, noteContent, matches, alreadyLinked, filesByFolder, surnameTaxon, excluded, bodyStart);
  }

  if (matchDeclaredAcronyms) {
    addAcronymMatches(app, noteContent, matches, noteFile, taxaMappings, excluded, bodyStart);
  }

  // Sort by number of occurrences descending
  matches.sort((a, b) => b.positions.length - a.positions.length);
  return matches;
}

/**
 * Second-reference surnames: once a person's full name appears in a note, later
 * bare surnames refer to them.
 *
 * Prose introduces someone as "Vladimir Dostoevsky" and calls them "Dostoevsky"
 * from then on. The plain matcher misses those, since the file is named for the
 * full name and most people files carry no surname alias. The evidence is local
 * to the note, so nothing is configured and nothing leaks: the surname only
 * matches where the full name established who is meant.
 *
 * Restricted to one taxon (People) because splitting on whitespace is a naming
 * convention, not a general rule. "Delay" has no surname.
 *
 * A surname shared by two people present in the same note is skipped entirely
 * rather than guessed, so this never links to the wrong person.
 */
function addSurnameMatches(
  app: App,
  noteContent: string,
  matches: UnlinkedMatch[],
  alreadyLinked: Set<string>,
  filesByFolder: Map<TaxaMapping, TFile[]>,
  taxon: TaxaMapping,
  excluded: Region[],
  bodyStart: number
): void {
  // Everyone the note establishes: linked, or already surfaced as a mention.
  const present = new Map<string, TFile>();
  for (const file of filesByFolder.get(taxon) ?? []) {
    if (alreadyLinked.has(file.path) || matches.some((m) => m.filePath === file.path)) {
      present.set(file.path, file);
    }
  }
  if (present.size === 0) return;

  // Surname -> the files claiming it. More than one means ambiguous here.
  const bySurname = new Map<string, TFile[]>();
  for (const file of present.values()) {
    const parts = stripPrefix(file.basename, taxon).trim().split(/\s+/);
    if (parts.length < 2) continue; // single-word name has no separate surname
    const surname = parts[parts.length - 1];
    if (surname.length < 3) continue; // initials and particles are too noisy
    const key = surname.toLowerCase();
    const list = bySurname.get(key);
    if (list) list.push(file);
    else bySurname.set(key, [file]);
  }

  for (const [, files] of bySurname) {
    if (files.length > 1) continue; // ambiguous in this note: skip, never guess
    const file = files[0];
    const surname = stripPrefix(file.basename, taxon).trim().split(/\s+/).pop()!;

    // Case-sensitive: a surname is a proper noun, so "Wood" is the person and
    // "wood" is lumber. Without this, common-word surnames flood any note that
    // happens to mention the person once.
    const positions = findUnlinkedPositions(noteContent, surname, excluded, true)
      .filter((offset) => offset >= bodyStart)
      .map((offset) => ({ offset, len: surname.length, surface: surname }));
    if (positions.length === 0) continue;

    // Fold into the file's existing row when it already has one, so a person
    // appears once with all their occurrences rather than twice.
    const existing = matches.find((m) => m.filePath === file.path);
    if (existing) {
      const seen = new Set(existing.positions.map((p) => p.offset));
      const added = positions.filter((p) => !seen.has(p.offset));
      if (added.length > 0) {
        existing.positions = [...existing.positions, ...added].sort((a, b) => a.offset - b.offset);
      }
      continue;
    }

    matches.push({
      matchText: surname,
      filePath: file.path,
      fileName: file.basename,
      alias: stripPrefix(file.basename, taxon),
      taxon,
      positions,
    });
  }
}

/**
 * Acronyms the note itself declares: a link immediately followed by a
 * parenthesised short form, as in "[[+just noticeable difference]] (JND)".
 *
 * Technical writing introduces a term with its abbreviation once and uses the
 * abbreviation thereafter. The declaration is written in the document, so this
 * reads an equivalence the author stated rather than inferring one, and it holds
 * only inside that note.
 *
 * Deliberately narrow. A parenthetical after a link is usually an editorial
 * aside, not an alias: "(concept)", "(memory)", "(status: final)", a file path.
 * Requiring acronym shape (uppercase initials, optional periods, optional
 * trailing "s") excludes those, at the cost of missing lowercase glosses and
 * foreign-language terms, which cannot be told apart from prose by shape alone.
 */
function addAcronymMatches(
  app: App,
  noteContent: string,
  matches: UnlinkedMatch[],
  noteFile: TFile,
  taxaMappings: TaxaMapping[],
  excluded: Region[],
  bodyStart: number
): void {
  // [[target]] or [[target|alias]], then optional space, then (ACRONYM).
  const declaration = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\] ?\(([A-Z][A-Za-z]*\.?(?:[A-Z]\.?){1,6}s?)\)/g;

  for (const m of noteContent.matchAll(declaration)) {
    const target = m[1].trim();
    const acronym = m[2];

    const dest = app.metadataCache.getFirstLinkpathDest(target, noteFile.path);
    if (!dest || dest.path === noteFile.path) continue;
    // Only taxa files: an acronym declared for an ordinary note isn't ours.
    const taxon = taxaMappings.find((t) => t.folder?.trim() && dest.path.startsWith(t.folder.trim() + "/"));
    if (!taxon) continue;

    // Case-sensitive: "JND" is the abbreviation, "jnd" is not, and a lowercase
    // match would fire inside unrelated words.
    const positions = findUnlinkedPositions(noteContent, acronym, excluded, true)
      .filter((offset) => offset >= bodyStart)
      .map((offset) => ({ offset, len: acronym.length, surface: acronym }));
    if (positions.length === 0) continue;

    const existing = matches.find((x) => x.filePath === dest.path);
    if (existing) {
      const seen = new Set(existing.positions.map((p) => p.offset));
      const added = positions.filter((p) => !seen.has(p.offset));
      if (added.length > 0) {
        existing.positions = [...existing.positions, ...added].sort((a, b) => a.offset - b.offset);
      }
      continue;
    }

    matches.push({
      matchText: acronym,
      filePath: dest.path,
      fileName: dest.basename,
      alias: stripPrefix(dest.basename, taxon),
      taxon,
      positions,
    });
  }
}

/**
 * Every existing taxa file whose name (without prefix) or one of its aliases
 * equals `text`, case-insensitively. Returns all matches, so callers can
 * disambiguate (e.g. open a picker) when a word maps to more than one file, or
 * treat a single hit as an unambiguous auto-pick.
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
 * Existing taxa files whose name or alias *begins* with `text` at a word
 * boundary, excluding exact matches.
 *
 * The case this serves: selecting "Sarah" when the vault holds @Sarah Cavanagh
 * and @Sarah Schnitker. Nothing matches exactly, so the plugin would offer to
 * create a third Sarah, when the user almost certainly meant one of the two.
 * The match is a prefix from the START of a term, so "Sarah" and even "Sar"
 * offer "Sarah Cavanagh", while "arah" offers nothing and "act" never drags in
 * "compact". Anchoring at the start (rather than requiring the prefix to end on
 * a word boundary) is what makes partial typing work: "Sar" is exactly when a
 * suggestion is most useful.
 *
 * Returns at most `limit` files, since this is a convenience prompt rather than
 * a search: a selection matching dozens of files is too vague to disambiguate.
 */
export function findTaxaFilesByPartialText(
  app: App,
  text: string,
  taxaMappings: TaxaMapping[],
  limit = 12
): { file: TFile; taxon: TaxaMapping }[] {
  const target = text.trim().toLowerCase();
  // Single characters match far too much to be a useful suggestion.
  if (target.length < 2) return [];

  const hits: { file: TFile; taxon: TaxaMapping }[] = [];
  for (const taxon of taxaMappings) {
    for (const file of getTaxaFiles(app, taxon)) {
      const terms = getSearchTerms(app, file, taxon).map((t) => t.toLowerCase());
      // Exact matches are the caller's other branch; only near-misses here.
      if (terms.includes(target)) continue;
      if (terms.some((t) => t.startsWith(target))) hits.push({ file, taxon });
      if (hits.length >= limit) return hits;
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
 *
 * When `gate` is supplied (the file is context-aware), its gated terms are only
 * searched if the note also contains one of the gate's context terms, so a
 * common-word alias surfaces only in notes about the right subject.
 */
export function findFileMatchPositions(
  app: App,
  noteContent: string,
  taxaFile: TFile,
  taxon: TaxaMapping,
  bodyStart = 0,
  excludedRegions?: Region[],
  gate?: ContextConfig,
  suppressed?: { terms: string[]; occurrences: number }
): MatchPosition[] {
  const searchTerms = getSearchTerms(app, taxaFile, taxon);
  const candidates: MatchPosition[] = [];
  // The excluded regions (code, links) depend only on the note text. Callers
  // scanning many files over the same note pass them in (computed once);
  // single-shot callers let us derive them here so they stay correct.
  const excluded = excludedRegions ?? findExcludedRegions(noteContent);

  // Context gating: only the file's gated terms (the common-word aliases like
  // "sync") are suppressed unless the note also contains one of the file's
  // context terms. Ungated terms (the full name, unambiguous aliases) always
  // match. isGatedTerm keys off the file's gatedAliases list; noteHasContext is
  // computed lazily and memoized, so ungated files pay nothing and a gated file
  // scans the note's context terms at most once.
  const gatedSet = gate
    ? new Set((gate.gatedAliases ?? []).map((t) => t.toLowerCase()))
    : null;
  const isGatedTerm = (term: string): boolean =>
    gatedSet !== null && gatedSet.has(term.toLowerCase());
  let contextChecked = false;
  let contextPresent = false;
  const noteHasContext = (): boolean => {
    if (!contextChecked) {
      contextPresent = (gate?.terms ?? []).some(
        (t) => t.length >= 2 && findUnlinkedPositions(noteContent, t, excluded).length > 0
      );
      contextChecked = true;
    }
    return contextPresent;
  };

  for (const term of searchTerms) {
    if (typeof term !== "string" || term.length < 2) continue;
    if (isGatedTerm(term) && !noteHasContext()) {
      // Withheld by the gate. Record what was suppressed so the sidebar can
      // show it under Hidden connections instead of the match vanishing.
      if (suppressed) {
        const hits = findUnlinkedPositions(noteContent, term, excluded).filter(
          (o) => o >= bodyStart
        );
        if (hits.length > 0) {
          suppressed.terms.push(term);
          suppressed.occurrences += hits.length;
        }
      }
      continue;
    }

    // Search both the bare term ("Paul Krugman") and the term carrying this
    // file's own taxon prefix ("@Paul Krugman"). The prefixed form matches only
    // this file's taxon, so "@Paul Krugman" surfaces the people file while
    // "+Paul Krugman" does not (the concept prefix is never searched for a
    // people file). The prefixed match consumes the prefix, so linking replaces
    // the whole "@Paul Krugman" rather than leaving a stray "@".
    const forms =
      taxon.prefix && taxon.prefix.length > 0 ? [taxon.prefix + term, term] : [term];
    for (const form of forms) {
      for (const offset of findUnlinkedPositions(noteContent, form, excluded)) {
        if (offset < bodyStart) continue;
        candidates.push({
          offset,
          len: form.length,
          surface: noteContent.substring(offset, offset + form.length),
        });
      }
    }
  }

  // Resolve overlaps: take the longest match first, then drop any candidate
  // whose [offset, offset+len) range overlaps an already-kept one. This also
  // dedupes exact-offset collisions. Ranges that don't overlap are all kept.
  return resolveOverlaps(candidates).sort((a, b) => a.offset - b.offset);
}

/** Keep the longest span at each overlap; drop any that overlaps a kept one. */
export function resolveOverlaps<T extends { offset: number; len: number }>(spans: T[]): T[] {
  const sorted = [...spans].sort((a, b) => b.len - a.len || a.offset - b.offset);
  const kept: T[] = [];
  for (const s of sorted) {
    if (!kept.some((k) => s.offset < k.offset + k.len && k.offset < s.offset + s.len)) kept.push(s);
  }
  return kept;
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
  excluded?: Region[],
  /**
   * Require the occurrence to match the term's capitalization. Used for terms
   * whose lowercase form is an ordinary word: a person surnamed Wood or Small
   * should match "Wood" in prose but not "a wood floor".
   */
  caseSensitive = false
): number[] {
  const positions: number[] = [];
  const regions = excluded ?? findExcludedRegions(text);
  const lowerText = caseSensitive ? text : text.toLowerCase();
  const lowerTerm = caseSensitive ? term : term.toLowerCase();
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
