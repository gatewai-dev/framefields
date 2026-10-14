import { ALL_FORMATS, FilePathSource, Input, UrlSource } from "mediabunny";
import { isNodeRuntime, toLocalPath } from "./local-path.js";

/** In the browser, local paths are served through the dev server's `/@fs`. */
function resolveInputUrl(url: string, isNode: boolean): string {
	let resolvedUrl = url;
	if (!isNode && typeof window !== "undefined") {
		if (resolvedUrl.startsWith("file://")) {
			resolvedUrl = resolvedUrl.slice(7);
		}
		if (
			resolvedUrl.startsWith("/") &&
			!resolvedUrl.startsWith("/@fs/") &&
			!resolvedUrl.startsWith("/api/")
		) {
			resolvedUrl = "/@fs" + resolvedUrl;
		}
	}
	return resolvedUrl;
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

class InputStore {
	private store = new Map<
		string,
		{ promise: Promise<Input>; refCount: number }
	>();

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
					// FilePathSource opens lazily; check now so a bad path fails
					// with its name instead of deep inside the first decode.
					await assertReadableFile(filePath, url);
					source = new FilePathSource(filePath);
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

	release(url: string): void {
		if (!url) return;
		const resolvedUrl = resolveInputUrl(url, isNodeRuntime());
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
