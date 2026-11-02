#!/usr/bin/env node
import { parseArgs } from "node:util";
import { convertVault, ScanError, scanVault, WriteError } from "../index.ts";

const USAGE =
	"Usage: obsidian-to-affine <vault-path> [--out <path>] [--exclude <glob>...]";

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
				out: { type: "string" },
			},
		});
	} catch (e) {
		return usageError(e instanceof Error ? e.message : String(e));
	}
})();
const [vaultPath] = positionals;
if (positionals.length !== 1 || vaultPath === undefined)
	usageError("Expected exactly one vault path.");

try {
	if (values.out !== undefined) {
		const { warnings } = await convertVault(vaultPath, {
			out: values.out,
			exclude: values.exclude,
		});
		for (const w of warnings)
			console.error(`${w.file}:${w.line} ${w.kind}: ${w.message}`);
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
