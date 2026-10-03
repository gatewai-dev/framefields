import type { RenderContextValue } from "../render-context.js";
import { textureCache } from "../texture-cache.js";
import { mediaDecoderCache } from "./media-decoder.js";
import type { VideoNodeProps } from "./types.js";

/**
 * Tracks the most recently successfully uploaded texture key per node.
 * This is the key to YouTube-like behaviour: while the next frame is being
 * decoded we keep showing the last good frame instead of going blank.
 */
const lastGoodFrameKey = new Map<string, string>();

/**
 * Tracks the active source URL per node so we can invalidate and clear
 * lastGoodFrameKey when the input video changes.
 */
const lastSourceUrl = new Map<string, string>();

/**
 * Tracks in-flight decode promises per node so we never kick off a second
 * decode for the same timestamp while one is already running.
 */
const pendingDecodes = new Map<string, Promise<void>>();

/**
 * Uploads a decoded frame into the GPU texture cache.
 * Returns the newly created GPUTexture, or null on failure.
 */
function uploadFrameToTexture(
	ctx: RenderContextValue,
	frameKey: string,
	frame: {
		width: number;
		height: number;
		canvas?: HTMLCanvasElement | OffscreenCanvas;
		buffer?: Uint8Array;
	},
	isHeadless: boolean,
): GPUTexture | null {
	if (isHeadless) {
		if (!frame.buffer) return null;
		const tex = textureCache.create(
			frameKey,
			ctx.device,
			frame.width,
			frame.height,
		);
		ctx.device.queue.writeTexture(
			{ texture: tex },
			frame.buffer as any,
			{ bytesPerRow: frame.width * 4 },
			[frame.width, frame.height],
		);
		return tex;
	} else {
		if (!frame.canvas) return null;
		const tex = textureCache.create(
			frameKey,
			ctx.device,
			frame.width,
			frame.height,
		);
		ctx.device.queue.copyExternalImageToTexture(
			{ source: frame.canvas, flipY: false },
			{ texture: tex, premultipliedAlpha: true },
			[frame.width, frame.height],
		);
		return tex;
	}
}

/**
 * Updates lastGoodFrameKey for a given node and immediately evicts the previous
 * frame texture from textureCache to prevent VRAM accumulation during export.
 */
function updateLastGoodFrame(
	nodeId: string,
	newKey: string,
	device?: GPUDevice,
): void {
	const prevKey = lastGoodFrameKey.get(nodeId);
	if (prevKey && prevKey !== newKey) {
		textureCache.evict(prevKey, device);
		textureCache.activeKeys.delete(prevKey);
	}
	lastGoodFrameKey.set(nodeId, newKey);
	textureCache.activeKeys.add(newKey);
}

