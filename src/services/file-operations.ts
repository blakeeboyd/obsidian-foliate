import { App, Editor, Notice, TFile, Vault, moment, apiVersion } from "obsidian";
import { TaxaMapping, FoliateSettings, INLINE_ACTION_OPTIONS } from "../types";
import { stripPrefix } from "../taxa";

/**
 * Paths Foliate is in the middle of creating. The auto-mover skips any file
 * whose path is in here, so it never races a file Foliate is itself building:
 * createTaxaFile already places the file in the taxon folder and applies the
 * template + alias, and a concurrent auto-move (fired by the create event)
 * would move the file out from under those steps, corrupting the result or the
 * links. The creator adds the path before vault.create and removes it once its
 * whole sequence finishes.
 */
export const suppressAutoMove = new Set<string>();

/**
 * The existing file for a taxon+cleanName, if any: in the taxon folder or at the
 * vault root (pre-auto-move). Shared by createTaxaFile (reuse check) and
 * createTaxaLink (to tell whether it created a new file), so the two can't
 * diverge on what "already exists" means.
 */
export function findExistingTaxaFile(
  app: App,
  cleanName: string,
  taxon: TaxaMapping
): TFile | null {
  const fileName = taxon.prefix + cleanName;
  const folder = taxon.folder.trim();
  const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
  const f =
    app.vault.getAbstractFileByPath(filePath) ??
    app.vault.getAbstractFileByPath(`${fileName}.md`);
  return f instanceof TFile ? f : null;
}

/**
 * Create a taxa link from selected text.
 * - Builds the filename with prefix
 * - Creates the file if it doesn't exist (in the taxa folder)
 * - Adds the alias to frontmatter
 * - Replaces the editor selection with a wikilink
 */
export async function createTaxaLink(
  app: App,
  editor: Editor,
  selectedText: string,
  taxon: TaxaMapping,
  settings: FoliateSettings
): Promise<TFile | null> {
  const hasPrefix = selectedText.startsWith(taxon.prefix);
  const cleanName = hasPrefix
    ? stripPrefix(selectedText, taxon)
    : selectedText;

  const existed = findExistingTaxaFile(app, cleanName, taxon) != null;
  const file = await createTaxaFile(app, cleanName, taxon, settings);
  if (!file) return null;

  // Replace selection with wikilink
  const fileName = taxon.prefix + cleanName;
  const wikilink = `[[${fileName}|${cleanName}]]`;
  editor.replaceSelection(wikilink);

  new Notice(`Linked ${cleanName} as ${taxon.label}`);
  // Return the file only when it was newly created, so callers can offer a
  // follow-up (e.g. assign a domain) without nagging on links to existing files.
  return existed ? null : file;
}

/**
 * Create (or reuse) the taxa file for `cleanName` in `taxon`'s folder, applying
 * the taxon template, Templater, and alias just as createTaxaLink does, but
 * without touching any editor. Used when a link to a missing file already exists
 * in a note and the user wants to bring the file into being. Returns the file,
 * or null if creation failed (a Notice is shown on failure).
 *
 * `cleanName` is the name without the taxa prefix; the prefix is added here.
 */
export async function createTaxaFile(
  app: App,
  cleanName: string,
  taxon: TaxaMapping,
  settings: FoliateSettings
): Promise<TFile | null> {
  const fileName = taxon.prefix + cleanName;
  const folder = taxon.folder.trim();
  const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

  // Ensure the configured folder exists when "Create folders if missing" is on.
  if (folder && settings.createFolderIfMissing) {
    await ensureFolderExists(app.vault, folder);
  }

  // Reuse the file if it already exists (in the taxa folder or at the root,
  // before auto-move).
  let file: TFile | null = findExistingTaxaFile(app, cleanName, taxon);

  if (!file) {
    // Suppress the auto-mover for this path while we build the file: the create
    // event would otherwise fire a concurrent move that races the template and
    // alias steps below. createTaxaFile already writes the file into the taxon
    // folder, so no move is needed anyway.
    suppressAutoMove.add(filePath);
    try {
      const tmpl = await renderTemplate(app, taxon, cleanName, fileName);
      const newFile = await app.vault.create(filePath, tmpl.content);
      // If the template uses Templater syntax, let Templater process the file
      // before we touch the frontmatter, so its <% %> commands resolve.
      if (tmpl.hasTemplater) await runTemplater(app, newFile);
      if (settings.autoAddAlias) await addAliasToFile(app, newFile, cleanName);
      return newFile;
    } catch (e) {
      new Notice(`Failed to create ${fileName}: ${e}`);
      return null;
    } finally {
      suppressAutoMove.delete(filePath);
    }
  }

  if (file instanceof TFile) {
    if (settings.autoAddAlias) await addAliasToFile(app, file, cleanName);
    return file;
  }
  return null;
}

