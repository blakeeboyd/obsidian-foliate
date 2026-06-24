import { App, Editor, Notice, TFile, Vault, moment } from "obsidian";
import { TaxaMapping, FoliateSettings } from "../types";
import { stripPrefix, addPrefix } from "../taxa";

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
): Promise<void> {
  const hasPrefix = selectedText.startsWith(taxon.prefix);
  const cleanName = hasPrefix
    ? stripPrefix(selectedText, taxon)
    : selectedText;

  const file = await createTaxaFile(app, cleanName, taxon, settings);
  if (!file) return;

  // Replace selection with wikilink
  const fileName = addPrefix(cleanName, taxon);
  const wikilink = `[[${fileName}|${cleanName}]]`;
  editor.replaceSelection(wikilink);

  new Notice(`Linked ${cleanName} as ${taxon.label}`);
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
  const fileName = addPrefix(cleanName, taxon);
  const folder = taxon.folder.trim();
  const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

  // Ensure the configured folder exists when "Create folders if missing" is on.
  if (folder && settings.createFolderIfMissing) {
    await ensureFolderExists(app.vault, folder);
  }

  // Reuse the file if it already exists (in the taxa folder or at the root,
  // before auto-move).
  let file =
    app.vault.getAbstractFileByPath(filePath) ??
    app.vault.getAbstractFileByPath(`${fileName}.md`);

  if (!file) {
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
    }
  }

  if (file instanceof TFile) {
    if (settings.autoAddAlias) await addAliasToFile(app, file, cleanName);
    return file;
  }
  return null;
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
  const tmpl = app.vault.getAbstractFileByPath(taxon.template);
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
