# CLAUDE.md — obsidian-portfolio

## Project Locations

- **Source code:** `/Users/harrisgb/Documents/GitHub/obsidian-portfolio/`
- **Deployed plugin:** `/Users/harrisgb/Documents/Obsidian/EtchedInterim/.obsidian/plugins/obsidian-portfolio/`

## Build & Deploy

```bash
cd /Users/harrisgb/Documents/GitHub/obsidian-portfolio
npm run build
cp main.js /Users/harrisgb/Documents/Obsidian/EtchedInterim/.obsidian/plugins/obsidian-portfolio/main.js
```

After copying, disable and re-enable the plugin in Obsidian (Settings > Community plugins) to pick up changes.

## Architecture

Taxa-based knowledge organization plugin for Obsidian. Core concepts:

- **Taxa mappings:** Prefix characters (e.g., `@` for People, `+` for Concepts) map to target folders
- **Auto-move:** Files with taxa prefixes are automatically moved to the correct folder on create/rename
- **Suggestions sidebar:** Shows unlinked mentions and LLM-extracted entities for the active note
- **Editor suggest:** Type a prefix character to autocomplete existing taxa files
- **Ollama integration:** Local LLM entity extraction via Ollama API

## Key Files

- `src/main.ts` — Plugin entry point, commands, auto-mover, status bar
- `src/settings.ts` — Settings tab UI
- `src/types.ts` — TypeScript interfaces
- `src/taxa.ts` — Default taxa mappings, prefix detection helpers
- `src/ui/suggestions-view.ts` — Suggestions sidebar (unlinked mentions + LLM entities)
- `src/ui/taxa-picker-modal.ts` — Modal for choosing taxa type
- `src/ui/taxa-suggest.ts` — Editor autocomplete for taxa prefixes
- `src/services/ollama.ts` — Ollama API client for entity extraction
- `src/services/file-operations.ts` — File creation, linking, folder management
- `src/services/unlinked-mentions.ts` — Scans note content for unlinked taxa references
