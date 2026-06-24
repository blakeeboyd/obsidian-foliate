# Foliate

Taxa-based knowledge organization for [Obsidian](https://obsidian.md). Built to work alongside [Stowe Boyd's Folio system](https://www.workings.co/p/folio-how-notetaking-becomes-knowledge).

Foliate uses prefix characters to classify knowledge files by type. Each prefix maps to a folder, so files are automatically organized as you create and link them.

## Default taxa

Foliate ships with these prefixes and labels. Folders start unset; assign one per taxon in settings. A taxon with no folder leaves its files at the vault root and isn't auto-moved.

| Prefix | Label         | Default folder |
|--------|---------------|----------------|
| `@`    | People        | (unset)        |
| `+`    | Concepts      | (unset)        |
| `~`    | Places        | (unset)        |
| `•`    | Projects      | (unset)        |
| `©`    | Works         | (unset)        |
| `¡`    | Images        | (unset)        |
| `º`    | Organizations | (unset)        |
| `∞`    | Events        | (unset)        |

All prefixes, labels, and folders are configurable in settings. [Full taxa system docs →](docs/taxa-system.md)

## Features

### Smart linking

Select text and run **Create taxa link** from the command palette. If the text starts with a known prefix, Foliate creates the file in the right folder and replaces the selection with a wikilink. If there's no prefix but the selection matches an existing taxa file, it links straight to that file; otherwise a picker lets you choose the taxa type.

[Smart linking docs →](docs/smart-linking.md)

### Suggestions sidebar

A sidebar panel with two sections for the active note:

- **Linked mentions:** all taxa currently linked in the note, grouped by type. Click a name to jump through occurrences (wikilinks and plain text). If a linked file still has plain-text mentions, link the remaining ones in one action.
- **Unlinked mentions:** existing taxa files whose names or aliases appear in your note but aren't linked yet. Link individual mentions or all at once.

Right-click any row for its full set of actions (link, open, unlink, ignore, dismiss, …); choose which of those also show as inline buttons under **Sidebar Buttons** in settings. The sidebar refreshes on file switch and content edits.

> **Quote numeric aliases.** YAML reads an unquoted alias like `5.1` or `2024` as a number, not text. Foliate ignores non-string aliases, so they won't be searched. Quote them in frontmatter to keep them working as aliases:
>
> ```yaml
> aliases:
>   - "5.1"
> ```

[Suggestions sidebar docs →](docs/suggestions-sidebar.md)

### Navigation

- **Click actions:** the plain click and each modifier-click (Cmd/Ctrl, Option/Alt, Shift) are configurable: jump to the next occurrence (cycling through all positions with an optional highlight flash), open the note (current tab, new tab, Split View, or new window), copy a wikilink, or open the options menu. Defaults: click jumps, Cmd/Ctrl opens in the current tab, Option/Alt opens the options menu, Shift opens in Split View.
- **Limit to visible area:** an eye toggle in the sidebar header scopes the list to occurrences in the editor's current view, updating as you scroll.

[Navigation docs →](docs/navigation.md)

### Auto-move

Files created or renamed with a taxa prefix are automatically moved to the matching folder. Collision detection prevents overwrites. Toggle in settings.

[Auto-move docs →](docs/taxa-system.md#auto-move)

## Commands

| Command | Description |
|---------|-------------|
| Create taxa link | Link selected text as a taxon. With nothing selected, acts on the cursor (see "Link word under cursor" setting): links an existing taxa term at the cursor, or the word it sits in when that matches a taxa file |
| Move current note to taxa folder | Move the active file based on its prefix |
| Link all unlinked taxa in the current note | Wrap every unlinked taxa mention in the note in one pass |
| Open Foliate sidebar | Show the Foliate panel |
| Toggle auto-scan | Turn the sidebar's auto-scan on or off |

## Installation

### BRAT (recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In BRAT settings, click "Add Beta plugin"
3. Enter: `blakeeboyd/obsidian-foliate`
4. Enable the plugin in Obsidian settings

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/blakeeboyd/obsidian-foliate/releases/latest)
2. Create a folder `.obsidian/plugins/obsidian-foliate/` in your vault
3. Copy the three files into that folder
4. Enable the plugin in Obsidian settings

### From source

```bash
git clone https://github.com/blakeeboyd/obsidian-foliate.git
cd obsidian-foliate
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-foliate/` folder.

## Settings

[Full settings reference →](docs/settings.md)

| Setting | Default | Description |
|---------|---------|-------------|
| Taxa Mappings | 8 prefixes, no folders | Add, edit, or remove prefix/label/folder mappings |
| Auto-add alias | On | On link creation, add the linked name to the target file's aliases |
| Auto-Move File On Creation | On | Automatically move files to taxa folders when created or renamed |
| Create folders if missing | On | Create target folders that don't exist |
| Enable Sidebar | On | Make the sidebar available (requires reload); off uses commands + auto-move only |
| Open sidebar on startup | On | Auto-open the Foliate sidebar on plugin load |
| Auto-scan | On | Scan the active note automatically; turn off to scan only via the Scan button |
| Limit to visible area | Off | Only show mentions in the editor's current view; also toggleable from the sidebar header (synced) |
| Sort entries | Mentions, high to low | Order entries within each category by mention count or name |
| Click action | Jump to term in the document | What a click on a sidebar item does: jump, open in current tab / new tab / Split View / new window, copy a wikilink, or open the options menu |
| Shift+click action | Open in Split View | Same choices, for Shift+click |
| Cmd/Ctrl+click action | Open in the current tab | Same choices, for Cmd/Ctrl+click |
| Option/Alt+click action | Open options menu | Same choices, for Option/Alt+click |
| Sidebar Buttons | Link, Link all, Unlink | Which row actions show as inline buttons; all actions are always available via right-click |
| Match aliases of linked files | On | Fold unlinked alias mentions of already-linked files into their Linked Mentions entry |
| Highlight on jump | On | Flash highlight when jumping to an occurrence |
| Highlight color | Yellow | Custom color for the jump highlight |
| Blocklist | (none) | Permanently ignored suggestion terms |

## Documentation

- [Taxa System](docs/taxa-system.md): prefixes, folders, auto-move, aliases
- [Smart Linking](docs/smart-linking.md): link creation, how linking works
- [Suggestions Sidebar](docs/suggestions-sidebar.md): linked mentions, unlinked mentions, actions, jump behavior
- [Navigation](docs/navigation.md): jump-to-occurrence, highlight, commands
- [Settings Reference](docs/settings.md): every setting explained
- [Changelog](CHANGELOG.md): version history

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## Credits

Booklet icon by Jamie Serra from [the Noun Project](https://thenounproject.com/icon/booklet-1624270/).

## License

MIT
