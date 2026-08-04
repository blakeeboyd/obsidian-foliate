import { App, Editor, Notice, TFile, Vault, moment, apiVersion } from "obsidian";
import { TaxaMapping, FoliateSettings } from "../types";
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
      problems.push(`${id}: no template configured, so new files are created empty.`);
      continue;
    }

    const file = resolveTemplateFile(app, taxon.template);
    if (!file) {
      lines.push(`  ${id}: folder=${folder} template=${taxon.template} -> NOT FOUND`);
      problems.push(`${id}: template "${taxon.template}" does not resolve to any file.`);
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
      problems.push(`${id}: template "${file.path}" is empty, so new files come out empty.`);
    }
    if (usesTemplater && !templater) {
      problems.push(
        `${id}: template uses Templater <% %> syntax but Templater is not installed, so it is written unprocessed.`
      );
    }
    if (!folderExists && !settings.createFolderIfMissing) {
      problems.push(`${id}: folder "${folder}" does not exist and "create folders if missing" is off.`);
    }
  }

  // Every file carrying the domain prefix, grouped by the name the picker shows.
  // Names that look identical on screen can differ by trailing whitespace, a
  // non-breaking space, or Unicode normalization (NFC vs NFD), so escapeName
  // makes those visible: a duplicate row in the picker is only diagnosable if
  // the report distinguishes "same name, two files" from "two names that render
  // the same".
  const domainPrefix = settings.domain.prefix;
  const domainFiles = app.vault
    .getMarkdownFiles()
    .filter((f) => f.basename.startsWith(domainPrefix));

  lines.push("");
  lines.push(`Domain files (${domainFiles.length}):`);

  if (domainFiles.length === 0) {
    lines.push("  (none)");
  } else {
    const byName = new Map<string, TFile[]>();
    for (const f of domainFiles) {
      const name = f.basename.slice(domainPrefix.length);
      const group = byName.get(name);
      if (group) group.push(f);
      else byName.set(name, [f]);
    }

    for (const name of [...byName.keys()].sort((a, b) => a.localeCompare(b))) {
      const group = byName.get(name)!;
      const dup = group.length > 1 ? `  <-- ${group.length} FILES SHARE THIS NAME` : "";
      lines.push(`  "${escapeName(name)}"${dup}`);
      for (const f of group) lines.push(`      ${f.path}`);
      if (group.length > 1) {
        problems.push(
          `${group.length} domain files share the name "${name}", so the picker lists it more than once ` +
            `and a bare [[${domainPrefix}${name}]] link cannot address one of them: ${group
              .map((f) => f.path)
              .join(", ")}`
        );
      }
    }

    // Names that differ only by case, whitespace, or Unicode form render alike
    // in the picker but are distinct strings, so the grouping above keeps them
    // apart. Flag them separately or they read as an unexplained duplicate.
    const byLoose = new Map<string, string[]>();
    for (const name of byName.keys()) {
      const loose = name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
      const group = byLoose.get(loose);
      if (group) group.push(name);
      else byLoose.set(loose, [name]);
    }
    for (const [loose, variants] of byLoose) {
      if (variants.length < 2) continue;
      problems.push(
        `Domain names that render alike but are different strings (${loose}): ` +
          variants.map((v) => `"${escapeName(v)}"`).join(" vs ")
      );
    }
  }

  lines.push("");
  lines.push(problems.length ? "Problems found:" : "Problems found: none");
  problems.forEach((p) => lines.push(`  - ${p}`));

  return lines.join("\n");
}

/**
 * Render a name so invisible differences survive a copy-paste: non-ASCII
 * characters become \uXXXX escapes and spaces are marked, so a trailing space or
 * a decomposed accent is visible in a pasted bug report.
 */
function escapeName(name: string): string {
  return [...name]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (ch === " ") return " ";
      if (cp < 0x20 || cp > 0x7e) {
        return `\\u${cp.toString(16).padStart(4, "0")}`;
      }
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
