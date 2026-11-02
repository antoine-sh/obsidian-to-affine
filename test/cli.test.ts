import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("CLI prints OK", () => {
	// Node >= 22.18 strips TypeScript types natively, so no build step is needed here.
	const out = execFileSync(process.execPath, ["src/cli/index.ts"], {
		encoding: "utf8",
	});
	expect(out).toBe("OK\n");
});
