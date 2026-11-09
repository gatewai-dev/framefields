/// <reference lib="dom" />
/// <reference types="webgpu" />
/**
 * The browser side of an on-device export: draws chunks of frames with the
 * page's WebGPU device into an OffscreenCanvas and hands each frame to
 * WebCodecs as a `VideoFrame` (no readback), muxed by mediabunny into the
 * job's store; mixes and encodes the soundtrack apart.
 */

import { applyMaster, masterGain } from "@framefields/compositions";
import type { VirtualMediaData } from "@framefields/core";
import type {
	FrameCostSample,
	PlannedChunk,
} from "@framefields/renderer/split";
import { preloadCompositionFonts } from "@framefields/renderers";
import {
	BrowserSurfaceProvider,
	clearMediaCaches,
	ensureDevice,
	mediaDecoderCache,
	shaderStore,
	WebGPUAudioProcessor,
} from "@framefields/webgpu-renderers";
import {
	AudioSample,
	AudioSampleSource,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_VERY_HIGH,
	QUALITY_VERY_LOW,
	type Quality,
	StreamTarget,
} from "mediabunny";
import {
	type AudioTarget,
	createAudioMixer,
} from "../../preview/audio-mixer.js";
import { FrameDrawer } from "../../preview/frame-drawer.js";
import type { ExportBackend, ExportSettings } from "../export-job.js";
import type { StoreWriter } from "../store.js";
import type { WebExportQuality } from "../types.js";

/** Seconds of soundtrack mixed at a time: bounds what the mix holds in memory. */
const AUDIO_BLOCK_SEC = 10;

export interface BrowserBackendOptions {
	target: AudioTarget;
	vm: VirtualMediaData;
	settings: ExportSettings;
	durationMs: number;
}

export async function createBrowserBackend(
	options: BrowserBackendOptions,
): Promise<ExportBackend & { dispose(): void }> {
	const { vm, settings } = options;
	const { fps, width, height, totalFrames } = settings;
	const timing = { fps, durationMs: options.durationMs };
	const canvas = new OffscreenCanvas(width, height);
	const bitrate = bitrateOf(settings.quality);

	const device = await ensureDevice();
	const surface = new BrowserSurfaceProvider(device, canvas);
	const drawer = new FrameDrawer(device, surface, vm, timing);
	await preloadCompositionFonts(vm, device);

	let runs = 0;
	const renderIdFor = (what: string) =>
		`web-${what}-${++runs}-${Math.random().toString(36).slice(2, 8)}`;
	const release = (renderId: string) => {
		mediaDecoderCache.clearNode(renderId);
		shaderStore.clear(renderId);
		WebGPUAudioProcessor.clearCache(renderId, device);
	};

	const audioJob: AudioJob = {
		target: options.target,
		fps,
		durationSec: totalFrames / fps,
		bitrate,
		device,
		renderId: () => renderIdFor("audio"),
		release,
	};

	/** Draws a frame into the surface's target and waits until the GPU is done. */
	const drawTimed = async (frame: number, renderId: string) => {
		await drawer.draw(frame, renderId, {
			texture: surface.getCurrentTexture(),
		});
		await device.queue.onSubmittedWorkDone();
	};

	return {
		async probe(count, signal) {
			const renderId = renderIdFor("probe");
			const last = Math.max(0, totalFrames - 3);
			const samples: FrameCostSample[] = [];
			try {
				for (let i = 0; i < Math.min(count, totalFrames); i++) {
					signal?.throwIfAborted();
					const at = count === 1 ? 0 : Math.round((i * last) / (count - 1));
					const frame = (f: number) => Math.min(f, totalFrames - 1);
					// The first catches up effects with memory; it isn't timed.
					await drawTimed(frame(at), renderId);
					const started = performance.now();
					await drawTimed(frame(at + 1), renderId);
					await drawTimed(frame(at + 2), renderId);
					samples.push({
						frame: frame(at + 1),
						ms: (performance.now() - started) / 2,
					});
				}
			} finally {
				release(renderId);
			}
			return samples;
		},

		async renderChunk(
			chunk: PlannedChunk,
			writer: StoreWriter,
			onFrame,
			signal,
		) {
			const renderId = renderIdFor(`chunk-${chunk.start}`);
			const output = new Output({
				format: new Mp4OutputFormat({ fastStart: false }),
				target: new StreamTarget(writer.stream, { chunked: true }),
			});
			const video = new CanvasSource(canvas, {
				codec: settings.codec === "hevc" ? "hevc" : "avc",
				bitrate,
				keyFrameInterval: settings.keyFrameIntervalSec,
				latencyMode: "realtime",
				hardwareAcceleration: "prefer-hardware",
			});
			output.addVideoTrack(video, { frameRate: fps });
			drawer.restart();
			try {
				await output.start();
				for (let f = chunk.start; f < chunk.end; f++) {
					signal?.throwIfAborted();
					// Release decoders of clips that ended a while ago.
					mediaDecoderCache.tick();
					await drawer.draw(f, renderId, {
						texture: surface.getCurrentTexture(),
					});
					// Onto the canvas, which the encoder reads as a VideoFrame.
					surface.present();
					await video.add((f - chunk.start) / fps, 1 / fps);
					onFrame(f - chunk.start + 1);
				}
				await output.finalize();
			} catch (err) {
				await output.cancel().catch(() => {});
				throw err;
			} finally {
				release(renderId);
			}
		},

		async renderAudio(openWriter, signal) {
			// Mastered with gain 1, unless the mix peaks above the ceiling: then
			// once more with the gain the whole mix's peak calls for. Most films
			// take one pass, and no pass holds more than a block in memory.
			let gain = 1;
			for (;;) {
				const peak = await encodeAudio(
					audioJob,
					gain,
					await openWriter(),
					signal,
				);
				const needed = masterGain(peak);
				if (needed === gain) return true;
				gain = needed;
			}
		},

		async betweenChunks() {
			// What the last chunk loaded (decoders, textures, LUTs, glyphs) goes;
			// pipelines and pools stay. Destroying the device too would give its
			// memory back in Node, but in WebKit the page then grows by ~400 MB a
			// chunk (Safari 26.3), so the device stays.
			clearMediaCaches();
			drawer.restart();
			await preloadCompositionFonts(vm, device);
		},

		dispose() {
			surface.destroy();
		},
	};
}

