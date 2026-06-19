# Settings Reference

All settings are in **Settings → Portfolio**.

## Taxa Mappings

A table of all configured taxa types. Each row has three fields:

| Field  | Description |
|--------|-------------|
| Prefix | Character(s) that identify this taxon in filenames (e.g. `@`) |
| Label  | Display name (e.g. "People") |
| Folder | Target folder path relative to vault root |

- **Add mapping** — click the "Add mapping" button below the table
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
| Open suggestions on startup | Off | Automatically open the suggestions sidebar when the plugin loads |
| Match aliases of linked files | Off | Also surface unlinked alias occurrences of a file that is already linked in the note (e.g. "ZPD" for an already-linked Zone of Proximal Development) |
| Highlight on jump | On | Flash a brief highlight when jumping to an occurrence |
| Highlight color | Yellow | Color picker for the jump highlight (reset button restores default) |

## Status Bar

| Setting | Default | Description |
|---------|---------|-------------|
| Show status bar | On | Display taxa link counts in Obsidian's status bar. Requires plugin reload to take effect. |

## Blocklist

Terms that have been permanently ignored via the "Ignore" button in the suggestions sidebar. Blocklisted terms never appear as suggestions.

- View all blocklisted terms in the settings panel
- Click **×** next to a term to remove it from the blocklist
- Blocklisted terms are stored in the plugin's data file and persist across sessions