/**
 * Build a plain-text diagnostic report, meant to be copied to the clipboard and
 * pasted into a bug report. Creates nothing.
 *
 * Two halves, deliberately different in kind:
 * - A dump of the environment, every setting, and every taxon. Derived from the
 *   settings object rather than a hand-listed set of fields, so a new setting
 *   shows up here without anyone remembering to add it.
 * - "Problems found": checks only for failures the plugin is otherwise SILENT
 *   about, all of them in the template path (none configured, path doesn't
 *   resolve, template empty, Templater syntax with Templater absent). Visible
 *   misbehaviour (wrong click action, a file missing from the sidebar) is not
 *   guessed at here: the dump gives the reader the state, and a static check
 *   couldn't diagnose it anyway.
 */
export async function buildDebugReport(
  app: App,
  settings: FoliateSettings,
  pluginVersion = "?"
): Promise<string> {
  const templater = (app as any).plugins?.plugins?.["templater-obsidian"];
  const templaterVersion = templater?.manifest?.version ?? "";
  const lines: string[] = [];
  const problems: string[] = [];
  // Set when a template needs Templater and it isn't installed, so the fix can
  // be suggested once rather than per affected taxon.
  let templaterProblem = false;

  lines.push("Foliate debug report");
  lines.push(
    `Foliate ${pluginVersion} | Obsidian API ${apiVersion} | Templater: ` +
      (templater ? `installed ${templaterVersion}` : "NOT installed")
  );

  const enabled: string[] = (app as any).plugins?.enabledPlugins
    ? [...(app as any).plugins.enabledPlugins]
    : [];
  if (enabled.length) {
    lines.push(`Other plugins enabled (${enabled.length}): ${enabled.sort().join(", ")}`);
  }

  // Settings dump, derived from the object so new settings appear automatically.
  // taxaMappings/domain are rendered in the Taxa section below; contextAware can
  // be large, so summarize it by count.
  lines.push("");
  lines.push("Settings:");
  const skip = new Set(["taxaMappings", "domain", "contextAware", "collapsedCategories"]);
  for (const [key, value] of Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))) {
    if (skip.has(key)) continue;
    lines.push(`  ${key}=${Array.isArray(value) ? `[${value.join(", ")}]` : String(value)}`);
  }
  lines.push(`  contextAware=${Object.keys(settings.contextAware ?? {}).length} entries`);
  lines.push(`  collapsedCategories=${(settings.collapsedCategories ?? []).length} collapsed`);

  lines.push("");
  lines.push("Taxa:");

  for (const taxon of [...settings.taxaMappings, settings.domain]) {
    // Label first: taxa prefixes are symbols that can get mangled in a paste.
    const id = `${taxon.label} (prefix ${taxon.prefix})`;
    const folder = taxon.folder?.trim() || "(vault root)";
    const folderExists = !taxon.folder?.trim() || !!app.vault.getAbstractFileByPath(taxon.folder.trim());

    if (!taxon.template) {
      lines.push(`  ${id}: folder=${folder} template=(none set)`);
      problems.push(`${id}: no template configured; new files are created empty`);
      continue;
    }

    const file = resolveTemplateFile(app, taxon.template);
    if (!file) {
      lines.push(`  ${id}: folder=${folder} template=${taxon.template} -> NOT FOUND`);
      problems.push(`${id}: template "${taxon.template}" does not resolve to a file`);
      continue;
    }

    const exact = file.path === taxon.template;
    const raw = await app.vault.cachedRead(file);
    const usesTemplater = raw.includes("<%");
    lines.push(
      `  ${id}: folder=${folder} template=${taxon.template}` +
        (exact ? "" : ` -> resolved by basename to ${file.path}`) +
        ` (${raw.length} chars${usesTemplater ? ", uses Templater <% %>" : ""})`
    );
    if (raw.trim() === "") {
      problems.push(`${id}: template "${file.path}" is empty; new files are created empty`);
    }
    if (usesTemplater && !templater) {
      templaterProblem = true;
      problems.push(
        `${id}: template uses <% %> but Templater is not installed; written unprocessed`
      );
    }
    if (!folderExists && !settings.createFolderIfMissing) {
      problems.push(`${id}: folder "${folder}" does not exist; createFolderIfMissing=false`);
    }
  }

  // Taxa file counts, plus any name carried by more than one file. Covers every
  // taxon, not just domains: a duplicate name is ambiguous for a link wherever
  // it occurs. Listing every taxa file would run to thousands of lines, so only
  // the duplicates are named.
  //
  // Names are escaped so invisible differences show: two files that look
  // identically named can differ by a trailing space, a non-breaking space, or
  // Unicode normalization (NFC vs NFD), and that distinction is the difference
  // between "one name, two files" and "two names that render alike".
  const allTaxa = [...settings.taxaMappings, settings.domain];
  const sortedTaxa = [...allTaxa].sort((a, b) => b.prefix.length - a.prefix.length);

  const filesByTaxon = new Map<TaxaMapping, TFile[]>(allTaxa.map((t) => [t, []]));
  for (const f of app.vault.getMarkdownFiles()) {
    const taxon = sortedTaxa.find((t) => t.prefix && f.basename.startsWith(t.prefix));
    if (taxon) filesByTaxon.get(taxon)!.push(f);
  }

  lines.push("");
  lines.push("Taxa files:");
  let misplacedCount = 0;
  for (const taxon of allTaxa) {
    const files = filesByTaxon.get(taxon)!;
    const folder = taxon.folder?.trim();
    const outside = folder ? files.filter((f) => f.parent?.path !== folder).length : 0;
    misplacedCount += outside;
    lines.push(
      `  ${taxon.label} (prefix ${taxon.prefix}): ${files.length} files` +
        (outside > 0 ? `, ${outside} outside ${folder}` : "")
    );
  }
  // The remedy sits with the finding rather than in a list at the end. Phrased
  // as a fix reference, not a sentence of advice: this is a technical report.

  // Duplicates, across every taxon. Only counted here: the command's modal lists
  // the offending paths, so repeating them in the report is noise.
  let duplicateCount = 0;
  for (const taxon of allTaxa) {
    const byName = new Map<string, TFile[]>();
    for (const f of filesByTaxon.get(taxon)!) {
      const name = stripPrefix(f.basename, taxon);
      const group = byName.get(name);
      if (group) group.push(f);
      else byName.set(name, [f]);
    }

    for (const name of [...byName.keys()].sort((a, b) => a.localeCompare(b))) {
      const group = byName.get(name)!;
      if (group.length < 2) continue;
      duplicateCount++;
    }

    // Names that differ only by case, whitespace, or Unicode form render alike
    // but are distinct strings, so the grouping above keeps them apart. Flag
    // them separately or they read as an unexplained duplicate.
    const byLoose = new Map<string, string[]>();
    for (const name of byName.keys()) {
      const loose = name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
      const group = byLoose.get(loose);
      if (group) group.push(name);
      else byLoose.set(loose, [name]);
    }
    for (const variants of byLoose.values()) {
      if (variants.length < 2) continue;
      problems.push(
        `${taxon.label}: names differ only by invisible characters: ` +
          variants.map((v) => escapeName(taxon.prefix + v)).join(" | ")
      );
    }
  }

  // Findings get one section each, in the order they should be acted on:
  // duplicates first, since resolving one also places the file it keeps.
  lines.push("");
  if (duplicateCount === 0) {
    lines.push("Duplicate names: none");
  } else {
    lines.push(`Duplicate names: ${duplicateCount}`);
    lines.push(`  fix: command "Find misplaced and duplicate taxa files" > Resolve`);
  }

  lines.push("");
  if (misplacedCount === 0) {
    lines.push("Misplaced files: none");
  } else {
    lines.push(`Misplaced files: ${misplacedCount} (a subfolder of the taxon folder counts as outside)`);
    lines.push(`  fix: command "Find misplaced and duplicate taxa files" > Move all`);
  }

  // Configuration faults that produce no visible error: the plugin simply does
  // nothing, or something other than what was configured. These are the states
  // a bug report can't describe ("it isn't working") but the report can name.
  const configured = allTaxa.filter((t) => t.prefix);

  // A taxon with no folder never auto-moves and creates files at the vault root.
  for (const taxon of configured) {
    if (!taxon.folder?.trim()) {
      problems.push(`${taxon.label} (prefix ${taxon.prefix}): no folder set; auto-move is inert, files land at vault root`);
    }
  }

  // An empty prefix can't identify a taxon, so its files are never recognized.
  for (const taxon of allTaxa) {
    if (!taxon.prefix) {
      problems.push(`${taxon.label}: no prefix set; this taxon matches nothing`);
    }
  }

  // Two taxa on one prefix: whichever sorts first wins every lookup.
  const byPrefix = new Map<string, string[]>();
  for (const taxon of configured) {
    const list = byPrefix.get(taxon.prefix);
    if (list) list.push(taxon.label);
    else byPrefix.set(taxon.prefix, [taxon.label]);
  }
  for (const [prefix, labels] of byPrefix) {
    if (labels.length > 1) {
      problems.push(`prefix "${prefix}" used by ${labels.length} taxa (${labels.join(", ")}); only one can match`);
    }
  }

  // Nested taxa folders: a file under both matches whichever is checked first.
  for (const a of configured) {
    const af = a.folder?.trim();
    if (!af) continue;
    for (const b of configured) {
      const bf = b.folder?.trim();
      if (!bf || a === b) continue;
      if (bf.startsWith(af + "/")) {
        problems.push(`${b.label} folder "${bf}" is inside ${a.label} folder "${af}"; files match both taxa`);
      }
    }
  }

  // Folder configured but absent, with no auto-creation to cover it.
  for (const taxon of configured) {
    const folder = taxon.folder?.trim();
    if (folder && !app.vault.getAbstractFileByPath(folder) && !settings.createFolderIfMissing) {
      problems.push(`${taxon.label}: folder "${folder}" does not exist; createFolderIfMissing=false`);
    }
  }

  // Inline-action ids the renderer doesn't know: the button never appears.
  const knownActions = new Set(INLINE_ACTION_OPTIONS.map((o) => o.id));
  const unknownActions = (settings.inlineActions ?? []).filter((id) => !knownActions.has(id));
  if (unknownActions.length > 0) {
    problems.push(
      `inlineActions contains unknown id(s): ${unknownActions.join(", ")}; ` +
        `no button is rendered for them (known: ${[...knownActions].join(", ")})`
    );
  }

  // Context-aware entries whose file is gone: the gating silently stops applying.
  const staleContext = Object.keys(settings.contextAware ?? {}).filter(
    (path) => !(app.vault.getAbstractFileByPath(path) instanceof TFile)
  );
  if (staleContext.length > 0) {
    problems.push(
      `contextAware has ${staleContext.length} entr${staleContext.length === 1 ? "y" : "ies"} for missing files: ` +
        staleContext.slice(0, 5).join(", ") +
        (staleContext.length > 5 ? `, +${staleContext.length - 5} more` : "")
    );
  }

  // Context-aware entries that gate nothing are inert config.
  const emptyGates = Object.entries(settings.contextAware ?? {}).filter(
    ([, cfg]) => (cfg?.gatedAliases ?? []).length === 0
  ).length;
  if (emptyGates > 0) {
    problems.push(`contextAware has ${emptyGates} entr${emptyGates === 1 ? "y" : "ies"} with no gated terms; they gate nothing`);
  }

  // Blocklist terms matching no current taxa file: leftover suppression.
  if ((settings.blocklist ?? []).length > 0) {
    const allTerms = new Set<string>();
    for (const taxon of allTaxa) {
      for (const f of filesByTaxon.get(taxon) ?? []) {
        allTerms.add(stripPrefix(f.basename, taxon).toLowerCase());
      }
    }
    const deadBlocks = settings.blocklist.filter((b) => !allTerms.has(b.toLowerCase()));
    if (deadBlocks.length > 0) {
      problems.push(
        `blocklist has ${deadBlocks.length} term(s) matching no taxa file: ` +
          deadBlocks.slice(0, 5).join(", ") +
          (deadBlocks.length > 5 ? `, +${deadBlocks.length - 5} more` : "")
      );
    }
  }

  // Duplicates are NOT added to `problems`: they have their own section above.
  // "Problems found" is for faults with no section of their own.
  lines.push("");
  if (problems.length === 0) {
    lines.push("Problems found: none");
  } else {
    lines.push("Problems found:");
    if (templaterProblem) {
      lines.push("  fix: install Templater, or remove <% %> syntax from the templates");
    }
    problems.forEach((p) => lines.push(`  - ${p}`));
  }

  return lines.join("\n");
}

