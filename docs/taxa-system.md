# Taxa System

Foliate organizes knowledge files using **taxa**: prefix characters that classify a file by type. Each taxon maps a prefix to a label and a folder, so every file of that type lives in the same place.

## How it works

When a file's name starts with a taxa prefix, Foliate knows what kind of knowledge it represents and where it belongs. The file `@Ada Lovelace.md` starts with `@`, so Foliate treats it as a **People** file and stores it in the People folder.

## Default taxa

Foliate ships with these prefixes and labels. Folders start unset, so you assign each taxon's folder in settings to match your vault. Until a taxon has a folder, its files are created at the vault root and aren't auto-moved.

| Prefix | Label         | Default folder |
|--------|---------------|----------------|
| `@`    | People        | (unset)        |
| `+`    | Concepts      | (unset)        |
| `~`    | Places        | (unset)        |
| `•`    | Projects      | (unset)        |
| `©`    | Works         | (unset)        |
| `¡`    | Images        | (unset)        |
| `º`    | Organizations | (unset)        |
| `∞`    | Events        | (unset)        |

## Customizing taxa

All mappings are configurable in **Settings → Foliate → Taxa Mappings**. You can:

- **Change prefixes:** use any character or multi-character string
- **Change labels:** rename "People" to "Characters" or anything else
- **Change folders:** point each taxon at whatever folder structure you use
- **Add new taxa:** create your own categories beyond the defaults
- **Remove taxa:** delete any mapping you don't need

When multiple prefixes could match (e.g. `@` and `@@`), Foliate checks the longest prefix first.

## Auto-move

When auto-move is enabled (the default), Foliate watches for two events:

1. **File creation:** a new file with a taxa prefix is automatically moved to the matching folder
2. **File rename:** renaming a file to include a taxa prefix moves it to the matching folder

If the target folder doesn't exist, Foliate creates it automatically (configurable). If a file with the same name already exists in the target folder, Foliate warns you instead of overwriting.

You can also manually move the active file with the **Move current note to taxa folder** command.

### Disabling auto-move

Toggle auto-move off in **Settings → Foliate** if you prefer to manage file locations yourself. The manual move command still works regardless of this setting.

## Aliases

When Foliate creates a taxa file, it adds the clean name (without the prefix) as a frontmatter alias. For example, creating `@Ada Lovelace.md` adds `Ada Lovelace` to the `aliases` field. This means Obsidian's backlink detection and search will find references to "Ada Lovelace" even without the `@` prefix.

Aliases are sorted longest-to-shortest in the frontmatter, which helps Obsidian's link resolution match the most specific alias first.
