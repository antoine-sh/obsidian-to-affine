#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
	convertVault,
	formatReport,
	ScanError,
	scanVault,
	WriteError,
} from "../index.ts";

const USAGE =
	"Usage: obsidian-to-affine <vault-path> [--out <path>] [--format markdown] [--zip] [--exclude <glob>...] [--report <path>] [--verbose]";

function usageError(message: string): never {
	console.error(`${message}\n${USAGE}`);
	process.exit(2);
}

const { positionals, values } = (() => {
	try {
		return parseArgs({
			allowPositionals: true,
			options: {
				exclude: { type: "string", multiple: true },
				format: { type: "string" },
				out: { type: "string" },
				report: { type: "string" },
				verbose: { type: "boolean" },
				zip: { type: "boolean" },
			},
		});
	} catch (e) {
		return usageError(e instanceof Error ? e.message : String(e));
	}
})();
const [vaultPath] = positionals;
if (positionals.length !== 1 || vaultPath === undefined)
	usageError("Expected exactly one vault path.");
for (const flag of ["report", "format", "zip", "verbose"] as const)
	if (values[flag] !== undefined && values.out === undefined)
		usageError(`--${flag} requires --out.`);
// Only one writer so far; `snapshot` is planned.
if (values.format !== undefined && values.format !== "markdown")
	usageError(`Unsupported --format: ${values.format} (supported: markdown).`);

try {
	if (values.out !== undefined) {
		const report = await convertVault(vaultPath, {
			out: values.out,
			report: values.report,
			exclude: values.exclude,
			zip: values.zip,
			log: values.verbose ? (m) => console.error(m) : undefined,
		});
		console.error(formatReport(report));
	} else {
		// Without --out, list what scan found.
		const result = await scanVault(vaultPath, { exclude: values.exclude });
		for (const [title, list] of [
			["Notes", result.notes],
			["Attachments", result.attachments],
			["Ignored", result.ignored],
		] as const) {
			console.log(`${title} (${list.length}):`);
			for (const path of list) console.log(`  ${path}`);
		}
	}
} catch (e) {
	console.error(
		e instanceof ScanError || e instanceof WriteError
			? e.message
			: `Conversion failed: ${e}`,
	);
	process.exit(1);
}
