/**
 * processCompositor v2 — doc → render tree (spec: SKILL.md).
 *
 * The composition duration is derived from the tree itself: the max
 * `startFrame + durationFrames` over nodes, with media nodes falling back
 * to their bound source duration. Media nodes bind their graph sources by
 * `inputHandleId`. Everything else is `compositorToProgram` — one
 * constructor, no layer bookkeeping, no implicit "render all inputs".
 */

import {
	collectMediaBindings,
	compositorToProgram,
	type LayoutNode,
} from "@gitframes/compositions/program";
import {
	DEFAULT_DURATION_MS,
	getActiveMediaMetadata,
	type VirtualMediaData,
} from "@gitframes/core";
import type { CompositorNodeConfig } from "./config.js";

function mediaDurationFrames(
	vm: VirtualMediaData | undefined,
	fps: number,
): number | undefined {
	if (vm?.operation?.dataType === "Image") return undefined;
	const ms = vm ? getActiveMediaMetadata(vm)?.durationMs : undefined;
	if (!ms || ms <= 0) return undefined;
	return Math.max(1, Math.round((ms / 1000) * fps));
}

function computeCompositionDurationFrames(
	config: CompositorNodeConfig,
	mediaByHandle: Map<string, VirtualMediaData>,
	fps: number,
): number {
	let frames = 0;
	const walk = (nodes: LayoutNode[]) => {
		for (const n of nodes) {
			let dur =
				typeof n.durationFrames === "number" &&
				Number.isFinite(n.durationFrames) &&
				n.durationFrames > 0
					? Math.round(n.durationFrames)
					: undefined;
			const startFrame =
				typeof n.startFrame === "number" &&
				Number.isFinite(n.startFrame) &&
				n.startFrame >= 0
					? Math.round(n.startFrame)
					: 0;
			const vm =
				n.kind === "media" ? mediaByHandle.get(n.inputHandleId) : undefined;
			const limit = mediaDurationFrames(vm, fps);
			const isCaption = vm?.operation?.dataType === "Caption";

			if (isCaption && limit !== undefined && limit > 0) {
				dur = limit;
			} else if (dur !== undefined) {
				if (limit !== undefined && limit > 0) {
					dur = Math.min(dur, limit);
				}
			} else {
				dur = limit ?? Math.round((DEFAULT_DURATION_MS / 1000) * fps);
			}

			frames = Math.max(frames, startFrame + dur);
			if ("children" in n && n.children) walk(n.children);
		}
	};
	walk(config.layout);
	return Math.max(1, frames);
}

export function processCompositor(
	config: CompositorNodeConfig,
	mediaByHandle: Map<string, VirtualMediaData>,
	isVideoMode: boolean,
	signalsByHandle?: Map<string, any>,
): VirtualMediaData {
	const fps = config.fps ?? 24;
	const durationFrames = isVideoMode
		? computeCompositionDurationFrames(config, mediaByHandle, fps)
		: undefined;
	const durationMs =
		durationFrames !== undefined ? (durationFrames / fps) * 1000 : undefined;

	const signalsObj: Record<string, any> = {};
	if (signalsByHandle) {
		for (const [key, val] of signalsByHandle.entries()) {
			signalsObj[key] = val;
		}
	}

	return compositorToProgram(config, {
		isVideoMode,
		fps,
		...(durationMs !== undefined && { durationMs }),
		resolveMedia: (inputHandleId) => mediaByHandle.get(inputHandleId),
		signals: signalsObj,
	});
}

export { collectMediaBindings };
