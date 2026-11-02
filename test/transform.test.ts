import { describe, expect, test } from "vitest";
import { parseNote } from "../src/parse/index.ts";
import { buildIndex } from "../src/resolve/index.ts";
import { transformNote } from "../src/transform/index.ts";

const index = buildIndex({
	notes: ["Home.md", "Projects/Plan.md", "Projects/Sub folder/Café notes.md"],
	attachments: ["assets/diagram.png", "Projects/spec.PDF"],
	ignored: [],
});

/** Strips positions so assertions focus on structure. */
function shape(node: unknown): unknown {
	return JSON.parse(
		JSON.stringify(node, (k, v) => (k === "position" ? undefined : v)),
	);
}

function run(source: string, path = "Home.md") {
	return transformNote(parseNote(path, source), index);
}

function paragraph(source: string, path = "Home.md"): unknown[] {
	const p = run(source, path).ast.children[0];
	if (p?.type !== "paragraph") throw new Error(`not a paragraph: ${source}`);
	return shape(p.children) as unknown[];
}

const text = (value: string) => ({ type: "text", value });
const link = (url: string, value: string) => ({
	type: "link",
	url,
	children: [text(value)],
});

describe("wikilinks", () => {
	test("become relative Markdown links, keeping alias text", () => {
		expect(paragraph("[[Plan]] [[Plan|the plan]]")).toEqual([
			link("Projects/Plan.md", "Plan"),
			text(" "),
			link("Projects/Plan.md", "the plan"),
		]);
	});

	test("urls are relative to the source note and percent-encoded", () => {
		expect(paragraph("[[Café notes]]", "Projects/Plan.md")).toEqual([
			link("Sub%20folder/Caf%C3%A9%20notes.md", "Café notes"),
		]);
		expect(paragraph("[[Home]]", "Projects/Plan.md")).toEqual([
			link("../Home.md", "Home"),
		]);
	});

	test("headings and block refs become anchors and show in the text", () => {
		expect(paragraph("[[Plan#Next steps]] [[Plan#^abc]] [[#Top]]")).toEqual([
			link("Projects/Plan.md#Next%20steps", "Plan > Next steps"),
			text(" "),
			link("Projects/Plan.md#%5Eabc", "Plan > ^abc"),
			text(" "),
			link("Home.md#Top", "Top"),
		]);
	});

	test("a wikilink inside a Markdown link becomes plain text", () => {
		expect(paragraph("[see [[Plan|it]]](http://u)")).toEqual([
			{
				type: "link",
				title: null,
				url: "http://u",
				children: [text("see "), text("it")],
			},
		]);
	});

	test("same-note links from a subfolder use the note's file name", () => {
		expect(paragraph("[[#H]]", "Projects/Plan.md")).toEqual([
			link("Plan.md#H", "H"),
		]);
	});

	test("broken links keep their source text and are reported", () => {
		const out = run("x\n\nSee [[Nope|n]].");
		expect(shape(out.ast.children[1])).toMatchObject({
			children: [text("See "), text("[[Nope|n]]"), text(".")],
		});
		expect(out.warnings).toEqual([
			{
				kind: "broken-link",
				file: "Home.md",
				line: 3,
				message: "Link target not found: Nope",
			},
		]);
	});
});

describe("embeds", () => {
	test("image embeds become images; a size alias is not used as alt text", () => {
		expect(paragraph("![[diagram.png]] ![[diagram.png|200]]")).toEqual([
			{ type: "image", url: "assets/diagram.png", alt: "diagram.png" },
			text(" "),
			{ type: "image", url: "assets/diagram.png", alt: "diagram.png" },
		]);
	});

	test("other attachment embeds become file links", () => {
		expect(paragraph("![[spec.pdf]]")).toEqual([
			link("Projects/spec.PDF", "spec.PDF"),
		]);
	});

	test("embed alias text is kept as alt text or link label", () => {
		expect(paragraph("![[diagram.png|A diagram]] ![[spec.pdf|Spec]]")).toEqual([
			{ type: "image", url: "assets/diagram.png", alt: "A diagram" },
			text(" "),
			link("Projects/spec.PDF", "Spec"),
		]);
	});

	test("note embeds become links and are reported", () => {
		const out = run("![[Plan]]");
		expect(shape(out.ast.children[0])).toMatchObject({
			children: [link("Projects/Plan.md", "Plan")],
		});
		expect(out.warnings.map((w) => w.kind)).toEqual(["note-embed"]);
	});

	test("broken embeds keep their source text", () => {
		expect(paragraph("![[missing.png]]")).toEqual([text("![[missing.png]]")]);
	});
});

