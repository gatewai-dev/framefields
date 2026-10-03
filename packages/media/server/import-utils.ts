import { extractSvgDimensions, type MediaService } from "@gitframes/core";
import { container, logger, TOKENS } from "@gitframes/server-utils";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import {
	calculateFallbackMetadata,
	getAudioDetails,
	getMediaDuration,
	getVideoMetadata,
} from "./utils/index.js";

export type SupportedDataType =
	| "Image"
	| "Video"
	| "Audio"
	| "SVG"
	| "Caption"
	| "Lottie"
	| "GIF"
	| "LUT";

export interface LottieManifestAnimation {
	id?: string;
	file?: string;
}

export interface LottieManifest {
	animations?: LottieManifestAnimation[];
	initial?: string;
}

export function isLottieJson(obj: unknown): boolean {
	if (typeof obj !== "object" || obj === null) return false;
	const dict = obj as Record<string, unknown>;
	const hasLayers = "layers" in dict && Array.isArray(dict.layers);
	const hasLottieStructure =
		"v" in dict && ("fr" in dict || "ip" in dict || "op" in dict);
	return hasLayers || hasLottieStructure;
}

export function processAndValidateLottie(
	buffer: Buffer,
	filename: string,
	mimeType?: string,
): { buffer: Buffer; filename: string; contentType: string } {
	const cleanFilename = filename.split("?")[0].split("#")[0];
	const ext = cleanFilename.toLowerCase().split(".").pop() ?? "";
	const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
	const isLottieExt = ext === "lottie" || ext === "zip";
	const isLottieMime =
		mimeType === "application/x-lottie" ||
		mimeType === "application/zip" ||
		mimeType === "application/x-zip-compressed";
	const isJsonExt = ext === "json";

	if (isLottieExt || isLottieMime || isZip) {
		try {
			const unzipped = unzipSync(new Uint8Array(buffer));
			let animationContent: Uint8Array | undefined;

			const findEntry = (
				predicate: (cleanKey: string, rawKey: string) => boolean,
			) => {
				for (const rawKey of Object.keys(unzipped)) {
					const cleanKey = rawKey
						.replace(/^[./\\]+/, "")
						.replace(/\\/g, "/")
						.toLowerCase();
					if (predicate(cleanKey, rawKey)) {
						return unzipped[rawKey];
					}
				}
				return undefined;
			};

			const manifestEntry = findEntry((k) => k === "manifest.json");
			if (manifestEntry) {
				try {
					const manifestStr = strFromU8(manifestEntry);
					const manifest = JSON.parse(manifestStr) as LottieManifest;
					if (
						manifest &&
						Array.isArray(manifest.animations) &&
						manifest.animations.length > 0
					) {
						const initialId = manifest.initial;
						const animObj =
							(initialId
								? manifest.animations.find((a) => a.id === initialId)
								: undefined) || manifest.animations[0];

						const candidates = [
							animObj.file,
							animObj.file ? `animations/${animObj.file}` : undefined,
							animObj.id ? `animations/${animObj.id}.json` : undefined,
							animObj.id ? `animations/${animObj.id}` : undefined,
							animObj.id ? `${animObj.id}.json` : undefined,
							animObj.id,
						]
							.filter((k): k is string => Boolean(k))
							.map((k) =>
								k
									.replace(/^[./\\]+/, "")
									.replace(/\\/g, "/")
									.toLowerCase(),
							);

						for (const cand of candidates) {
							const found = findEntry((k) => k === cand);
							if (found) {
								animationContent = found;
								break;
							}
						}
					}
				} catch (err) {
					logger.error(
						{ err },
						"Failed to parse manifest.json from .lottie zip",
					);
				}
			}

			if (!animationContent) {
				const jsonKeys = Object.keys(unzipped).filter((k) => {
					const clean = k
						.replace(/^[./\\]+/, "")
						.replace(/\\/g, "/")
						.toLowerCase();
					return clean.endsWith(".json") && clean !== "manifest.json";
				});

				jsonKeys.sort((a, b) => {
					const aInAnim = a.toLowerCase().includes("animations/") ? -1 : 1;
					const bInAnim = b.toLowerCase().includes("animations/") ? -1 : 1;
					return aInAnim - bInAnim;
				});

				for (const key of jsonKeys) {
					try {
						const parsed = JSON.parse(strFromU8(unzipped[key]));
						if (isLottieJson(parsed)) {
							animationContent = unzipped[key];
							break;
						}
					} catch {
						// Continue searching
					}
				}
			}

			if (animationContent) {
				const text = strFromU8(animationContent);
				const parsed = JSON.parse(text);
				if (!isLottieJson(parsed)) {
					throw new Error(
						"Extracted file from .lottie archive is not a valid Lottie animation",
					);
				}

				const newBuffer = Buffer.from(text);
				let newFilename = filename;
				if (/\.lottie$/i.test(newFilename)) {
					newFilename = newFilename.replace(/\.lottie$/i, ".json");
				} else if (/\.zip$/i.test(newFilename)) {
					newFilename = newFilename.replace(/\.zip$/i, ".json");
				} else if (!/\.json$/i.test(newFilename)) {
					newFilename = `${newFilename}.json`;
				}

				return {
					buffer: newBuffer,
					filename: newFilename,
					contentType: "application/json",
				};
			}
			if (isLottieExt || isLottieMime) {
				throw new Error(
					"No valid Lottie animation JSON file found inside .lottie archive",
				);
			}
		} catch (error: unknown) {
			if (isLottieExt || isLottieMime) {
				const msg = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to process .lottie file: ${msg}`);
			}
		}
	}

	if (
		isJsonExt ||
		mimeType === "application/json" ||
		mimeType === "text/json"
	) {
		try {
			const text = buffer.toString("utf-8");
			const parsed = JSON.parse(text);
			if (!isLottieJson(parsed)) {
				throw new Error(
					"Not a valid Lottie animation (missing 'layers' array or animation structure)",
				);
			}
			return {
				buffer,
				filename,
				contentType: "application/json",
			};
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSON Lottie file: ${msg}`);
		}
	}

	return {
		buffer,
		filename,
		contentType: mimeType ?? "application/octet-stream",
	};
}