export const drawVideoNode = async (
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: VideoNodeProps,
): Promise<void> => {
	try {
		const nodeId = props.nodeId ?? "default";
		const currentSourceUrl = props.sourceUrl;

		if (lastSourceUrl.get(nodeId) !== currentSourceUrl) {
			lastSourceUrl.set(nodeId, currentSourceUrl);
			const prevKey = lastGoodFrameKey.get(nodeId);
			if (prevKey) {
				textureCache.evict(prevKey, ctx.device);
				lastGoodFrameKey.delete(nodeId);
			}
		}

		const isHeadless =
			props.isHeadless ??
			(typeof window === "undefined" ||
				(globalThis as any).__IS_HEADLESS_RENDERER__);

		const decoder = mediaDecoderCache.getVideo(
			props.sourceUrl,
			isHeadless,
			nodeId,
		);

		// ── Step 1: ensure we have the frame for this exact timestamp ──────────
		//
		// The VideoDecoder already maintains currentFrame / nextFrame internally
		// (mirroring the mediabunny pattern). Awaiting getFrame() here is cheap
		// when the frame is already buffered — it resolves from the internal
		// iterator cache without re-decoding.  On a cold start it will take a
		// moment but it will always return the actual frame rather than nothing.

		const exactKey = props.frameKey;
		let exactTex = textureCache.acquire(exactKey);

		if (!exactTex) {
			// Only start a decode if one isn't already running for this key
			if (!pendingDecodes.has(exactKey)) {
				const delayHandle = `${nodeId}-${Math.random()}`;
				const delays =
					(globalThis as any).__GATEWAI_DELAYS__ || new Set<number | string>();
				(globalThis as any).__GATEWAI_DELAYS__ = delays;
				delays.add(delayHandle);

				const safeTimestampSec = Math.max(
					0,
					Number.isFinite(props.timestampSec) ? props.timestampSec : 0,
				);
				const decodePromise = decoder
					.getFrame(safeTimestampSec)
					.then((frame) => {
						if (!frame) return;
						// Another render cycle may have already uploaded this
						const existing = textureCache.acquire(exactKey);
						if (existing) {
							textureCache.release(exactKey);
							return;
						}
						const tex = uploadFrameToTexture(ctx, exactKey, frame, isHeadless);
						if (tex) {
							updateLastGoodFrame(nodeId, exactKey, ctx.device);
						}
					})
					.catch((err) => {
						console.error("[VideoNode] decode error:", err);
					})
					.finally(() => {
						pendingDecodes.delete(exactKey);
						delays.delete(delayHandle);
					});

				pendingDecodes.set(exactKey, decodePromise);

				// ── YouTube-like behaviour ──────────────────────────────────────
				// On the very first frame (cold start) we WAIT for the frame so
				// the player never shows a blank canvas.  For subsequent frames
				// during normal playback we fall through immediately and draw the
				// last-good frame while the decode runs in the background — this
				// keeps rendering smooth at full frame-rate.
				// In headless mode we ALWAYS await every frame to guarantee 100%
				// frame-accuracy and prevent parallel decodes clogging WebCodecs.
				const isPlaying = props.isPlaying ?? true;
				const shouldWait = isHeadless || props.forceWait || !isPlaying;
				const isFirstFrame = !lastGoodFrameKey.has(nodeId);
				if (isFirstFrame || shouldWait) {
					await decodePromise;
					exactTex = textureCache.acquire(exactKey);
				}
			} else {
				const isPlaying = props.isPlaying ?? true;
				const shouldWait = isHeadless || props.forceWait || !isPlaying;
				const isFirstFrame = !lastGoodFrameKey.has(nodeId);
				if (isFirstFrame || shouldWait) {
					await pendingDecodes.get(exactKey);
					exactTex = textureCache.acquire(exactKey);
				}
			}
		} else {
			// Frame is already in the GPU cache; keep the last-good pointer current
			updateLastGoodFrame(nodeId, exactKey, ctx.device);
		}

		// ── Step 2: pick the best available texture to draw ───────────────────
		//
		// Priority:  exact frame  →  last good frame  →  nothing
		// This is exactly what mediabunny does: keep showing the previous frame
		// while the next one is being decoded.

		let activeKey: string | null = null;
		let texToDraw: GPUTexture | null = null;

		if (exactTex) {
			texToDraw = exactTex;
			activeKey = exactKey;
		} else if (lastGoodFrameKey.has(nodeId)) {
			const fallbackKey = lastGoodFrameKey.get(nodeId)!;
			const fallbackTex = textureCache.acquire(fallbackKey);
			if (fallbackTex) {
				texToDraw = fallbackTex;
				activeKey = fallbackKey;
			}
		}

		if (texToDraw) {
			ctx.renderer.drawTexture(pass, texToDraw, props.dstRect, {
				opacity: props.opacity,
				transform: props.matrix,
			});
		}

		if (activeKey) {
			textureCache.release(activeKey);
		}
	} catch (err) {
		console.error("[VideoNode] drawVideoNode error:", err);
	}
};

/**
 * Call this when a video node is removed from the scene so we don't leak
 * stale entries in the fallback map.
 */
export const clearVideoNodeState = (
	nodeId: string,
	device?: GPUDevice,
): void => {
	const keysToDelete: string[] = [];
	for (const key of lastGoodFrameKey.keys()) {
		if (key === nodeId || key.startsWith(`${nodeId}-`)) {
			keysToDelete.push(key);
		}
	}
	for (const key of keysToDelete) {
		const prevKey = lastGoodFrameKey.get(key);
		if (prevKey) {
			textureCache.evict(prevKey, device);
			textureCache.activeKeys.delete(prevKey);
		}
		lastGoodFrameKey.delete(key);
		lastSourceUrl.delete(key);
	}
};

export const clearAllVideoCache = (device?: GPUDevice): void => {
	for (const key of lastGoodFrameKey.values()) {
		textureCache.evict(key, device);
		textureCache.activeKeys.delete(key);
	}
	lastGoodFrameKey.clear();
	lastSourceUrl.clear();
	pendingDecodes.clear();
};
