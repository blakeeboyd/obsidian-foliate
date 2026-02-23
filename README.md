# Portfolio

Taxa-based knowledge organization for [Obsidian](https://obsidian.md). Inspired by [Stowe Boyd's Portfolio system](https://stoweboyd.com/).

Portfolio uses prefix characters to classify knowledge files by type. Each prefix maps to a folder, so files are automatically organized as you create and link them.

## Default taxa

| Prefix | Label | Default folder |
|--------|-------|----------------|
| `@` | People | `00 knowledge/people` |
| `+` | Concepts | `00 knowledge/concepts` |
| `~` | Places | `00 knowledge/places` |
| `*` | Projects | `00 knowledge/projects` |
| `©` | Works | `00 knowledge/works` |
| `º` | Organizations | `00 knowledge/organizations` |
| `∞` | Events | `00 knowledge/events` |

All prefixes, labels, and folders are configurable in settings.

## Features

### Smart linking

Select text and run **Create taxa link** (command palette). If the text starts with a known prefix, Portfolio creates the file in the right folder and replaces the selection with a wikilink. If no prefix is detected, a picker modal lets you choose the taxa type.

### Editor autocomplete

Type a prefix character (e.g. `@`) followed by a few letters to get autocomplete suggestions from existing files in that taxa folder.

### Auto-move

When a file is created or renamed with a taxa prefix, Portfolio automatically moves it to the matching folder. Toggle this on/off in settings.

### Suggestions sidebar

A sidebar panel that shows two kinds of suggestions for the active note:

- **Unlinked mentions** — existing taxa files whose names appear in your note but aren't linked yet. Click "Link" to link the first occurrence, or "Link all" to link every occurrence.
- **AI taxa extraction** — uses a local [Ollama](https://ollama.ai) instance to find people, concepts, places, organizations, works, and events in your text. Click "Link" to create the taxa file and link the first mention.

The sidebar updates when you switch files, edit content, or change your text selection. Select text to scope suggestions to just that selection.

### Status bar

Shows a count of taxa links in the active note (e.g. `3@ 2+ 1~`). Click it to open a summary modal listing all linked taxa, grouped by type. Click any name in the modal to navigate to that file.

## Settings

- **Taxa Mappings** — add, edit, or remove prefix/label/folder mappings
- **Auto-Move** — toggle automatic file moving; optionally create folders that don't exist
- **Open suggestions on startup** — automatically open the sidebar when the plugin loads
- **Show status bar** — toggle the taxa counts in the status bar (requires plugin reload)
- **Enable AI taxa extraction** — toggle the entire AI extraction feature on/off
- **Auto-analyze on file open** — toggle automatic Ollama taxa extraction when switching files (manual refresh always available)
- **Ollama URL** — defaults to `http://localhost:11434`
- **Model** — Ollama model for taxa extraction (default: `llama3.2:3b`)
- **Test connection** — verify Ollama is running and the model is available

## Installation

### Manual

1. Clone or download this repo into your vault's `.obsidian/plugins/obsidian-portfolio/` folder
2. Run `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, and `styles.css` to the plugin folder
4. Enable the plugin in Obsidian settings

### Ollama setup (optional)

The AI suggestions feature requires a local Ollama instance:

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2:3b` (or any model you prefer)
3. Make sure Ollama is running when you want AI suggestions
4. Configure the URL and model name in plugin settings

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
