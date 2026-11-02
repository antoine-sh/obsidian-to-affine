export {
	type ParsedNote,
	type ParseWarning,
	parseNote,
	parseVault,
	type Tag,
	type WikiLink,
} from "./parse/index.ts";
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
	WriteError,
	writeMarkdown,
} from "./writers/markdown/index.ts";

import { parseVault } from "./parse/index.ts";
import { buildIndex } from "./resolve/index.ts";
import { type ScanOptions, scanVault } from "./scan/index.ts";
import { type TransformWarning, transformNote } from "./transform/index.ts";
import { checkOutput, writeMarkdown } from "./writers/markdown/index.ts";

export interface ConvertOptions extends ScanOptions {
	out: string;
}

/** Runs the whole pipeline: scan → parse → resolve → transform → write. */
export async function convertVault(
	vaultPath: string,
	options: ConvertOptions,
): Promise<{ warnings: TransformWarning[] }> {
	const scan = await scanVault(vaultPath, options);
	// Before parsing or writing, so a bad --out fails fast and nothing is written.
	await checkOutput(vaultPath, options.out);
	const index = buildIndex(scan);
	const notes = (await parseVault(vaultPath, scan)).map((n) =>
		transformNote(n, index),
	);
	await writeMarkdown(vaultPath, options.out, notes, scan.attachments);
	return { warnings: notes.flatMap((n) => n.warnings) };
}