export function extractCaptionDuration(buffer: Buffer): number | null {
	try {
		const str = buffer.toString("utf-8");
		const regex = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/g;
		let maxTimeSec = 0;
		for (const match of str.matchAll(regex)) {
			const hours = parseInt(match[1], 10);
			const minutes = parseInt(match[2], 10);
			const seconds = parseInt(match[3], 10);
			const ms = parseInt(match[4], 10);
			const timeSec = hours * 3600 + minutes * 60 + seconds + ms / 1000;
			if (timeSec > maxTimeSec) {
				maxTimeSec = timeSec;
			}
		}
		return maxTimeSec > 0 ? maxTimeSec : null;
	} catch {
		return null;
	}
}

export async function resolveDataType(
	contentType: string,
	filename: string,
	buffer?: Buffer,
): Promise<SupportedDataType> {
	const ext = filename.toLowerCase().split(".").pop();
	if (ext === "cube") return "LUT";
	if (contentType === "image/svg+xml") return "SVG";
	if (contentType === "image/gif" || ext === "gif") return "GIF";

	if (contentType === "image/webp" || ext === "webp") {
		if (buffer) {
			try {
				const metadata = await sharp(buffer).metadata();
				const pages = metadata.pages || 1;
				if (pages > 1) {
					return "GIF";
				}
			} catch (error) {
				logger.error({ err: error }, "Failed to detect WebP animation");
			}
		}
		return "Image";
	}

	if (contentType.startsWith("image/")) return "Image";
	if (contentType.startsWith("video/")) return "Video";
	if (contentType.startsWith("audio/")) return "Audio";

	if (ext === "srt" || contentType === "text/srt") {
		return "Caption";
	}

	if (
		contentType === "application/json" ||
		contentType === "text/json" ||
		ext === "json" ||
		ext === "lottie"
	) {
		return "Lottie";
	}

	throw new Error(`Unsupported content type: ${contentType}`);
}

export interface MediaMetadata {
	width: number | null;
	height: number | null;
	durationInSec: number | null;
	fps: number | null;
	sampleRate?: number | null;
	channels?: number | null;
	bitDepth?: number | null;
	audioCodec?: string | null;
	audioBitrate?: number | null;
}

