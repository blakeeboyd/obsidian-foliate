import { App, Editor, Notice, TFile, Vault } from "obsidian";
import { TaxaMapping, PortfolioSettings } from "../types";
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
  settings: PortfolioSettings
): Promise<void> {
  const hasPrefix = selectedText.startsWith(taxon.prefix);
  const cleanName = hasPrefix
    ? stripPrefix(selectedText, taxon)
    : selectedText;
  const fileName = addPrefix(cleanName, taxon);
  const filePath = `${taxon.folder}/${fileName}.md`;

  // Ensure folder exists
  if (settings.createFolderIfMissing) {
    await ensureFolderExists(app.vault, taxon.folder);
  }

  // Create file if it doesn't exist
  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    // Also check if it exists in the root (before auto-move)
    file = app.vault.getAbstractFileByPath(`${fileName}.md`);
  }

  if (!file) {
    try {
      const newFile = await app.vault.create(filePath, "");
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