describe("tags", () => {
	test("inline tags merge with frontmatter tags, deduplicated", () => {
		const out = run(
			"---\ntitle: T\ntags: [a, '#b/c']\n---\nText #B/c #new #a/b\n",
		);
		expect(out.tags).toEqual(["a", "b/c", "new", "a/b"]);
		expect(out.frontmatter).toEqual({
			title: "T",
			tags: ["a", "b/c", "new", "a/b"],
		});
		expect(out.ast.children[0]).toMatchObject({
			type: "yaml",
			value: "title: T\ntags:\n  - a\n  - b/c\n  - new\n  - a/b",
		});
	});

	test("comments and other keys survive tag merging", () => {
		const out = run("---\n# note\ntitle: T # inline\ntags: [a]\n---\n#b\n");
		expect(out.ast.children[0]).toMatchObject({
			type: "yaml",
			value: "# note\ntitle: T # inline\ntags:\n  - a\n  - b",
		});
	});

	test("number tags are kept as strings", () => {
		expect(run("---\ntags: [2024, a]\n---\n").tags).toEqual(["2024", "a"]);
	});

	test("Tags: and tag: keys merge into a single tags key", () => {
		const out = run("---\nTags: [a]\ntag: b\n---\n#c\n");
		expect(out.frontmatter).toEqual({ tags: ["a", "b", "c"] });
		expect(out.ast.children[0]).toMatchObject({
			value: "tags:\n  - a\n  - b\n  - c",
		});
	});

	test("empty frontmatter gains inline tags", () => {
		expect(run("---\n---\n#x\n").ast.children[0]).toMatchObject({
			type: "yaml",
			value: "tags:\n  - x",
		});
	});

	test("comma- or space-separated tag strings are accepted", () => {
		expect(run("---\ntags: a, b c\n---\n").tags).toEqual(["a", "b", "c"]);
	});

	test("inline tags stay as text and add frontmatter when there was none", () => {
		const out = run("Hi #x");
		expect(shape(out.ast.children)).toEqual([
			{ type: "yaml", value: "tags:\n  - x" },
			{ type: "paragraph", children: [text("Hi "), text("#x")] },
		]);
	});

	test("notes without tags or frontmatter get no yaml block", () => {
		expect(run("Hi").ast.children.map((n) => n.type)).toEqual(["paragraph"]);
	});

	test("invalid frontmatter is kept as a yaml code block", () => {
		const out = run("---\ntitle: [oops\n---\nHi\n");
		expect(shape(out.ast.children[0])).toEqual({
			type: "code",
			lang: "yaml",
			value: "title: [oops",
		});
	});

	test("invalid frontmatter with inline tags: new yaml first, old kept as code", () => {
		const out = run("---\ntitle: [oops\n---\n#x\n");
		expect(out.ast.children.map((n) => n.type)).toEqual([
			"yaml",
			"code",
			"paragraph",
		]);
	});
});

test("plugin code blocks are kept and reported as unsupported", () => {
	const out = run("x\n\n```dataview\nLIST\n```\n");
	expect(out.ast.children[1]).toMatchObject({
		type: "code",
		lang: "dataview",
		value: "LIST",
	});
	expect(out.warnings).toEqual([
		{
			kind: "unsupported",
			file: "Home.md",
			line: 3,
			message: "dataview block has no AFFiNE equivalent; kept as code",
		},
	]);
});

test("plugin block detection ignores case", () => {
	expect(run("```Dataview\nLIST\n```").warnings.map((w) => w.kind)).toEqual([
		"unsupported",
	]);
});

test("the parsed note is not mutated", () => {
	const note = parseNote("Home.md", "---\ntags: a\n---\n[[Plan]] #t\n");
	const before = structuredClone(note);
	transformNote(note, index);
	expect(note).toEqual(before);
});
