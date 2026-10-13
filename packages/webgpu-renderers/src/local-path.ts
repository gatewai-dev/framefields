export const isNodeRuntime = () =>
	typeof process !== "undefined" && Boolean(process.versions?.node);

/**
 * A URL scheme of two or more characters (`http:`, `data:`, `blob:`, ...).
 * A single letter followed by a colon is a Windows drive (`D:\media`), not a scheme.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * The filesystem path a media source names under Node, or `null` when it
 * should be fetched. `file://` URLs go through `fileURLToPath` (so
 * `file:///D:/clip.mp4` becomes `D:\clip.mp4` on Windows), and absolute,
 * Windows and relative paths are resolved against the working directory.
 */
export async function toLocalPath(src: string): Promise<string | null> {
	if (!isNodeRuntime()) return null;
	if (src.startsWith("file:")) {
		const { fileURLToPath } = await import(
			/* webpackIgnore: true */ /* @vite-ignore */ "node:url"
		);
		return fileURLToPath(src);
	}
	if (URL_SCHEME.test(src)) return null;
	const { resolve } = await import(
		/* webpackIgnore: true */ /* @vite-ignore */ "node:path"
	);
	return resolve(src);
}