/**
 * Render a name so invisible differences survive a copy-paste, while leaving
 * legible characters alone.
 *
 * Only characters you cannot see are escaped: control characters, zero-width
 * marks, combining marks (a decomposed accent), and non-standard spaces. Taxa
 * prefixes (©, ≈, ∞) and accented letters (Jünglinge, Orphée) are ordinary
 * content and stay readable. Escaping every non-ASCII character turned normal
 * names into "©Gesang der Jünglinge", which hid the very differences
 * this is meant to reveal.
 */
function escapeName(name: string): string {
  const esc = (cp: number) => `\\u${cp.toString(16).padStart(4, "0")}`;

  return [...name]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      // Control characters.
      if (cp < 0x20 || cp === 0x7f) return esc(cp);
      // Any whitespace that isn't a plain space: NBSP, thin, ideographic.
      if (ch !== " " && /\s/.test(ch)) return esc(cp);
      // Zero-width space/non-joiner/joiner, directional marks, BOM.
      if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || cp === 0xfeff) {
        return esc(cp);
      }
      // Combining marks: the tell for NFD, where "e" plus U+0301 renders as "é".
      if (/\p{Mn}/u.test(ch)) return esc(cp);
      return ch;
    })
    .join("")
    .replace(/^ | $/g, "␣"); // open box marks a leading/trailing space
}

