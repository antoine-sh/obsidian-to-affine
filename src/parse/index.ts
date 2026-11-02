import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Literal, PhrasingContent, Root, Text } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Point } from "unist";
import { SKIP, visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import type { ScanResult } from "../scan/index.ts";

/** `[[target#heading|alias]]`, or an embed `![[...]]`. Unresolved: resolve maps `target` to a file. */
export interface WikiLink extends Literal {
	type: "wikiLink";
	embed: boolean;
	/** Empty for same-note links such as `[[#Heading]]`. */
	target: string;
	heading?: string;
	block?: string;
	/** Alias text, or an embed size such as `200` / `200x100`. */
	alias?: string;
	/** Original source text, kept so unresolved links can be written back verbatim. */
	value: string;
}

/** Inline `#tag` (without the `#`); nested tags keep their `/`. */
export interface Tag extends Literal {
	type: "tag";
	value: string;
}

declare module "mdast" {
	interface PhrasingContentMap {
		wikiLink: WikiLink;
		tag: Tag;
	}
	interface RootContentMap {
		wikiLink: WikiLink;
		tag: Tag;
	}
}

export interface ParseWarning {
	kind: "invalid-frontmatter" | "unsupported";
	/** Vault-relative POSIX path. */
	file: string;
	line: number;
	message: string;
}

export interface ParsedNote {
	/** Vault-relative POSIX path. */
	path: string;
	/** Empty when the note has no frontmatter or it is invalid. */
	frontmatter: Record<string, unknown>;
	/** The `yaml` node stays in the tree, so invalid frontmatter is never lost. */
	ast: Root;
	warnings: ParseWarning[];
}

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkFrontmatter);

// Wikilinks: no brackets inside. Tags: Obsidian requires whitespace (or line start) before `#`.
const OBSIDIAN = /(!?)\[\[([^[\]]+)\]\]|(?<=^|\s)#([\p{L}\p{N}_/-]+)/gu;

// Files AFFiNE cannot represent; the whole source is kept as one code block, with this language.
const UNSUPPORTED: [RegExp, string, string][] = [
	[/\.canvas$/i, "json", "Canvas"],
	[/\.excalidraw\.md$/i, "excalidraw", "Excalidraw drawing"],
];

export function parseNote(path: string, source: string): ParsedNote {
	const unsupported = UNSUPPORTED.find(([re]) => re.test(path));
	if (unsupported) {
		const [, lang, what] = unsupported;
		return {
			path,
			frontmatter: {},
			ast: {
				type: "root",
				children: [{ type: "code", lang, value: source.replace(/\r?\n$/, "") }],
			},
			warnings: [
				{
					kind: "unsupported",
					file: path,
					line: 1,
					message: `${what} has no AFFiNE equivalent; kept as code`,
				},
			],
		};
	}
	const ast = processor.parse(source);
	const warnings: ParseWarning[] = [];
	let frontmatter: Record<string, unknown> = {};

	const first = ast.children[0];
	if (first?.type === "yaml") {
		try {
			const data: unknown = parseYaml(first.value);
			if (data === null) {
				// Empty `---\n---` block: nothing to keep.
			} else if (typeof data === "object" && !Array.isArray(data)) {
				frontmatter = data as Record<string, unknown>;
			} else {
				throw new Error("frontmatter must be a mapping of keys to values");
			}
		} catch (e) {
			warnings.push({
				kind: "invalid-frontmatter",
				file: path,
				line: first.position?.start.line ?? 1,
				message: `Invalid YAML frontmatter, kept as text: ${(e as Error).message}`,
			});
		}
	}

	// Only `text` nodes are visited, so code spans, code blocks and URLs are never rewritten.
	// shortcut: a wikilink that remark splits across nodes (e.g. `[[a *b* c]]`) stays plain text;
	// move to a micromark extension if real vaults hit this.
	visit(ast, "text", (node, index, parent) => {
		if (!parent || index === undefined) return;
		// A text node that follows inline markup (`**b**#t`) does not start after whitespace.
		const prev = parent.children[index - 1];
		const parts = splitText(node, source, !prev || prev.type === "break");
		if (!parts) return;
		parent.children.splice(index, 1, ...parts);
		return [SKIP, index + parts.length];
	});

	return { path, frontmatter, ast, warnings };
}

