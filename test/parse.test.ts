import { expect, test } from "vitest";
import { parseNote, parseVault } from "../src/parse/index.ts";
import { scanVault } from "../src/scan/index.ts";
import { hashTree } from "./helpers.ts";

/** Strips positions so assertions focus on structure. */
function shape(node: unknown): unknown {
	return JSON.parse(
		JSON.stringify(node, (k, v) => (k === "position" ? undefined : v)),
	);
}

function paragraph(source: string): unknown[] {
	const { ast } = parseNote("n.md", source);
	const p = ast.children[0];
	if (p?.type !== "paragraph") throw new Error(`not a paragraph: ${source}`);
	return shape(p.children) as unknown[];
}

test("frontmatter is parsed into an object and kept as a yaml node", () => {
	const note = parseNote("n.md", "---\ntitle: Hi\ntags: [a, b]\n---\n# Body\n");
	expect(note.frontmatter).toEqual({ title: "Hi", tags: ["a", "b"] });
	expect(note.ast.children.map((n) => n.type)).toEqual(["yaml", "heading"]);
	expect(note.warnings).toEqual([]);
});

test("frontmatter dates stay strings so output does not depend on time zone", () => {
	expect(parseNote("n.md", "---\ndate: 2024-01-02\n---\n").frontmatter).toEqual(
		{ date: "2024-01-02" },
	);
});

test("note without frontmatter has empty frontmatter", () => {
	expect(parseNote("n.md", "text").frontmatter).toEqual({});
});

test("invalid frontmatter is warned about and kept in the AST", () => {
	const note = parseNote("a/n.md", "---\ntitle: [oops\n---\ntext\n");
	expect(note.frontmatter).toEqual({});
	expect(note.ast.children[0]?.type).toBe("yaml");
	expect(note.warnings).toEqual([
		expect.objectContaining({
			kind: "invalid-frontmatter",
			file: "a/n.md",
			line: 1,
		}),
	]);
});

test("non-mapping frontmatter is warned about", () => {
	const note = parseNote("n.md", "---\n- a\n---\n");
	expect(note.frontmatter).toEqual({});
	expect(note.warnings.map((w) => w.kind)).toEqual(["invalid-frontmatter"]);
});

test("wikilinks become wikiLink nodes with target, heading, block and alias", () => {
	expect(
		paragraph(
			"See [[Note]], [[Dir/Note|Alias]], [[Note#Head]], [[Note#^blk]] and [[#Local]].",
		),
	).toEqual([
		{ type: "text", value: "See " },
		{ type: "wikiLink", embed: false, target: "Note", value: "[[Note]]" },
		{ type: "text", value: ", " },
		{
			type: "wikiLink",
			embed: false,
			target: "Dir/Note",
			alias: "Alias",
			value: "[[Dir/Note|Alias]]",
		},
		{ type: "text", value: ", " },
		{
			type: "wikiLink",
			embed: false,
			target: "Note",
			heading: "Head",
			value: "[[Note#Head]]",
		},
		{ type: "text", value: ", " },
		{
			type: "wikiLink",
			embed: false,
			target: "Note",
			block: "blk",
			value: "[[Note#^blk]]",
		},
		{ type: "text", value: " and " },
		{
			type: "wikiLink",
			embed: false,
			target: "",
			heading: "Local",
			value: "[[#Local]]",
		},
		{ type: "text", value: "." },
	]);
});

test("embeds are wikiLink nodes with embed set", () => {
	expect(paragraph("![[image.png|200]]")).toEqual([
		{
			type: "wikiLink",
			embed: true,
			target: "image.png",
			alias: "200",
			value: "![[image.png|200]]",
		},
	]);
});

test("escaped pipe inside a table cell still yields the alias", () => {
	const { ast } = parseNote("n.md", "| a |\n| - |\n| [[Note\\|Alias]] |\n");
	expect(shape(ast)).toMatchObject({
		children: [
			{
				type: "table",
				children: [
					{},
					{
						children: [
							{
								children: [
									{ type: "wikiLink", target: "Note", alias: "Alias" },
								],
							},
						],
					},
				],
			},
		],
	});
});

test("wikilinks and tags inside code are left alone", () => {
	const { ast } = parseNote("n.md", "`[[A]] #b`\n\n```\n[[A]] #b\n```\n");
	expect(JSON.stringify(ast)).not.toMatch(/wikiLink|"tag"/);
});

test("URL fragments are not tags", () => {
	expect(
		JSON.stringify(parseNote("n.md", "see http://e.com/#frag").ast),
	).not.toContain('"tag"');
});

test("tags become tag nodes; numbers and mid-word # are not tags", () => {
	expect(
		paragraph("#todo and #a/b-c_d, not #123 or x#y or a/#frag #1a"),
	).toEqual([
		{ type: "tag", value: "todo" },
		{ type: "text", value: " and " },
		{ type: "tag", value: "a/b-c_d" },
		{ type: "text", value: ", not #123 or x#y or a/#frag " },
		{ type: "tag", value: "1a" },
	]);
});

test("escaped # and brackets are not tags or links", () => {
	expect(
		paragraph("\\#no \\[\\[x]] [\\[y]] \\\\#t a\\\\[[w]] \\![[z]]"),
	).toEqual([
		{ type: "text", value: "#no [[x]] [[y]] \\#t a\\" },
		{ type: "wikiLink", embed: false, target: "w", value: "[[w]]" },
		{ type: "text", value: " !" },
		{ type: "wikiLink", embed: false, target: "z", value: "[[z]]" },
	]);
});

test("# right after inline markup is not a tag, but a tag may open emphasis", () => {
	expect(paragraph("**b**#t `c`#u *#v* x  \n#w")).toEqual([
		{ type: "strong", children: [{ type: "text", value: "b" }] },
		{ type: "text", value: "#t " },
		{ type: "inlineCode", value: "c" },
		{ type: "text", value: "#u " },
		{ type: "emphasis", children: [{ type: "tag", value: "v" }] },
		{ type: "text", value: " x" },
		{ type: "break" },
		{ type: "tag", value: "w" },
	]);
});

test("unicode tags are recognised", () => {
	expect(paragraph("#café")).toEqual([{ type: "tag", value: "café" }]);
});

test("new nodes carry source positions for the report", () => {
	const { ast } = parseNote("n.md", "x\n\nab [[N]]\nc #t");
	const p = ast.children[1];
	if (p?.type !== "paragraph") throw new Error("expected paragraph");
	const [, link, , tag] = p.children;
	expect(link?.position?.start).toEqual({ line: 3, column: 4, offset: 6 });
	expect(link?.position?.end).toEqual({ line: 3, column: 9, offset: 11 });
	expect(tag?.position?.start).toEqual({ line: 4, column: 3, offset: 14 });
});

test("parseVault parses every scanned note without touching the vault", async () => {
	const vault = "test/fixtures/scan-basic/vault";
	const before = hashTree(vault);
	const notes = await parseVault(vault, await scanVault(vault));
	expect(notes.map((n) => n.path)).toEqual([
		"Home.md",
		"Projects/Plan.md",
		"Projects/Sub folder/Café notes.md",
		"README.MD",
	]);
	expect(shape(notes[0]?.ast.children[1])).toMatchObject({
		type: "paragraph",
		children: [{ type: "wikiLink", target: "Plan" }],
	});
	expect(hashTree(vault)).toBe(before);
});
