import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { convertVault, formatReport } from "../src/index.ts";
import { hashTree, readTree } from "./helpers.ts";

const fixture = "test/fixtures/report-basic";
const vault = `${fixture}/vault`;
const tmp = (): string => mkdtempSync(join(tmpdir(), "o2a-"));

test("writes a conversion report matching the golden file, including parse warnings", async () => {
	const before = hashTree(vault);
	const dir = tmp();
	const [out, reportPath] = [join(dir, "out"), join(dir, "report.json")];
	const report = await convertVault(vault, { out, report: reportPath });
	expect(hashTree(vault)).toBe(before);
	expect(readTree(out)).toEqual(readTree(`${fixture}/expected`));
	expect(readFileSync(reportPath, "utf8")).toBe(
		readFileSync(`${fixture}/conversion-report.json`, "utf8"),
	);
	expect(report.warnings.map((w) => w.kind)).toEqual([
		"invalid-frontmatter",
		"broken-link",
		"note-embed",
		"unsupported",
	]);
});

test("summarizes counts, warnings by kind, and each warning location", () => {
	const w = { file: "a.md", line: 3, message: "m" };
	expect(
		formatReport({
			notes: 2,
			attachments: 1,
			warnings: [
				{ ...w, kind: "broken-link" },
				{ ...w, kind: "broken-link" },
				{ ...w, kind: "unsupported" },
			],
		}),
	).toBe(
		[
			"a.md:3 broken-link: m",
			"a.md:3 broken-link: m",
			"a.md:3 unsupported: m",
			"Converted 2 notes and 1 attachment with 3 warnings (broken-link: 2, unsupported: 1).",
		].join("\n"),
	);
	expect(formatReport({ notes: 1, attachments: 0, warnings: [] })).toBe(
		"Converted 1 note and 0 attachments with 0 warnings.",
	);
});

test("refuses a report path inside the vault before writing anything", async () => {
	const before = hashTree(vault);
	const out = join(tmp(), "out");
	const report = `${vault}/report.json`;
	await expect(convertVault(vault, { out, report })).rejects.toMatchObject({
		kind: "report-inside-vault",
		message: expect.stringContaining(report),
	});
	expect(existsSync(out)).toBe(false);
	expect(hashTree(vault)).toBe(before);
});

function cli(...args: string[]) {
	return spawnSync(process.execPath, ["src/cli/index.ts", ...args], {
		encoding: "utf8",
	});
}

test("CLI writes --report and prints the summary on stderr", () => {
	const dir = tmp();
	const reportPath = join(dir, "r.json");
	const r = cli(vault, "--out", join(dir, "out"), "--report", reportPath);
	expect(r.status).toBe(0);
	expect(r.stdout).toBe("");
	expect(r.stderr).toContain("Note.md:1 invalid-frontmatter");
	expect(r.stderr).toContain(
		"Converted 2 notes and 1 attachment with 4 warnings",
	);
	expect(readFileSync(reportPath, "utf8")).toBe(
		readFileSync(`${fixture}/conversion-report.json`, "utf8"),
	);
});

test("CLI exits 2 when --report is given without --out", () => {
	const r = cli(vault, "--report", join(tmp(), "r.json"));
	expect(r.status).toBe(2);
	expect(r.stderr).toMatch(/--report requires --out/);
});

test.each([
	["inside --out", (out: string) => join(out, "Note.md")],
	["equal to --out", (out: string) => out],
])(
	"refuses a report path %s so no exported file is replaced",
	async (_, at) => {
		const out = join(tmp(), "out");
		await expect(
			convertVault(vault, { out, report: at(out) }),
		).rejects.toMatchObject({ kind: "report-inside-out" });
		expect(existsSync(out)).toBe(false);
	},
);

test("refuses a report path that is a directory before writing anything", async () => {
	const dir = tmp();
	const out = join(dir, "out");
	await expect(convertVault(vault, { out, report: dir })).rejects.toMatchObject(
		{ kind: "report-is-directory", message: expect.stringContaining(dir) },
	);
	expect(existsSync(out)).toBe(false);
});

test("creates missing parent directories for the report", async () => {
	const dir = tmp();
	const report = join(dir, "a", "b", "r.json");
	await convertVault(vault, { out: join(dir, "out"), report });
	expect(existsSync(report)).toBe(true);
});

test("prints only the first line of a multi-line warning on the console", () => {
	expect(
		formatReport({
			notes: 1,
			attachments: 0,
			warnings: [
				{
					kind: "invalid-frontmatter",
					file: "a.md",
					line: 1,
					message: "bad\n\n  ^\n",
				},
			],
		}),
	).toBe(
		"a.md:1 invalid-frontmatter: bad\nConverted 1 note and 0 attachments with 1 warning (invalid-frontmatter: 1).",
	);
});