function splitText(
	node: Text,
	source: string,
	startsAfterSpace: boolean,
): PhrasingContent[] | undefined {
	// remark has already removed escapes from `node.value`, so `\#x` must be checked in the source.
	const offsets = sourceOffsets(node, source);
	const escaped = (i: number): boolean => isEscaped(source, offsets[i] ?? 0);
	const out: PhrasingContent[] = [];
	let last = 0;
	for (const m of node.value.matchAll(OBSIDIAN)) {
		let [raw, bang, inner, tag] = m;
		let start = m.index;
		if (tag !== undefined) {
			// Obsidian needs at least one non-digit, so `#123` is not a tag.
			if (!/\P{N}/u.test(tag) || escaped(start)) continue;
			if (start === 0 && !startsAfterSpace) continue;
		} else {
			const open = start + (bang?.length ?? 0);
			const close = start + raw.length;
			if ([open, open + 1, close - 2, close - 1].some(escaped)) continue;
			// `\![[x]]` is a literal `!` followed by a plain link.
			if (bang === "!" && escaped(start)) {
				start++;
				raw = raw.slice(1);
				bang = "";
			}
		}
		if (start > last) out.push(textNode(node, last, start));
		const position = {
			start: pointAt(node, start),
			end: pointAt(node, start + raw.length),
		};
		out.push(
			tag !== undefined
				? { type: "tag", value: tag, position }
				: { ...wikiLink(bang === "!", inner ?? "", raw), position },
		);
		last = start + raw.length;
	}
	if (out.length === 0) return undefined;
	if (last < node.value.length)
		out.push(textNode(node, last, node.value.length));
	return out;
}

function wikiLink(embed: boolean, inner: string, value: string): WikiLink {
	const pipe = inner.indexOf("|");
	const ref = pipe === -1 ? inner : inner.slice(0, pipe);
	const hash = ref.indexOf("#");
	const link: WikiLink = {
		type: "wikiLink",
		embed,
		target: (hash === -1 ? ref : ref.slice(0, hash)).trim(),
		value,
	};
	if (hash !== -1) {
		const sub = ref.slice(hash + 1).trim();
		if (sub.startsWith("^")) link.block = sub.slice(1);
		else link.heading = sub;
	}
	if (pipe !== -1) link.alias = inner.slice(pipe + 1).trim();
	return link;
}

/** Source offset of each character of `node.value`, skipping escapes and container prefixes such as `> `. */
// shortcut: entities (`&lt;`) can misalign a few following characters; only used for escape checks.
function sourceOffsets(node: Text, source: string): number[] {
	const end = node.position?.end.offset ?? source.length;
	let at = node.position?.start.offset ?? 0;
	const offsets: number[] = [];
	for (const c of node.value) {
		const found = source.indexOf(c, at);
		if (found !== -1 && found < end) at = found;
		for (let k = 0; k < c.length; k++) offsets.push(at++);
	}
	return offsets;
}

/** An odd number of backslashes before `offset` escapes the character there. */
function isEscaped(source: string, offset: number): boolean {
	let n = 0;
	while (source[offset - 1 - n] === "\\") n++;
	return n % 2 === 1;
}

function textNode(node: Text, from: number, to: number): Text {
	return {
		type: "text",
		value: node.value.slice(from, to),
		position: { start: pointAt(node, from), end: pointAt(node, to) },
	};
}

// shortcut: assumes the text value maps 1:1 onto the source, so positions drift after escapes
// or entities (e.g. `\|`) on the same line; fine for report line numbers, revisit if columns matter.
function pointAt(node: Text, index: number): Point {
	const start = node.position?.start ?? { line: 1, column: 1, offset: 0 };
	const before = node.value.slice(0, index);
	const newlines = before.split("\n").length - 1;
	return {
		line: start.line + newlines,
		column:
			newlines === 0 ? start.column + index : index - before.lastIndexOf("\n"),
		offset: (start.offset ?? 0) + index,
	};
}

/** Reads and parses every scanned note, in scan order. Reads only; never writes to the vault. */
export async function parseVault(
	vaultPath: string,
	scan: ScanResult,
): Promise<ParsedNote[]> {
	// Sequential so large vaults do not exhaust file descriptors (EMFILE).
	const notes: ParsedNote[] = [];
	for (const path of scan.notes) {
		notes.push(parseNote(path, await readFile(join(vaultPath, path), "utf8")));
	}
	return notes;
}
