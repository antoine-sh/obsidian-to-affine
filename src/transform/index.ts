import { posix } from "node:path";
import type { PhrasingContent, Root, RootContent } from "mdast";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import { parseDocument } from "yaml";
import type { ParsedNote, WikiLink } from "../parse/index.ts";
import { resolveLink, type VaultIndex } from "../resolve/index.ts";

export interface TransformWarning {
	kind: "broken-link" | "note-embed" | "unsupported";
	/** Vault-relative POSIX path. */
	file: string;
	line: number;
	message: string;
}

export interface TransformedNote {
	path: string;
	/** Frontmatter with `tags` replaced by the merged tag list (when there are tags). */
	frontmatter: Record<string, unknown>;
	/** Frontmatter and inline tags, without `#`, deduplicated case-insensitively in first-seen order. */
	tags: string[];
	/** Standard mdast: no `wikiLink` or `tag` nodes remain. */
	ast: Root;
	warnings: TransformWarning[];
}

const IMAGE = /\.(png|jpe?g|gif|bmp|svg|webp|avif)$/i;
// Fenced blocks that only render inside an Obsidian plugin.
const PLUGIN_BLOCKS = new Set(["dataview", "dataviewjs", "tasks", "query"]);

/**
 * Rewrites a parsed note into plain Markdown semantics. Pure: the input note is not mutated.
 * Output paths mirror vault paths, so links point at the target's vault path relative to this note.
 */
export function transformNote(
	note: ParsedNote,
	index: VaultIndex,
): TransformedNote {
	const ast = structuredClone(note.ast);
	const warnings: TransformWarning[] = [];
	const tags: string[] = [];
	const addTag = (t: string): void => {
		const tag = t.replace(/^#/, "").trim();
		if (tag && !tags.some((x) => x.toLowerCase() === tag.toLowerCase()))
			tags.push(tag);
	};
	const warn = (
		kind: TransformWarning["kind"],
		node: Node,
		message: string,
	): void => {
		warnings.push({
			kind,
			file: note.path,
			line: node.position?.start.line ?? 1,
			message,
		});
	};

	// Obsidian reads `tags`, `tag`, and any capitalisation of them; they merge into one `tags` key.
	const frontmatter = { ...note.frontmatter };
	const tagKeys = Object.keys(frontmatter).filter((k) => /^tags?$/i.test(k));
	for (const k of tagKeys) {
		addTags(frontmatter[k], addTag);
		if (k !== "tags") delete frontmatter[k];
	}

	visit(ast, (node, i, parent) => {
		if (node.type === "link" || node.type === "linkReference") {
			// A link cannot contain a link, so a nested wikilink keeps only its label.
			visit(node, "wikiLink", (w, j, p) => {
				if (p && j !== undefined)
					p.children[j] = { type: "text", value: label(w) };
			});
		}
		if (
			node.type === "code" &&
			node.lang &&
			PLUGIN_BLOCKS.has(node.lang.toLowerCase())
		) {
			warn(
				"unsupported",
				node,
				`${node.lang} block has no AFFiNE equivalent; kept as code`,
			);
		}
		if (!parent || i === undefined) return;
		if (node.type === "tag") {
			addTag(node.value);
			// AFFiNE's Markdown importer has no inline tags; the text keeps them readable.
			parent.children[i] = { type: "text", value: `#${node.value}` };
		} else if (node.type === "wikiLink") {
			parent.children[i] = rewriteLink(node, note.path, index, warn);
		}
	});

	if (tags.length) frontmatter.tags = tags;
	const first = ast.children[0];
	const invalid = note.warnings.some((w) => w.kind === "invalid-frontmatter");
	if (first?.type === "yaml" && invalid) {
		ast.children[0] = { type: "code", lang: "yaml", value: first.value };
	}
	if (tags.length) {
		const valid = first?.type === "yaml" && !invalid;
		// Editing the YAML document, not re-serialising the object, keeps comments and key style.
		const doc = parseDocument(valid ? first.value : "");
		for (const k of tagKeys) doc.delete(k);
		doc.set("tags", tags);
		const yaml: RootContent = { type: "yaml", value: String(doc).trimEnd() };
		if (valid) ast.children[0] = yaml;
		else ast.children.unshift(yaml);
	}

	return { path: note.path, frontmatter, tags, ast, warnings };
}

/** Obsidian accepts a list or a comma/space-separated string. */
function addTags(value: unknown, add: (t: string) => void): void {
	const list = typeof value === "string" ? value.split(/[\s,]+/) : value;
	if (!Array.isArray(list)) return;
	for (const t of list)
		if (typeof t === "string" || typeof t === "number") add(String(t));
}

function rewriteLink(
	link: WikiLink,
	from: string,
	index: VaultIndex,
	warn: (kind: TransformWarning["kind"], node: Node, message: string) => void,
): PhrasingContent {
	const target = resolveLink(index, link.target, from);
	if (target.kind === "broken") {
		warn("broken-link", link, `Link target not found: ${link.target}`);
		return { type: "text", value: link.value };
	}
	const rel = posix.relative(posix.dirname(from), target.path);
	const anchor = link.heading ?? (link.block && `^${link.block}`);
	const url = [rel, anchor]
		.filter(Boolean)
		.map((s) => s?.split("/").map(encodeURIComponent).join("/"))
		.join("#");
	const name = posix.basename(target.path);
	// An embed alias is either a size (`200`, `200x100`) or display text.
	const shown =
		link.alias && !/^\d+(x\d+)?$/.test(link.alias) ? link.alias : name;

	if (link.embed && target.kind === "attachment") {
		// shortcut: embed sizes (`|200`) are dropped; AFFiNE's Markdown importer has no image width.
		return IMAGE.test(name)
			? { type: "image", url, alt: shown }
			: { type: "link", url, children: [{ type: "text", value: shown }] };
	}
	if (link.embed) {
		warn(
			"note-embed",
			link,
			`Embedded note ${target.path} converted to a link`,
		);
	}
	return {
		type: "link",
		url,
		children: [{ type: "text", value: label(link) }],
	};
}

/** Obsidian's display text: the alias, else `Note > Heading`. */
function label(link: WikiLink): string {
	return (
		link.alias ||
		[link.target, link.heading, link.block && `^${link.block}`]
			.filter(Boolean)
			.join(" > ")
	);
}
