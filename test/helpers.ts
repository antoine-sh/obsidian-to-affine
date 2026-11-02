import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
