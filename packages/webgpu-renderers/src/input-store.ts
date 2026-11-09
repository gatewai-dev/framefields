import { isLocalFilePath, localFileUrl } from "@framefields/core";
import { ALL_FORMATS, FilePathSource, Input, UrlSource } from "mediabunny";
import { isNodeRuntime, toLocalPath } from "./local-path.js";

/**
 * In the browser (a page or a worker), local paths are read from where the
 * installed `LocalFileSource` serves them (the preview server's `/@fs`
 * unless a bundle installed its own).
 */
export function resolveInputUrl(url: string, isNode: boolean): string {
	if (isNode || typeof location === "undefined" || !isLocalFilePath(url))
		return url;
	return localFileUrl(url);
}

function safeDecode(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

async function assertReadableFile(
	filePath: string,
	url: string,
): Promise<void> {
	const { stat } = await import(
		/* webpackIgnore: true */ /* @vite-ignore */ "node:fs/promises"
	);
	let isFile: boolean;
	try {
		isFile = (await stat(filePath)).isFile();
	} catch (err) {
		throw new Error(
			`Cannot open local media file "${filePath}" (from "${url}"): ${(err as Error).message}`,
			{ cause: err },
		);
	}
	if (!isFile) {
		throw new Error(
			`Cannot open local media file "${filePath}" (from "${url}"): not a regular file`,
		);
	}
}

/**
 * Where to read a local media file that isn't on disk: a URL for it (a
 * project's asset pinned on a bucket), or undefined.
 */
export type MissingMediaResolver = (
	filePath: string,
) => Promise<string | undefined>;

class InputStore {
	private store = new Map<
		string,
		{ promise: Promise<Input>; refCount: number }
	>();
	private resolveMissing?: MissingMediaResolver;

	/**
	 * Reads local files that are missing from disk from the URL `resolver`
	 * gives, with HTTP range requests, so a clip pinned on a bucket plays
	 * without being downloaded. Unset with no argument.
	 */
	setMissingMediaResolver(resolver?: MissingMediaResolver): void {
		this.resolveMissing = resolver;
	}

	async acquire(url: string): Promise<Input> {
		if (!url) throw new Error("Cannot acquire Input for empty URL");
		const isNode = isNodeRuntime();
		const resolvedUrl = resolveInputUrl(url, isNode);

		let shared = this.store.get(resolvedUrl);
		if (!shared) {
			const promise = (async () => {
				const filePath = await toLocalPath(
					resolvedUrl.startsWith("file:")
						? resolvedUrl
						: safeDecode(resolvedUrl),
				);
				let source:
					| InstanceType<typeof FilePathSource>
					| InstanceType<typeof UrlSource>;
				if (filePath !== null) {
					source = await this.localSource(filePath, url);
				} else {
					source = new UrlSource(resolvedUrl);
				}
				return new Input({
					source,
					formats: ALL_FORMATS,
				});
			})();
			promise.catch(() => {
				this.store.delete(resolvedUrl);
			});
			shared = { promise, refCount: 0 };
			this.store.set(resolvedUrl, shared);
		}
		shared.refCount++;
		return shared.promise;
	}

	/**
	 * Drops every cached input, including ones a failed render never released.
	 * Used between jobs, when the same path may now hold a different file.
	 */
	clear(): void {
		const entries = [...this.store.values()];
		this.store.clear();
		for (const shared of entries) {
			shared.promise.then(
				(input) => {
					try {
						input.dispose();
					} catch (_) {}
				},
				() => {},
			);
		}
	}

	private async localSource(
		filePath: string,
		url: string,
	): Promise<
		InstanceType<typeof FilePathSource> | InstanceType<typeof UrlSource>
	> {
		try {
			// FilePathSource opens lazily; check now so a bad path fails
			// with its name instead of deep inside the first decode.
			await assertReadableFile(filePath, url);
			return new FilePathSource(filePath);
		} catch (err) {
			const remote = await this.resolveMissing?.(filePath);
			if (remote) return new UrlSource(remote);
			throw err;
		}
	}

	release(url: string): void {
		if (!url) return;
		let resolvedUrl: string;
		try {
			resolvedUrl = resolveInputUrl(url, isNodeRuntime());
		} catch {
			return; // not a file this realm can read, so never acquired
		}
		const shared = this.store.get(resolvedUrl);
		if (!shared) return;

		shared.refCount--;
		if (shared.refCount <= 0) {
			this.store.delete(resolvedUrl);
			shared.promise.then(
				(input) => {
					try {
						input.dispose();
					} catch (_) {}
				},
				() => {},
			);
		}
	}
}

export const inputStore = new InputStore();