/** The context `encodeAudioPass` mixes in, bound when the backend is made. */
interface AudioJob {
	target: AudioTarget;
	fps: number;
	durationSec: number;
	bitrate: number | Quality;
	device: GPUDevice;
	renderId: () => string;
	release: (renderId: string) => void;
}

/**
 * Mixes the soundtrack block by block on one chain (each block continues the
 * last one's effect state, so together they are the full mix sample for
 * sample), masters each with `gain` and encodes it into `writer`. Returns
 * the mix's peak before the master stage. When `masterGain(peak)` is not
 * `gain`, the file is discarded and the pass must be redone with it.
 */
async function encodeAudio(
	job: AudioJob,
	gain: number,
	writer: StoreWriter,
	signal: AbortSignal | undefined,
): Promise<number> {
	const renderId = job.renderId();
	const mix = createAudioMixer(job.target, job.fps, job.device, renderId);
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: false }),
		target: new StreamTarget(writer.stream, { chunked: true }),
	});
	const source = new AudioSampleSource({ codec: "aac", bitrate: job.bitrate });
	output.addAudioTrack(source);
	let peak = 0;
	try {
		await output.start();
		let offset = 0;
		for (let start = 0; start < job.durationSec; start += AUDIO_BLOCK_SEC) {
			signal?.throwIfAborted();
			const end = Math.min(job.durationSec, start + AUDIO_BLOCK_SEC);
			const block = await mix({ startSec: start, endSec: end }, "export");
			peak = Math.max(peak, block.peak);
			// Once the gain is wrong, mix on only to learn the whole mix's peak.
			if (masterGain(peak) !== gain) continue;
			applyMaster([block.left, block.right], gain);
			offset += await addInterleaved(source, block, offset, signal);
		}
		if (masterGain(peak) !== gain) {
			await output.cancel();
			await writer.abort();
			return peak;
		}
		await output.finalize();
		await writer.close();
		return peak;
	} catch (err) {
		await output.cancel().catch(() => {});
		await writer.abort();
		throw err;
	} finally {
		job.release(renderId);
	}
}

/** Adds a stereo block in 100 ms samples (fresh buffers: the encoder reads them later). */
async function addInterleaved(
	source: AudioSampleSource,
	block: { left: Float32Array; right: Float32Array; sampleRate: number },
	offset: number,
	signal: AbortSignal | undefined,
): Promise<number> {
	const { left, right, sampleRate } = block;
	const step = Math.round(0.1 * sampleRate);
	for (let i = 0; i < left.length; i += step) {
		signal?.throwIfAborted();
		const n = Math.min(step, left.length - i);
		const data = new Float32Array(n * 2);
		for (let j = 0; j < n; j++) {
			data[j * 2] = left[i + j];
			data[j * 2 + 1] = right[i + j];
		}
		const sample = new AudioSample({
			data,
			format: "f32",
			numberOfChannels: 2,
			sampleRate,
			timestamp: (offset + i) / sampleRate,
		});
		try {
			await source.add(sample);
		} finally {
			sample.close();
		}
	}
	return left.length;
}

function bitrateOf(quality: WebExportQuality): number | Quality {
	if (typeof quality === "number") return quality;
	switch (quality) {
		case "very_low":
			return QUALITY_VERY_LOW;
		case "low":
			return QUALITY_LOW;
		case "medium":
			return QUALITY_MEDIUM;
		case "high":
			return QUALITY_HIGH;
		default:
			return QUALITY_VERY_HIGH;
	}
}
