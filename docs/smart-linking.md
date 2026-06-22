# Smart Linking

Enfoliate provides several ways to create taxa links without manually typing wikilinks or managing files.

## Create taxa link (command)

1. Select text in the editor
2. Run **Create taxa link** from the command palette (`Ctrl/Cmd+P`)

What happens next depends on whether the selected text starts with a known taxa prefix:

**Prefix detected:** Enfoliate creates the file in the correct folder (if it doesn't already exist), adds the clean name as a frontmatter alias, and replaces the selection with a wikilink like `[[+Metaphor|Metaphor]]`.

**Matches an existing taxon:** If the selection has no prefix but matches exactly one existing taxa file (by name or alias), Enfoliate links straight to it, skipping the picker. For example, selecting "Ada Lovelace" links to `@Ada Lovelace`.

**No prefix and no match:** A picker modal opens listing all configured taxa types. Choose one, and Enfoliate creates the file with the appropriate prefix and replaces the selection with a wikilink.

If the file already exists (either in the taxa folder or at the vault root before auto-move runs), Enfoliate links to the existing file and adds the alias if it's not already present.

## Link from the suggestions sidebar

The [suggestions sidebar](suggestions-sidebar.md) offers one-click linking for unlinked mentions:

- **Link:** wraps one occurrence in a wikilink (the one you last jumped to, else the first in view)
- **Link all:** wraps every occurrence of a term in wikilinks, working backwards through the document to preserve character positions

See [Suggestions Sidebar](suggestions-sidebar.md) for details.

## How linking works internally

When you link text through any of these methods, Enfoliate:

1. Determines the clean name (strips the prefix if present)
2. Builds the filename: `prefix + clean name`
3. Checks if the file exists in the taxa folder or vault root
4. Creates the file if it doesn't exist, with an empty body
5. Adds the clean name as a frontmatter alias (sorted longest-first)
6. Replaces the editor selection with `[[prefixName|cleanName]]`
