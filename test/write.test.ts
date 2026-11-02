import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import {
	convertVault,
	transformNote,
	WriteError,
	writeMarkdown,
} from "../src/index.ts";
import { hashTree, readTree } from "./helpers.ts";

const fixture = "test/fixtures/write-basic";
const vault = `${fixture}/vault`;
const tmp = (): string => mkdtempSync(join(tmpdir(), "o2a-"));

test("writes normalized Markdown and attachments matching the golden output", async () => {
	const before = hashTree(vault);
	const out = join(tmp(), "out");
	const { warnings } = await convertVault(vault, { out });
	expect(hashTree(vault)).toBe(before);
	const actual = readTree(out);
	const expected = readTree(`${fixture}/expected`);
	expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
	for (const [path, bytes] of Object.entries(expected))
		expect(actual[path]?.toString("latin1"), path).toBe(
			bytes.toString("latin1"),
		);
	expect(warnings).toEqual([
		expect.objectContaining({
			kind: "broken-link",
			file: "Projects/Plan.md",
			line: 1,
		}),
	]);
});

test("output is deterministic", async () => {
	const [a, b] = [join(tmp(), "a"), join(tmp(), "b")];
	await convertVault(vault, { out: a });
	await convertVault(vault, { out: b });
	expect(readTree(a)).toEqual(readTree(b));
});

test.each([
	["equal to the vault", vault],
	["inside the vault", `${vault}/Projects/out`],
])("refuses an output path %s", async (_, out) => {
	const before = hashTree(vault);
	await expect(convertVault(vault, { out })).rejects.toMatchObject({
		kind: "out-inside-vault",
		message: expect.stringContaining(out),
	});
	expect(hashTree(vault)).toBe(before);
});

test("refuses a non-empty output directory so nothing is overwritten", async () => {
	const out = tmp();
	writeFileSync(join(out, "Home.md"), "mine");
	await expect(convertVault(vault, { out })).rejects.toBeInstanceOf(WriteError);
	expect(readTree(out)).toEqual({ "Home.md": Buffer.from("mine") });
});

test("accepts an existing empty output directory", async () => {
	const out = join(tmp(), "empty");
	mkdirSync(out);
	await convertVault(vault, { out });
	expect(Object.keys(readTree(out))).toContain("Home.md");
});

test("refuses an output reached through a symlink into the vault", async () => {
	const link = join(tmp(), "link");
	symlinkSync(resolve(`${vault}/Projects`), link);
	await expect(
		convertVault(vault, { out: join(link, "out") }),
	).rejects.toMatchObject({ kind: "out-inside-vault" });
	expect(existsSync(`${vault}/Projects/out`)).toBe(false);
});

test("refuses an output path that is a file", async () => {
	const out = join(tmp(), "file");
	writeFileSync(out, "x");
	await expect(convertVault(vault, { out })).rejects.toMatchObject({
		kind: "out-not-directory",
		message: expect.stringContaining(out),
	});
});

test("removes partial output when writing fails, so a rerun is possible", async () => {
	const out = join(tmp(), "out");
	const note = transformNote(
		{
			path: "Home.md",
			frontmatter: {},
			ast: { type: "root", children: [] },
			warnings: [],
		},
		{ byName: new Map() },
	);
	await expect(
		writeMarkdown(vault, out, [note], ["missing.png"]),
	).rejects.toThrow(/missing\.png/);
	expect(existsSync(out)).toBe(false);
});
