export {
	type ParsedNote,
	type ParseWarning,
	parseNote,
	parseVault,
	type Tag,
	type WikiLink,
} from "./parse/index.ts";
export {
	buildReport,
	type ConversionReport,
	formatReport,
	type Warning,
} from "./report/index.ts";
export {
	buildIndex,
	type Resolution,
	resolveLink,
	type VaultIndex,
} from "./resolve/index.ts";
export {
	ScanError,
	type ScanOptions,
	type ScanResult,
	scanVault,
} from "./scan/index.ts";
export {
	type TransformedNote,
	type TransformWarning,
	transformNote,
} from "./transform/index.ts";
export {
	checkOutput,
	checkReport,
	WriteError,
	writeMarkdown,
} from "./writers/markdown/index.ts";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseVault } from "./parse/index.ts";
import { buildReport, type ConversionReport } from "./report/index.ts";
import { buildIndex } from "./resolve/index.ts";
import { type ScanOptions, scanVault } from "./scan/index.ts";
import { transformNote } from "./transform/index.ts";
import {
	checkOutput,
	checkReport,
	writeMarkdown,
} from "./writers/markdown/index.ts";
import { zipDirectory } from "./writers/zip.ts";

export interface ConvertOptions extends ScanOptions {
	out: string;
	/** Where to write the JSON conversion report; skipped when absent. */
	report?: string;
	/** Write `out` as a zip archive instead of a directory. */
	zip?: boolean;
	/** Receives progress messages; the library never prints them itself. */
	log?: (message: string) => void;
}

/** Runs the whole pipeline: scan → parse → resolve → transform → write → report. */
export async function convertVault(
	vaultPath: string,
	options: ConvertOptions,
): Promise<ConversionReport> {
	const log = options.log ?? (() => {});
	const scan = await scanVault(vaultPath, options);
	log(
		`Scanned ${scan.notes.length} notes and ${scan.attachments.length} attachments in ${vaultPath}`,
	);
	// Before parsing or writing, so a bad --out or --report fails fast and nothing is written.
	await checkOutput(vaultPath, options.out, options.zip);
	if (options.report !== undefined)
		await checkReport(vaultPath, options.out, options.report);
	const index = buildIndex(scan);
	const parsed = await parseVault(vaultPath, scan);
	const notes = parsed.map((n) => transformNote(n, index));
	if (options.zip) {
		// Staged in the OS temp dir, never the vault, then archived.
		const stage = await mkdtemp(join(tmpdir(), "obsidian-to-affine-"));
		try {
			const dir = join(stage, "export");
			await writeMarkdown(vaultPath, dir, notes, scan.attachments);
			await zipDirectory(dir, options.out);
		} finally {
			await rm(stage, { recursive: true, force: true });
		}
	} else {
		await writeMarkdown(vaultPath, options.out, notes, scan.attachments);
	}
	log(`Wrote ${options.out}`);
	const report = buildReport(notes.length, scan.attachments.length, [
		...parsed.flatMap((n) => n.warnings),
		...notes.flatMap((n) => n.warnings),
	]);
	if (options.report !== undefined) {
		await mkdir(dirname(options.report), { recursive: true });
		await writeFile(options.report, `${JSON.stringify(report, null, "\t")}\n`);
		log(`Wrote report ${options.report}`);
	}
	return report;
}
