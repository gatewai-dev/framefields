import {
	type MediaSourceRange,
	mediaSourceRange,
	type ResolvedMediaTimeRemap,
	type VirtualMediaData,
} from "@framefields/core";
import { inputStore } from "@framefields/webgpu-renderers";
import { computeRenderParams } from "./apply-operations.js";

/** Resolve the source bound to a compositor layer, including effect wrappers. */
function sourceOf(node: VirtualMediaData): string | undefined {
	if (node.operation?.op === "source")
		return computeRenderParams(node).sourceUrl;
	for (const child of node.children ?? []) {
		const source = sourceOf(child);
		if (source) return source;
	}
}

/** Verify mapped source intervals before decoding or mixing. */
export async function preflightMediaTime(
	root: VirtualMediaData,
	fps: number,
): Promise<void> {
	const walk = async (node: VirtualMediaData): Promise<void> => {
		const op = node.operation as unknown as {
			op?: string;
			id?: string;
			dataType?: string;
			muted?: boolean;
			volume?: number;
			durationFrames?: number;
			timeRemap?: ResolvedMediaTimeRemap;
		};
		if (op?.op === "CompositorLayer" && op.timeRemap && op.durationFrames) {
			const source = sourceOf(node);
			if (!source)
				throw new Error(`Time remap on '${op.id}' has no media source`);
			const bounds: Array<{ first: number; last: number }> = [];
			const input = await inputStore.acquire(source);
			try {
				const video =
					op.dataType === "Video" ? await input.getPrimaryVideoTrack() : null;
				const audio =
					op.dataType === "Video" && (op.muted || op.volume === 0)
						? null
						: await input.getPrimaryAudioTrack();
				if (op.dataType === "Video" && !video)
					throw new Error(
						`Time remap on '${op.id}': source has no video track`,
					);
				if (op.dataType === "Audio" && !audio)
					throw new Error(
						`Time remap on '${op.id}': source has no audio track`,
					);
				for (const track of [video, audio]) {
					if (!track) continue;
					bounds.push({
						first: await input.getFirstTimestamp([track]),
						last: await track.computeDuration(),
					});
				}
			} finally {
				inputStore.release(source);
			}
			const check = (range: MediaSourceRange) => {
				for (const { first, last } of bounds) {
					if (
						range.min < first - 1e-8 ||
						range.max > last + 1e-8 ||
						(range.maxIncluded && range.max >= last - 1e-8)
					) {
						throw new Error(
							`Time remap on '${op.id}' requests source ${range.min.toFixed(6)}–${range.max.toFixed(6)}s outside ${first.toFixed(6)}–${last.toFixed(6)}s`,
						);
					}
				}
			};
			// A live history is checked interval by interval as it is recorded.
			if (op.timeRemap.kind === "recorded")
				op.timeRemap.recorder.checkRange(check);
			else check(mediaSourceRange(op.timeRemap, 0, op.durationFrames, fps));
		}
		for (const child of node.children ?? []) await walk(child);
	};
	await walk(root);
}
