import { App, Editor, Notice, TFile, Vault, moment } from "obsidian";
import { TaxaMapping, EnfoliateSettings } from "../types";
import { stripPrefix, addPrefix } from "../taxa";

/**
 * The folder a taxon's files should live in. When the taxon has no folder
 * configured and `autoCreateTaxaFolder` is on, fall back to a folder named
 * after the taxon (its label, or prefix if unlabeled) so files get a home
 * instead of erroring or landing at the vault root. `derived` is true when the
 * name was generated this way, signaling the caller to create it regardless of
 * the "Create folders if missing" setting. Returns an empty folder when there
 * is no usable destination.
 */
export function resolveTaxaFolder(
  taxon: TaxaMapping,
  settings: EnfoliateSettings
): { folder: string; derived: boolean } {
  const configured = taxon.folder.trim();
  if (configured) return { folder: configured, derived: false };
  if (settings.autoCreateTaxaFolder) {
    const name = sanitizeFolderName(taxon.label || taxon.prefix);
    if (name) return { folder: name, derived: true };
  }
  return { folder: "", derived: false };
}

/** Strip characters illegal in a folder name and collapse surrounding space. */
function sanitizeFolderName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, "").trim();
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
  settings: EnfoliateSettings
): Promise<void> {
  const hasPrefix = selectedText.startsWith(taxon.prefix);
  const cleanName = hasPrefix
    ? stripPrefix(selectedText, taxon)
    : selectedText;
  const fileName = addPrefix(cleanName, taxon);
  const { folder, derived } = resolveTaxaFolder(taxon, settings);
  const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

  // Ensure folder exists. An auto-derived folder is always created; a
  // configured path is created only when "Create folders if missing" is on.
  if (folder && (settings.createFolderIfMissing || derived)) {
    await ensureFolderExists(app.vault, folder);
  }

  // Create file if it doesn't exist
  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    // Also check if it exists in the root (before auto-move)
    file = app.vault.getAbstractFileByPath(`${fileName}.md`);
  }

  if (!file) {
    try {
      const tmpl = await renderTemplate(app, taxon, cleanName);
      const newFile = await app.vault.create(filePath, tmpl.content);
      // If the template uses Templater syntax, let Templater process the file
      // before we touch the frontmatter, so its <% %> commands resolve.
      if (tmpl.hasTemplater) await runTemplater(app, newFile);
      await addAliasToFile(app, newFile, cleanName);
      file = newFile;
    } catch (e) {
      new Notice(`Failed to create ${fileName}: ${e}`);
      return;
    }
  } else if (file instanceof TFile) {
    await addAliasToFile(app, file, cleanName);
  }

  // Replace selection with wikilink
  const wikilink = `[[${fileName}|${cleanName}]]`;
  editor.replaceSelection(wikilink);

  new Notice(`Linked ${cleanName} as ${taxon.label}`);
}

/**
 * Build the initial content for a new taxa file from the taxon's template, if
 * one is configured. The template engine is auto-detected:
 * - {{...}} tokens are always filled by Enfoliate: {{title}} (also
 *   {{name}}/{{alias}}), {{prefix}}, {{label}}, and the core-Templates date
 *   tokens {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}}.
 * - If the template also contains Templater syntax (<% ... %>), hasTemplater is
 *   set so the caller can run Templater on the created file.
 * Returns empty content when there is no template (or it can't be read).
 */
async function renderTemplate(
  app: App,
  taxon: TaxaMapping,
  name: string
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
    .replace(/\{\{\s*(title|name|alias)\s*\}\}/gi, name)
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
