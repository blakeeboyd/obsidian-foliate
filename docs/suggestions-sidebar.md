# Suggestions Sidebar

The suggestions sidebar is Enfoliate's main analysis panel. It shows what's already linked in a note and what could be linked.

Open it with the **Open Enfoliate sidebar** command, or by enabling "Open sidebar on startup" in settings.

## Sections

The sidebar has two sections, top to bottom. Within each, every taxa category (`@ People`, `+ Concepts`, etc.) has a clickable header that collapses or expands its contents; the collapsed state persists across notes and restarts. Each section heading also has a collapse/expand-all button that toggles every category in that section at once.

### Linked Taxa

Shows all taxa currently linked in the active note, grouped by type. Each item displays:

- **Name** — click to jump to the next occurrence in the document (cycles through all occurrences, including both wikilinks and plain text mentions)
- **Count** — total number of occurrences (linked + unlinked mentions of that name). With **Match aliases of linked files** on (see [Settings](settings.md)), the count also folds in unlinked occurrences of the file's other aliases and is shown as `(total, N unlinked)`. For example, a note that links `[[+Zone of Proximal Development]]` twice but writes "ZPD" 33 more times reads `(35, 33 unlinked)`, and clicking the name cycles through all 35.
- **→ button** — opens the taxa file directly

This section only appears when the note contains at least one taxa link.

### Unlinked Mentions

Scans the note for text matching existing taxa files that aren't linked yet. Enfoliate checks both filenames (without prefix) and frontmatter aliases.

Matches are grouped by taxa type. Each match shows:

- **Name** — click to jump to the next occurrence, cycling through every match (including alias hits of different lengths)
- **Count** — number of unlinked occurrences
- **Link** — wraps the first occurrence in a wikilink, preserving its surface form as the link alias
- **Link all** — wraps every occurrence in wikilinks
- **✕ (Dismiss)** — hides this suggestion for the current session
- **Ignore** — permanently blocklists this term (see [Settings](settings.md))

Matching rules:
- Case-insensitive
- Word boundaries respected (won't match "art" inside "party")
- Markdown formatting characters (`*`, `_`, `~`, `` ` ``) treated as word boundaries, so bold/italic text is matched correctly
- Existing wikilinks are excluded — text inside `[[ ]]` won't generate a match
- Minimum term length of 2 characters
- A file that is already linked anywhere in the note never appears under Unlinked Mentions — it is shown under Linked Taxa instead, so the same file is never listed twice. Its still-unlinked alias occurrences are surfaced there (see Linked Taxa above) when **Match aliases of linked files** is on.

## Sticky headers

As you scroll, the title bar, the search box, the current section heading (Linked Taxa / Unlinked Mentions), and the current category header stay pinned to the top of the panel, so you always know where you are. Hide the search box with **Show search bar** in settings.

## Filtering

The **Filter taxa** box at the top of the panel narrows both Linked Taxa and Unlinked Mentions to entries whose name or alias contains what you type. Categories with no remaining matches are hidden, and a matching entry inside a collapsed category is revealed while the filter is active. Clearing the box restores the full list and your collapse state.

## Scanning

With **Auto-scan** on (the default), the sidebar rescans automatically when you:

- Switch to a different file
- Edit the current file (debounced to 1 second)
- Change your text selection

Turn **Auto-scan** off (in settings) when you don't want the sidebar working on every keystroke and file switch — useful in large vaults. A **Scan** button then appears in the sidebar header; the panel only analyzes the active note when you click it.

## Selection scoping

Select text in the editor to scope the scan to just that selection. Deselect to revert to the full note. Turn this off with **Scope to selection** in settings to always scan the whole note regardless of selection.

## Jump-to-occurrence

Clicking a taxa name (in any section) jumps to the next occurrence in the document. Clicking again jumps to the next one, cycling through all positions. The jump:

1. Focuses the editor
2. Sets the cursor at the occurrence
3. Scrolls the view to show the occurrence
4. Optionally highlights the text with a brief fade-out animation

For wikilinks, the highlight covers the full `[[...]]` span, not just the display text.

In **Reading mode** there is no editor to drive, so the jump scrolls the rendered preview to the occurrence and highlights it directly in the rendered HTML (via the CSS Custom Highlight API). The exact occurrence is found by index — its position among the matching occurrences in source maps to the same position among the rendered ones — so cycling moves through occurrences one at a time as in edit mode, even when several share a line, and a linked occurrence is highlighted on its rendered link rather than skipped. The match is centered in the view.

### Highlight settings

- **Toggle highlight on jump** — enable/disable the highlight flash (Settings → Enfoliate)
- **Highlight color** — choose a custom color or use the default yellow (`rgba(255, 215, 0, 0.45)`)
- **Highlight duration** — how long the highlight stays before fading, 0.5 to 10 seconds (default 2.5)
