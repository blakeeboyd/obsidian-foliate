# Taxa System

Enfoliate organizes knowledge files using **taxa** — prefix characters that classify a file by type. Each taxon maps a prefix to a label and a folder, so every file of that type lives in the same place.

## How it works

When a file's name starts with a taxa prefix, Enfoliate knows what kind of knowledge it represents and where it belongs. The file `@Ada Lovelace.md` starts with `@`, so Enfoliate treats it as a **People** file and stores it in the People folder.

## Default taxa

| Prefix | Label         | Default folder               |
|--------|---------------|------------------------------|
| `@`    | People        | `00 knowledge/people`        |
| `+`    | Concepts      | `00 knowledge/concepts`      |
| `~`    | Places        | `00 knowledge/places`        |
| `•`    | Projects      | `00 knowledge/projects`      |
| `©`    | Works         | `00 knowledge/works`         |
| `º`    | Organizations | `00 knowledge/organizations` |
| `∞`    | Events        | `00 knowledge/events`        |

## Customizing taxa

All mappings are fully configurable in **Settings → Enfoliate → Taxa Mappings**. You can:

- **Change prefixes** — use any character or multi-character string
- **Change labels** — rename "People" to "Characters" or anything else
- **Change folders** — point each taxon at whatever folder structure you use
- **Add new taxa** — create your own categories beyond the defaults
- **Remove taxa** — delete any mapping you don't need

When multiple prefixes could match (e.g. `@` and `@@`), Enfoliate checks the longest prefix first.

## Auto-move

When auto-move is enabled (the default), Enfoliate watches for two events:

1. **File creation** — a new file with a taxa prefix is automatically moved to the matching folder
2. **File rename** — renaming a file to include a taxa prefix moves it to the matching folder

If the target folder doesn't exist, Enfoliate creates it automatically (configurable). If a file with the same name already exists in the target folder, Enfoliate warns you instead of overwriting.

You can also manually move the active file with the **Move current note to taxa folder** command.

### Disabling auto-move

Toggle auto-move off in **Settings → Enfoliate** if you prefer to manage file locations yourself. The manual move command still works regardless of this setting.

## Aliases

When Enfoliate creates a taxa file, it adds the clean name (without the prefix) as a frontmatter alias. For example, creating `@Ada Lovelace.md` adds `Ada Lovelace` to the `aliases` field. This means Obsidian's backlink detection and search will find references to "Ada Lovelace" even without the `@` prefix.

Aliases are sorted longest-to-shortest in the frontmatter, which helps Obsidian's link resolution match the most specific alias first.
