import {
	getActiveMediaMetadata,
	getMediaType,
	type VirtualMediaData,
} from "@gitframes/core";
import { type AudioProcessor, audioRegistry } from "@gitframes/node-sdk";
import { inputStore, shaderStore } from "@gitframes/webgpu-renderers";
import { AudioSampleSink } from "mediabunny";
import { computeRenderParams } from "./apply-operations.js";
import { normalizeTimeline } from "./normalization.js";

// Progress chatter (every decode step) is debug output: shown only with LOG_LEVEL=debug or trace.
const verbose =
	typeof process !== "undefined" &&
	/^(debug|trace)$/i.test(process.env?.LOG_LEVEL ?? "");

// Fallback logger for browser environment. In Node.js environment, we dynamically load @gitframes/server-utils to avoid bundling it on the frontend.
let mediaLogger = {
	info: (msg: unknown, ...args: unknown[]) => {
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

if (
	typeof window === "undefined" ||
	(typeof process !== "undefined" && process.versions?.node)
) {
	import(/* webpackIgnore: true */ /* @vite-ignore */ "@gitframes/server-utils")
		.then((m) => {
			if (m.mediaLogger) {
				mediaLogger = m.mediaLogger;
			}
		})
		.catch(() => {});
}

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
	mediaLogger.info(
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
			mediaLogger.info(
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
				mediaLogger.info(
					`[AudioExtractor] Fetch response status for ${url}: ${response.status} (${response.statusText})`,
				);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch audio source: ${response.statusText}`,
					);
				}
				const arrayBuffer = await response.arrayBuffer();
				mediaLogger.info(
					`[AudioExtractor] Fetched ${arrayBuffer.byteLength} bytes. Decoding audio data...`,
				);
				const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
				mediaLogger.info(
					`[AudioExtractor] Decoded successfully: ${audioBuffer.numberOfChannels} channels, sampleRate: ${audioBuffer.sampleRate}, duration: ${audioBuffer.duration}s`,
				);

				const channels: Float32Array[] = [];
				for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
					channels.push(new Float32Array(audioBuffer.getChannelData(c)));
				}
				return { channels, sampleRate: audioBuffer.sampleRate };
			} finally {
				void audioCtx.close();
				mediaLogger.info(`[AudioExtractor] AudioContext closed for ${url}`);
			}
		}

		let inputAcquired = false;
		try {
			mediaLogger.info(
				`[AudioExtractor] Server / Node.js detected. Acquiring from inputStore for ${url}...`,
			);
			const input = await inputStore.acquire(url);
			inputAcquired = true;
			mediaLogger.info(
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
			const generator = sink.samples(0);

			const decodedPlanes: Float32Array[][] = [];
			let totalFrames = 0;
			let sampleRate = 48000;
			let numChannels = 1;

			mediaLogger.info(
				`[AudioExtractor] Starting mediabunny generator loop for ${url}...`,
			);
			for await (const sample of generator) {
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
			mediaLogger.info(
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

			return { channels, sampleRate };
		} catch (err) {
			if (typeof process !== "undefined" && process.versions?.node) {
				try {
					const { execSync } = await import("node:child_process");
					const stdout = execSync(
						`ffmpeg -v error -i "${url}" -f f32le -ar 48000 -ac 2 pipe:1`,
						{ maxBuffer: 100 * 1024 * 1024 },
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
					return { channels: [left, right], sampleRate: 48000 };
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
		mediaLogger.error(
			{ err },
			`[AudioExtractor] Failed to decode source ${url}`,
		);
		return null;
	}
}

/**
 * Resamples a PCM buffer using linear interpolation to target sample rate & speed.
 */
async function resampleAndStretchPCM(
	inputChannel: Float32Array,
	sourceSampleRate: number,
	targetSampleRate: number,
	speed: number,
	outputLength: number,
	trimOffsetSamples: number,
): Promise<Float32Array> {
	const output = new Float32Array(outputLength);
	const resampleRatio = sourceSampleRate / targetSampleRate;
	const factor = resampleRatio * speed;

	const YIELD_INTERVAL = 100_000;

	for (let i = 0; i < outputLength; i++) {
		if (i > 0 && i % YIELD_INTERVAL === 0) {
			await yieldToMain();
		}
		const srcIndex = trimOffsetSamples + i * factor;
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
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
	mediaLogger.info(
		`[AudioExtractor] mixAudioTracks started. FPS: ${fps}, targetSampleRate: ${targetSampleRate}`,
	);
	await waitForDelayRender();

	// Register all signals from the composition tree
	shaderStore.registerSignalsFromComposition(renderId, virtualMedia);

	const durationMs = getActiveMediaMetadata(virtualMedia)?.durationMs || 1000;
	const totalDurationSec = durationMs / 1000;
	const totalTargetSamples = Math.ceil(totalDurationSec * targetSampleRate);
	mediaLogger.info(
		`[AudioExtractor] Composition total duration: ${durationMs}ms (${totalDurationSec}s). Total mixed samples to allocate: ${totalTargetSamples}`,
	);

	// Output mixed buffer is stereo
	const outputLeft = new Float32Array(totalTargetSamples);
	const outputRight = new Float32Array(totalTargetSamples);
	const mixedChannels = [outputLeft, outputRight];

	// Map to cache decoded sources so we don't decode multiple clips of the same file twice
	const decodedCache = new Map<
		string,
		{ channels: Float32Array[]; sampleRate: number } | null
	>();

	async function traverse(
		node: VirtualMediaData,
		inheritedSeekSec: number,
		inheritedClockFrames: number,
		inheritedVolume: number,
		inheritedSpeed: number,
		inheritedDurationFrames: number | null,
	): Promise<Float32Array[] | null> {
		if (!node) return null;
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

			const localLeft = new Float32Array(localSamplesCount);
			const localRight = new Float32Array(localSamplesCount);
			const localChannels = [localLeft, localRight];

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
					for (let c = 0; c < 2; c++) {
						const dest = localChannels[c];
						const src = childChannels[c];
						const len = Math.min(src.length, dest.length - childStartSample);
						for (let i = 0; i < len; i++) {
							if (childStartSample + i >= 0) {
								dest[childStartSample + i] += src[i];
							}
						}
					}
				}
			}
			return localChannels;
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

		const localLeft = new Float32Array(localSamplesCount);
		const localRight = new Float32Array(localSamplesCount);
		const localChannels = [localLeft, localRight];

		const processSegment = async (
			seg: { startSec: number; endSec?: number } | null,
			windowStartFrameOffset: number,
		) => {
			const segSeekSec = seg ? seg.startSec : 0;
			const totalSeekSec = inheritedSeekSec + segSeekSec;
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

					// Load and decode from cache or file
					let decoded = decodedCache.get(params.sourceUrl);
					if (decoded === undefined) {
						decoded = await decodeAudioSource(params.sourceUrl);
						decodedCache.set(params.sourceUrl, decoded);
					}

					if (decoded) {
						const clipDurationSec = actualDurationFrames / fps;
						const clipSamplesCount = Math.min(
							localSamplesCount - segmentStartSample,
							Math.ceil(clipDurationSec * targetSampleRate),
						);

						if (
							clipSamplesCount > 0 &&
							segmentStartSample < localSamplesCount
						) {
							const trimOffsetSamples = Math.round(
								effectiveTrimSec * decoded.sampleRate,
							);

							// Resample left & right channels
							const srcLeft = decoded.channels[0];
							const srcRight =
								decoded.channels.length > 1
									? decoded.channels[1]
									: decoded.channels[0]; // fallback to mono

							const stretchedLeft = await resampleAndStretchPCM(
								srcLeft,
								decoded.sampleRate,
								targetSampleRate,
								finalSpeed,
								clipSamplesCount,
								trimOffsetSamples,
							);

							const stretchedRight = await resampleAndStretchPCM(
								srcRight,
								decoded.sampleRate,
								targetSampleRate,
								finalSpeed,
								clipSamplesCount,
								trimOffsetSamples,
							);

							// Add to local mix with volume scaling
							for (let i = 0; i < clipSamplesCount; i++) {
								const outIndex = segmentStartSample + i;
								localLeft[outIndex] += stretchedLeft[i] * volume;
								localRight[outIndex] += stretchedRight[i] * volume;
							}
						}
					}
					await yieldToMain();
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
						const destStartSample = segmentStartSample + childStartSample;
						for (let c = 0; c < 2; c++) {
							const dest = localChannels[c];
							const src = childChannels[c];
							const len = Math.min(src.length, dest.length - destStartSample);
							for (let i = 0; i < len; i++) {
								if (destStartSample + i >= 0) {
									dest[destStartSample + i] += src[i];
								}
							}
						}
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
						const slicedChannels = localChannels.map((ch) =>
							ch.subarray(
								segmentStartSample,
								segmentStartSample + clipSamplesCount,
							),
						);
						const elapsedMs = (totalClockFrames / fps + totalSeekSec) * 1000;
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

		return localChannels;
	}

	const normalized = normalizeTimeline(virtualMedia, fps);
	const rootChannels = await traverse(normalized, 0, 0, 1, 1, null);
	if (rootChannels) {
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
