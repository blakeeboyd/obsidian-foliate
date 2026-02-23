# Portfolio

Taxa-based knowledge organization for [Obsidian](https://obsidian.md). Inspired by [Stowe Boyd's Portfolio system](https://stoweboyd.com/).

Portfolio uses prefix characters to classify knowledge files by type. Each prefix maps to a folder, so files are automatically organized as you create and link them.

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

Select text and run **Create taxa link** from the command palette. If the text starts with a known prefix, Portfolio creates the file in the right folder and replaces the selection with a wikilink. If no prefix is detected, a picker modal lets you choose the taxa type.

Portfolio also provides real-time **editor autocomplete** — type a prefix character followed by a few letters to get suggestions from existing taxa files.

[Smart linking docs →](docs/smart-linking.md)

### Suggestions sidebar

A sidebar panel with three sections for the active note:

- **Linked taxa** — all taxa currently linked in the note, grouped by type. Click a name to jump through occurrences (wikilinks and plain text). Click → to open the taxa file.
- **Unlinked mentions** — existing taxa files whose names appear in your note but aren't linked yet. Link individual mentions or all at once.
- **AI taxa extraction** — uses a local [Ollama](https://ollama.ai) LLM to discover people, concepts, places, organizations, works, and events in your text.

The sidebar refreshes on file switch, content edits, and selection changes. Select text to scope AI extraction to just that selection.

[Suggestions sidebar docs →](docs/suggestions-sidebar.md) · [AI extraction docs →](docs/ai-extraction.md)

### Navigation

- **Jump-to-occurrence** — click any taxa name in the sidebar to jump to the next occurrence, cycling through all positions with an optional highlight flash
- **Status bar** — shows a count of taxa links in the active note (e.g. `3@ 2+ 1~`). Click to open the sidebar.

[Navigation docs →](docs/navigation.md)

### Auto-move

Files created or renamed with a taxa prefix are automatically moved to the matching folder. Collision detection prevents overwrites. Toggle in settings.

[Auto-move docs →](docs/taxa-system.md#auto-move)

## Commands

| Command | Description |
|---------|-------------|
| Create taxa link | Link selected text as a taxon |
| Move current note to taxa folder | Move the active file based on its prefix |
| Open suggestions sidebar | Show the suggestions panel |

## Installation

### BRAT (recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In BRAT settings, click "Add Beta plugin"
3. Enter: `blakeeboyd/obsidian-portfolio`
4. Enable the plugin in Obsidian settings

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/blakeeboyd/obsidian-portfolio/releases/latest)
2. Create a folder `.obsidian/plugins/obsidian-portfolio/` in your vault
3. Copy the three files into that folder
4. Enable the plugin in Obsidian settings

### From source

```bash
git clone https://github.com/blakeeboyd/obsidian-portfolio.git
cd obsidian-portfolio
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-portfolio/` folder.

### Ollama setup (optional)

The AI suggestions feature requires a local Ollama instance:

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2:3b`
3. Make sure Ollama is running when you want AI suggestions
4. Configure the URL and model name in plugin settings

[Full AI setup guide →](docs/ai-extraction.md)

## Settings

[Full settings reference →](docs/settings.md)

| Setting | Default | Description |
|---------|---------|-------------|
| Taxa Mappings | 7 defaults | Add, edit, or remove prefix/label/folder mappings |
| Auto-Move | On | Automatically move files to taxa folders |
| Create folders if missing | On | Create target folders that don't exist |
| Open suggestions on startup | Off | Auto-open the sidebar on plugin load |
| Show status bar | On | Taxa counts in the status bar (reload required) |
| Enable AI taxa extraction | On | Toggle the AI feature on/off |
| Auto-analyze on file open | Off | Run extraction automatically when switching files |
| Highlight on jump | On | Flash highlight when jumping to an occurrence |
| Highlight color | Yellow | Custom color for the jump highlight |
| Ollama URL | `http://localhost:11434` | Local Ollama instance address |
| Model | `llama3.2:3b` | Ollama model for extraction |
| Blocklist | — | Permanently ignored suggestion terms |

## Documentation

- [Taxa System](docs/taxa-system.md) — prefixes, folders, auto-move, aliases
- [Smart Linking](docs/smart-linking.md) — link creation, autocomplete, how linking works
- [Suggestions Sidebar](docs/suggestions-sidebar.md) — linked taxa, unlinked mentions, actions, jump behavior
- [AI Extraction](docs/ai-extraction.md) — Ollama setup, entity types, troubleshooting
- [Navigation](docs/navigation.md) — status bar, jump-to-occurrence, highlight, commands
- [Settings Reference](docs/settings.md) — every setting explained

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
