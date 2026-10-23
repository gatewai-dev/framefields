import {
	getActiveMediaMetadata,
	getMediaType,
	type VirtualMediaData,
} from "@framefields/core";
import { type AudioProcessor, audioRegistry } from "@framefields/node-sdk";
import { inputStore, shaderStore } from "@framefields/webgpu-renderers";
import { AudioSampleSink } from "mediabunny";
import { computeRenderParams } from "./apply-operations.js";
import { normalizeTimeline } from "./normalization.js";

// Progress chatter (every decode step) is debug output: shown only with LOG_LEVEL=debug or trace.
const verbose =
	typeof process !== "undefined" &&
	/^(debug|trace)$/i.test(process.env?.LOG_LEVEL ?? "");

const mediaLogger = {
	debug: (msg: unknown, ...args: unknown[]) => {
		if (!verbose) return;
		if (typeof msg === "object" && msg !== null) {
			console.info("[AudioExtractor]", msg, ...args);
		} else {
			console.info(`[AudioExtractor] ${msg}`, ...args);
		}
	},
	warn: (msg: unknown, ...args: unknown[]) => {
		if (typeof msg === "object" && msg !== null) {
			console.warn("[AudioExtractor]", msg, ...args);
		} else {
			console.warn(`[AudioExtractor] ${msg}`, ...args);
		}
	},
	error: (msg: unknown, ...args: unknown[]) => {
		if (typeof msg === "object" && msg !== null) {
			console.error("[AudioExtractor]", msg, ...args);
		} else {
			console.error(`[AudioExtractor] ${msg}`, ...args);
		}
	},
};

const yieldToMain = (): Promise<void> => {
	if (typeof window === "undefined") {
		return Promise.resolve();
	}
	const sched = (globalThis as Record<string, unknown>).scheduler as
		| { yield?: () => Promise<void> }
		| undefined;
	return typeof sched?.yield === "function"
		? sched.yield()
		: new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const waitForDelayRender = async (timeoutMs = 30_000): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, 100));

	const start = Date.now();
	return new Promise<void>((resolve) => {
		const check = () => {
			const browserHandles: unknown[] =
				typeof window !== "undefined" &&
				(window as unknown as { renderer_delayRenderHandles?: unknown[] })
					.renderer_delayRenderHandles
					? (
							window as unknown as {
								renderer_delayRenderHandles: unknown[];
							}
						).renderer_delayRenderHandles
					: [];

			const globalDelays =
				typeof globalThis !== "undefined"
					? (globalThis as any).__GATEWAI_DELAYS__
					: null;

			const hasBrowserDelays = browserHandles.length > 0;
			const hasGlobalDelays =
				globalDelays instanceof Set && globalDelays.size > 0;

			if (!hasBrowserDelays && !hasGlobalDelays) {
				resolve();
				return;
			}

			if (Date.now() - start > timeoutMs) {
				mediaLogger.warn(
					`[AudioExtractor] waitForDelayRender timed out waiting for handles: ${JSON.stringify(
						{
							browserHandles,
							globalDelays: globalDelays ? Array.from(globalDelays) : [],
						},
					)}`,
				);
				resolve();
				return;
			}

			setTimeout(check, 50);
		};
		check();
	});
};

export interface AudioClip {
	sourceUrl: string;
	destStartFrame: number;
	trimStartSec: number;
	durationFrames: number;
	speed: number;
	volume: number;
}

/**
 * Decodes all audio samples from a given source URL into raw Float32 mono/stereo channel buffers.
 */
export async function decodeAudioSource(
	url: string,
): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
	const decoded = await decodeAudioRange(url);
	return decoded
		? { channels: decoded.channels, sampleRate: decoded.sampleRate }
		: null;
}

/**
 * Seconds decoded ahead of a requested range: a compressed stream (MP3, AAC)
 * decoded from mid-file only matches a whole-file decode once the decoder has
 * warmed up on the packets before it.
 */
const DECODE_PREROLL_SEC = 0.5;

/**
 * A decoded stretch of a source. `channels[c][i]` is sample `startIndex + i`
 * of a whole-file decode, so callers index it as they would the whole file.
 * Samples in [validFromSec, validToSec) match a whole-file decode exactly.
 */
