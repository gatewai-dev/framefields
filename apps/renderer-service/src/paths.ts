import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "./errors.js";

/** True when `s` contains ASCII control characters (incl. NUL and DEL). */
export function hasControlChars(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x20 || c === 0x7f) return true;
	}
	return false;
}

/**
 * True for a relative POSIX path that stays inside its root: no leading `/`,
 * no `..` segment, no NUL or control characters, no Windows drive letters.
 */
export function isSafeRelativePath(p: string): boolean {
	if (!p || hasControlChars(p)) return false;
	if (p.startsWith("/") || p.startsWith("\\") || /^[a-z]:/i.test(p)) {
		return false;
	}
	return !p.split(/[/\\]/).some((seg) => seg === "..");
}

/**
 * Resolves `rel` under `root` and follows symlinks, failing with PATH_ESCAPE
 * when the real path lands outside the real root.
 */
export async function resolveInside(
	root: string,
	rel: string,
): Promise<string> {
	if (!isSafeRelativePath(rel) && rel !== ".") {
		throw new RenderError("PATH_ESCAPE", `Path "${rel}" leaves the workspace.`);
	}
	const realRoot = await fs.realpath(root);
	const real = await fs.realpath(path.resolve(realRoot, rel));
	if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
		throw new RenderError(
			"PATH_ESCAPE",
			`Path "${rel}" resolves outside the workspace (symlink?).`,
		);
	}
	return real;
}
