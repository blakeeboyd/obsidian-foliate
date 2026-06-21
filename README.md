# Enfoliate

Taxa-based knowledge organization for [Obsidian](https://obsidian.md). Inspired by [Stowe Boyd's Portfolio system](https://stoweboyd.com/).

Enfoliate uses prefix characters to classify knowledge files by type. Each prefix maps to a folder, so files are automatically organized as you create and link them.

## Default taxa

| Prefix | Label         | Default folder               |
|--------|---------------|------------------------------|
| `@`    | People        | `00 knowledge/people`        |
| `+`    | Concepts      | `00 knowledge/concepts`      |
| `~`    | Places        | `00 knowledge/places`        |
| `•`    | Projects      | `00 knowledge/projects`      |
| `©`    | Works         | `00 knowledge/works`         |
| `º`    | Organizations | `00 knowledge/organizations` |
| `∞`    | Events        | `00 knowledge/events`        |

All prefixes, labels, and folders are configurable in settings. [Full taxa system docs →](docs/taxa-system.md)

## Features

### Smart linking

Select text and run **Create taxa link** from the command palette. If the text starts with a known prefix, Enfoliate creates the file in the right folder and replaces the selection with a wikilink. If no prefix is detected, a picker modal lets you choose the taxa type.

[Smart linking docs →](docs/smart-linking.md)

### Suggestions sidebar

A sidebar panel with two sections for the active note:

- **Linked taxa** — all taxa currently linked in the note, grouped by type. Click a name to jump through occurrences (wikilinks and plain text). Click → to open the taxa file.
- **Unlinked mentions** — existing taxa files whose names or aliases appear in your note but aren't linked yet. Link individual mentions or all at once.

The sidebar refreshes on file switch, content edits, and selection changes. Select text to scope the scan to just that selection.

> **Quote numeric aliases.** YAML reads an unquoted alias like `5.1` or `2024` as a number, not text. Enfoliate ignores non-string aliases so they can't break matching — which also means they won't be searched. Quote them in frontmatter to keep them working as aliases:
>
> ```yaml
> aliases:
>   - "5.1"
> ```

[Suggestions sidebar docs →](docs/suggestions-sidebar.md)

### Navigation

- **Jump-to-occurrence** — click any taxa name in the sidebar to jump to the next occurrence, cycling through all positions with an optional highlight flash

[Navigation docs →](docs/navigation.md)

### Auto-move

Files created or renamed with a taxa prefix are automatically moved to the matching folder. Collision detection prevents overwrites. Toggle in settings.

[Auto-move docs →](docs/taxa-system.md#auto-move)

## Commands

| Command | Description |
|---------|-------------|
| Create taxa link | Link selected text as a taxon |
| Move current note to taxa folder | Move the active file based on its prefix |
| Open Enfoliate sidebar | Show the Enfoliate panel |

## Installation

### BRAT (recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In BRAT settings, click "Add Beta plugin"
3. Enter: `blakeeboyd/obsidian-enfoliate`
4. Enable the plugin in Obsidian settings

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/blakeeboyd/obsidian-enfoliate/releases/latest)
2. Create a folder `.obsidian/plugins/obsidian-enfoliate/` in your vault
3. Copy the three files into that folder
4. Enable the plugin in Obsidian settings

### From source

```bash
git clone https://github.com/blakeeboyd/obsidian-enfoliate.git
cd obsidian-enfoliate
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-enfoliate/` folder.

## Settings

[Full settings reference →](docs/settings.md)

| Setting | Default | Description |
|---------|---------|-------------|
| Taxa Mappings | 7 defaults | Add, edit, or remove prefix/label/folder mappings |
| Auto-Move | On | Automatically move files to taxa folders |
| Create folders if missing | On | Create target folders that don't exist |
| Open sidebar on startup | Off | Auto-open the Enfoliate sidebar on plugin load |
| Auto-scan | On | Scan the active note automatically; turn off to scan only via the Scan button |
| Match aliases of linked files | Off | Fold unlinked alias mentions of already-linked files into their Linked Taxa entry |
| Highlight on jump | On | Flash highlight when jumping to an occurrence |
| Highlight color | Yellow | Custom color for the jump highlight |
| Blocklist | — | Permanently ignored suggestion terms |

## Documentation

- [Taxa System](docs/taxa-system.md) — prefixes, folders, auto-move, aliases
- [Smart Linking](docs/smart-linking.md) — link creation, how linking works
- [Suggestions Sidebar](docs/suggestions-sidebar.md) — linked taxa, unlinked mentions, actions, jump behavior
- [Navigation](docs/navigation.md) — jump-to-occurrence, highlight, commands
- [Settings Reference](docs/settings.md) — every setting explained

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
