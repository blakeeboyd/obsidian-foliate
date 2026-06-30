# Changelog

All notable changes to Foliate are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

_Nothing yet._

## 0.4.1 - 2026-06-29

### Fixed

- Opening a non-markdown file (PDF, image, canvas, audio) no longer freezes
  Obsidian. The suggestions sidebar now skips any active file that isn't a
  markdown note instead of reading its raw bytes and scanning them, which had
  pegged the main thread and conflicted with other plugins such as PDF++.
- Typing a markdown link no longer freezes the editor. The exclusion-region
  scanner's markdown-link pattern had catastrophic backtracking on a half-typed
  link (an opening `[label](` with no closing paren yet, worse when the URL
  contained a paren); the pattern is now linear.

### Performance

- A sidebar refresh no longer recomputes the note's excluded regions (code
  spans, links) once per taxa file. They are computed once and reused across the
  whole scan, removing thousands of redundant regex passes per refresh on large
  vaults. The vault file list is also partitioned by taxon in a single walk
  instead of one walk per taxon.

## 0.4.0 - 2026-06-24

### Added

- Linked Mentions now flags links whose target file doesn't exist yet: the title
  is dimmed (matching Obsidian's unresolved-link style) with a "No file yet"
  tooltip, and the row shows a **Create file** button that builds the file in the
  taxon's folder using its template, the same way "Create taxa link" does. Once
  created, the marker clears on the next refresh.

### Changed

- "Create taxa link" now works without a selection. With nothing selected it acts
  on the cursor: it links an existing taxa term whose span covers the cursor, or
  the word the cursor sits in when that word matches a taxa file or carries a taxa
  prefix. A word that matches nothing is left alone (no file is created from an
  unselected word). When the word matches more than one existing taxa file, a
  picker lists the candidates so you choose which to link. This is governed by a
  new **Link word under cursor when nothing is selected** setting, on by default.
- The settings tab's "Open guide" button is now a link to the GitHub page (with
  the Folio attribution beside it); the in-app How-to modal was removed in favor
  of the README and docs.
- Removed the standalone "Link taxa mention under the cursor" command; its
  behavior is now folded into "Create taxa link" via the setting above. Any hotkey
  bound to the old command will need rebinding to "Create taxa link".
- Renamed the plugin from Enfoliate to **Foliate**. Display name, manifest/package
  id (`obsidian-foliate`), command IDs, view type, CSS classes, and internal
  symbols all updated. The deployed plugin folder and source repo were renamed to
  match; existing settings (`data.json`) are preserved.

### Fixed

- Unlinked-mention detection no longer matches inside code (fenced blocks and
  inline spans), markdown links (`[label](url)`), or bare/autolink URLs, where
  wrapping a wikilink would break the syntax or make no sense.
- `{{title}}` in a per-taxon template now resolves to the actual file name with
  its taxa prefix (e.g. `@Ada Lovelace`) instead of the stripped name. `{{name}}`
  and `{{alias}}` continue to resolve to the stripped name without the prefix.

## 0.3.0 - 2026-06-22

### Added

- Viewport-aware **Link** button: links the occurrence you last jumped to for that term, otherwise the first one in the editor's current view, otherwise the first in the document.
- **Limit to visible area**: scope both sidebar sections to occurrences in the editor's current view, updating as you scroll. Toggle it from the eye button in the sidebar header or the matching setting; the two stay in sync. Edit mode only.
- Auto-pick the taxon when **Create taxa link** runs on text that matches exactly one existing taxa file (by name or alias), skipping the picker.
- **Sort entries** setting: order entries within each taxa category by mention count (high to low or low to high) or by name (A to Z or Z to A).
- **Open options menu** click action: opens the row's full action set, the same as right-clicking. Default for Option/Alt+click.
- **Enable Sidebar** master toggle, so the plugin's commands and auto-move can be used without the sidebar.

### Changed

- Renamed the auto-move setting to **Auto-Move File On Creation**.
- New defaults (on): Open sidebar on startup, Match aliases of linked files, Select text on jump.

### Fixed

- Viewport scoping now resolves the note's open editor reliably (it was a no-op before).

## 0.2.1 - 2026-06-22

### Added

- Guide: explanations of the `{{title}}`, `{{prefix}}`, and `{{label}}` template tokens, plus a note that Obsidian's built-in Templates date tokens and Templater commands also work.

### Changed

- Guide copy: reordered sections, added bold section leads, and reworded for clarity.
- Editing pass over the README and docs (removed em dashes, tightened wording).

### Fixed

- Hyphens are treated as part of a word in mention matching, so a short term like "Sub" no longer matches inside "Sub-branch".
- Slimmed the guide modal scrollbar so it stays within the rounded corners.

## 0.2.0 - 2026-06-22

First BRAT-installable release. Foliate (formerly "Portfolio") is taxa-based knowledge organization for Obsidian, built to work alongside Stowe Boyd's Folio system.

### Added

- Taxa system: prefix characters classify notes by type and map each prefix to a folder.
- Auto-move: files created or renamed with a taxa prefix move to the matching folder; optional folder creation.
- Commands: Create taxa link (prefix detection or picker), Move current note to taxa folder, Link all unlinked taxa in the current note, Link taxa mention under the cursor, Open Foliate sidebar, Toggle auto-scan.
- Suggestions sidebar with Linked Mentions and Unlinked Mentions, grouped by taxon, with jump-to-occurrence and a flash highlight (edit and reading mode).
- Per-row actions via inline buttons and a right-click menu, with configurable inline buttons.
- Configurable click and modifier-click actions: jump, or open in the current tab, a new tab, Split View, or a new window, or copy a wikilink.
- Per-taxon templates with `{{title}}`, `{{prefix}}`, `{{label}}`, and date-token substitution; optional alias added on link.
- Auto-scan toggle with an on-demand Scan button; filter box with a clear button; custom jump-highlight color and duration; a per-taxon blocklist.
- Undoable linking: link actions and the bulk command apply through the editor where possible, so Ctrl/Cmd+Z reverts them.

### Notes

- Icon by Jamie Serra from the Noun Project.
