import { TFile } from "obsidian";

/**
 * Changing a taxon's prefix orphans every file still carrying the old one.
 *
 * The setting is the only thing the prefix field writes, so the moment it
 * changes, 1,530 files named "+something" stop matching the "≈" mapping: they
 * are not detected as taxa, not moved, not indexed as that taxon. Nothing warns
 * about it and nothing undoes it, because the settings undo stack restores
 * settings rather than files.
 *
 * The rename itself is Obsidian's job. `fileManager.renameFile` rewrites every
 * [[link]] pointing at a file, including aliased and heading links, so this
 * module never touches link text. What it owns is deciding WHICH files move and
 * catching the cases where a rename would lose data.
 */

/** One file's planned rename, or the reason it cannot happen. */
export interface ReprefixPlan {
  file: TFile;
  from: string;
  /** Full target path. */
  to: string;
  /**
   * Why this file is not renameable, if it is not. A blocked plan is reported
   * and skipped rather than attempted: a rename onto an existing file is data
   * loss, and Obsidian will not do it for us.
   */
  blocked?: "collision";
}

export interface ReprefixSummary {
  planned: ReprefixPlan[];
  blocked: ReprefixPlan[];
}

/**
 * What renaming this taxon's files from `oldPrefix` to `newPrefix` would do.
 *
 * Pure, so the caller can show the counts and get a confirmation before
 * anything is written. `existingPaths` is every path in the vault, used to
 * catch the collision case: renaming "+economics" to "≈economics" when
 * "≈economics" already exists would silently destroy one of them.
 *
 * Files keep their folder. Moving them to the new taxon's folder is the
 * auto-mover's job and happens after, on the rename event, so that a user who
 * has auto-move off gets a rename and nothing else.
 */
export function planReprefix(
  files: TFile[],
  oldPrefix: string,
  newPrefix: string,
  existingPaths: Set<string>
): ReprefixSummary {
  const planned: ReprefixPlan[] = [];
  const blocked: ReprefixPlan[] = [];
  // A no-op prefix change would rename every file onto itself, which reads as
  // a collision against its own path. Nothing to do is not an error.
  if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) return { planned, blocked };

  // Targets claimed within this batch count as taken. Two files cannot both
  // become the same name, and the second would otherwise pass the check by
  // looking only at what exists on disk before the batch started.
  const claimed = new Set<string>();

  for (const file of files) {
    if (!file.basename.startsWith(oldPrefix)) continue;
    const renamed = newPrefix + file.basename.slice(oldPrefix.length);
    const folder = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
    const to = `${folder}${renamed}.${file.extension}`;
    const plan: ReprefixPlan = { file, from: file.path, to };
    if (existingPaths.has(to) || claimed.has(to)) {
      plan.blocked = "collision";
      blocked.push(plan);
      continue;
    }
    claimed.add(to);
    planned.push(plan);
  }
  return { planned, blocked };
}

/**
 * Frontmatter aliases that still spell the old prefix.
 *
 * `renameFile` updates links and knows nothing about alias strings, so a file
 * aliased "+economics" keeps that alias after being renamed to "≈economics"
 * and goes on matching the old spelling. Foliate builds its dictionary from
 * aliases, so a stale one is a term that resolves to a taxon whose prefix no
 * longer exists. Reported rather than rewritten: an alias is a deliberate
 * spelling, and some of them mean the bare word rather than the prefixed name.
 */
export function staleAliases(
  aliasesByPath: Map<string, string[]>,
  paths: string[],
  oldPrefix: string
): { path: string; aliases: string[] }[] {
  const out: { path: string; aliases: string[] }[] = [];
  for (const path of paths) {
    const aliases = aliasesByPath.get(path) ?? [];
    const stale = aliases.filter((a) => a.startsWith(oldPrefix));
    if (stale.length > 0) out.push({ path, aliases: stale });
  }
  return out;
}
