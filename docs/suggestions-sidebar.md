# Suggestions Sidebar

The suggestions sidebar is Portfolio's main analysis panel. It shows what's already linked in a note, what could be linked, and what an AI model thinks might be worth linking.

Open it with the **Open suggestions sidebar** command, by clicking the status bar taxa count, or by enabling "Open suggestions on startup" in settings.

## Sections

The sidebar has three sections, top to bottom:

### Linked Taxa

Shows all taxa currently linked in the active note, grouped by type. Each item displays:

- **Name** — click to jump to the next occurrence in the document (cycles through all occurrences, including both wikilinks and plain text mentions)
- **Count** — total number of occurrences (linked + unlinked mentions of that name). With **Match aliases of linked files** on (see [Settings](settings.md)), the count also folds in unlinked occurrences of the file's other aliases and is shown as `(total, N unlinked)`. For example, a note that links `[[+Zone of Proximal Development]]` twice but writes "ZPD" 33 more times reads `(35, 33 unlinked)`, and clicking the name cycles through all 35.
- **→ button** — opens the taxa file directly

This section only appears when the note contains at least one taxa link.

### Unlinked Mentions

Scans the note for text matching existing taxa files that aren't linked yet. Portfolio checks both filenames (without prefix) and frontmatter aliases.

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
- By default, a file that is already linked anywhere in the note drops out of unlinked mentions. Turn on **Match aliases of linked files** (see [Settings](settings.md)) to keep surfacing its still-unlinked alias occurrences — for example, when `[[+Zone of Proximal Development]]` is linked once but the abbreviation "ZPD" appears unlinked elsewhere. Each occurrence links with its own surface form, so "ZPD" becomes `[[+Zone of Proximal Development|ZPD]]`.

### AI Taxa Extraction

Uses a local [Ollama](https://ollama.ai) LLM to discover entities in your text. See [AI Extraction](ai-extraction.md) for setup and details.

## Refreshing

The sidebar refreshes automatically when you:

- Switch to a different file
- Edit the current file (debounced to 1 second)
- Change your text selection

Click the **↻** button in the header to manually refresh and re-run AI extraction.

## Selection scoping

Select text in the editor before refreshing to scope AI extraction to just that selection. Unlinked mention detection always scans the full note.

## Jump-to-occurrence

Clicking a taxa name (in any section) jumps to the next occurrence in the document. Clicking again jumps to the next one, cycling through all positions. The jump:

1. Focuses the editor
2. Sets the cursor at the occurrence
3. Scrolls the view to show the occurrence
4. Optionally highlights the text with a brief fade-out animation

For wikilinks, the highlight covers the full `[[...]]` span, not just the display text.

### Highlight settings

- **Toggle highlight on jump** — enable/disable the highlight flash (Settings → Portfolio)
- **Highlight color** — choose a custom color or use the default yellow (`rgba(255, 215, 0, 0.45)`)
- **Fade duration** — the highlight holds for 1.5 seconds, then fades over 1 second (2.5 seconds total)
