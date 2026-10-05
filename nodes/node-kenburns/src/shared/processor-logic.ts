import type {
	DataType,
	MediaMetadata,
	MediaOperation,
	VirtualMediaData,
} from "@framefields/core";
import type { KenBurnsConfig } from "./config.js";

/**
 * Calculates the output metadata for a Ken Burns operation based on current metadata and config.
 * Ensures consistent behavior between browser and server processors.
 */
export function calculateKenBurnsMetadata(
	currentMeta: MediaMetadata,
	config: KenBurnsConfig,
	inputType: DataType = "Image",
): MediaMetadata {
	let outWidth = currentMeta.width;
	let outHeight = currentMeta.height;
	if (!outWidth || !outHeight) {
		throw new Error("Dimensions are missing from input media.");
	}

	// Crop bounding box to fit the new aspect ratio
	if (config.aspectRatio && config.aspectRatio !== "input") {
		const [wRatio, hRatio] = config.aspectRatio.split(":").map(Number);
		const targetAr = wRatio / hRatio;
		const sourceAr = outWidth / outHeight;

		if (sourceAr > targetAr) {
			// Source is wider, bind output to height
			outWidth = Math.round(outHeight * targetAr);
		} else {
			// Source is taller, bind output to width
			outHeight = Math.round(outWidth / targetAr);
		}
	}

	// Calculate total chain duration (minimum 100ms)
	let totalDuration = currentMeta.durationMs ?? 3000;
	if (config.keyframes && config.keyframes.length > 0) {
		const keyframesDuration = config.keyframes.reduce(
			(acc, kf) => acc + kf.durationMs + (kf.holdMs || 0),
			0,
		);

		if (inputType === "Image" || inputType === "SVG") {
			totalDuration = Math.max(100, keyframesDuration);
		} else {
			// For videos/audio, we cap the animation duration to the available content duration
			totalDuration = Math.min(totalDuration, Math.max(100, keyframesDuration));
		}
	}

	let fps = currentMeta.fps;
	if (inputType === "Image" || inputType === "SVG" || inputType === "Lottie") {
		fps = 60;
	} else if (!fps) {
		fps = 24; // fallback if missing
	}

	return {
		...currentMeta,
		width: Math.round(outWidth),
		height: Math.round(outHeight),
		durationMs: totalDuration,
		fps,
	};
}

/**
 * Environment-specific functions needed for Ken Burns processing.
 */
export interface KenBurnsProcessorEnv {
	getActiveMediaMetadata: (media: VirtualMediaData) => MediaMetadata | null;
	appendOperation: (
		media: VirtualMediaData,
		operation: MediaOperation,
	) => VirtualMediaData;
	getMediaType: (media: VirtualMediaData) => DataType;
}

/**
 * Performs the core Ken Burns processing logic, abstracting away environment-specific function calls.
 */
export function performKenBurnsProcessing(
	inputMedia: VirtualMediaData,
	config: KenBurnsConfig,
	env: KenBurnsProcessorEnv,
): VirtualMediaData {
	const currentMeta = env.getActiveMediaMetadata(inputMedia);
	if (!currentMeta) {
		throw new Error("Unable to read media metadata");
	}

	const mediaType = env.getMediaType(inputMedia);
	const newMeta = calculateKenBurnsMetadata(currentMeta, config, mediaType);

	// Append the Ken Burns operation to the media tree with calculated metadata
	return env.appendOperation(inputMedia, {
		op: "KenBurns",
		...config,
		originalWidth: currentMeta.width,
		originalHeight: currentMeta.height,
		metadata: newMeta,
		dataType: "Video",
	});
}