/**
 * Resolve a taxon's template setting to a TFile. Tries the value as a full vault
 * path first (what the file picker stores), then falls back to matching by
 * basename so legacy configs that stored a bare "Name.md" still resolve even if
 * the template lives in a subfolder. Returns null if nothing matches.
 */
export function resolveTemplateFile(app: App, template: string): TFile | null {
  const exact = app.vault.getAbstractFileByPath(template);
  if (exact instanceof TFile) return exact;
  const base = template.endsWith(".md") ? template : `${template}.md`;
  return app.vault.getMarkdownFiles().find((f) => f.name === base) ?? null;
}

/**
 * Build the initial content for a new taxa file from the taxon's template, if
 * one is configured. The template engine is auto-detected:
 * - {{...}} tokens are always filled by Foliate: {{title}} resolves to the
 *   actual file name (prefix included, e.g. "@Ada Lovelace"), while
 *   {{name}}/{{alias}} resolve to the stripped name without the prefix. Also
 *   {{prefix}}, {{label}}, and the core-Templates date tokens {{date}},
 *   {{time}}, {{date:FORMAT}}, {{time:FORMAT}}.
 * - If the template also contains Templater syntax (<% ... %>), hasTemplater is
 *   set so the caller can run Templater on the created file.
 * Returns empty content when there is no template (or it can't be read).
 */
