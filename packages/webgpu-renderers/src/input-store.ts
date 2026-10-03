import { ALL_FORMATS, FilePathSource, Input, UrlSource } from "mediabunny";

class InputStore {
	private store = new Map<
		string,
		{ promise: Promise<Input>; refCount: number }
	>();

	async acquire(url: string): Promise<Input> {
		if (!url) throw new Error("Cannot acquire Input for empty URL");
		let resolvedUrl = url;
		const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

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

		let shared = this.store.get(resolvedUrl);
		if (!shared) {
			const promise = (async () => {
				const isLocal = resolvedUrl.startsWith("/") || resolvedUrl.startsWith("file://");
				let source: InstanceType<typeof FilePathSource> | InstanceType<typeof UrlSource>;
				if (isNode && isLocal && typeof FilePathSource !== "undefined") {
					let filePath = resolvedUrl.startsWith("file://")
						? resolvedUrl.slice(7)
						: resolvedUrl;
					try {
						filePath = decodeURIComponent(filePath);
					} catch (_) {}
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

	release(url: string): void {
		if (!url) return;
		let resolvedUrl = url;
		const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

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
