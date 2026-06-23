# Changelog

All notable changes to Enfoliate are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

First BRAT-installable release. Enfoliate (formerly "Portfolio") is taxa-based knowledge organization for Obsidian, built to work alongside Stowe Boyd's Folio system.

### Added

- Taxa system: prefix characters classify notes by type and map each prefix to a folder.
- Auto-move: files created or renamed with a taxa prefix move to the matching folder; optional folder creation.
- Commands: Create taxa link (prefix detection or picker), Move current note to taxa folder, Link all unlinked taxa in the current note, Link taxa mention under the cursor, Open Enfoliate sidebar, Toggle auto-scan.
- Suggestions sidebar with Linked Mentions and Unlinked Mentions, grouped by taxon, with jump-to-occurrence and a flash highlight (edit and reading mode).
- Per-row actions via inline buttons and a right-click menu, with configurable inline buttons.
- Configurable click and modifier-click actions: jump, or open in the current tab, a new tab, Split View, or a new window, or copy a wikilink.
- Per-taxon templates with `{{title}}`, `{{prefix}}`, `{{label}}`, and date-token substitution; optional alias added on link.
- Auto-scan toggle with an on-demand Scan button; filter box with a clear button; custom jump-highlight color and duration; a per-taxon blocklist.
- Undoable linking: link actions and the bulk command apply through the editor where possible, so Ctrl/Cmd+Z reverts them.

### Notes

- Icon by Jamie Serra from the Noun Project.