async function renderTemplate(
  app: App,
  taxon: TaxaMapping,
  name: string,
  fileName: string
): Promise<{ content: string; hasTemplater: boolean }> {
  if (!taxon.template) return { content: "", hasTemplater: false };
  const tmpl = resolveTemplateFile(app, taxon.template);
  if (!(tmpl instanceof TFile)) {
    new Notice(`Template not found: ${taxon.template}`);
    return { content: "", hasTemplater: false };
  }
  const raw = await app.vault.read(tmpl);
  const content = raw
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/gi, (_m, fmt) => moment().format(fmt))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/gi, (_m, fmt) => moment().format(fmt))
    .replace(/\{\{\s*date\s*\}\}/gi, moment().format("YYYY-MM-DD"))
    .replace(/\{\{\s*time\s*\}\}/gi, moment().format("HH:mm"))
    .replace(/\{\{\s*title\s*\}\}/gi, fileName)
    .replace(/\{\{\s*(name|alias)\s*\}\}/gi, name)
    .replace(/\{\{\s*prefix\s*\}\}/gi, taxon.prefix)
    .replace(/\{\{\s*label\s*\}\}/gi, taxon.label);
  return { content, hasTemplater: raw.includes("<%") };
}

/**
 * Run the installed Templater plugin over a file, resolving its <% %> commands
 * in place. No-op if Templater isn't installed.
 */
