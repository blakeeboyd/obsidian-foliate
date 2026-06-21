# Navigation

Enfoliate provides several ways to move between your notes and find where entities are mentioned.

## Status bar

The status bar shows a compact count of taxa links in the active note. For example, `3@ 2+ 1~` means three People links, two Concept links, and one Place link.

Click the status bar to open the suggestions sidebar.

The status bar updates automatically when you switch files. Toggle it in **Settings → Enfoliate → Show status bar** (requires plugin reload).

## Jump-to-occurrence

In the [suggestions sidebar](suggestions-sidebar.md), clicking on any taxa name jumps to its next occurrence in the editor. This works for:

- **Linked taxa** — jumps through both wikilink instances (`[[...]]`) and plain text mentions of the same name
- **Unlinked mentions** — jumps through plain text occurrences that aren't linked yet

Clicking repeatedly cycles through all occurrences. When you reach the last one, the next click wraps back to the first.

### What happens on jump

1. The editor pane is focused
2. The cursor moves to the occurrence
3. The view scrolls to center the occurrence
4. A highlight flash marks the text (if enabled)

### Highlight

The jump highlight is a brief visual pulse that draws your eye to where the cursor landed.

- **Default color:** yellow (`rgba(255, 215, 0, 0.45)`)
- **Custom color:** set any color via the color picker in Settings → Enfoliate
- **Duration:** holds for 1.5 seconds, then fades over 1 second
- **Wikilinks:** when jumping to a `[[link|alias]]`, the highlight covers the entire wikilink, not just the alias text

The highlight uses a CSS animation on `background-color`, so the text itself stays fully visible throughout the fade.

Toggle the highlight in **Settings → Enfoliate → Highlight on jump**.

## File navigation

The linked taxa section in the sidebar includes a **→** button next to each taxa name. Clicking it opens that taxa file in the editor, the same as clicking a wikilink in the note body.

## Commands

| Command | What it does |
|---------|-------------|
| **Create taxa link** | Link selected text as a taxon (with prefix detection or picker) |
| **Move current note to taxa folder** | Move the active file to its taxa folder based on filename prefix |
| **Open suggestions sidebar** | Show the suggestions panel in the right sidebar |

All commands are available from the command palette (`Ctrl/Cmd+P`).
