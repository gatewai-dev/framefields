// `node:path` for the browser preview bundle (POSIX semantics).

export const sep = "/";
export const delimiter = ":";

export function normalize(p: string): string {
	if (!p) return ".";
	const abs = p.startsWith("/");
	const out: string[] = [];
	for (const part of p.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (out.length && out[out.length - 1] !== "..") out.pop();
			else if (!abs) out.push("..");
		} else out.push(part);
	}
	const joined = out.join("/");
	const trailing = p.endsWith("/") && joined ? "/" : "";
	return (abs ? "/" : "") + joined + trailing || (abs ? "/" : ".");
}

export function join(...parts: string[]): string {
	return normalize(parts.filter(Boolean).join("/"));
}

export function resolve(...parts: string[]): string {
	let out = "";
	for (let i = parts.length - 1; i >= 0 && !out.startsWith("/"); i--) {
		if (parts[i]) out = out ? `${parts[i]}/${out}` : parts[i];
	}
	return normalize(out.startsWith("/") ? out : `/${out}`).replace(
		/(.)\/$/,
		"$1",
	);
}

export const isAbsolute = (p: string): boolean => p.startsWith("/");

export function dirname(p: string): string {
	const trimmed = p.replace(/\/+$/, "");
	const i = trimmed.lastIndexOf("/");
	if (i < 0) return ".";
	return i === 0 ? "/" : trimmed.slice(0, i);
}

export function basename(p: string, ext?: string): string {
	const base = p.replace(/\/+$/, "").split("/").pop() ?? "";
	return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(p: string): string {
	const base = basename(p);
	const i = base.lastIndexOf(".");
	return i > 0 ? base.slice(i) : "";
}

export function relative(from: string, to: string): string {
	const a = resolve(from).split("/").filter(Boolean);
	const b = resolve(to).split("/").filter(Boolean);
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function parse(p: string) {
	const base = basename(p);
	const ext = extname(p);
	return {
		root: p.startsWith("/") ? "/" : "",
		dir: dirname(p),
		base,
		ext,
		name: ext ? base.slice(0, -ext.length) : base,
	};
}

export function format(o: {
	dir?: string;
	base?: string;
	name?: string;
	ext?: string;
}): string {
	const base = o.base ?? `${o.name ?? ""}${o.ext ?? ""}`;
	return o.dir ? `${o.dir}/${base}` : base;
}

export const toNamespacedPath = (p: string): string => p;

const path = {
	sep,
	delimiter,
	normalize,
	join,
	resolve,
	isAbsolute,
	dirname,
	basename,
	extname,
	relative,
	parse,
	format,
	toNamespacedPath,
	posix: undefined as unknown,
};
path.posix = path;
export const posix = path;
export default path;
