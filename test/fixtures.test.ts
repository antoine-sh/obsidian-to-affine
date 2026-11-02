import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { convertVault } from "../src/index.ts";
import { hashTree, readTree } from "./helpers.ts";

// Each fixture: vault/ -> expected/ golden tree plus expected-warnings.json (kind, file, line).
test.each(["wikilinks", "names", "embeds", "tags", "unsupported-blocks"])(
	"fixture %s matches its golden output",
	async (name) => {
		const fixture = `test/fixtures/${name}`;
		const vault = `${fixture}/vault`;
		const before = hashTree(vault);
		const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "out");
		const { warnings } = await convertVault(vault, { out });
		expect(hashTree(vault)).toBe(before);
		const actual = readTree(out);
		const expected = readTree(`${fixture}/expected`);
		expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
		for (const [path, bytes] of Object.entries(expected))
			expect(actual[path]?.toString("latin1"), path).toBe(
				bytes.toString("latin1"),
			);
		expect(
			warnings.map(({ kind, file, line }) => ({ kind, file, line })),
		).toEqual(
			JSON.parse(readFileSync(`${fixture}/expected-warnings.json`, "utf8")),
		);
	},
);
