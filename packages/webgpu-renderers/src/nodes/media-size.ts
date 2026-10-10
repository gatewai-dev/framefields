import { inputStore } from "../input-store.js";

export interface MediaSize {
	width: number;
	height: number;
}

const sizes = new Map<string, Promise<MediaSize | null>>();

/**
 * Display size of a video source, read from its container (no decode) and
 * memoized per URL. For nodes that need the source's real aspect when the
 * document never stated it (a layer built from a bare path); null when the
 * source has no video track or cannot be opened.
 */
export function probeVideoSize(url: string): Promise<MediaSize | null> {
	let size = sizes.get(url);
	if (!size) {
		size = (async () => {
			try {
				const input = await inputStore.acquire(url);
				try {
					const track = await input.getPrimaryVideoTrack();
					return track
						? { width: track.displayWidth, height: track.displayHeight }
						: null;
				} finally {
					inputStore.release(url);
				}
			} catch {
				return null;
			}
		})();
		sizes.set(url, size);
	}
	return size;
}
