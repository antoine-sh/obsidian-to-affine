import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { hashTree } from "./helpers.ts";

// Node >= 22.18 strips TypeScript types natively, so no build step is needed here.
function cli(...args: string[]) {
	return spawnSync(process.execPath, ["src/cli/index.ts", ...args], {
		encoding: "utf8",
	});
}

test("CLI lists scan findings without touching the vault", () => {
	const vault = "test/fixtures/scan-basic/vault";
	const before = hashTree(vault);
	const r = cli(vault, "--exclude", "assets/**");
	expect(hashTree(vault)).toBe(before);
	expect(r.status).toBe(0);
	expect(r.stdout).toBe(
		[
			"Notes (4):",
			"  Home.md",
			"  Projects/Plan.md",
			"  Projects/Sub folder/Café notes.md",
			"  README.MD",
			"Attachments (1):",
			"  Projects/spec.PDF",
			"Ignored (3):",
			"  .obsidian",
			"  .trash",
			"  assets",
			"",
		].join("\n"),
	);
});

test("CLI exits 2 without a vault path", () => {
	const r = cli();
	expect(r.status).toBe(2);
	expect(r.stderr).toMatch(/Usage/);
});

test("CLI exits 1 when the vault is not a directory", () => {
	const r = cli("test/fixtures/scan-basic/vault/Home.md");
	expect(r.status).toBe(1);
	expect(r.stderr).toContain("test/fixtures/scan-basic/vault/Home.md");
});

test("CLI exits 1 with a clear message when the vault does not exist", () => {
	const r = cli("test/fixtures/scan-basic/nope");
	expect(r.status).toBe(1);
	expect(r.stderr).toContain("does not exist: test/fixtures/scan-basic/nope");
});

test("CLI rejects --out until the write stage exists", () => {
	const r = cli("test/fixtures/scan-basic/vault", "--out", "/tmp/x");
	expect(r.status).toBe(2);
	expect(r.stderr).toMatch(/--out/);
});
