import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { zipSync } from "fflate";

// Fixed entry dates (local time, as zip stores them) so the same export gives byte-identical archives.
const MTIME = new Date(1980, 0, 1);

/** Zips every file under `dir` into `dest`, which must not exist yet. */
export async function zipDirectory(dir: string, dest: string): Promise<void> {
	const files: Record<string, Uint8Array> = {};
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	for (const e of entries.filter((e) => e.isFile())) {
		const p = join(e.parentPath, e.name);
		files[relative(dir, p).split(sep).join("/")] = await readFile(p);
	}
	const sorted = Object.fromEntries(
		Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)),
	);
	// shortcut: builds the whole archive in memory; stream it if vaults grow to many GB.
	await mkdir(dirname(dest), { recursive: true });
	await writeFile(dest, zipSync(sorted, { mtime: MTIME }), { flag: "wx" });
}
