# Changelog

All notable changes to Foliate are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.1 - 2026-08-04

### Fixed

- The "Add to domain" list no longer shows the same domain twice. When more than
  one file carries a domain name, the list now has a single row for it and names
  the folders those files are in, so you can merge or rename them. A bare
  `[[≈Name]]` link can't say which of two same-named files it means, so domain
  membership could land in the wrong one.

### Changed

- The debug report now lists your domain files, grouped by name and with their
  paths. Names are written so invisible differences show up: two domains that
  look identical on screen but differ by a trailing space, a non-breaking space,
  or an accent typed a different way are told apart. It flags both cases:
  several files sharing one name, and names that only appear to match.

## 0.5.0 - 2026-07-14

### Added

- **Domains**: a higher-order taxon (prefix `≈`) that groups your other taxa
  files by subject. Run "Add current file to a domain" on any taxa file and pick
  a domain: the file gains a `domains` entry linking to it, and the domain file
  is created if it doesn't exist yet. Configure the prefix, folder, and template
  under Settings, the same as any other taxon. Domains are left out of mention
  scanning, so they won't clutter the sidebar with unlinked mentions.
- **Backlinks** in the sidebar. On a taxa or domain file, a Backlinks section at
  the bottom lists the other taxa files that link to it, grouped by type. Click a
  row to open it. This is how a domain shows you its members.
- **Copy debug report to clipboard**, a new command for troubleshooting. It
  writes a plain-text summary of your Foliate settings, your taxa and their
  templates, and your Obsidian and plugin versions, then flags anything that
  would stop a template from applying (none configured, a path that doesn't
  resolve, an empty template file, Templater syntax with Templater not
  installed). Paste it into a bug report.
- A clear (✕) button on the folder and template fields in settings.

### Changed

- The template picker now searches the whole path, so words from the folder and
  the file name can be combined in any order. Typing "foliate people" finds
  `Foliate Templates/People Template.md`.
- A taxon's template is stored as a full vault path. Templates that were saved
  under a bare file name are converted the next time Foliate loads, so moving a
  template into a folder no longer stops it from being found.

## 0.4.2 - 2026-07-03

### Added

- Context-aware mentions (experimental, off by default). If a taxa file's
  alias is a common word (for example "work" for a concept, or "an" for a
  Chinese-thought concept), it can flood every note with unlinked mentions.
  With this on, that alias only surfaces as an unlinked mention in notes that
  also mention one of the file's related terms, and stays quiet everywhere
  else. Enable it under Settings → Experimental → Context-aware mentions, then
  set files up from a sidebar item's "Add … to context-aware list" action and
  manage the gated terms (click-to-toggle chips of the file's own aliases) and
  related terms in the manager. Turning the toggle off fully disables the
  gating and hides its sidebar action; your configured files are kept and
  reactivate if you turn it back on. Only the gated alias is affected: the
  file's other aliases keep matching normally, and deliberate actions like
  running "Create taxa link" on the word under the cursor are never gated.

### Fixed

- Writing a mention with its prefix already attached now matches. Typing
  `@Paul Krugman` in a note finds the `@Paul Krugman` file, where before the
  leading `@` stopped it from matching anything. Linking it gives you
  `[[@Paul Krugman]]`. Only the file's own prefix counts, so `+Paul Krugman`
  still won't match a People file.
- Renaming a taxa file no longer breaks the links pointing to it, at any batch
  size.
- A file created through Foliate could occasionally come out missing its
  template content or its alias. Newly created files are now placed,
  templated, and aliased reliably every time.

### Changed

- The right-click menu on sidebar mentions groups its actions with dividers so
  the removal actions (Dismiss, Add to blocklist, Unlink) are set apart from the
  safe link/open actions and aren't clicked by accident. The blocklist action
  now names the file it will block.
- "Create taxa link" with no selection always acts on the word under the cursor
  now; the "Link word under cursor when nothing is selected" setting is removed.
  It never creates a file from an unmatched word, so the toggle only added
  friction.
- Settings panel cleanup:
  - Sidebar display, click, inline-button, and highlight options moved into a
    "Sidebar settings" modal.
  - "Linking" and "Auto-move" sections merged into "Files".
  - Removed the in-tab filter box; Obsidian's own settings search covers it.
  - The Taxa Mappings table gained column headers.

## 0.4.1 - 2026-06-29

### Fixed

- Opening a non-markdown file (PDF, image, canvas, audio) no longer freezes
  Obsidian. The suggestions sidebar now skips any active file that isn't a
  markdown note, instead of reading it and conflicting with other plugins such
  as PDF++.
- Typing a markdown link no longer freezes the editor, including while the
  link is only half-typed (an opening `[label](` with no closing paren yet).

### Performance

- Sidebar refreshes are much faster on large vaults.

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