interface DecodedAudioRange {
	channels: Float32Array[];
	sampleRate: number;
	startIndex: number;
	validFromSec: number;
	validToSec: number;
}

/**
 * Decodes [range.startSec, range.endSec) of a source (the whole file without
 * a range), so a short clip from a long file decodes only what it plays.
 */
async function decodeAudioRange(
	url: string,
	range?: { startSec: number; endSec: number },
): Promise<DecodedAudioRange | null> {
	mediaLogger.debug(
		`[AudioExtractor] decodeAudioSource started for url: ${url}`,
	);
	try {
		const isBrowser =
			typeof window !== "undefined" &&
			typeof window.document !== "undefined" &&
			!(
				typeof process !== "undefined" &&
				process.versions &&
				process.versions.node
			);
		if (isBrowser) {
			mediaLogger.debug(
				`[AudioExtractor] Browser detected. Fetching arrayBuffer for ${url}...`,
			);
			const AudioContextClass =
				window.AudioContext || (window as any).webkitAudioContext;
			if (!AudioContextClass) {
				throw new Error("AudioContext is not supported in this browser");
			}
			const audioCtx = new AudioContextClass();
			try {
				const response = await fetch(url);
				mediaLogger.debug(
					`[AudioExtractor] Fetch response status for ${url}: ${response.status} (${response.statusText})`,
				);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch audio source: ${response.statusText}`,
					);
				}
				const arrayBuffer = await response.arrayBuffer();
				mediaLogger.debug(
					`[AudioExtractor] Fetched ${arrayBuffer.byteLength} bytes. Decoding audio data...`,
				);
				const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
				mediaLogger.debug(
					`[AudioExtractor] Decoded successfully: ${audioBuffer.numberOfChannels} channels, sampleRate: ${audioBuffer.sampleRate}, duration: ${audioBuffer.duration}s`,
				);

				const channels: Float32Array[] = [];
				for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
					channels.push(new Float32Array(audioBuffer.getChannelData(c)));
				}
				// decodeAudioData only decodes whole files.
				return {
					channels,
					sampleRate: audioBuffer.sampleRate,
					startIndex: 0,
					validFromSec: 0,
					validToSec: Number.POSITIVE_INFINITY,
				};
			} finally {
				void audioCtx.close();
				mediaLogger.debug(`[AudioExtractor] AudioContext closed for ${url}`);
			}
		}

		let inputAcquired = false;
		try {
			mediaLogger.debug(
				`[AudioExtractor] Server / Node.js detected. Acquiring from inputStore for ${url}...`,
			);
			const input = await inputStore.acquire(url);
			inputAcquired = true;
			mediaLogger.debug(
				`[AudioExtractor] inputStore acquired. Retrieving primary audio track...`,
			);
			const track = await input.getPrimaryAudioTrack();
			if (!track) {
				mediaLogger.warn(
					`[AudioExtractor] No primary audio track found in input for ${url}`,
				);
				return null;
			}

			const sink = new AudioSampleSink(track);
			const decodeFromSec = range
				? Math.max(0, range.startSec - DECODE_PREROLL_SEC)
				: 0;
			const generator = sink.samples(decodeFromSec, range?.endSec);

			const decodedPlanes: Float32Array[][] = [];
			let totalFrames = 0;
			let sampleRate = 48000;
			let numChannels = 1;
			let firstTimestamp: number | null = null;

			mediaLogger.debug(
				`[AudioExtractor] Starting mediabunny generator loop for ${url}...`,
			);
			for await (const sample of generator) {
				if (firstTimestamp === null) firstTimestamp = sample.timestamp;
				sampleRate = sample.sampleRate;
				numChannels = sample.numberOfChannels;
				const sampleFrames = sample.numberOfFrames;

				if (decodedPlanes.length === 0) {
					for (let c = 0; c < numChannels; c++) {
						decodedPlanes.push([]);
					}
				}

				for (let c = 0; c < numChannels; c++) {
					let planeBuffer: Float32Array;
					try {
						const allocSize = sample.allocationSize({
							planeIndex: c,
							format: "f32-planar",
						});
						planeBuffer = new Float32Array(allocSize / 4);
						sample.copyTo(planeBuffer, {
							planeIndex: c,
							format: "f32-planar",
						});
					} catch {
						// Fallback: copy in sample's native format and normalize to float32 [-1, 1]
						const allocSize = sample.allocationSize({ planeIndex: c });
						if (sample.format === "s16" || sample.format === "s16-planar") {
							const int16Buffer = new Int16Array(allocSize / 2);
							sample.copyTo(int16Buffer, { planeIndex: c });
							planeBuffer = new Float32Array(int16Buffer.length);
							for (let i = 0; i < int16Buffer.length; i++) {
								planeBuffer[i] = (int16Buffer[i] ?? 0) / 32768;
							}
						} else if (
							sample.format === "s32" ||
							sample.format === "s32-planar"
						) {
							const int32Buffer = new Int32Array(allocSize / 4);
							sample.copyTo(int32Buffer, { planeIndex: c });
							planeBuffer = new Float32Array(int32Buffer.length);
							for (let i = 0; i < int32Buffer.length; i++) {
								planeBuffer[i] = (int32Buffer[i] ?? 0) / 2147483648;
							}
						} else if (
							sample.format === "u8" ||
							sample.format === "u8-planar"
						) {
							const u8Buffer = new Uint8Array(allocSize);
							sample.copyTo(u8Buffer, { planeIndex: c });
							planeBuffer = new Float32Array(u8Buffer.length);
							for (let i = 0; i < u8Buffer.length; i++) {
								planeBuffer[i] = ((u8Buffer[i] ?? 128) - 128) / 128;
							}
						} else {
							planeBuffer = new Float32Array(allocSize / 4);
							sample.copyTo(planeBuffer, { planeIndex: c });
						}
					}
					decodedPlanes[c].push(planeBuffer);
				}

				totalFrames += sampleFrames;
				sample.close();
			}
			mediaLogger.debug(
				`[AudioExtractor] Generator loop finished. Decoded total frames: ${totalFrames}`,
			);

			if (totalFrames === 0 || decodedPlanes.length === 0) {
				return null;
			}

			const channels = decodedPlanes.map((planes) => {
				const merged = new Float32Array(totalFrames);
				let offset = 0;
				for (const plane of planes) {
					merged.set(plane, offset);
					offset += plane.length;
				}
				return merged;
			});

			// A whole-file decode starts at the sample samples(0) yields first;
			// a range is placed on that same index.
			let startIndex = 0;
			if (decodeFromSec > 0 && firstTimestamp !== null) {
				const origin = await sink.getSample(0);
				const originTimestamp =
					origin?.timestamp ?? (await track.getFirstTimestamp());
				origin?.close();
				startIndex = Math.round(
					(firstTimestamp - originTimestamp) * sampleRate,
				);
			}
			const endedEarly =
				!range || (startIndex + totalFrames) / sampleRate < range.endSec;

			return {
				channels,
				sampleRate,
				startIndex,
				validFromSec: decodeFromSec > 0 && range ? range.startSec : 0,
				validToSec:
					endedEarly || !range ? Number.POSITIVE_INFINITY : range.endSec,
			};
		} catch (err) {
			if (
				err instanceof Error &&
				err.message.includes("Cannot open local media file")
			) {
				throw err;
			}
			if (typeof process !== "undefined" && process.versions?.node) {
				try {
					const { execFileSync } = await import("node:child_process");
					// ffmpeg's input -ss decodes from before the seek point and discards
					// up to it, so the range starts on an exact 48 kHz sample.
					const ffStartIndex = range
						? Math.round(Math.max(0, range.startSec) * 48000)
						: 0;
					const ffStartSec = ffStartIndex / 48000;
					const stdout = execFileSync(
						"ffmpeg",
						[
							"-v",
							"error",
							...(ffStartSec > 0 ? ["-ss", String(ffStartSec)] : []),
							"-i",
							url,
							...(range ? ["-t", String(range.endSec - ffStartSec)] : []),
							"-f",
							"f32le",
							"-ar",
							"48000",
							"-ac",
							"2",
							"pipe:1",
						],
						// 48 kHz stereo f32 is 384 KB/s: a fixed cap drops long sources.
						{ maxBuffer: Number.POSITIVE_INFINITY },
					);
					const totalSamples = stdout.byteLength / 4;
					const numFrames = totalSamples / 2;
					const interleaved = new Float32Array(
						stdout.buffer,
						stdout.byteOffset,
						totalSamples,
					);
					const left = new Float32Array(numFrames);
					const right = new Float32Array(numFrames);
					for (let i = 0; i < numFrames; i++) {
						left[i] = interleaved[i * 2];
						right[i] = interleaved[i * 2 + 1];
					}
					const ffEndedEarly =
						!range || ffStartSec + numFrames / 48000 < range.endSec;
					return {
						channels: [left, right],
						sampleRate: 48000,
						startIndex: ffStartIndex,
						validFromSec: ffStartSec,
						validToSec:
							ffEndedEarly || !range ? Number.POSITIVE_INFINITY : range.endSec,
					};
				} catch (ffmpegErr) {
					mediaLogger.warn(
						{ ffmpegErr },
						`[AudioExtractor] ffmpeg fallback decode failed for ${url}`,
					);
				}
			}
			mediaLogger.error(
				{ err },
				`[AudioExtractor] Failed to decode source ${url}`,
			);
			return null;
		} finally {
			if (inputAcquired) {
				inputStore.release(url);
			}
		}
	} catch (err) {
		if (
			err instanceof Error &&
			err.message.includes("Cannot open local media file")
		) {
			throw err;
		}
		mediaLogger.error(
			{ err },
			`[AudioExtractor] Failed to decode source ${url}`,
		);
		return null;
	}
}

/**
 * Resamples a PCM buffer using linear interpolation to target sample rate & speed.
 * `trimOffsetSamples` is a whole-file index; `inputStartIndex` is the
 * whole-file index of `inputChannel[0]` when it holds only a range.
 */
async function resampleAndStretchPCM(
	inputChannel: Float32Array,
	sourceSampleRate: number,
	targetSampleRate: number,
	speed: number,
	outputLength: number,
	trimOffsetSamples: number,
	inputStartIndex = 0,
): Promise<Float32Array> {
	const output = new Float32Array(outputLength);
	const resampleRatio = sourceSampleRate / targetSampleRate;
	const factor = resampleRatio * speed;

	const YIELD_INTERVAL = 100_000;

	for (let i = 0; i < outputLength; i++) {
		if (i > 0 && i % YIELD_INTERVAL === 0) {
			await yieldToMain();
		}
		// Subtracting the integer start after the sum keeps the position exact,
		// so a range resamples bit-for-bit as the whole file would.
		const srcIndex = trimOffsetSamples + i * factor - inputStartIndex;
		const indexFloor = Math.floor(srcIndex);
		const indexCeil = Math.ceil(srcIndex);

		if (indexFloor < 0) {
			output[i] = 0;
			continue;
		}
		if (indexFloor >= inputChannel.length) {
			break; // Out of bounds of source media
		}

		const weight = srcIndex - indexFloor;
		const sampleFloor = inputChannel[indexFloor] ?? 0;
		const sampleCeil =
			indexCeil >= 0 && indexCeil < inputChannel.length
				? (inputChannel[indexCeil] ?? sampleFloor)
				: sampleFloor;

		const val = sampleFloor + weight * (sampleCeil - sampleFloor);
		output[i] = Number.isFinite(val) ? val : 0;
	}

	return output;
}

/** Seconds decoded past a clip's last source sample, for interpolation. */
const RANGE_MARGIN_SEC = 0.05;

/** Processors that only scale what is already there, so silence stays silence. */
const GAIN_ONLY_PROCESSORS = new Set(["Compositor", "CompositorLayer"]);

/** Adds `src` into `dest` starting at `destStart` (which may be negative). */
function addInto(dest: Float32Array, src: Float32Array, destStart: number) {
	const from = Math.max(0, -destStart);
	const to = Math.min(src.length, dest.length - destStart);
	for (let i = from; i < to; i++) {
		dest[destStart + i] += src[i];
	}
}

/**
 * A node's stereo mix, allocated on first write. A child that covers the
 * whole bus while it is still silent is taken over instead of copied (adding
 * into silence changes nothing), so a chain of single-child nodes passes one
 * buffer up instead of allocating and summing a full-length copy per level.
 */
class MixBus {
	channels: Float32Array[] | null = null;

	constructor(readonly length: number) {}

	/** The bus channels, allocated (silent) if nothing was written yet. */
	get(): Float32Array[] {
		this.channels ??= [
			new Float32Array(this.length),
			new Float32Array(this.length),
		];
		return this.channels;
	}

	/** Whether `src` written at `start` could replace the bus outright. */
	canAdopt(src: Float32Array[], start: number): boolean {
		return (
			this.channels === null &&
			start === 0 &&
			src.every((ch) => ch.length === this.length)
		);
	}

	/** Mixes `src` into the bus starting at sample `start`. */
	add(src: Float32Array[], start: number): void {
		if (this.canAdopt(src, start) && src[0] !== src[1]) {
			this.channels = src;
			return;
		}
		const dest = this.get();
		for (let c = 0; c < 2; c++) {
			addInto(dest[c], src[c], start);
		}
	}
}

/** Progress reported by `mixAudioTracks` as each audio or video clip is mixed. */
export interface AudioMixProgress {
	/** Clips mixed so far. */
	done: number;
	/** Audio and video clips in the tree; muted or empty ones may be skipped. */
	total: number;
	/** File name of the clip just mixed (no directory or query string). */
	source?: string;
}

export interface MixAudioOptions {
	onProgress?: (progress: AudioMixProgress) => void;
}

/** A clip's file name for progress, without paths or signed-URL queries. */
function sourceLabel(url: string): string {
	if (url.startsWith("data:")) return "inline audio";
	const name = url.split(/[?#]/)[0].split(/[\\/]/).pop();
	return name ? decodeURIComponentSafe(name) : "audio";
}

function decodeURIComponentSafe(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/**
 * Recursively parses the VirtualMediaData tree and mixes all active audio tracks
 * into a single unified stereo PCM stream (Float32Array channels).
 */
export async function mixAudioTracks(
	virtualMedia: VirtualMediaData,
	fps: number,
	targetSampleRate = 48000,
	device?: GPUDevice,
	renderId?: string,
	options: MixAudioOptions = {},
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
	mediaLogger.debug(
		`[AudioExtractor] mixAudioTracks started. FPS: ${fps}, targetSampleRate: ${targetSampleRate}`,
	);
	await waitForDelayRender();

	// Register all signals from the composition tree
	shaderStore.registerSignalsFromComposition(renderId, virtualMedia);

	const durationMs = getActiveMediaMetadata(virtualMedia)?.durationMs || 1000;
	const totalDurationSec = durationMs / 1000;
	const totalTargetSamples = Math.ceil(totalDurationSec * targetSampleRate);
	mediaLogger.debug(
		`[AudioExtractor] Composition total duration: ${durationMs}ms (${totalDurationSec}s). Total mixed samples to allocate: ${totalTargetSamples}`,
	);

	// Decoded ranges per source, so clips sharing a stretch of a file decode it once
	const decodedCache = new Map<string, DecodedAudioRange[]>();
	const undecodable = new Set<string>();

	async function getDecodedRange(
		url: string,
		startSec: number,
		endSec: number,
	): Promise<DecodedAudioRange | null> {
		if (undecodable.has(url)) return null;
		let ranges = decodedCache.get(url);
		const hit = ranges?.find(
			(r) => r.validFromSec <= startSec && r.validToSec >= endSec,
		);
		if (hit) return hit;
		const decoded = await decodeAudioRange(url, { startSec, endSec });
		if (!decoded) {
			undecodable.add(url);
			return null;
		}
		if (!ranges) {
			ranges = [];
			decodedCache.set(url, ranges);
		}
		ranges.push(decoded);
		return decoded;
	}

	// A subtree without a source or a sound-producing processor mixes to
	// silence (text, images, shapes), so it is skipped instead of being
	// allocated, processed and summed at full length.
	const audibleCache = new WeakMap<VirtualMediaData, boolean>();
	function isAudible(node: VirtualMediaData): boolean {
		const cached = audibleCache.get(node);
		if (cached !== undefined) return cached;
		const op = node.operation;
		let audible = false;
		if (op?.op === "source") {
			const mediaType = getMediaType(node);
			audible = mediaType === "Audio" || mediaType === "Video";
		} else if (
			op?.op &&
			!GAIN_ONLY_PROCESSORS.has(op.op) &&
			audioRegistry.get(op.op)
		) {
			audible = true;
		}
		if (!audible && node.children) {
			audible = node.children.some((child) => child && isAudible(child));
		}
		audibleCache.set(node, audible);
		return audible;
	}

	async function traverse(
		node: VirtualMediaData,
		inheritedSeekSec: number,
		inheritedClockFrames: number,
		inheritedVolume: number,
		inheritedSpeed: number,
		inheritedDurationFrames: number | null,
	): Promise<Float32Array[] | null> {
		if (!node || !isAudible(node)) return null;
		const op = node.operation;
		if (!op) {
			const durationMs = getActiveMediaMetadata(node)?.durationMs ?? 0;
			const durationFrames = Math.round((durationMs / 1000) * fps);
			const actualDurationFrames =
				inheritedDurationFrames !== null
					? durationFrames > 0
						? Math.min(inheritedDurationFrames, durationFrames)
						: inheritedDurationFrames
					: durationFrames;

			const localSamplesCount = Math.ceil(
				(actualDurationFrames / fps) * targetSampleRate,
			);
			if (localSamplesCount <= 0) return null;

			const bus = new MixBus(localSamplesCount);

			for (const child of node.children) {
				const childChannels = await traverse(
					child,
					inheritedSeekSec,
					inheritedClockFrames,
					inheritedVolume,
					inheritedSpeed,
					actualDurationFrames,
				);
				if (childChannels) {
					const childOp = child.operation;
					const childStartFrame =
						childOp?.startFrame ?? childOp?.timeline?.startFrame ?? 0;
					const childStartSample = Math.round(
						(childStartFrame / fps) * targetSampleRate,
					);
					bus.add(childChannels, childStartSample);
				}
			}
			return bus.channels;
		}

		const volume =
			inheritedVolume *
			(op.volume ?? 1) *
			(op.opacity === 0 ? 0 : 1) *
			((op as Record<string, unknown>).muted ? 0 : 1);
		const speedMultiplier = inheritedSpeed;

		const nodeStartFrame = op.startFrame ?? op.timeline?.startFrame ?? 0;
		const localClockFrames = inheritedClockFrames + nodeStartFrame;

		const segments = op.timeline?.segments || [];

		// A layer's in-point: the source second that plays at its startFrame.
		// Resolved as the compositor resolves it for the picture, so a clip's
		// sound stays on its frames.
		const layer = op as {
			op: string;
			mediaStartFrame?: number;
			trimStartFrames?: number;
			trimStartSec?: number;
		};
		const layerTrimSec =
			layer.op === "CompositorLayer"
				? (layer.mediaStartFrame ?? layer.trimStartFrames ?? null) !== null
					? (layer.mediaStartFrame ?? layer.trimStartFrames ?? 0) / fps
					: Math.round((layer.trimStartSec ?? 0) * fps) / fps
				: 0;

		const nodeDurationMs = getActiveMediaMetadata(node)?.durationMs ?? 0;
		const nodeDurationFrames = Math.round((nodeDurationMs / 1000) * fps);
		const nodeActualDurationFrames =
			inheritedDurationFrames !== null
				? nodeDurationFrames > 0
					? Math.min(inheritedDurationFrames, nodeDurationFrames)
					: inheritedDurationFrames
				: nodeDurationFrames;
		const localSamplesCount = Math.ceil(
			(nodeActualDurationFrames / fps) * targetSampleRate,
		);
		if (localSamplesCount <= 0) return null;

		const bus = new MixBus(localSamplesCount);

		const processSegment = async (
			seg: { startSec: number; endSec?: number } | null,
			windowStartFrameOffset: number,
		) => {
			const segSeekSec = seg ? seg.startSec : 0;
			const totalSeekSec = inheritedSeekSec + layerTrimSec + segSeekSec;
			const totalClockFrames = localClockFrames + windowStartFrameOffset;

			let segDurationFrames = 0;
			if (seg) {
				segDurationFrames = Math.max(
					1,
					Math.round(((seg.endSec ?? 0) - seg.startSec) * fps),
				);
			} else {
				segDurationFrames = nodeDurationFrames;
			}

			const actualDurationFrames =
				inheritedDurationFrames !== null
					? Math.min(inheritedDurationFrames, segDurationFrames)
					: segDurationFrames;

			const segmentStartSample = Math.round(
				(windowStartFrameOffset / fps) * targetSampleRate,
			);

			// If we are on a source clip (audio/video file)
			if (op.op === "source") {
				const mediaType = getMediaType(node);
				const params = computeRenderParams(node);
				if (
					params.sourceUrl &&
					(mediaType === "Audio" || mediaType === "Video") &&
					volume > 0
				) {
					const finalSpeed = Math.max(
						0.5,
						speedMultiplier * (Number(params.speed) || 1),
					);
					const effectiveTrimSec = Math.max(
						0,
						(Number(params.trimStartSec) || 0) + totalSeekSec,
					);

					const clipDurationSec = actualDurationFrames / fps;
					const clipSamplesCount = Math.min(
						localSamplesCount - segmentStartSample,
						Math.ceil(clipDurationSec * targetSampleRate),
					);

					// Decode (or reuse) only the stretch of the source this clip plays
					const decoded =
						clipSamplesCount > 0 && segmentStartSample < localSamplesCount
							? await getDecodedRange(
									params.sourceUrl,
									effectiveTrimSec,
									effectiveTrimSec +
										(clipSamplesCount / targetSampleRate) * finalSpeed +
										RANGE_MARGIN_SEC,
								)
							: null;

					if (decoded) {
						const trimOffsetSamples = Math.round(
							effectiveTrimSec * decoded.sampleRate,
						);

						// Resample left & right channels
						const stretchedLeft = await resampleAndStretchPCM(
							decoded.channels[0],
							decoded.sampleRate,
							targetSampleRate,
							finalSpeed,
							clipSamplesCount,
							trimOffsetSamples,
							decoded.startIndex,
						);

						// A mono source plays the same samples on both sides
						const stretchedRight =
							decoded.channels.length > 1
								? await resampleAndStretchPCM(
										decoded.channels[1],
										decoded.sampleRate,
										targetSampleRate,
										finalSpeed,
										clipSamplesCount,
										trimOffsetSamples,
										decoded.startIndex,
									)
								: stretchedLeft;

						const stretched = [stretchedLeft, stretchedRight];
						if (bus.canAdopt(stretched, segmentStartSample)) {
							// The clip fills the silent bus: scale it in place and keep it
							if (volume !== 1) {
								for (let i = 0; i < clipSamplesCount; i++) {
									stretchedLeft[i] *= volume;
								}
								if (stretchedRight !== stretchedLeft) {
									for (let i = 0; i < clipSamplesCount; i++) {
										stretchedRight[i] *= volume;
									}
								}
							}
							bus.channels = [
								stretchedLeft,
								stretchedRight === stretchedLeft
									? stretchedLeft.slice()
									: stretchedRight,
							];
						} else {
							// Add to local mix with volume scaling
							const [localLeft, localRight] = bus.get();
							for (let i = 0; i < clipSamplesCount; i++) {
								const outIndex = segmentStartSample + i;
								localLeft[outIndex] += stretchedLeft[i] * volume;
								localRight[outIndex] += stretchedRight[i] * volume;
							}
						}
					}
					await yieldToMain();
				}
				if (mediaType === "Audio" || mediaType === "Video") {
					clipsDone++;
					options.onProgress?.({
						done: clipsDone,
						total: clipsTotal,
						...(params.sourceUrl && { source: sourceLabel(params.sourceUrl) }),
					});
				}
			}

			// Traverse children recursively
			if (node.children) {
				for (const child of node.children) {
					const childChannels = await traverse(
						child,
						totalSeekSec,
						totalClockFrames,
						volume,
						speedMultiplier,
						actualDurationFrames,
					);
					if (childChannels) {
						const childOp = child.operation;
						const childStartFrame =
							childOp?.startFrame ?? childOp?.timeline?.startFrame ?? 0;
						const childStartSample = Math.round(
							(childStartFrame / fps) * targetSampleRate,
						);
						bus.add(childChannels, segmentStartSample + childStartSample);
					}
				}
			}

			// -- Plugin Processing Hook --
			const pluginProcessor = audioRegistry.get(op.op) as AudioProcessor | null;
			if (pluginProcessor) {
				try {
					const clipDurationSec = actualDurationFrames / fps;
					const clipSamplesCount = Math.min(
						localSamplesCount - segmentStartSample,
						Math.ceil(clipDurationSec * targetSampleRate),
					);

					if (
						clipSamplesCount > 0 &&
						segmentStartSample < localSamplesCount &&
						segmentStartSample >= 0
					) {
						const slicedChannels = bus
							.get()
							.map((ch) =>
								ch.subarray(
									segmentStartSample,
									segmentStartSample + clipSamplesCount,
								),
							);
						// The layer's own clock: its in-point moves the source, not its
						// animation, and a CompositorLayer's keyframes count from its
						// own first frame (as its picture's do), not the composition's.
						const layerClockFrames =
							op.op === "CompositorLayer" ? localClockFrames : 0;
						const elapsedMs =
							((totalClockFrames - layerClockFrames) / fps +
								totalSeekSec -
								layerTrimSec) *
							1000;
						const durationMs =
							getActiveMediaMetadata(node)?.durationMs ?? undefined;
						await pluginProcessor(slicedChannels, targetSampleRate, node, {
							device,
							frame: totalClockFrames,
							fps,
							renderId,
							elapsedMs,
							durationMs,
						});
					}
				} catch (pluginErr) {
					mediaLogger.error(
						{ err: pluginErr },
						`[AudioExtractor] Custom plugin for operation '${op.op}' failed`,
					);
				}
			}
		};

		if (segments.length > 0) {
			let currentStart = 0;
			for (const seg of segments) {
				const durSec = (seg.endSec ?? 0) - seg.startSec;
				const durFrames = Math.max(1, Math.round(durSec * fps));
				await processSegment(seg, currentStart);
				currentStart += durFrames;
			}
		} else {
			await processSegment(null, 0);
		}

		return bus.channels;
	}

	const normalized = normalizeTimeline(virtualMedia, fps);

	// Clips to mix, for progress: one per segment of each audio or video source.
	let clipsTotal = 0;
	let clipsDone = 0;
	if (options.onProgress) {
		const count = (node: VirtualMediaData | undefined) => {
			if (!node) return;
			const op = node.operation;
			if (op?.op === "source") {
				const mediaType = getMediaType(node);
				if (mediaType === "Audio" || mediaType === "Video") {
					clipsTotal += Math.max(1, op.timeline?.segments?.length ?? 0);
				}
			}
			for (const child of node.children ?? []) count(child);
		};
		count(normalized);
		options.onProgress({ done: 0, total: clipsTotal });
	}

	const rootChannels = await traverse(normalized, 0, 0, 1, 1, null);

	// Output mixed buffer is stereo; a root mix of the same length is used as is
	const mixedChannels =
		rootChannels?.every((ch) => ch.length === totalTargetSamples) &&
		rootChannels[0] !== rootChannels[1]
			? rootChannels
			: [
					new Float32Array(totalTargetSamples),
					new Float32Array(totalTargetSamples),
				];
	const [outputLeft, outputRight] = mixedChannels;
	if (rootChannels && mixedChannels !== rootChannels) {
		for (let c = 0; c < 2; c++) {
			const dest = mixedChannels[c];
			const src = rootChannels[c];
			const len = Math.min(src.length, dest.length);
			for (let i = 0; i < len; i++) {
				dest[i] = src[i];
			}
		}
	}

	// Clear decoder cache
	decodedCache.clear();

	// Calculate master mix peak across all channels to prevent multi-track summation distortion
	let mixPeak = 0;
	for (let i = 0; i < totalTargetSamples; i++) {
		const l = Math.abs(outputLeft[i] ?? 0);
		const r = Math.abs(outputRight[i] ?? 0);
		if (l > mixPeak) mixPeak = l;
		if (r > mixPeak) mixPeak = r;
	}

	// Automatic gain ceiling: if multi-track summation exceeds -0.5 dB (0.95), scale smoothly
	const autoGain = mixPeak > 0.95 ? 0.92 / mixPeak : 1.0;

	// Soft-knee limiting & non-finite float sanitation (transparent saturation instead of harsh square-wave clipping)
	for (let i = 0; i < totalTargetSamples; i++) {
		const l = (outputLeft[i] ?? 0) * autoGain;
		const r = (outputRight[i] ?? 0) * autoGain;
		outputLeft[i] = Number.isFinite(l) ? Math.tanh(l) : 0;
		outputRight[i] = Number.isFinite(r) ? Math.tanh(r) : 0;
	}

	return {
		channels: mixedChannels,
		sampleRate: targetSampleRate,
	};
}
