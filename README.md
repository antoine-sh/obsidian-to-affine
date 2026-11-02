# obsidian-to-affine

Convert an [Obsidian](https://obsidian.md) vault into Markdown that [AFFiNE](https://affine.pro)'s built-in importer can read. Offline: no network access, no AFFiNE API. You import the result into AFFiNE by hand.

The vault is read-only. Nothing in it is modified, moved or deleted, and the tool refuses to write inside it.

## Requirements

Node.js 22 (see `.nvmrc`) and [pnpm](https://pnpm.io).

## Usage

```bash
pnpm install
pnpm build
node dist/cli/index.js <vault-path> --out <path> [options]
```

Once installed as a package, the binary is `obsidian-to-affine`.

| Flag | Meaning |
|---|---|
| `--out <path>` | Where to write the export. Must be outside the vault, and a new or empty directory (a new file with `--zip`). Without `--out`, the tool only lists the notes, attachments and ignored paths it found. |
| `--zip` | Write `--out` as a zip archive instead of a directory. |
| `--format markdown` | Output format. Only `markdown` exists today. |
| `--exclude <glob>` | Skip vault paths matching the glob. Repeatable. |
| `--report <path>` | Also write the conversion report as JSON. Must be outside the vault and the export. |
| `--verbose` | Print progress to stderr. |

`--format`, `--zip`, `--report` and `--verbose` require `--out`.

Progress and warnings go to stderr. Exit codes: `0` success (warnings allowed), `1` fatal error (bad vault, unsafe output path, I/O failure), `2` invalid usage.

```bash
obsidian-to-affine ~/Vaults/notes --out ~/export --report ~/report.json
obsidian-to-affine ~/Vaults/notes --out ~/export.zip --zip --exclude "Templates/**"
```

## What gets converted

| Obsidian | Result |
|---|---|
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]` | Resolved with Obsidian's shortest-path matching, rewritten as relative Markdown links. Alias text is kept. |
| `![[image.png]]` | Standard Markdown image. Size hints like `\|200` are dropped. |
| `![[file.pdf]]` and other attachments | Markdown link to the copied file. |
| `![[Note]]` | Becomes a link to the note (not inlined), with a `note-embed` warning. |
| Attachments | Copied to the same relative path. |
| Folders | The vault's folder layout is mirrored. |
| Frontmatter | Kept. `tags`/`tag` keys merge with inline `#tags` (including `#a/b`) into one deduplicated `tags` list. |
| Inline `#tags` | Left as text, and added to the frontmatter `tags`. |
| `.canvas`, Excalidraw, `dataview`/`dataviewjs`/`tasks`/`query` blocks | Kept as fenced code, with an `unsupported` warning. `.canvas` files get a `.md` suffix. |

Dot-prefixed paths (`.obsidian/`, `.trash/`, `.git/`) are ignored. Output is deterministic: the same vault always gives the same bytes.

## Conversion report

Every lossy conversion is reported with file, line, kind and message, and the run still succeeds. Kinds:

- `broken-link`: target not found; the original text is left in place.
- `note-embed`: an embedded note was turned into a link.
- `unsupported`: content with no AFFiNE equivalent, kept as code.
- `invalid-frontmatter`: YAML that failed to parse; kept as a `yaml` code block.

The console gets one line per warning plus a summary. `--report` writes `{ notes, attachments, warnings }` as JSON.

## Architecture

```
scan → parse → resolve → transform → write → report
```

| Directory | Role |
|---|---|
| `src/scan` | Walk the vault and list notes, attachments and ignored paths. |
| `src/parse` | Read notes into an mdast AST plus frontmatter. |
| `src/resolve` | Vault-wide index; resolve links and embeds. |
| `src/transform` | Pure rewrite of ASTs into plain Markdown, collecting warnings. |
| `src/writers` | Output writers (`markdown`, plus the zip packager). |
| `src/report` | Report building and console formatting. |
| `src/cli` | Argument parsing only. |

`convertVault` in `src/index.ts` runs the whole pipeline and is the programmatic entry point.

A planned `--format snapshot` would add a second writer that keeps more detail (linked docs, properties, folders).

## Development

```bash
pnpm test         # Vitest
pnpm lint         # Biome
pnpm typecheck    # tsc --noEmit
pnpm format       # Biome format
```

Tests use fixture vaults in `test/fixtures/<case>/`. Golden fixtures (`vault/` → `expected/` plus `expected-warnings.json`) cover `wikilinks`, `names`, `embeds`, `tags` and `unsupported-blocks`; the source vault is checked to be unchanged after each run. Contribution rules (TDD, Conventional Commits) are in [AGENTS.md](AGENTS.md).
