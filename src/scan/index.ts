import { readdir, stat } from "node:fs/promises";
import { join, matchesGlob } from "node:path";

export interface ScanResult {
	/** Vault-relative POSIX paths, sorted. */
	notes: string[];
	attachments: string[];
	/** Top-most ignored paths; their contents are not walked. */
	ignored: string[];
}

export interface ScanOptions {
	/** Globs matched against vault-relative POSIX paths. */
	exclude?: string[];
}

export class ScanError extends Error {
	readonly kind: "not-found" | "not-a-directory";
	readonly path: string;
	constructor(kind: ScanError["kind"], path: string) {
		super(
			kind === "not-found"
				? `Vault path does not exist: ${path}`
				: `Vault path is not a directory: ${path}`,
		);
		this.kind = kind;
		this.path = path;
	}
}

export async function scanVault(
	vaultPath: string,
	options: ScanOptions = {},
): Promise<ScanResult> {
	// Other stat errors (e.g. EACCES) propagate; Node's message already names the path.
	const info = await stat(vaultPath).catch((e: unknown) => {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw e;
	});
	if (!info) throw new ScanError("not-found", vaultPath);
	if (!info.isDirectory()) throw new ScanError("not-a-directory", vaultPath);

	const exclude = options.exclude ?? [];
	const result: ScanResult = { notes: [], attachments: [], ignored: [] };

	async function walk(rel: string): Promise<void> {
		for (const entry of await readdir(join(vaultPath, rel), {
			withFileTypes: true,
		})) {
			const path = rel ? `${rel}/${entry.name}` : entry.name;
			// The trailing slash lets `dir/**` exclude the folder itself, so it is reported once.
			const globPath = entry.isDirectory() ? `${path}/` : path;
			// Obsidian hides dot-prefixed entries, which covers .obsidian/, .trash/ and .git/.
			if (
				entry.name.startsWith(".") ||
				exclude.some((g) => matchesGlob(globPath, g))
			) {
				result.ignored.push(path);
			} else if (entry.isDirectory()) {
				await walk(path);
			} else if (entry.isFile()) {
				// shortcut: `.MD` counts as a note so its content gets converted; unverified whether Obsidian
				// itself treats it as one. Revisit if a real vault shows `[[README]]` should not resolve to it.
				// Canvases are notes so parse keeps their JSON as text instead of copying an unimportable file.
				(/\.(md|canvas)$/i.test(entry.name)
					? result.notes
					: result.attachments
				).push(path);
			} else {
				// shortcut: symlinks and special files are ignored, follow symlinks if users ask for it.
				result.ignored.push(path);
			}
		}
	}

	await walk("");
	// Default sort compares UTF-16 code units, so order does not depend on locale.
	for (const list of Object.values(result)) list.sort();
	return result;
}