async function runTemplater(app: App, file: TFile): Promise<void> {
  const templater = (app as any).plugins?.plugins?.["templater-obsidian"]?.templater;
  if (!templater || typeof templater.overwrite_file_commands !== "function") return;
  try {
    await templater.overwrite_file_commands(file);
  } catch (e) {
    new Notice(`Templater processing failed: ${e}`);
  }
}

/**
 * Assign a taxa file to a domain: ensure the domain (≈Name) file exists,
 * creating it via the domain mapping if not, then add a `[[≈Name]]` wikilink to
 * the taxa file's `domains` frontmatter list. `domainName` is the clean name
 * without the ≈ prefix. Idempotent: a domain already listed is not duplicated.
 * Taxa link *up* to domains, so the link lives on the member (the taxa file).
 */
export async function addFileToDomain(
  app: App,
  taxaFile: TFile,
  domainName: string,
  settings: FoliateSettings
): Promise<void> {
  const clean = stripPrefix(domainName.trim(), settings.domain);
  if (!clean) return;

  // Create the ≈ file if it doesn't exist yet (in the domain folder, templated).
  await createTaxaFile(app, clean, settings.domain, settings);

  const link = `[[${settings.domain.prefix}${clean}]]`;
  await app.fileManager.processFrontMatter(taxaFile, (fm) => {
    if (!fm.domains) fm.domains = [];
    else if (!Array.isArray(fm.domains)) fm.domains = [fm.domains];
    if (!fm.domains.includes(link)) fm.domains.push(link);
  });
  new Notice(`Added to ${settings.domain.prefix}${clean}`);
}

/**
 * Add an alias to a file's frontmatter if not already present.
 * Sorts aliases longest-to-shortest for optimal backlink detection.
 */
export async function addAliasToFile(
  app: App,
  file: TFile,
  alias: string
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!fm.aliases) {
      fm.aliases = [];
    }
    if (!Array.isArray(fm.aliases)) {
      fm.aliases = [fm.aliases];
    }
    if (!fm.aliases.includes(alias)) {
      fm.aliases.push(alias);
      fm.aliases.sort((a: string, b: string) => b.length - a.length);
    }
  });
}

/**
 * Ensure a folder path exists, creating intermediate folders as needed.
 */
export async function ensureFolderExists(
  vault: Vault,
  folderPath: string
): Promise<void> {
  const existing = vault.getAbstractFileByPath(folderPath);
  if (existing) return;

  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = vault.getAbstractFileByPath(current);
    if (!folder) {
      await vault.createFolder(current);
    }
  }
}

