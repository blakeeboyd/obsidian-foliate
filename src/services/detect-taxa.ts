import { App, TFile } from "obsidian";
import { TaxaMapping } from "../types";

/** A prefix convention found in the vault that isn't configured yet. */
export interface DetectedTaxon {
  prefix: string;
  fileCount: number;
  /** Deepest folder containing every file with this prefix, "" for the root. */
  folder: string;
  /** How many of the files sit directly in that folder. */
  inFolder: number;
  /** A few example basenames, to make the suggestion legible. */
  examples: string[];
}

/**
 * Characters that start ordinary filenames and never mean "taxon". Digits and
 * letters are excluded separately, since a date-led or word-led name is the
 * common case, not a convention.
 */
const NOT_A_PREFIX = new Set([
  ".", ",", "-", "_", "(", ")", "[", "]", "{", "}", "'", '"', "`",
  "!", "?", ";", ":", "/", "\\", "|", "*", "#", "$", "%", "^", "=",
  "<", ">", "“", "”", "‘", "’", " ",
]);

/**
 * Minimum files sharing a prefix before it counts as a convention.
 *
 * The number that matters. A real vault turns up single files starting with an
 * emoji, a smart quote, or a stray symbol, none of which are conventions. In
 * this vault the configured prefixes carry 3613, 1351, 161, 122 and 3 files,
 * while every false positive carries exactly one, so the gap is wide and the
 * threshold only has to sit inside it.
 */
const MIN_FILES = 3;

/**
 * Find prefix conventions already present in the vault but not configured.
 *
 * A user with an existing convention would otherwise have to notice that the
 * plugin could adopt it, then set up each prefix by hand. Scanning turns that
 * into a list they confirm.
 *
 * Only unconfigured prefixes are returned: a configured one is not a
 * suggestion, it is the current state.
 */
export function detectTaxaPrefixes(
  app: App,
  configured: TaxaMapping[]
): DetectedTaxon[] {
  const taken = new Set(configured.map((t) => t.prefix).filter(Boolean));

  const byPrefix = new Map<string, TFile[]>();
  for (const file of app.vault.getMarkdownFiles()) {
    const first = [...file.basename][0];
    if (!first) continue;
    if (taken.has(first)) continue;
    // A letter or digit at the start is a normal filename, not a marker.
    if (/[\p{L}\p{N}]/u.test(first)) continue;
    if (NOT_A_PREFIX.has(first)) continue;

    const list = byPrefix.get(first);
    if (list) list.push(file);
    else byPrefix.set(first, [file]);
  }

  const found: DetectedTaxon[] = [];
  for (const [prefix, files] of byPrefix) {
    if (files.length < MIN_FILES) continue;
    const folder = commonFolder(files);
    found.push({
      prefix,
      fileCount: files.length,
      folder,
      inFolder: files.filter((f) => (f.parent?.path ?? "") === folder).length,
      examples: files.slice(0, 3).map((f) => f.basename),
    });
  }

  // Most-used first: the strongest convention is the one to confirm first.
  return found.sort((a, b) => b.fileCount - a.fileCount);
}

/**
 * The deepest folder containing every one of these files.
 *
 * Not the most populated folder. Works files here live across
 * `works/audio-engineering`, `works/pedagogy` and `works/embodied-cognition`,
 * and the answer that covers them is `works`, which is also where auto-move
 * should put new ones.
 */
function commonFolder(files: TFile[]): string {
  let parts: string[] | null = null;
  for (const file of files) {
    const p = (file.parent?.path ?? "").split("/").filter(Boolean);
    if (parts === null) {
      parts = p;
      continue;
    }
    let i = 0;
    while (i < parts.length && i < p.length && parts[i] === p[i]) i++;
    parts = parts.slice(0, i);
    if (parts.length === 0) break;
  }
  return (parts ?? []).join("/");
}
