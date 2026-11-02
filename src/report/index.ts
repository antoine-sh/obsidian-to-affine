import type { ParseWarning } from "../parse/index.ts";
import type { TransformWarning } from "../transform/index.ts";

export type Warning = ParseWarning | TransformWarning;

/** Serialized as-is to the report file, so keep it free of timestamps and absolute paths. */
export interface ConversionReport {
	notes: number;
	attachments: number;
	/** Sorted by file, then line. */
	warnings: Warning[];
}

export function buildReport(
	notes: number,
	attachments: number,
	warnings: Warning[],
): ConversionReport {
	// Stable sort: same-line warnings keep pipeline order (parse before transform).
	const sorted = warnings.toSorted(
		(a, b) =>
			(a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line,
	);
	return { notes, attachments, warnings: sorted };
}

/** Human-readable report: one line per warning, then a summary line. */
export function formatReport(report: ConversionReport): string {
	const counts = new Map<string, number>();
	for (const w of report.warnings)
		counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
	const byKind = [...counts]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([kind, n]) => `${kind}: ${n}`)
		.join(", ");
	const plural = (n: number, word: string): string =>
		`${n} ${word}${n === 1 ? "" : "s"}`;
	const summary = `Converted ${plural(report.notes, "note")} and ${plural(report.attachments, "attachment")} with ${plural(report.warnings.length, "warning")}${byKind ? ` (${byKind})` : ""}.`;
	return [
		...report.warnings.map(
			// Messages such as YAML errors span lines; the console gets the first, the JSON keeps all.
			(w) => `${w.file}:${w.line} ${w.kind}: ${w.message.split("\n")[0]}`,
		),
		summary,
	].join("\n");
}
