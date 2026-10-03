import type { DataType } from "../base.js";
import type { FileData } from "../node-result.js";
import { DEFAULT_DURATION_MS } from "./rendering-defaults.js";
import type {
	MediaMetadata,
	MediaOperation,
	VirtualMediaData,
} from "./virtual-video.js";

export type MediaSourceDescriptor = {
	url?: string;
	path?: string;
	width?: number;
	height?: number;
	durationMs?: number;
	fps?: number;
	mimeType?: string;
	sampleRate?: number;
	channels?: number;
	bitDepth?: number;
	audioCodec?: string;
	audioBitrate?: number;
	entity?: any;
};

export type MediaSourceInput =
	| VirtualMediaData
	| string
	| MediaSourceDescriptor
	| FileData;

/**
 * Identify the actual leaf media type (Video, Image, etc) by walking down the tree.
 * This can differ from getMediaType() if an operation (like Ken Burns) upgrades
 * an Image to a Video.
 */
export function getLeafMediaType(
	vv: VirtualMediaData | undefined | null,
): DataType | undefined {
	if (!vv) return undefined;
	if (vv.operation?.op === "source") return vv.operation.dataType;
	if (vv.children && vv.children.length > 0) {
		return getLeafMediaType(vv.children[0]);
	}
	return vv.operation.dataType;
}

/**
 * Resolve the MIME type of the leaf source media.
 */
export function resolveMediaMimeType(
	vv: VirtualMediaData | undefined | null,
): string | undefined {
	if (!vv) return undefined;
	if (vv.operation?.op === "source") {
		const op = vv.operation as any;
		if (op.mimeType) return op.mimeType;
		if (op.sourceMeta?.mimeType) return op.sourceMeta.mimeType;
		if (op.source?.entity?.mimeType) return op.source.entity.mimeType;
		const url =
			typeof op.source === "string" ? op.source : (op.url ?? op.source?.url);
		if (typeof url === "string") {
			const ext = url.split(".").pop()?.toLowerCase();
			if (ext === "mp4") return "video/mp4";
			if (ext === "webm") return "video/webm";
			if (ext === "mov") return "video/quicktime";
			if (ext === "png") return "image/png";
			if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
			if (ext === "webp") return "image/webp";
			if (ext === "svg") return "image/svg+xml";
			if (ext === "mp3") return "audio/mpeg";
			if (ext === "wav") return "audio/wav";
			if (ext === "aac") return "audio/aac";
		}
	}
	if (vv.children && vv.children.length > 0) {
		return resolveMediaMimeType(vv.children[0]);
	}
	return undefined;
}

/**
 * Create a VirtualMediaData from a FileData source or Text.
 * Used by Import, VideoGen, and Text nodes to wrap concrete content.
 */
export function createVirtualMedia(
	source: MediaSourceInput,
	type: DataType = "Video",
): VirtualMediaData {
	// If it is already a VirtualMediaData AST, return it verbatim
	if (
		source &&
		typeof source === "object" &&
		"operation" in source &&
		"metadata" in source
	) {
		return source as VirtualMediaData;
	}

	// Case 1: Simple string URL / file path
	if (typeof source === "string") {
		const url = source;
		const isImage =
			type === "Image" || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(url);
		const durationMs = isImage ? DEFAULT_DURATION_MS : undefined;
		const sourceMeta: MediaMetadata = {
			width: undefined,
			height: undefined,
			durationMs,
			fps: undefined,
		};
		return {
			metadata: sourceMeta,
			operation: {
				op: "source",
				url,
				source: url,
				sourceMeta,
				dataType: type,
			},
			children: [],
		};
	}

	// Case 2: Media descriptor object with explicit url/path and optional dimensions/duration
	if (
		typeof source === "object" &&
		source !== null &&
		("url" in source || "path" in source)
	) {
		const desc = source as MediaSourceDescriptor;
		const url = desc.url ?? desc.path!;
		const isImage =
			type === "Image" || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(url);
		const durationMs =
			desc.durationMs ?? (isImage ? DEFAULT_DURATION_MS : undefined);
		const sourceMeta: MediaMetadata = {
			width: desc.width,
			height: desc.height,
			durationMs,
			fps: desc.fps,
			sampleRate: desc.sampleRate,
			channels: desc.channels,
			bitDepth: desc.bitDepth,
			audioCodec: desc.audioCodec,
			audioBitrate: desc.audioBitrate,
		};
		return {
			metadata: sourceMeta,
			operation: {
				op: "source",
				url,
				source: url,
				sourceMeta,
				dataType: type,
			},
			children: [],
		};
	}

	// Case 3: Legacy FileData with entity
	const sourceMeta = getFileDataMetadata(source as any) || {
		width: undefined,
		height: undefined,
		durationMs: undefined,
		fps: undefined,
	};
	return {
		metadata: sourceMeta,
		operation: {
			op: "source",
			source: {
				entity: (source as any)?.entity,
			},
			sourceMeta,
			dataType: type,
		},
		children: [],
	};
}