async function extractImageDimensions(
	buffer: Buffer,
): Promise<{ width: number; height: number }> {
	let metaWidth: number | null | undefined;
	let metaHeight: number | null | undefined;
	let hasMediaService = false;

	try {
		if (
			container &&
			typeof container.isBound === "function" &&
			container.isBound(TOKENS.MEDIA)
		) {
			const media = container.get<MediaService>(TOKENS.MEDIA);
			if (media) {
				hasMediaService = true;
				const meta = await media.getImageDimensions(buffer);
				metaWidth = meta?.width;
				metaHeight = meta?.height;
			}
		}
	} catch {
		// If media service threw, allow fallback to sharp
	}

	if (!hasMediaService && (metaWidth == null || metaHeight == null)) {
		const metadata = await sharp(buffer).metadata();
		metaWidth = metadata.width;
		metaHeight = metadata.height;
	}

	if (metaWidth == null || metaHeight == null) {
		throw new Error("Failed to extract image dimensions");
	}

	return { width: metaWidth, height: metaHeight };
}

function extractSvgDimensionsSafe(buffer: Buffer): {
	width: number;
	height: number;
} {
	try {
		const dim = extractSvgDimensions(buffer);
		const w = dim?.w || 0;
		const h = dim?.h || 0;
		if (w === 0 || h === 0) {
			return { width: 1080, height: 1080 };
		}
		return { width: w, height: h };
	} catch (error) {
		logger.error({ err: error }, "Failed to extract SVG dimensions");
		return { width: 1080, height: 1080 };
	}
}

async function extractVideoDetails(
	mediaSource: Buffer | string,
): Promise<Partial<MediaMetadata>> {
	const meta = await getVideoMetadata(mediaSource);
	if (!meta) {
		throw new Error("Failed to extract video metadata");
	}

	const width = meta.width;
	const height = meta.height;
	let durationInSec = meta.duration;
	let fps = meta.fps;

	if (durationInSec === 0 || fps === 0) {
		const fallback = await calculateFallbackMetadata(mediaSource);
		if (fallback && fallback.duration > 0) {
			durationInSec = fallback.duration;
			if (fps === 0 || Number.isNaN(fps)) fps = fallback.fps;
		}
	}

	if (width === 0 || height === 0 || durationInSec === 0 || fps === 0) {
		throw new Error(
			`Incomplete video metadata: width=${width}, height=${height}, duration=${durationInSec}, fps=${fps}`,
		);
	}

	const audioDetails = await getAudioDetails(mediaSource);

	return {
		width,
		height,
		durationInSec,
		fps,
		sampleRate: audioDetails?.sampleRate ?? null,
		channels: audioDetails?.channels ?? null,
		bitDepth: audioDetails?.bitDepth ?? null,
		audioCodec: audioDetails?.audioCodec ?? null,
		audioBitrate: audioDetails?.audioBitrate ?? null,
	};
}

async function extractAudioDetails(
	mediaSource: Buffer | string,
	contentType: string,
): Promise<Partial<MediaMetadata>> {
	let durationInSec = await getMediaDuration(mediaSource, contentType);

	if (durationInSec == null || durationInSec === 0) {
		const fallback = await calculateFallbackMetadata(mediaSource);
		if (fallback && fallback.duration > 0) {
			durationInSec = fallback.duration;
		}
	}

	if (durationInSec == null || durationInSec === 0) {
		throw new Error("Failed to extract audio duration");
	}

	const audioDetails = await getAudioDetails(mediaSource);

	return {
		durationInSec,
		sampleRate: audioDetails?.sampleRate ?? null,
		channels: audioDetails?.channels ?? null,
		bitDepth: audioDetails?.bitDepth ?? null,
		audioCodec: audioDetails?.audioCodec ?? null,
		audioBitrate: audioDetails?.audioBitrate ?? null,
	};
}

function extractLottieDetails(buffer: Buffer): Partial<MediaMetadata> {
	try {
		let lottieBuffer = buffer;
		if (
			lottieBuffer.length >= 4 &&
			lottieBuffer[0] === 0x50 &&
			lottieBuffer[1] === 0x4b
		) {
			try {
				const processed = processAndValidateLottie(
					lottieBuffer,
					"animation.lottie",
				);
				lottieBuffer = processed.buffer;
			} catch (err) {
				logger.error(
					{ err },
					"Failed to extract JSON from .lottie zip in extractMediaMetadata",
				);
			}
		}

		const parsed = JSON.parse(lottieBuffer.toString("utf-8"));
		const width =
			typeof parsed.w === "number" ? parsed.w : Number(parsed.w) || null;
		const height =
			typeof parsed.h === "number" ? parsed.h : Number(parsed.h) || null;
		const fr =
			typeof parsed.fr === "number" ? parsed.fr : Number(parsed.fr) || null;
		const ip =
			typeof parsed.ip === "number" ? parsed.ip : Number(parsed.ip) || 0;
		const op =
			typeof parsed.op === "number" ? parsed.op : Number(parsed.op) || 0;
		let durationInSec: number | null = null;
		if (fr && fr > 0 && op > ip) {
			durationInSec = (op - ip) / fr;
		}

		return {
			width,
			height,
			fps: fr,
			durationInSec,
		};
	} catch (error) {
		logger.error({ err: error }, "Failed to extract Lottie metadata");
		return {};
	}
}

