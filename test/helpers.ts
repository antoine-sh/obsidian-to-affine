import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Hash of every path and file byte under `dir`, to prove a vault was not modified. */
export function hashTree(dir: string): string {
	const h = createHash("sha256");
	for (const e of readdirSync(dir, {
		recursive: true,
		withFileTypes: true,
	}).sort((a, b) =>
		join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)),
	)) {
		const p = join(e.parentPath, e.name);
		h.update(p);
		if (e.isFile()) h.update(readFileSync(p));
	}
	return h.digest("hex");
}

/** Every file under `dir`, keyed by POSIX relative path, for golden comparisons. */
export function readTree(dir: string): Record<string, Buffer> {
	const files: Record<string, Buffer> = {};
	for (const e of readdirSync(dir, { recursive: true, withFileTypes: true }))
		if (e.isFile()) {
			const p = join(e.parentPath, e.name);
			files[relative(dir, p).split(sep).join("/")] = readFileSync(p);
		}
	return files;
}
