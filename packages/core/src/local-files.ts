/**
 * Where a browser engine reads the files a composition names by local path
 * (`/project/assets/clip.mp4`, `file:///…`). Under the preview server they
 * are served by path under `/@fs`; a prebuilt web bundle installs a source
 * that maps them to the files it ships. Every browser read of a local file
 * (fetches by media loaders, the `fs` shim's reads and stats) goes through
 * `localFileUrl`, so one source covers them all. Node reads the disk and
 * never asks.
 */
export interface LocalFileSource {
	/** The folder relative paths resolve against, as Node resolves them against its working directory. */
	cwd: string;
	/** The URL to fetch `path` from, or `undefined` when there is no such file. */
	url(path: string): string | undefined;
	/** The file's size in bytes, or `undefined` when there is no such file. */
	size(path: string): number | undefined;
}

let installed: LocalFileSource | undefined;

/** Installs `source` for every local read in this realm; no argument restores the preview server's `/@fs`. */
export function setLocalFileSource(source?: LocalFileSource): void {
	installed = source;
}

export function getLocalFileSource(): LocalFileSource | undefined {
	return installed;
}

/** A URL scheme of two or more characters (`http:`, `data:`, `blob:`); one letter is a Windows drive. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Whether `src` names a local file (an absolute path or a `file://` URL)
 * rather than a URL to fetch as is. With a source installed, a relative path
 * is a local file too, under its `cwd`, as in Node.
 */
export function isLocalFilePath(src: string): boolean {
	if (src.startsWith("file://")) return true;
	if (src.startsWith("//") || src.startsWith("/api/")) return false;
	if (src.startsWith("/")) return true;
	return !!installed && !!src && !URL_SCHEME.test(src);
}

/** The path a local reference names: `file://` and the preview's `/@fs` prefix removed, percent-escapes decoded. */
export function localPathOf(src: string): string {
	let p = src;
	if (p.startsWith("file://")) {
		try {
			p = decodeURIComponent(new URL(p).pathname);
		} catch {
			p = p.slice("file://".length);
		}
	}
	if (p.startsWith("/@fs/")) p = p.slice("/@fs".length);
	if (installed && !p.startsWith("/")) p = joinPath(installed.cwd, p);
	return p;
}

/**
 * The URL a browser fetches a local file from. Throws when an installed
 * source has no such file, naming it, instead of a bare 404 later.
 */
export function localFileUrl(src: string): string {
	const path = localPathOf(src);
	if (!installed) return `/@fs${path}`;
	const url = installed.url(path);
	if (url === undefined)
		throw Object.assign(
			new Error(
				`[framefields] "${path}" is not in this bundle. Rebuild it with \`framefields bundle\`, adding the file with --include if the composition reads it at run time.`,
			),
			{ code: "ENOENT" },
		);
	return url;
}

/** Size of a local file, or `undefined` when missing; `null` when no source is installed (ask the server). */
export function localFileSize(src: string): number | undefined | null {
	return installed ? installed.size(localPathOf(src)) : null;
}

/** `base` and a relative path joined into one absolute POSIX path, `.` and `..` resolved. */
function joinPath(base: string, rel: string): string {
	const parts: string[] = [];
	for (const part of `${base}/${rel}`.split("/")) {
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	}
	return `/${parts.join("/")}`;
}
