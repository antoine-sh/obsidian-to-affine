import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { hashTree, readTree } from "./helpers.ts";

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

test("CLI converts into --out, reporting warnings on stderr", () => {
	const vault = "test/fixtures/write-basic/vault";
	const before = hashTree(vault);
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "out");
	const r = cli(vault, "--out", out);
	expect(hashTree(vault)).toBe(before);
	expect(r.status).toBe(0);
	expect(readTree(out)).toEqual(readTree("test/fixtures/write-basic/expected"));
	expect(r.stderr).toContain("Projects/Plan.md:1 broken-link");
});

test("CLI exits 1 when --out is inside the vault", () => {
	const vault = "test/fixtures/write-basic/vault";
	const r = cli(vault, "--out", `${vault}/out`);
	expect(r.status).toBe(1);
	expect(r.stderr).toContain(`outside the vault: ${vault}/out`);
});

test("CLI rejects --format, which no longer exists", () => {
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "out");
	const r = cli(
		"test/fixtures/write-basic/vault",
		"--out",
		out,
		"--format",
		"markdown",
	);
	expect(r.status).toBe(2);
	expect(existsSync(out)).toBe(false);
});

test.each([["--zip"], ["--verbose"]])(
	"CLI exits 2 when %s is given without --out",
	(...flag) => {
		const r = cli("test/fixtures/write-basic/vault", ...flag);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("requires --out");
	},
);

test("CLI --zip writes the export as a deterministic zip at --out", () => {
	const vault = "test/fixtures/write-basic/vault";
	const before = hashTree(vault);
	const dir = mkdtempSync(join(tmpdir(), "o2a-"));
	const [a, b] = [join(dir, "a.zip"), join(dir, "b.zip")];
	expect(cli(vault, "--out", a, "--zip").status).toBe(0);
	expect(cli(vault, "--out", b, "--zip").status).toBe(0);
	expect(hashTree(vault)).toBe(before);
	const zip = readFileSync(a);
	expect(zip.equals(readFileSync(b))).toBe(true);
	const files = Object.fromEntries(
		Object.entries(unzipSync(zip)).map(([k, v]) => [k, Buffer.from(v)]),
	);
	expect(files).toEqual(readTree("test/fixtures/write-basic/expected"));
});

test("CLI --zip exits 1 rather than overwrite an existing file", () => {
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "a.zip");
	writeFileSync(out, "keep me");
	const r = cli("test/fixtures/write-basic/vault", "--out", out, "--zip");
	expect(r.status).toBe(1);
	expect(r.stderr).toContain(`Output file already exists: ${out}`);
	expect(readFileSync(out, "utf8")).toBe("keep me");
});

test("CLI --zip exits 1 when --out is inside the vault", () => {
	const vault = "test/fixtures/write-basic/vault";
	const r = cli(vault, "--out", `${vault}/x.zip`, "--zip");
	expect(r.status).toBe(1);
	expect(r.stderr).toContain(`outside the vault: ${vault}/x.zip`);
});

test("CLI --verbose reports progress on stderr only", () => {
	const vault = "test/fixtures/write-basic/vault";
	const dir = mkdtempSync(join(tmpdir(), "o2a-"));
	const quiet = cli(vault, "--out", join(dir, "q"));
	const loud = cli(vault, "--out", join(dir, "v"), "--verbose");
	expect(loud.status).toBe(0);
	expect(loud.stdout).toBe("");
	expect(quiet.stderr).not.toContain("Scanned");
	expect(loud.stderr).toMatch(/^Scanned \d+ notes and \d+ attachments/m);
	expect(loud.stderr).toContain(`Wrote ${join(dir, "v")}`);
});

test("CLI --zip creates missing parent directories of --out", () => {
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "new", "a.zip");
	const r = cli("test/fixtures/write-basic/vault", "--out", out, "--zip");
	expect(r.status).toBe(0);
	expect(Object.keys(unzipSync(readFileSync(out)))).not.toHaveLength(0);
});

test("CLI --zip exits 1 when --report is the zip path", () => {
	const out = join(mkdtempSync(join(tmpdir(), "o2a-")), "a.zip");
	const r = cli(
		"test/fixtures/write-basic/vault",
		"--out",
		out,
		"--zip",
		"--report",
		out,
	);
	expect(r.status).toBe(1);
	expect(r.stderr).toContain(`Report path must be outside the output`);
	expect(r.stderr).toContain(out);
});
