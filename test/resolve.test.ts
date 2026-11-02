import { describe, expect, test } from "vitest";
import { buildIndex, resolveLink } from "../src/resolve/index.ts";
import { scanVault } from "../src/scan/index.ts";

const index = buildIndex({
	notes: [
		"Home.md",
		"Plan.md",
		"Projects/Plan.md",
		"Projects/Sub/Deep.md",
		"Archive/2024/Plan.md",
		"Café.md",
		"README.MD",
		"v1.2.md",
	],
	attachments: ["assets/diagram.png", "Projects/spec.PDF"],
	ignored: [],
});

const note = (path: string) => ({ kind: "note", path });

describe("resolveLink", () => {
	test.each([
		["Home", "Home.md"],
		["Home.md", "Home.md"],
		["home", "Home.md"],
		["Deep", "Projects/Sub/Deep.md"],
		["Sub/Deep", "Projects/Sub/Deep.md"],
		["Projects/Sub/Deep.md", "Projects/Sub/Deep.md"],
		["readme", "README.MD"],
		["v1.2", "v1.2.md"],
		["/Projects/Plan", "Projects/Plan.md"],
		["Projects/../Plan", "Plan.md"],
		["Projects//Plan", "Projects/Plan.md"],
		// macOS stores names decomposed (NFD); Obsidian matches either form.
		["Café", "Café.md"],
	])("[[%s]] -> %s", (target, path) => {
		expect(resolveLink(index, target, "Home.md")).toEqual(note(path));
	});

	test("attachments resolve by file name, case-insensitively", () => {
		expect(resolveLink(index, "diagram.png", "Home.md")).toEqual({
			kind: "attachment",
			path: "assets/diagram.png",
		});
		expect(resolveLink(index, "spec.pdf", "Home.md")).toEqual({
			kind: "attachment",
			path: "Projects/spec.PDF",
		});
	});

	test("ambiguous names: vault root path, then same folder, then shortest", () => {
		expect(resolveLink(index, "Plan", "Projects/Sub/Deep.md")).toEqual(
			note("Plan.md"),
		);
		const noRoot = buildIndex({
			notes: ["Projects/Plan.md", "Archive/2024/Plan.md", "Archive/2024/X.md"],
			attachments: [],
			ignored: [],
		});
		expect(resolveLink(noRoot, "Plan", "Archive/2024/X.md")).toEqual(
			note("Archive/2024/Plan.md"),
		);
		expect(resolveLink(noRoot, "Plan", "Other.md")).toEqual(
			note("Projects/Plan.md"),
		);
	});

	test("without an extension a note beats a same-named file", () => {
		const idx = buildIndex({
			notes: ["Plan.md", "diagram.png.md"],
			attachments: ["Plan", "diagram.png"],
			ignored: [],
		});
		expect(resolveLink(idx, "Plan", "X.md")).toEqual(note("Plan.md"));
		expect(resolveLink(idx, "diagram.png", "X.md").kind).toBe("attachment");
	});

	test("relative paths resolve against the source folder", () => {
		expect(resolveLink(index, "./Deep", "Projects/Sub/X.md")).toEqual(
			note("Projects/Sub/Deep.md"),
		);
		expect(resolveLink(index, "../Plan", "Projects/Sub/X.md")).toEqual(
			note("Projects/Plan.md"),
		);
	});

	test("an empty target is the source note (`[[#Heading]]`)", () => {
		expect(resolveLink(index, "", "Plan.md")).toEqual(note("Plan.md"));
	});

	test("unknown targets are broken, not guessed", () => {
		for (const target of [
			"Nope",
			"diagram",
			"Sub/Plan",
			"../../../Home",
			"/Plan/Deep",
		]) {
			expect(resolveLink(index, target, "Projects/Sub/Deep.md")).toEqual({
				kind: "broken",
				target,
			});
		}
	});
});

test("index built from a scanned fixture resolves its files", async () => {
	const idx = buildIndex(await scanVault("test/fixtures/scan-basic/vault"));
	expect(resolveLink(idx, "Café notes", "Home.md")).toEqual(
		note("Projects/Sub folder/Café notes.md"),
	);
	expect(resolveLink(idx, "Old", "Home.md").kind).toBe("broken");
});
