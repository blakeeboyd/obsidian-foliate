# File creation & movement: the model

Notes for anyone (me included) adding functionality that creates, moves, or
renames files in Foliate. The recurring bug in this area is always the same
shape: **Foliate reacts to a vault event that its own operation triggered, while
that operation is still in progress.** Read this before touching `handleAutoMove`,
`moveFileToTaxaFolder`, `createTaxaFile`, or the vault event registrations.

## The event model (verified, not assumed)

- `vault.create(path, content)` fires the vault **`create`** event effectively
  synchronously: the auto-mover's `create` handler starts running before the
  `await vault.create(...)` in the caller resolves its following lines. So any
  work a creator does *after* `vault.create` (Templater, alias, a follow-up
  move) races the auto-move.
- `fileManager.renameFile(file, newPath)` is what moves/renames a file **and
  updates every `[[link]]` to it across the vault**. Always use it, never
  `vault.rename`, for anything a note might link to.
- Renaming a file fires the vault **`rename`** event *and* kicks off Obsidian's
  own async link-rewriting pass. That pass isn't done when the `rename` event
  fires.
- `metadataCache.on("resolved")` fires once the whole link graph has settled
  after modifications (any batch size). It does **not** fire if a change touched
  no links. This is the real "links are done" signal.

## The two rules

**Rule 1 — Never move/rename in direct response to the event that started it.**
Moving inside a `rename` handler issues a second `renameFile` mid-pass, which
races Obsidian's link rewrite and breaks links to the file. Instead wait for
`metadataCache.on("resolved")` (one-shot listener + a timeout fallback for the
no-links case), then move. See `scheduleAutoMoveAfterLinksResolve`. (#0259)

**Rule 2 — Foliate must not auto-move a file Foliate is itself creating.**
`createTaxaFile` already places the file in the taxon folder and applies the
template + alias. The `create` event it fires would trigger a concurrent
auto-move that moves the file out from under those steps. Guard with the
`suppressAutoMove` set: the creator adds the target path before `vault.create`
and removes it in a `finally`; `handleAutoMove` skips any path in the set. (#0260
hardening)

## Creation paths (know which one you're in)

1. **`createTaxaFile`** (via Create-taxa-link, sidebar "Create file",
   link-all-unlinked). Builds `filePath` = `folder ? folder/name.md : name.md`,
   creates the file *already in the folder* with rendered template content, runs
   Templater if the template has `<% %>`, adds the alias. This is the only path
   that applies templates. Verified: with a folder + Templater template
   configured, the template applies correctly and the file needs no move.
2. **New note named with a taxa prefix** (Obsidian New Note / file explorer,
   outside Foliate). Only the auto-mover reacts: it **moves** the file, and by
   design does **not** apply a template. Templating is intentionally reserved for
   Foliate-initiated creation. Do not add templating here.

## Config variables that change the flow

- **Taxon `folder` empty** → `createTaxaFile` writes at vault root; auto-move
  no-ops (no folder to move to). No template loss, but the file stays at root.
- **`createFolderIfMissing` off + folder missing** → `vault.create(folder/…)`
  throws; caught, "Failed to create" notice, returns null. File not created.
- **Taxon `folder` set** → file created in-folder; auto-move sees
  `file.parent.path === folder` and no-ops. The suppress-set is then belt-and-
  suspenders, not load-bearing.
- **`template` unset/None** → no template applied (not a bug; nothing to apply).
- **`template` path wrong** → `renderTemplate` shows "Template not found" and
  returns empty content; file created empty.

When a "template didn't apply" bug can't be reproduced, check the reporter's
taxon config first: folder set? `createFolderIfMissing`? template path readable?
Most "bugs" here are one of these config states, not code.

## Checklist before shipping create/move/rename changes

- Does this fire a vault event that a Foliate handler also listens to? If yes,
  which handler, and does it act on the in-flight file?
- Am I moving/renaming in response to `rename`? → gate on `resolved`, not a
  timeout guess.
- Am I creating a file Foliate placed correctly? → add its path to
  `suppressAutoMove` for the duration.
- Am I using `fileManager.renameFile` (link-preserving), not `vault.rename`?
- Verify by driving the real path and reading the console
  (`read_console` MCP), not by reasoning alone — the event timing is the whole
  bug and it's easy to get wrong on paper.
