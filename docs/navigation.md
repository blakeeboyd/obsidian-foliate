# Navigation

Enfoliate provides several ways to move between your notes and find where entities are mentioned.

## Jump-to-occurrence

In the [suggestions sidebar](suggestions-sidebar.md), clicking on any taxa name jumps to its next occurrence in the editor. This works for:

- **Linked mentions** — jumps through both wikilink instances (`[[...]]`) and plain text mentions of the same name
- **Unlinked mentions** — jumps through plain text occurrences that aren't linked yet

Clicking repeatedly cycles through all occurrences. When you reach the last one, the next click wraps back to the first.

Jumping is the default action for a plain click, but the click and each modifier-click are configurable in **Settings → Enfoliate → Click Actions**: plain click, **Cmd/Ctrl+click**, **Option/Alt+click**, and **Shift+click**. Each can jump in the document, open the note in the current tab, a new tab, Split View, or a new window, or copy a wikilink to the note. Defaults: click jumps, Shift opens in Split View, Cmd/Ctrl in the current tab, Option/Alt in a new tab. With several modifiers held, precedence is Cmd/Ctrl, then Option/Alt, then Shift.

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

The linked mentions section in the sidebar includes a **→** button next to each taxa name. Clicking it opens that taxa file in the editor, the same as clicking a wikilink in the note body.

## Commands

| Command | What it does |
|---------|-------------|
| **Create taxa link** | Link selected text as a taxon (with prefix detection or picker) |
| **Move current note to taxa folder** | Move the active file to its taxa folder based on filename prefix |
| **Link all unlinked taxa in the current note** | Wrap every unlinked mention of an existing taxa file in the note in one pass (overlaps resolved by keeping the longest match) |
| **Open Enfoliate sidebar** | Show the Enfoliate panel in the right sidebar |
| **Toggle auto-scan** | Turn the sidebar's auto-scan on or off without opening settings |

All commands are available from the command palette (`Ctrl/Cmd+P`).
