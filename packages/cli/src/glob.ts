/** Minimal globs for `assets.exclude`: `**`, `*`, `?` and `{a,b}`, matched against posix paths. */
const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
	const cached = cache.get(glob);
	if (cached) return cached;
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i] as string;
		if (c === "*") {
			if (glob[i + 1] === "*") {
				// `**/` matches zero or more directories; a trailing `**` anything.
				if (glob[i + 2] === "/") {
					re += "(?:.*/)?";
					i += 2;
				} else {
					re += ".*";
					i += 1;
				}
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if (c === "{") {
			const end = glob.indexOf("}", i);
			if (end === -1) re += "\\{";
			else {
				re += `(?:${glob
					.slice(i + 1, end)
					.split(",")
					.map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
					.join("|")})`;
				i = end;
			}
		} else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	const compiled = new RegExp(`^${re}$`);
	cache.set(glob, compiled);
	return compiled;
}

export const matchesAny = (globs: string[], file: string) =>
	globs.some((g) => globToRegExp(g).test(file));
