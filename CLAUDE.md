# CLAUDE.md — obsidian-foliate

## Project Locations

- **Source code:** `/Users/harrisgb/Documents/GitHub/obsidian-foliate/`
- **Deployed plugin:** `/Users/harrisgb/Documents/Obsidian/EtchedInterim/.obsidian/plugins/obsidian-foliate/`

## Build & Deploy

```bash
cd /Users/harrisgb/Documents/GitHub/obsidian-foliate
npx tsc --noEmit   # typecheck (esbuild does not)
npm run build      # produces main.js
# copy the built artifacts into the vault plugin folder:
DST=/Users/harrisgb/Documents/Obsidian/EtchedInterim/.obsidian/plugins/obsidian-foliate
cp main.js manifest.json styles.css "$DST/"
```

`main.js` is gitignored in the source repo (built artifact). After copying, fully reload the plugin in Obsidian (Settings > Community plugins, toggle off then on) so both `main.js` and `styles.css` are picked up. Always run `tsc --noEmit` and confirm it exits 0 before committing.

## Architecture

Taxa-based knowledge organization plugin for Obsidian, built to work alongside Stowe Boyd's Folio system. Core concepts:

- **Taxa mappings:** prefix characters (`@` People, `+` Concepts, etc.) map to target folders. Folders ship unset; the user assigns them.
- **Auto-move:** files whose name starts with a taxa prefix move to the matching folder on create/rename.
- **Suggestions sidebar:** two sections for the active note — Linked Mentions and Unlinked Mentions — grouped by taxon, with jump-to-occurrence + flash highlight, a right-click action menu, configurable inline buttons, configurable click/modifier-click actions, sorting, and an optional "limit to visible area" viewport scope.
- **Per-taxon templates:** `{{title}}`/`{{name}}`/`{{alias}}`, `{{prefix}}`, `{{label}}`, and Obsidian core date tokens are substituted; Templater `<% %>` runs if installed.

There is no LLM/Ollama integration, editor autocomplete, or status bar (all removed).

## Key Files

- `src/main.ts` — plugin entry, commands, auto-mover, sidebar activation, settings load/save
- `src/settings.ts` — settings tab UI and modals (Blocklist, Confirm, folder/file suggesters)
- `src/types.ts` — interfaces and the `ClickAction` / `OpenMode` / `SortOrder` types and `INLINE_ACTION_OPTIONS`
- `src/taxa.ts` — default taxa mappings and prefix helpers
- `src/icon.ts` — the registered booklet icon (from The Noun Project)
- `src/ui/suggestions-view.ts` — the sidebar view (sections, click actions, jump highlight, viewport scope, row actions)
- `src/ui/taxa-picker-modal.ts` — modal for choosing a taxon
- `src/services/file-operations.ts` — file creation, linking, alias and folder handling, template rendering
- `src/services/unlinked-matcher.ts` — scans note content for taxa mentions (`findUnlinkedMatches`, `findUnlinkedPositions`, `findTaxaFileByText`)

## GitHub Workflow

**Current mode: SOLO** — change the word on this line to TEAM to switch. The agent reads this line and follows the matching mode below.

`main` is always releasable. CI (`.github/workflows/ci.yml`) typechecks and builds on every push to `main` and every PR. Releases publish automatically (`.github/workflows/release.yml`) when a version tag is pushed.

### Solo mode (default)

- Commit directly to `main` for routine work; deploy to the vault and verify.
- Use a branch + PR only for large or risky changes, at your discretion.

### Team mode

- Never commit or push to `main` directly. For each task:
  1. Branch from main: `git switch -c <type>/<short-desc>` (`type` = `feat` | `fix` | `docs` | `chore` | `refactor`).
  2. Commit, push, open a PR: `gh pr create --fill`.
  3. Let CI run; do not merge until it is green.
  4. Merge with `gh pr merge --squash --delete-branch` after review.
- Releases still happen from `main` after the PR merges (see below).

Branch names: `type/short-desc`. Prefer Conventional Commit subjects (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).

### Cutting a release (either mode)

1. Move the `## Unreleased` notes in `CHANGELOG.md` under a new `## x.y.z - YYYY-MM-DD` heading (run `date` for the date).
2. Bump the version in `manifest.json` and `package.json`, and add `"x.y.z": "<minAppVersion>"` to `versions.json`. Keep all three in sync.
3. Commit and push to `main`.
4. Tag and push: `git tag x.y.z && git push origin x.y.z`. No `v` prefix — the tag must equal `manifest.version`.
5. The Release Action builds and publishes the GitHub release with `main.js`, `manifest.json`, and `styles.css`, using the matching CHANGELOG section as the notes. BRAT picks it up.
