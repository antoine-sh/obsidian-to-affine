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

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

export interface ConvertOptions extends ScanOptions {
	out: string;
	/** Where to write the JSON conversion report; skipped when absent. */
	report?: string;
}

/** Runs the whole pipeline: scan → parse → resolve → transform → write → report. */
export async function convertVault(
	vaultPath: string,
	options: ConvertOptions,
): Promise<ConversionReport> {
	const scan = await scanVault(vaultPath, options);
	// Before parsing or writing, so a bad --out or --report fails fast and nothing is written.
	await checkOutput(vaultPath, options.out);
	if (options.report !== undefined)
		await checkReport(vaultPath, options.out, options.report);
	const index = buildIndex(scan);
	const parsed = await parseVault(vaultPath, scan);
	const notes = parsed.map((n) => transformNote(n, index));
	await writeMarkdown(vaultPath, options.out, notes, scan.attachments);
	const report = buildReport(notes.length, scan.attachments.length, [
		...parsed.flatMap((n) => n.warnings),
		...notes.flatMap((n) => n.warnings),
	]);
	if (options.report !== undefined) {
		await mkdir(dirname(options.report), { recursive: true });
		await writeFile(options.report, `${JSON.stringify(report, null, "\t")}\n`);
	}
	return report;
}
