import { posix } from "node:path";
import type { ScanResult } from "../scan/index.ts";

interface Entry {
	kind: "note" | "attachment";
	path: string;
	/** Normalized vault-relative path used for matching. */
	key: string;
}

export interface VaultIndex {
	/** Entries grouped by normalized file name. */
	byName: Map<string, Entry[]>;
}

export type Resolution =
	| {
			kind: "note" | "attachment";
			/** Vault-relative POSIX path, as listed by scan. */
			path: string;
	  }
	| { kind: "broken"; target: string };

// Obsidian matches names case-insensitively, and macOS may store them decomposed (NFD).
const norm = (s: string): string => s.normalize("NFC").toLowerCase();

export function buildIndex(scan: ScanResult): VaultIndex {
	const byName = new Map<string, Entry[]>();
	const add = (kind: Entry["kind"], path: string): void => {
		const key = norm(path);
		const name = posix.basename(key);
		const list = byName.get(name) ?? [];
		list.push({ kind, path, key });
		byName.set(name, list);
	};
	for (const p of scan.notes) add("note", p);
	for (const p of scan.attachments) add("attachment", p);
	return { byName };
}

/**
 * Resolve a parsed `WikiLink.target` (no `#heading`, `#^block` or `|alias`) the way Obsidian does:
 * `Note`, `Note.md`, `Folder/Note`, `./rel`, `../rel`, `file.png`. Empty means the source note itself.
 */
export function resolveLink(
	index: VaultIndex,
	target: string,
	sourcePath: string,
): Resolution {
	const linkpath = target.trim();
	if (!linkpath) return { kind: "note", path: sourcePath };

	const sourceDir = posix.dirname(norm(sourcePath));
	const raw = norm(linkpath);
	// `./x` and `../x` are relative to the source note; a leading `/` is the vault root.
	const exact = /^(\.\.?)?\//.test(raw);
	const wanted = posix.normalize(
		/^\.\.?\//.test(raw) ? posix.join(sourceDir, raw) : raw.replace(/^\/+/, ""),
	);
	if (wanted === "." || wanted.startsWith("../"))
		return { kind: "broken", target };

	// A target without `.md` may still name a note, and `v1.2` is a note, not a `.2` file.
	const matches = [wanted, `${wanted}.md`].flatMap((w) =>
		(index.byName.get(posix.basename(w)) ?? []).filter((e) =>
			exact ? e.key === w : e.key === w || e.key.endsWith(`/${w}`),
		),
	);
	if (!matches.length) return { kind: "broken", target };

	// Obsidian appends `.md` to extensionless targets, so `[[Plan]]` is Plan.md, not a file named Plan.
	const wantsNote = !posix.extname(wanted);
	// Then exact vault path, the source's own folder, the shallowest path.
	const rank = (e: Entry): [number, number, number, number, string] => [
		e.key.endsWith(".md") === wantsNote ? 0 : 1,
		e.key === wanted || e.key === `${wanted}.md` ? 0 : 1,
		posix.dirname(e.key) === sourceDir ? 0 : 1,
		e.key.split("/").length,
		e.path,
	];
	const best = matches.reduce((a, b) => {
		const [ra, rb] = [rank(a), rank(b)];
		const i = ra.findIndex((v, j) => v !== rb[j]);
		return i >= 0 && rb[i] < ra[i] ? b : a;
	});
	return { kind: best.kind, path: best.path };
}