/**
 * A taxa or domain file that carries a taxon's prefix but doesn't live in that
 * taxon's folder. Auto-move handles this on create and rename, so a stray file
 * means it was moved by hand, created before the folder was configured, or
 * arrived through Sync from a vault with different settings.
 */
export interface MisplacedFile {
  file: TFile;
  taxon: TaxaMapping;
  currentFolder: string;
  targetFolder: string;
  /** A file already sits at the target path, so moving would collide. */
  blocked: boolean;
}

/**
 * Find every taxa or domain file that isn't in its taxon's folder.
 *
 * Taxa with no configured folder are skipped: with no target there is nowhere
 * for a file to be misplaced from. The domain is included alongside the regular
 * taxa, since it has the same shape and the same folder expectation.
 */
export function findMisplacedTaxaFiles(
  app: App,
  settings: FoliateSettings
): MisplacedFile[] {
  const taxa = [...settings.taxaMappings, settings.domain].filter((t) => t.folder?.trim());
  if (taxa.length === 0) return [];

  const misplaced: MisplacedFile[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    // Longest prefix first, so a multi-character prefix isn't shadowed by a
    // single-character one that happens to be its first character.
    const taxon = [...taxa]
      .sort((a, b) => b.prefix.length - a.prefix.length)
      .find((t) => file.basename.startsWith(t.prefix));
    if (!taxon) continue;

    const target = taxon.folder.trim();
    const current = file.parent?.path ?? "/";
    if (current === target) continue;

    misplaced.push({
      file,
      taxon,
      currentFolder: current,
      targetFolder: target,
      blocked: !!app.vault.getAbstractFileByPath(`${target}/${file.name}`),
    });
  }
  return misplaced.sort(
    (a, b) => a.taxon.label.localeCompare(b.taxon.label) || a.file.basename.localeCompare(b.file.basename)
  );
}

/**
 * Two or more taxa/domain files sharing a name in different folders.
 *
 * A wikilink like [[≈AI]] carries no path, so with two ≈AI files Obsidian
 * resolves it to whichever it finds first: membership and links can silently
 * attach to the wrong file, and pickers list the name twice. Files in the same
 * folder can't collide (the filesystem forbids it), so a duplicate is always
 * cross-folder.
 */
export interface DuplicateTaxaName {
  /** The shared basename, prefix included (e.g. "≈AI"). */
  name: string;
  taxon: TaxaMapping;
  files: TFile[];
  /** The copy in the taxon's folder, if exactly one of them is there. */
  canonical: TFile | null;
}

/**
 * Find taxa and domain files that share a name across folders.
 *
 * Unlike findMisplacedTaxaFiles, this does not need a configured folder: two
 * files with the same name are ambiguous wherever they live. When the taxon does
 * have a folder and exactly one copy is in it, that copy is reported as the
 * canonical one, which is the answer to "which of these should I keep".
 */
export function findDuplicateTaxaNames(
  app: App,
  settings: FoliateSettings
): DuplicateTaxaName[] {
  const taxa = [...settings.taxaMappings, settings.domain];
  // Longest prefix first so a multi-character prefix isn't shadowed.
  const sorted = [...taxa].sort((a, b) => b.prefix.length - a.prefix.length);

  const byName = new Map<string, { taxon: TaxaMapping; files: TFile[] }>();
  for (const file of app.vault.getMarkdownFiles()) {
    const taxon = sorted.find((t) => t.prefix && file.basename.startsWith(t.prefix));
    if (!taxon) continue;
    const entry = byName.get(file.basename);
    if (entry) entry.files.push(file);
    else byName.set(file.basename, { taxon, files: [file] });
  }

  const dupes: DuplicateTaxaName[] = [];
  for (const [name, { taxon, files }] of byName) {
    if (files.length < 2) continue;
    const folder = taxon.folder?.trim();
    const inFolder = folder ? files.filter((f) => f.parent?.path === folder) : [];
    dupes.push({
      name,
      taxon,
      files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
      canonical: inFolder.length === 1 ? inFolder[0] : null,
    });
  }
  return dupes.sort(
    (a, b) => a.taxon.label.localeCompare(b.taxon.label) || a.name.localeCompare(b.name)
  );
}
