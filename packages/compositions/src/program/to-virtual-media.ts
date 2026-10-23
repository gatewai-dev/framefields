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
	type FrameContext,
	getActiveMediaMetadata,
	type VirtualMediaData,
} from "@framefields/core";
import { collectInlineSignals } from "./inline-signals.js";
import { hoistMattes } from "./mattes.js";
import type {
	CompositorProgramConfig,
	LayoutNode,
	ProgramEffect,
} from "./schema.js";

import { computeStaggerDelay } from "./stagger.js";

export interface CompositorToProgramOptions {
	isVideoMode: boolean;
	fps: number;
	/** Comp duration in ms (metadata only; derived upstream). */
	durationMs?: number;
	/** Bind a media node's `inputHandleId` to its graph source item. */
	resolveMedia?: (inputHandleId?: string) => VirtualMediaData | undefined;
	/** External signals mapped by inputHandleId. */
	signals?: Record<string, unknown>;
	/** Per-frame notification hook. */
	onRequestFrame?: ((ctx: FrameContext) => void) | unknown;
	/** Composition-wide effect chain (`comp.apply(effect)`). */
	effects?: ProgramEffect[];
	/** Composition-wide vision config or bundle. */
	vision?: unknown;
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
	const sourceRef =
		node.kind === "media"
			? (node.src ?? node.inputHandleId)
			: "inputHandleId" in node
				? (node as { inputHandleId?: string }).inputHandleId
				: undefined;
	const isDirectMediaSource = (s: unknown) =>
		typeof s === "string" &&
		(s.startsWith("http://") ||
			s.startsWith("https://") ||
			s.startsWith("file://") ||
			s.startsWith("/") ||
			s.startsWith("./") ||
			s.startsWith("blob:") ||
			s.startsWith("data:") ||
			/\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|mkv|mp3|wav|ogg|m4a|srt|vtt|json|lottie)$/i.test(
				s,
			));

	let media: VirtualMediaData | undefined;
	if (node.kind === "media") {
		if (resolveMedia && node.inputHandleId) {
			media = resolveMedia(node.inputHandleId);
		}
		if (
			!media &&
			sourceRef &&
			(isDirectMediaSource(sourceRef) || Boolean(node.src))
		) {
			media = createVirtualMedia(
				sourceRef,
				(node.dataType as DataType) ?? "Video",
			);
		}
		if (
			!media &&
			!resolveMedia &&
			sourceRef &&
			(sourceRef.includes(".") || sourceRef.includes("/"))
		) {
			console.warn(
				`[Compositor] Media layer '${node.id ?? "?"}' source '${sourceRef}' could not be resolved.`,
			);
		}
		if (media && node.crop) {
			const cropRaw = node.crop as
				| { toOperation?: () => Record<string, unknown> }
				| Record<string, unknown>;
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
			};
		}
		if (media && Array.isArray(node.effects)) {
			let currentMedia: VirtualMediaData = media;
			for (const eff of node.effects) {
				const effOp =
					eff &&
					typeof (eff as { toOperation?: unknown }).toOperation === "function"
						? (
								eff as { toOperation: () => Record<string, unknown> }
							).toOperation()
						: (eff as Record<string, unknown>);
				currentMedia = {
					metadata: { ...currentMedia.metadata },
					operation: {
						op: String(effOp.op ?? "effect"),
						id: node.id ? `${node.id}-${effOp.op ?? "effect"}` : undefined,
						effect: eff,
						...effOp,
						dataType: currentMedia.operation.dataType,
					},
					children: [currentMedia],
				};
			}
			media = currentMedia;
		}
		if (media && node.vision) {
			const visionRaw = node.vision as
				| { toOperation?: () => Record<string, unknown> }
				| Record<string, unknown>;
			const visionOp =
				typeof visionRaw.toOperation === "function"
					? visionRaw.toOperation()
					: visionRaw;
			media = {
				metadata: { ...media.metadata },
				operation: {
					op: "Vision",
					id: node.id,
					effect: visionRaw,
					...visionOp,
					dataType: media.operation.dataType,
				},
				children: [media],
			};
		}
	}

	if (node.kind === "media") {
		children = media ? [media] : [];
	} else if ("children" in node && node.children) {
		const staggerFrames =
			node.kind === "flex" && typeof node.staggerFrames === "number"
				? node.staggerFrames
				: 0;
		const staggerDirection =
			node.kind === "flex" && typeof node.staggerDirection === "string"
				? node.staggerDirection
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
		const nodeChildren = node.children;
		children = nodeChildren.map((c, idx) => {
			const delay = computeStaggerDelay(
				idx,
				nodeChildren.length,
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
					(c.operation.startFrame ?? 0) +
					(c.operation.durationFrames ?? defaultCompDuration),
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
		let curr: VirtualMediaData | undefined = media;
		while (curr) {
			if (!curr.metadata?.durationMs || curr.metadata.durationMs <= 0) {
				if (!curr.metadata) {
					(curr as unknown as { metadata: Record<string, unknown> }).metadata =
						{};
				}
				curr.metadata.durationMs = durationMs;
			}
			if (
				curr.operation?.sourceMeta &&
				!(curr.operation.sourceMeta as Record<string, unknown>).durationMs
			) {
				(curr.operation.sourceMeta as Record<string, unknown>).durationMs =
					durationMs;
			}
			curr = curr.children?.[0];
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
			// Signal objects passed straight to `LayerAnimation.signal` ride on
			// their tracks; fold them in under their generated handle ids.
			signals: {
				...collectInlineSignals(config.layout),
				...(signals ?? config.signals ?? {}),
			},
			...(config.onRequestFrame || options.onRequestFrame
				? {
						onRequestFrame: config.onRequestFrame ?? options.onRequestFrame,
					}
				: {}),
		},
		children: hoistMattes(config.layout).map((n) =>
			nodeToVirtualMedia(n, resolveMedia, fps, 0, durationMs),
		),
	} as unknown as VirtualMediaData;

	const effectsList: ProgramEffect[] = Array.isArray(options.effects)
		? options.effects
		: Array.isArray(config.effects)
			? config.effects
			: [];
	for (const eff of effectsList) {
		const effOp =
			eff &&
			typeof (eff as { toOperation?: unknown }).toOperation === "function"
				? (eff as { toOperation: () => Record<string, unknown> }).toOperation()
				: (eff as Record<string, unknown>);
		rootMedia = {
			metadata: { ...rootMedia.metadata },
			operation: {
				...effOp,
				dataType: rootMedia.operation.dataType,
			},
			children: [rootMedia],
		} as unknown as VirtualMediaData;
	}

	const visionRaw = config.vision ?? options.vision;
	if (visionRaw) {
		const visionOp =
			typeof (visionRaw as { toOperation?: unknown }).toOperation === "function"
				? (
						visionRaw as { toOperation: () => Record<string, unknown> }
					).toOperation()
				: (visionRaw as Record<string, unknown>);
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