async function extractGifDetails(
	buffer: Buffer,
): Promise<Partial<MediaMetadata>> {
	try {
		const metadata = await sharp(buffer).metadata();
		const width = metadata.width || null;
		const height = metadata.height || null;
		const delay = metadata.delay;
		const pages = metadata.pages || 1;

		let durationInSec: number | null = null;
		let fps: number | null = null;

		if (delay && delay.length > 0) {
			const totalDelayMs = delay.reduce((acc, d) => acc + d, 0);
			durationInSec = totalDelayMs / 1000;
			fps = durationInSec > 0 ? Math.round(pages / durationInSec) : null;
		} else if (pages > 1) {
			durationInSec = (pages * 100) / 1000;
			fps = 10;
		}

		return { width, height, durationInSec, fps };
	} catch (error) {
		logger.error({ err: error }, "Failed to extract GIF metadata");
		return {};
	}
}

function extractLutDetails(buffer: Buffer): Partial<MediaMetadata> {
	let type: "1D" | "3D" = "3D";
	let size = 33;
	if (buffer) {
		const lines = buffer.toString("utf-8").split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("LUT_3D_SIZE")) {
				const parts = trimmed.split(/\s+/);
				const parsedSize = parseInt(parts[1], 10);
				if (!Number.isNaN(parsedSize)) {
					size = parsedSize;
					type = "3D";
				}
				break;
			}
			if (trimmed.startsWith("LUT_1D_SIZE")) {
				const parts = trimmed.split(/\s+/);
				const parsedSize = parseInt(parts[1], 10);
				if (!Number.isNaN(parsedSize)) {
					size = parsedSize;
					type = "1D";
				}
				break;
			}
		}
	}
	return {
		width: size,
		height: type === "3D" ? 3 : 1,
	};
}

export async function extractMediaMetadata(
	bufferOrUrl: Buffer | string,
	contentType: string,
	dataType: SupportedDataType,
): Promise<MediaMetadata> {
	let buffer: Buffer;
	if (typeof bufferOrUrl === "string") {
		if (dataType !== "Video" && dataType !== "Audio") {
			const res = await fetch(bufferOrUrl);
			if (!res.ok) {
				throw new Error(`Failed to fetch media from URL: ${res.statusText}`);
			}
			buffer = Buffer.from(await res.arrayBuffer());
		} else {
			buffer = Buffer.alloc(0);
		}
	} else {
		buffer = bufferOrUrl;
	}

	const isUrl = typeof bufferOrUrl === "string";
	const mediaSource =
		isUrl && (dataType === "Video" || dataType === "Audio")
			? bufferOrUrl
			: buffer;

	const baseMeta: MediaMetadata = {
		width: null,
		height: null,
		durationInSec: null,
		fps: null,
		sampleRate: null,
		channels: null,
		bitDepth: null,
		audioCodec: null,
		audioBitrate: null,
	};

	let specificMeta: Partial<MediaMetadata> = {};

	switch (dataType) {
		case "Image": {
			const dims = await extractImageDimensions(buffer);
			specificMeta = { width: dims.width, height: dims.height };
			break;
		}
		case "SVG": {
			const dims = extractSvgDimensionsSafe(buffer);
			specificMeta = { width: dims.width, height: dims.height };
			break;
		}
		case "Video": {
			specificMeta = await extractVideoDetails(mediaSource);
			break;
		}
		case "Audio": {
			specificMeta = await extractAudioDetails(mediaSource, contentType);
			break;
		}
		case "Caption": {
			const captionDuration = extractCaptionDuration(buffer);
			specificMeta = { durationInSec: captionDuration };
			break;
		}
		case "Lottie": {
			specificMeta = extractLottieDetails(buffer);
			break;
		}
		case "GIF": {
			specificMeta = await extractGifDetails(buffer);
			break;
		}
		case "LUT": {
			specificMeta = extractLutDetails(buffer);
			break;
		}
	}

	return {
		...baseMeta,
		...specificMeta,
	};
}