/**
 * Identify if a VirtualMediaData node is intended to be Video, Audio, Image, or Text.
 */
export function getMediaType(vv: VirtualMediaData): DataType {
	if (!vv) throw new Error("No media data provided");
	return vv.operation.dataType;
}

/**
 * Append an operation to an existing VirtualMediaData (recursive).
 * This creates a new parent node wrapping the current one as a child.
 */
export function appendOperation(
	vv: VirtualMediaData,
	operation: MediaOperation,
): VirtualMediaData {
	const activeMetadata = getActiveMediaMetadata(vv);
	const nextMeta = computeNextMetadata(activeMetadata ?? {}, operation);
	return {
		metadata: nextMeta,
		operation,
		children: [vv],
	};
}

/**
 * Helper to compute the metadata of the NEXT node in the operator tree.
 */
function computeNextMetadata(
	baseMeta: MediaMetadata,
	op: MediaOperation,
): MediaMetadata {
	let {
		width,
		height,
		durationMs,
		fps,
		sampleRate,
		channels,
		bitDepth,
		audioCodec,
		audioBitrate,
	} = baseMeta;

	// If an operation explicitly provides metadata, we use it as a base/override
	if ("metadata" in op && op.metadata) {
		width = op.metadata.width ?? width;
		height = op.metadata.height ?? height;
		durationMs = op.metadata.durationMs ?? durationMs;
		fps = op.metadata.fps ?? fps;
		sampleRate = op.metadata.sampleRate ?? sampleRate;
		channels = op.metadata.channels ?? channels;
		bitDepth = op.metadata.bitDepth ?? bitDepth;
		audioCodec = op.metadata.audioCodec ?? audioCodec;
		audioBitrate = op.metadata.audioBitrate ?? audioBitrate;
	}

	if (
		op.dataType === "Audio" ||
		op.dataType === "Text" ||
		op.dataType === "Caption"
	) {
		width = undefined;
		height = undefined;
		fps = undefined;
	}

	return {
		width,
		height,
		durationMs,
		fps,
		sampleRate,
		channels,
		bitDepth,
		audioCodec,
		audioBitrate,
	};
}

export function getFileDataMetadata(
	filedata:
		| {
				entity?: {
					width?: number | null;
					height?: number | null;
					duration?: number | null;
					fps?: number | null;
					mimeType?: string | null;
					sampleRate?: number | null;
					channels?: number | null;
					bitDepth?: number | null;
					audioCodec?: string | null;
					audioBitrate?: number | null;
					name?: string | null;
				};
		  }
		| null
		| undefined,
): MediaMetadata | null {
	if (!filedata) return null;

	const { entity } = filedata;

	const width = entity?.width;
	const height = entity?.height;
	let durationMs = entity?.duration;
	const fps = entity?.fps;
	const sampleRate = entity?.sampleRate;
	const channels = entity?.channels;
	const bitDepth = entity?.bitDepth;
	const audioCodec = entity?.audioCodec;
	const audioBitrate = entity?.audioBitrate;

	if (durationMs === undefined || durationMs === null) {
		const mimeType = entity?.mimeType ?? "";
		const isStaticMedia =
			mimeType.startsWith("image/") || mimeType === "image/svg+xml";

		if (isStaticMedia) {
			durationMs = DEFAULT_DURATION_MS;
		}
	}

	if (
		width === undefined &&
		height === undefined &&
		durationMs === undefined &&
		sampleRate === undefined &&
		channels === undefined
	) {
		return null;
	}

	return {
		width,
		height,
		durationMs: durationMs === 0 ? undefined : durationMs,
		fps,
		sampleRate,
		channels,
		bitDepth,
		audioCodec,
		audioBitrate,
	};
}

