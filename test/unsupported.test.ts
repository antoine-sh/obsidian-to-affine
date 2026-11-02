import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { convertVault } from "../src/index.ts";
import { hashTree, readTree } from "./helpers.ts";

const fixture = "test/fixtures/unsupported-files";
const vault = `${fixture}/vault`;

test("keeps .canvas and .excalidraw.md files as code blocks and reports them", async () => {
	const before = hashTree(vault);
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "out");
	const { warnings } = await convertVault(vault, { out });
	expect(hashTree(vault)).toBe(before);
	const actual = readTree(out);
	const expected = readTree(`${fixture}/expected`);
	expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
	for (const [path, bytes] of Object.entries(expected))
		expect(actual[path]?.toString(), path).toBe(bytes.toString());
	expect(warnings).toEqual([
		expect.objectContaining({
			kind: "unsupported",
			file: "Boards/Board.canvas",
			line: 1,
		}),
		expect.objectContaining({
			kind: "unsupported",
			file: "Sketch.excalidraw.md",
			line: 1,
		}),
	]);
});
