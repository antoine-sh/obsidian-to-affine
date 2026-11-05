# AGENTS.md

Guidance for AI coding agents (and humans) working on **obsidian-to-affine**.

## Project overview

`obsidian-to-affine` is a **command-line tool** that converts an [Obsidian](https://obsidian.md) vault into files that [AFFiNE](https://affine.pro)'s built-in importer can consume.

- **Input:** a path to an Obsidian vault (a folder of Markdown files, attachments, and `.obsidian/` config).
- **Output:** an export directory or zip archive, written somewhere other than the vault, that the user imports into AFFiNE by hand.
- **No network access:** the tool does not talk to AFFiNE servers or APIs.

### Roadmap

Status: v1 is implemented end to end (scan → parse → resolve → transform → write → report) with `--out`, `--zip`, `--exclude`, `--report` and `--verbose`. There is no snapshot writer: AFFiNE's snapshot import cannot carry folders, tags or properties, so it was dropped. `README.md` is the user-facing doc: update it when flags, behavior or warning kinds change.

**v1: normalized Markdown export.** Rewrite Obsidian-specific syntax into Markdown that AFFiNE's Markdown importer handles well, and package it with its attachments.

### Features to preserve

| Obsidian feature | Expected handling |
|---|---|
| Wikilinks `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]` | Resolve to the target note using Obsidian's shortest-path resolution, then rewrite as links AFFiNE can import. Keep alias text. |
| Embeds `![[Note]]`, `![[image.png]]`, `![[file.pdf]]` | Embedded attachments become standard Markdown image/file references. Embedded notes currently become links with a `note-embed` warning; inlining is not implemented. |
| Attachments (images, PDFs, other files) | Copy into the export with stable, collision-free paths and update every reference to them. |
| YAML frontmatter and `#tags` (including nested `#a/b`) | Keep them as doc properties and tags in a form AFFiNE can import. Merge frontmatter `tags:` with inline tags and remove duplicates. |
| Folder structure | Mirror the vault's folder hierarchy in the export so it maps to AFFiNE's organization. |

### Unsupported content

Some Obsidian content has no AFFiNE equivalent, such as Dataview queries, plugin-specific syntax, `.canvas` files, and Excalidraw drawings. For these, **keep the content as text and warn**:

- Wrap the raw source in a fenced code block (tagged with the original language or plugin name when known) so nothing is lost.
- Record each case in the **conversion report**, with file, line, kind, and message.
- Do not drop content silently and do not fail the whole run because of it.

Broken links (targets that don't exist) are also reported. Leave the original text in place.

### The source vault is read-only

The converter must **never modify, move, or delete anything inside the source vault**. All writes go to the output location.

- Refuse to run if the output path is inside the vault, or equal to it.
- Open vault files read-only. Never write temp files into the vault.
- Tests must check that a fixture vault is byte-for-byte unchanged after conversion.

## Tech stack

- **Language:** TypeScript (strict mode), ESM.
- **Runtime:** Node.js **22 LTS** (pin it in `.nvmrc` and `engines`).
- **Package manager:** **pnpm**. Do not commit `package-lock.json` or `yarn.lock`.
- **Tests:** **Vitest**.
- **Lint and format:** **Biome**. Do not add ESLint or Prettier.
- Prefer well-maintained libraries for Markdown parsing (for example the `unified`/`remark` ecosystem with `mdast`) over hand-written regexes. Use regexes only for narrow, well-tested cases.

## Architecture

Keep the pipeline as separate, independently testable stages:

```
scan → parse → resolve → transform → write → report
```

| Stage | Responsibility |
|---|---|
| **scan** | Walk the vault and list notes, attachments, and ignored paths (`.obsidian/`, `.trash/`, user excludes). |
| **parse** | Read each note into an AST plus frontmatter. No I/O beyond reading. |
| **resolve** | Build a vault-wide index and resolve wikilinks, embeds, and attachments to concrete targets. |
| **transform** | Pure functions that rewrite ASTs into the target dialect and collect warnings. |
| **write** | A format-specific *writer* (`markdown` today) that emits the output and copies attachments. |
| **report** | Summarize conversions, warnings, and broken links for the console and as a machine-readable file (for example `conversion-report.json`). |

Suggested layout:

```
src/
  cli/          # argument parsing and entry point only; no business logic
  scan/
  parse/
  resolve/
  transform/
  writers/
    markdown/
    zip.ts      # packages a finished export directory
  report/
  index.ts      # programmatic API used by the CLI
test/
  fixtures/
    <case-name>/
      vault/       # input vault (read-only)
      expected/    # golden output
  *.test.ts
```

Golden fixtures (run by `test/fixtures.test.ts`, each with `vault/`, `expected/` and `expected-warnings.json` listing `kind`, `file`, `line`): `wikilinks`, `names` (spaces, Unicode, same-name notes in different folders, deep paths), `embeds`, `tags`, `unsupported-blocks`.

Other fixtures are used by focused tests: `scan-basic` (only `vault/`), `write-basic`, `unsupported-files`, and `report-basic` (also has `conversion-report.json`).

Principles:

- Keep `transform` pure: no filesystem or global state. Do I/O at the edges (`scan`, `write`).
- Output must be deterministic. The same vault gives byte-identical output: sort directory listings, use stable IDs, and include no timestamps unless asked for.
- Normalize paths with POSIX separators internally, and handle case-insensitive filename matching the way Obsidian does.
- Handle Unicode filenames, spaces, and special characters correctly.

## Development workflow

```bash
pnpm install          # install dependencies
pnpm build            # compile TypeScript
pnpm test             # run Vitest once
pnpm test:watch       # Vitest in watch mode
pnpm lint             # biome check .
pnpm format           # biome format --write .
pnpm typecheck        # tsc --noEmit
```

Before considering any change done, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. All three must pass. Don't claim success without running them.

## Testing: TDD with fixture vaults

This project uses **test-driven development**:

1. **Write a failing test first** that describes the new behavior or reproduces the bug.
2. Run it and confirm it fails for the expected reason.
3. Write the minimum code needed to make it pass.
4. Refactor with the tests green.

**Fixture vaults** are the main testing tool:

- Each feature or bug gets its own small fixture under `test/fixtures/<case-name>/` with a `vault/` input and an `expected/` golden output.
- Golden tests run the full pipeline on `vault/` and compare against `expected/`, including the conversion report.
- Update golden files on purpose (for example `pnpm test -- -u` or a dedicated script), and review every golden-file diff in the PR.
- Cover pure `transform` and `resolve` logic with focused unit tests as well.
- Every fixture test also checks that the source vault was not modified.
- Never skip, disable, or weaken a test to get the suite green.

## Code style

- Biome is the source of truth for formatting and lint rules. Don't argue with the formatter.
- TypeScript `strict` mode. Avoid `any`. Use `unknown` plus narrowing instead.
- Prefer small, named, pure functions and explicit return types on exported APIs.
- Use typed warning and error objects (with a `kind` discriminant), not bare strings.
- Library code (`src/` outside `cli/`) should not call `process.exit` or write to stdout directly. Return results and let the CLI decide.
- Add comments that explain *why* (especially Obsidian or AFFiNE quirks), not *what*.

## CLI conventions

- Shape: `obsidian-to-affine <vault-path> [--out <path>] [--zip] [--exclude <glob>...] [--report <path>] [--verbose]`.
- Exit codes: `0` success (warnings allowed), `1` fatal error (bad input, output inside the vault, I/O failure), `2` invalid usage.
- Progress and warnings go to stderr. Machine-readable output, if any, goes to stdout or the report file.
- Error messages must be clear and actionable, and include the offending path.

## Git and commits

- Use **Conventional Commits**: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `build:`, `ci:`. Add a scope when helpful, for example `feat(resolve): support block references`.
- Keep commits small and focused. Separate refactors from behavior changes.
- Work on feature branches and merge through pull requests. Don't push directly to the default branch.
- PR descriptions say what changed, why, and how it was tested, including any golden-file updates.

## Do / Don't summary

**Do**

- Write the failing test (and fixture) before the implementation.
- Keep the source vault untouched and the output deterministic.
- Report every lossy conversion and broken link.
- Keep writers pluggable.

**Don't**

- Modify anything in the input vault.
- Drop unsupported content silently.
- Add network calls or AFFiNE API integration (out of scope).
- Introduce npm/yarn lockfiles, ESLint, or Prettier.
- Skip `pnpm lint && pnpm typecheck && pnpm test` before finishing.
