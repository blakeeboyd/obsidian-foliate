# Settings Reference

All settings are in **Settings → Enfoliate**.

## Taxa Mappings

A table of all configured taxa types. Each row has these fields:

| Field  | Description |
|--------|-------------|
| Prefix | Character(s) that identify this taxon in filenames (e.g. `@`) |
| Label  | Display name (e.g. "People") |
| Folder | Target folder path relative to vault root |
| Template | Optional path to a template file used as the starting content for new files of this taxon. Supports `{{title}}` (the entity name, also `{{name}}`/`{{alias}}`), `{{prefix}}`, and `{{label}}` |

- **Add Taxa** — click the "Add Taxa" button below the table
- **Restore defaults** — restore the default set of taxa prefixes and labels (after a confirmation). Your existing folder paths are kept for prefixes you already have; newly added taxa start with an empty folder. Never moves or renames files
- **Edit** — change any field directly in the table
- **Delete** — click the **×** button on a row

Changes take effect immediately after saving.

## Auto-Move

| Setting | Default | Description |
|---------|---------|-------------|
| Enable auto-move | On | Automatically move files to taxa folders when created or renamed with a taxa prefix |
| Create folders if missing | On | Create target folders that don't exist yet (including intermediate directories) |

## Sidebar

| Setting | Default | Description |
|---------|---------|-------------|
| Open sidebar on startup | Off | Automatically open the Enfoliate sidebar when the plugin loads |
| Auto-scan | On | Scan the active note automatically as you switch files, edit, and change selection. Turn off to scan only when you click **Scan** in the sidebar header |
| Match aliases of linked files | Off | Under Linked Mentions, fold in a file's unlinked alias occurrences so you can cycle through them (e.g. "USA" for an already-linked United States) |
| Select text on jump | Off | Select the matched text in the editor when jumping to an occurrence (edit mode only) |
| Scope to selection | Off | When you select text in the editor, narrow the sidebar to taxa within that selection. Off scans the whole note |
| Show search bar | On | Show the filter box at the top of the Enfoliate sidebar |

## Click Actions

What clicking a taxa name in the sidebar does. Each can jump to the name's next occurrence in the document, or open the note in the current tab, a new tab, or a new window.

| Setting | Default | Description |
|---------|---------|-------------|
| Click action | Jump to it in the document | What a click on a sidebar item does: jump to its next occurrence, or open the note in the current tab, a new tab, or a new window |
| Cmd/Ctrl+click action | Open in the current tab | What a Cmd (macOS) / Ctrl (Windows/Linux) + click on a sidebar item does: jump, or open in the current tab, a new tab, or a new window |

## Highlighting

Settings for the flash highlight shown when you click a name in the sidebar to jump to its occurrence.

| Setting | Default | Description |
|---------|---------|-------------|
| Highlight on jump | On | Flash a brief highlight when jumping to an occurrence |
| Highlight duration | 2.5s | How long the jump highlight stays before fading (0.5-10 seconds) |
| Highlight color | Yellow | Color picker for the jump highlight (reset button restores default) |

## Blocklist

Terms that have been permanently ignored via the "Ignore" button in the suggestions sidebar. Blocklisted terms never appear as suggestions.

- View all blocklisted terms in the settings panel
- Click **×** next to a term to remove it from the blocklist
- Blocklisted terms are stored in the plugin's data file and persist across sessions