/**
 * Get the active metadata from the VirtualMediaData node.
 * Simply returns the metadata property of the node.
 * Supports legacy formats (sourceMeta) and extracts from source if needed.
 */
export function getActiveMediaMetadata(
	vv: VirtualMediaData | undefined | null,
): MediaMetadata | null {
	if (!vv) return null;

	let width = vv.metadata?.width;
	let height = vv.metadata?.height;
	let durationMs = vv.metadata?.durationMs;
	let fps = vv.metadata?.fps;
	let sampleRate = vv.metadata?.sampleRate;
	let channels = vv.metadata?.channels;
	let bitDepth = vv.metadata?.bitDepth;
	let audioCodec = vv.metadata?.audioCodec;
	let audioBitrate = vv.metadata?.audioBitrate;

	const op = vv.operation as any;
	if (op?.op === "source") {
		const sm = op.sourceMeta || {};
		const fdm = op.source ? getFileDataMetadata(op.source) : null;

		width = width ?? sm.width ?? fdm?.width;
		height = height ?? sm.height ?? fdm?.height;
		durationMs = durationMs ?? sm.durationMs ?? fdm?.durationMs;
		fps = fps ?? sm.fps ?? fdm?.fps;
		sampleRate = sampleRate ?? sm.sampleRate ?? fdm?.sampleRate;
		channels = channels ?? sm.channels ?? fdm?.channels;
		bitDepth = bitDepth ?? sm.bitDepth ?? fdm?.bitDepth;
		audioCodec = audioCodec ?? sm.audioCodec ?? fdm?.audioCodec;
		audioBitrate = audioBitrate ?? sm.audioBitrate ?? fdm?.audioBitrate;
	}

	if (
		width === undefined &&
		height === undefined &&
		durationMs === undefined &&
		sampleRate === undefined &&
		channels === undefined
	) {
		return null;
	}

	return {
		width,
		height,
		durationMs: durationMs === 0 ? undefined : durationMs, // Avoid 0 duration falling back incorrectly
		fps,
		sampleRate,
		channels,
		bitDepth,
		audioCodec,
		audioBitrate,
	};
}

/**
 * Compute the dimensions and offsets for rendering a cropped video.
 * Traverses the VirtualMediaData tree to find nested crops and source dimensions.
 */
export function computeVideoCropRenderProps(virtualMedia: VirtualMediaData): {
	videoNaturalWidth: number;
	videoNaturalHeight: number;
	cropTranslatePercentageX: number; // Changed from Px to Percentage
	cropTranslatePercentageY: number; // Changed from Px to Percentage
} | null {
	let totalOffsetX = 0;
	let totalOffsetY = 0;
	let hasCrop = false;
	let sourceMetaFound = null;

	// Traverse the recursive tree to find crops and the source dimensions
	let currentNode: VirtualMediaData | undefined = virtualMedia;
	while (currentNode) {
		const op = currentNode.operation;

		if (op.op === "Crop") {
			hasCrop = true;
			const anyOp = op as any;
			const inputMeta = currentNode.children[0]?.metadata;
			const inputW = inputMeta?.width ?? 0;
			const inputH = inputMeta?.height ?? 0;

			if (inputW > 0 && inputH > 0) {
				const cropLeftPx = (anyOp.leftPercentage / 100) * inputW;
				const cropTopPx = (anyOp.topPercentage / 100) * inputH;

				totalOffsetX += cropLeftPx;
				totalOffsetY += cropTopPx;
			}
		}

		if (op.op === "source") {
			const anyOp = op as any;
			sourceMetaFound = anyOp.sourceMeta ?? currentNode.metadata;
		}

		// Move down the tree
		currentNode = currentNode.children[0];
	}

	if (!hasCrop || !sourceMetaFound) return null;

	const sourceW = sourceMetaFound.width ?? 1;
	const sourceH = sourceMetaFound.height ?? 1;

	// Convert absolute pixels back to a percentage relative to the source!
	const translatePctX = -(totalOffsetX / sourceW) * 100;
	const translatePctY = -(totalOffsetY / sourceH) * 100;

	return {
		videoNaturalWidth: sourceW,
		videoNaturalHeight: sourceH,
		cropTranslatePercentageX: translatePctX,
		cropTranslatePercentageY: translatePctY,
	};
}
