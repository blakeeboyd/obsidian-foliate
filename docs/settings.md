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
| Auto-analyze on file open | Off | Run AI taxa extraction automatically when switching to a new file |
| Highlight on jump | On | Flash a brief highlight when jumping to an occurrence |
| Highlight color | Yellow | Color picker for the jump highlight (reset button restores default) |

## Status Bar

| Setting | Default | Description |
|---------|---------|-------------|
| Show status bar | On | Display taxa link counts in Obsidian's status bar. Requires plugin reload to take effect. |

## AI Taxa Extraction

| Setting | Default | Description |
|---------|---------|-------------|
| Enable AI taxa extraction | On | Master toggle for the entire AI feature. When off, the sidebar shows an explanation of the feature. |
| Ollama URL | `http://localhost:11434` | Address of your local Ollama instance |
| Model | `llama3.2:3b` | Ollama model used for entity extraction |
| Test connection | — | Button to verify Ollama is running and the model is available |

See [AI Extraction](ai-extraction.md) for setup instructions.

## Blocklist

Terms that have been permanently ignored via the "Ignore" button in the suggestions sidebar. Blocklisted terms never appear as suggestions.

- View all blocklisted terms in the settings panel
- Click **×** next to a term to remove it from the blocklist
- Blocklisted terms are stored in the plugin's data file and persist across sessions
