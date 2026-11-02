import { join } from "node:path";
import { expect, test } from "vitest";
import { scanVault } from "../src/scan/index.ts";
import { hashTree } from "./helpers.ts";

const vault = "test/fixtures/scan-basic/vault";

test("scan lists notes, attachments and ignored paths, sorted, POSIX", async () => {
	const before = hashTree(vault);
	const result = await scanVault(vault);
	expect(result).toEqual({
		notes: [
			"Home.md",
			"Projects/Plan.md",
			"Projects/Sub folder/Café notes.md",
			"README.MD",
		],
		attachments: ["Projects/spec.PDF", "assets/diagram.png"],
		ignored: [".obsidian", ".trash"],
	});
	expect(hashTree(vault)).toBe(before);
});

test("scan applies user exclude globs", async () => {
	const result = await scanVault(vault, { exclude: ["Projects/**"] });
	expect(result.notes).toEqual(["Home.md", "README.MD"]);
	expect(result.attachments).toEqual(["assets/diagram.png"]);
	expect(result.ignored).toEqual([".obsidian", ".trash", "Projects"]);
});

test("scan rejects a path that is not a directory", async () => {
	await expect(scanVault(join(vault, "Home.md"))).rejects.toMatchObject({
		kind: "not-a-directory",
	});
});

test("scan reports a missing vault path as not found", async () => {
	await expect(scanVault(join(vault, "nope"))).rejects.toMatchObject({
		kind: "not-found",
		message: expect.stringContaining("does not exist"),
	});
});
