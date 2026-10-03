/**
 * The ONE constructor from document to render tree (spec: SKILL.md).
 *
 * A validated v2 program (`CompositorProgramConfig`) becomes the
 * `VirtualMediaData` tree the compositor renderer consumes. Every layout node
 * becomes a `CompositorLayer` op carrying its document fields verbatim
 * (id/kind/style/timing/animation); containers carry nested node ops as
 * children; media nodes bind their graph source as the content child when
 * resolved.
 *
 * Pure + deterministic: same doc → same tree. No width/height resolution
 * here — geometry comes from `computeLayout` at render time.
 */
import {
	createVirtualMedia,
	type DataType,
	getActiveMediaMetadata,
	type VirtualMediaData,
} from "@gitframes/core";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";

import { computeStaggerDelay } from "./stagger.js";

export interface CompositorToProgramOptions {
	isVideoMode: boolean;
	fps: number;
	/** Comp duration in ms (metadata only; derived upstream). */
	durationMs?: number;
	/** Bind a media node's `inputHandleId` to its graph source item. */
	resolveMedia?: (inputHandleId: string) => VirtualMediaData | undefined;
	/** External signals mapped by inputHandleId. */
	signals?: Record<string, any>;
}

function nodeToVirtualMedia(
	node: LayoutNode,
	resolveMedia: CompositorToProgramOptions["resolveMedia"],
	fps: number,
	inheritedOffset = 0,
	compDurationMs?: number,
	inheritedDurationFrames?: number,
): VirtualMediaData {
	let children: VirtualMediaData[] = [];
	const sourceRef = (node as any).src ?? (node as any).inputHandleId;
	const isDirectMediaSource = (s: unknown) =>
		typeof s === "string" &&
		(s.startsWith("http://") ||
			s.startsWith("https://") ||
			s.startsWith("file://") ||
			s.startsWith("/") ||
			s.startsWith("./") ||
			s.startsWith("blob:") ||
			s.startsWith("data:") ||
			/\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|mkv|mp3|wav|ogg|m4a|srt|vtt)$/i.test(
				s,
			));

	let media: VirtualMediaData | undefined;
	if (node.kind === "media") {
		if (resolveMedia) {
			media = resolveMedia(node.inputHandleId);
		}
		if (
			!media &&
			sourceRef &&
			(isDirectMediaSource(sourceRef) || (node as any).src)
		) {
			media = createVirtualMedia(
				sourceRef,
				(node.dataType as DataType) ?? "Video",
			);
		}
		if (media && (node as any).crop) {
			const cropRaw = (node as any).crop;
			const cropOp =
				typeof cropRaw.toOperation === "function"
					? cropRaw.toOperation()
					: cropRaw;
			media = {
				metadata: { ...media.metadata },
				operation: {
					op: "Crop",
					...cropOp,
					dataType: media.operation.dataType,
				},
				children: [media],
			} as unknown as VirtualMediaData;
		}
		if (media && Array.isArray((node as any).effects)) {
			for (const eff of (node as any).effects) {
				const effOp =
					typeof eff.toOperation === "function" ? eff.toOperation() : eff;
				media = {
					metadata: { ...media.metadata },
					operation: {
						id: (node as any).id
							? `${(node as any).id}-${effOp.op ?? "effect"}`
							: undefined,
						effect: eff,
						...effOp,
						dataType: media.operation.dataType,
					},
					children: [media],
				} as unknown as VirtualMediaData;
			}
		}
		if (media && (node as any).vision) {
			const visionRaw = (node as any).vision;
			const visionOp =
				typeof visionRaw.toOperation === "function"
					? visionRaw.toOperation()
					: visionRaw;
			media = {
				metadata: { ...media.metadata },
				operation: {
					op: "Vision",
					id: (node as any).id,
					effect: visionRaw,
					...visionOp,
					dataType: media.operation.dataType,
				},
				children: [media],
			} as unknown as VirtualMediaData;
		}
	}

	if (node.kind === "media") {
		children = media ? [media] : [];
	} else if ("children" in node && node.children) {
		const staggerFrames =
			"staggerFrames" in node && typeof (node as any).staggerFrames === "number"
				? (node as any).staggerFrames
				: 0;
		const staggerDirection =
			"staggerDirection" in node &&
			typeof (node as any).staggerDirection === "string"
				? (node as any).staggerDirection
				: "forward";

		const nodeStart =
			typeof node.startFrame === "number" && Number.isFinite(node.startFrame)
				? Math.round(node.startFrame)
				: 0;
		const nodeDuration =
			typeof node.durationFrames === "number" &&
			Number.isFinite(node.durationFrames)
				? Math.round(node.durationFrames)
				: inheritedDurationFrames;
		children = node.children.map((c, idx) => {
			const delay = computeStaggerDelay(
				idx,
				node.children!.length,
				staggerFrames,
				staggerDirection,
			);
			const childOffset = inheritedOffset + nodeStart + delay;
			return nodeToVirtualMedia(
				c,
				resolveMedia,
				fps,
				childOffset,
				compDurationMs,
				c.durationFrames === undefined ? nodeDuration : undefined,
			);
		});
	}

	let dataType: DataType = "Image";
	let limit: number | undefined;
	if (media) {
		dataType = media.operation?.dataType ?? "Image";
		const isStaticAsset = dataType === "Image" || dataType === "SVG";
		const durationMs = isStaticAsset
			? undefined
			: getActiveMediaMetadata(media)?.durationMs;
		if (durationMs !== undefined && durationMs !== null) {
			limit = Math.max(1, Math.round((durationMs / 1000) * fps));
		}
	}

	const isCaption = media?.operation?.dataType === "Caption";
	const isContainer =
		node.kind === "flex" || node.kind === "block" || node.kind === "box";
	const startFrame =
		(typeof node.startFrame === "number" &&
		Number.isFinite(node.startFrame) &&
		node.startFrame >= 0
			? Math.round(node.startFrame)
			: 0) + inheritedOffset;
	let dur =
		typeof node.durationFrames === "number" &&
		Number.isFinite(node.durationFrames) &&
		node.durationFrames > 0
			? Math.round(node.durationFrames)
			: undefined;

	const defaultCompDuration =
		inheritedDurationFrames ??
		Math.round(((compDurationMs ?? 10000) / 1000) * fps);

	if (isContainer && children.length > 0) {
		// A container without its own timing keeps its parent's clock — its keyframes
		// are authored parent-relative and its background shows before its first child
		// arrives — and stays active until its last child ends.
		// Also when its own durationFrames is unusable (0, NaN): `dur` is unset then.
		if (dur === undefined) {
			const childEnds = children.map(
				(c) =>
					((c.operation as any)?.startFrame ?? 0) +
					((c.operation as any)?.durationFrames ?? defaultCompDuration),
			);
			dur = Math.max(1, Math.max(...childEnds) - startFrame);
		}
	} else {
		if (isCaption && limit !== undefined && limit > 0) {
			dur = limit;
		} else if (dur !== undefined) {
			if (
				(dataType === "Video" || dataType === "Audio") &&
				limit !== undefined &&
				limit > 0
			) {
				dur = Math.min(dur, limit);
			}
		} else {
			dur =
				limit ??
				inheritedDurationFrames ??
				Math.round(((compDurationMs ?? 10000) / 1000) * fps);
		}
	}

	const durationMs = (dur / fps) * 1000;

	if (node.kind === "media" && media) {
		if (!media.metadata?.durationMs || media.metadata.durationMs <= 0) {
			if (!media.metadata)
				(media as unknown as { metadata: Record<string, unknown> }).metadata =
					{};
			media.metadata.durationMs = durationMs;
		}
	}

	return {
		metadata: {
			durationMs,
		},
		operation: {
			op: "CompositorLayer",
			...node,
			startFrame,
			durationFrames: dur,
			dataType,
		},
		children,
	} as unknown as VirtualMediaData;
}

