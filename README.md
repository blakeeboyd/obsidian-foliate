# Foliate

Taxa-based knowledge organization for [Obsidian](https://obsidian.md). Built to work alongside [Stowe Boyd's Folio system](https://www.workings.co/p/folio-how-notetaking-becomes-knowledge).

Foliate uses prefix characters to classify knowledge files by type. Each prefix maps to a folder, so files are automatically organized as they are created and linked.

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
| `≈`    | Domains       | (unset)        |

Domains are a higher-order taxon: they group other taxa files by subject rather than appearing as mentions in your notes.

All prefixes, labels, and folders are configurable in settings. [Full taxa system docs →](docs/taxa-system.md)

## Features

### Smart linking

Select text, or put the cursor in a word, and run **Create taxa link**. Foliate works from the most certain interpretation to the least:

1. Text starting with a known prefix creates the file in that taxon's folder.
2. Text matching one existing taxa file links straight to it.
3. Text matching several opens a picker.
4. Text matching none exactly, but prefixing some ("Bill" with several Bills in the vault), offers those before creating anything.
5. Nothing matches: choose a taxon and Foliate creates the file.

[Smart linking docs →](docs/smart-linking.md)

### Suggestions sidebar

A sidebar panel with two sections for the active note:

- **Linked mentions:** all taxa currently linked in the note, grouped by type. Click a name to jump through occurrences (wikilinks and plain text). If a linked file still has plain-text mentions, link the remaining ones in one action.
- **Unlinked mentions:** existing taxa files whose names or aliases appear in your note but aren't linked yet. Link individual mentions or all at once.

Right-click any row for its full set of actions (link, open, unlink, ignore, dismiss, …); choose which of those also show as inline buttons under **Inline buttons** in settings. The sidebar refreshes on file switch and content edits.

> **Quote numeric aliases.** YAML reads an unquoted alias like `5.1` or `2024` as a number, not text. Foliate ignores non-string aliases, so they won't be searched. Quote them in frontmatter to keep them working as aliases:
>
> ```yaml
> aliases:
>   - "5.1"
> ```

[Suggestions sidebar docs →](docs/suggestions-sidebar.md)

### Navigation

- **Click actions:** the plain click and each modifier-click (Cmd/Ctrl, Option/Alt, Shift) are configurable: jump to the next occurrence (cycling through all positions with an optional highlight flash), open the note (current tab, new tab, Split View, or new window), copy a wikilink, or open the options menu. Defaults: click jumps, Cmd/Ctrl opens in the current tab, Option/Alt opens the options menu, Shift opens in Split View.

[Navigation docs →](docs/navigation.md)

### Domains

A domain (`≈`) groups taxa files by subject. Run **Add current file to a domain** on any taxa file and pick one: the file gains a `domains` entry linking to it, and the domain file is created if it doesn't exist. On a taxa or domain file, the sidebar's Backlinks section lists the other taxa files linking to it. This is how a domain shows its members.

Domains are left out of mention scanning. They never appear as unlinked mentions in your notes.

### Note-local matching

Two rules read what a note itself establishes. Nothing is configured, and nothing applies outside that note.

**Name parts.** In a note mentioning "Vladimir Dostoevsky", a later bare "Dostoevsky" or "Vladimir" matches that file. Matching is case-sensitive: someone surnamed Wood does not match "a wood floor". When two people in a note share a part, each gets a row and linking opens a picker.

**Declared acronyms.** Writing `[[just noticeable difference]] (JND)` makes a later JND match in that note. Only acronym-shaped parentheticals count: `(concept)` and `(status: final)` are ignored.

Right-click either kind of match and choose **Add an alias** to write it into the file's frontmatter. This promotes it from that one note to the whole vault.

### Vault hygiene

**Find misplaced and duplicate taxa files** reports two problems. Files outside their taxon's folder can be moved individually or in bulk. Names used by more than one file get a Compare view showing each copy's folder, backlink count, and content; keeping one trashes the rest to the vault trash and moves the keeper into the taxon folder.

**Run debug report** shows plugin state in a window with a copy button: per-taxon file counts, misplaced and duplicate counts, and checks for configuration that silently does nothing, such as a taxon with no folder, two taxa sharing a prefix, or context-aware entries pointing at deleted files.

### Auto-move

Files created or renamed with a taxa prefix are automatically moved to the matching folder. Collision detection prevents overwrites. Toggle in settings.

[Auto-move docs →](docs/taxa-system.md#auto-move)

## Commands

| Command | Description |
|---------|-------------|
| Create taxa link | Link the selection, or the word under the cursor, to a taxa file |
| Move current note to taxa folder | Move the active file based on its prefix |
| Add current file to a domain | Record the current taxa file's membership in a `≈` domain |
| Link all unlinked taxa in the current note | Link the first mention of each file in one pass |
| Find misplaced and duplicate taxa files | Report files outside their taxon's folder, and names used by more than one file |
| Run debug report | Show plugin state and configuration problems, with a copy button |
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
| Auto-move files on creation | On | Automatically move files to taxa folders when created or renamed |
| Create folders if missing | On | Create target folders that don't exist |
| Enable sidebar | On | Make the sidebar available (requires reload); off uses commands + auto-move only |
| Open on startup | On | Auto-open the Foliate sidebar on plugin load |
| Auto-scan | On | Scan the active note automatically; turn off to scan only via the Scan button |
| Limit to visible area | Off | Experimental. Scope the sidebar to mentions in the editor's current view. Edit mode only |
| Sort entries | Mentions, high to low | Order entries within each category by mention count or name |
| Click action | Jump to term in the document | What a click on a sidebar item does: jump, open in current tab / new tab / Split View / new window, copy a wikilink, or open the options menu |
| Shift+click action | Open in Split View | Same choices, for Shift+click |
| Cmd/Ctrl+click action | Open in the current tab | Same choices, for Cmd/Ctrl+click |
| Option/Alt+click action | Open options menu | Same choices, for Option/Alt+click |
| Inline buttons | Link, Link all, Unlink | Which row actions show as inline buttons; all actions are always available via right-click |
| Match aliases of linked files | On | Fold unlinked alias mentions of already-linked files into their Linked Mentions entry |
| Match acronyms a note declares | On | `[[term]] (ABC)` in a note makes ABC match in that note |
| Match surnames after a full name | People | Once a full name appears in a note, its parts match there. Off, or any taxon |
| Match acronyms in file names | Off | A trailing acronym in a file name acts as an alias when its letters abbreviate the name |
| Add a plain-text alias for accented names | On | New files with accented names also get their plain spelling as an alias |
| Show hidden connections | Off | Sidebar section listing mentions that context gating withheld |
| Highlight on jump | On | Flash highlight when jumping to an occurrence |
| Highlight color | Yellow | Custom color for the jump highlight |
| Blocked terms | (none) | Permanently ignored suggestion terms |

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
