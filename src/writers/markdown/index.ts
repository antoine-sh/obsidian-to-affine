import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	readdir,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { TransformedNote } from "../../transform/index.ts";

export class WriteError extends Error {
	readonly kind: "out-inside-vault" | "out-not-empty" | "out-not-directory";
	readonly path: string;
	constructor(kind: WriteError["kind"], path: string) {
		super(
			{
				"out-inside-vault": `Output path must be outside the vault: ${path}`,
				"out-not-empty": `Output directory is not empty: ${path} (choose a new or empty directory)`,
				"out-not-directory": `Output path is not a directory: ${path}`,
			}[kind],
		);
		this.kind = kind;
		this.path = path;
	}
}

const processor = unified()
	.use(remarkGfm)
	.use(remarkFrontmatter)
	.use(remarkStringify);

/** Throws unless `out` is outside the vault and new or empty, so neither the vault nor user files get overwritten. */
export async function checkOutput(
	vaultPath: string,
	out: string,
): Promise<void> {
	// Real paths, so a symlink cannot smuggle the output into the vault.
	const rel = relative(await realpath(vaultPath), await real(resolve(out)));
	if (rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel)))
		throw new WriteError("out-inside-vault", out);
	const entries = await readdir(out).catch((e: unknown) => {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return [];
		if (code === "ENOTDIR") throw new WriteError("out-not-directory", out);
		throw e;
	});
	if (entries.length) throw new WriteError("out-not-empty", out);
}

/** Mirrors the vault layout, so the vault-relative links built by transform stay valid. Call `checkOutput` first. */
export async function writeMarkdown(
	vaultPath: string,
	out: string,
	notes: TransformedNote[],
	attachments: string[],
): Promise<void> {
	await mkdir(out, { recursive: true });
	try {
		await writeAll(vaultPath, out, notes, attachments);
	} catch (e) {
		// checkOutput proved `out` was new or empty, so everything in it is ours; a half export would block reruns.
		await rm(out, { recursive: true, force: true });
		throw e;
	}
}

async function writeAll(
	vaultPath: string,
	out: string,
	notes: TransformedNote[],
	attachments: string[],
): Promise<void> {
	// Sequential to keep file descriptor use flat on large vaults; `wx`/EXCL never overwrite.
	for (const note of notes) {
		const dest = join(out, note.path);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, processor.stringify(note.ast), { flag: "wx" });
	}
	for (const path of attachments) {
		const dest = join(out, path);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(join(vaultPath, path), dest, constants.COPYFILE_EXCL);
	}
}

/** Real path of `p`, resolving symlinks in its nearest existing ancestor when `p` does not exist yet. */
async function real(p: string): Promise<string> {
	try {
		return await realpath(p);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		const parent = dirname(p);
		return parent === p ? p : join(await real(parent), basename(p));
	}
}