export function compositorToProgram(
	config: CompositorProgramConfig,
	options: CompositorToProgramOptions,
): VirtualMediaData {
	const { isVideoMode, fps, durationMs, resolveMedia, signals } = options;

	let rootMedia: VirtualMediaData = {
		metadata: {
			width: config.width,
			height: config.height,
			fps,
			...(durationMs !== undefined && { durationMs }),
		},
		operation: {
			op: "Compositor",
			width: config.width,
			height: config.height,
			fps,
			mode: config.mode ?? "Video",
			backgroundColor: config.backgroundColor,
			...(config.antialias3d !== undefined && {
				antialias3d: config.antialias3d,
			}),
			// Master gain — consumed by the compositor's audio processor when
			// the extractor dispatches the root op (audio-processor.ts).
			volume: config.volume ?? 1,
			dataType: isVideoMode ? "Video" : "Image",
			// Debug-only snapshot of the document (L7): the render tree is
			// `children`; this copy exists for tree inspection in devtools and
			// is NOT read by the renderer — do not treat it as the source of
			// truth (the config is).
			layout: config.layout,
			signals: signals ?? (config as any).signals ?? {},
			...(((config as any).onRequestFrame ||
				(options as any).onRequestFrame) && {
				onRequestFrame:
					(config as any).onRequestFrame ?? (options as any).onRequestFrame,
			}),
		},
		children: config.layout.map((n) =>
			nodeToVirtualMedia(n, resolveMedia, fps, 0, durationMs),
		),
	} as unknown as VirtualMediaData;

	const effectsList: any[] = Array.isArray((options as any).effects)
		? (options as any).effects
		: Array.isArray((config as any).effects)
			? (config as any).effects
			: [];
	for (const eff of effectsList) {
		const effOp =
			typeof eff.toOperation === "function" ? eff.toOperation() : eff;
		rootMedia = {
			metadata: { ...rootMedia.metadata },
			operation: {
				...effOp,
				dataType: rootMedia.operation.dataType,
			},
			children: [rootMedia],
		} as unknown as VirtualMediaData;
	}

	const visionRaw = (config as any).vision ?? (options as any).vision;
	if (visionRaw) {
		const visionOp =
			typeof visionRaw.toOperation === "function"
				? visionRaw.toOperation()
				: visionRaw;
		rootMedia = {
			metadata: { ...rootMedia.metadata },
			operation: {
				op: "Vision",
				...visionOp,
				dataType: rootMedia.operation.dataType,
			},
			children: [rootMedia],
		} as unknown as VirtualMediaData;
	}

	return rootMedia;
}

/** Recursively gather every node op from a render tree (in order). */
export function collectNodeOps(nodes: VirtualMediaData[]): VirtualMediaData[] {
	const out: VirtualMediaData[] = [];
	const walk = (vm: VirtualMediaData) => {
		if (vm?.operation?.op === "CompositorLayer") {
			out.push(vm);
		}
		for (const c of vm?.children ?? []) walk(c);
	};
	for (const n of nodes) walk(n);
	return out;
}
