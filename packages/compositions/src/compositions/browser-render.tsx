/**
 * browser-video-renderer.tsx
 *
 * Architecture
 * ────────────
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ AudioMuxer (no React deps)                                      │
 * │  · subscribe / getSnapshot  →  useSyncExternalStore contract    │
 * │  · run()  →  mixing + encoding with cooperative yielding        │
 * │  · abort() → AbortSignal cancellation                           │
 * └─────────────────────────────────────────────────────────────────┘
 *          ▲  useSyncExternalStore
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ BrowserVideoRendererInner                                       │
 * │  Effect 1: muxer init (output, sources, OPFS target)           │
 * │  Effect 2: video frame loop  →  setVideoFramesDone(true)        │
 * │  Effect 3: audio kick-off    when videoFramesDone               │
 * │  Effect 4: finalization      when audioState.phase === "done"   │
 * │  Effect 5: progress bridge   audioState → onProgress prop       │
 * │  Effect 6: error bridge      audioState → onError prop          │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Why FPS dropped to 2-3 during audio processing (and how it's fixed)
 * ────────────────────────────────────────────────────────────────────
 *
 * ROOT CAUSE 1 — Main-thread monopoly
 *   The old audio chunk loop ran entirely on the JS main thread. Each
 *   iteration allocated a Float32Array, interleaved channel data, and
 *   called `await audioSource.add()`. Consecutive microtask continuations
 *   never returned control to the browser's rendering pipeline; the
 *   compositor thread was starved waiting for a JS task to complete before
 *   it could issue a new paint frame.
 *
 * ROOT CAUSE 2 — React scheduler saturation
 *   `onProgress("audio", pct)` was called on every chunk (up to ~100×/sec
 *   for long clips). Each call triggered a parent setState, enqueuing a
 *   React reconciliation. When updates arrived faster than the reconciler
 *   could drain them, React degraded to synchronous rendering to clear the
 *   backlog — which blocked the main thread even longer.
 *
 * ROOT CAUSE 3 — AudioEncoder backpressure
 *   mediabunny's AudioSampleSource.add() awaits the encoder's internal
 *   queue. Under load it parks the caller in a microtask continuation and
 *   immediately resumes on the same task. The browser task scheduler never
 *   saw an idle slot to run its rendering pipeline.
 *
 * ROOT CAUSE 4 — Entangled concerns
 *   Audio encoding lived inside the video frame useEffect. The render loop
 *   and the encoder competed for the same task slot and the same React
 *   reconciliation pass.
 *
 * FIX — yieldToMain() between every audio chunk
 *   `scheduler.yield()` (Chrome 115+) is the correct primitive: it
 *   explicitly yields to the browser's task queue at "user-blocking"
 *   priority, guaranteeing a paint opportunity between chunks. The
 *   `setTimeout(0)` fallback provides equivalent semantics on older
 *   browsers (>4 ms clamped, sufficient for ~60 FPS).
 *   Progress notifications are throttled to ≤12 updates/sec to avoid
 *   overwhelming the React scheduler.
 */

import { getMediaType, type VirtualMediaData } from "@gitframes/core";
import {
	clearAllVideoCache,
	RenderProvider,
	useRenderContext,
} from "@gitframes/webgpu-renderers";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	canEncodeAudio,
	canEncodeVideo,
	Mp3OutputFormat,
	Mp4OutputFormat,
	Output,
	QUALITY_VERY_HIGH,
	StreamTarget,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat,
} from "mediabunny";
import type React from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mixAudioTracks } from "../utils/audio-extractor.js";
import { CanvasComposition } from "./canvas-composition.js";

const isNode =
	typeof process !== "undefined" && Boolean(process.versions?.node);

// Register custom MP3 encoder fallback for browsers lacking native WebCodecs MP3 encoding
if (typeof window !== "undefined" && !isNode) {
	canEncodeAudio("mp3")
		.then((supported) => {
			if (!supported) {
				registerMp3Encoder();
			}
		})
		.catch(() => {});
}

// ───  delay-render compatibility ──────────────────────────────────────

/**
 * Blocks until all delayRender handles are cleared, or the timeout
 * expires. The initial 100 ms sleep gives React one full render cycle to
 * register any new handles before we start polling.
 *
 * NOTE: The 100 ms floor sets a hard upper bound on video encoding throughput
 * (~10 FPS maximum) when delayRender handles are not in use. If you control the
 * config, consider reducing this to 0 ms after verifying no handles
 * are ever registered synchronously before the first poll.
 */
const waitForDelayRender = async (timeoutMs = 30_000): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, 100));

	const start = Date.now();
	return new Promise<void>((resolve) => {
		const check = () => {
			const handles: unknown[] =
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

			const hasBrowserDelays = handles.length > 0;
			const hasGlobalDelays =
				globalDelays instanceof Set && globalDelays.size > 0;

			if (!hasBrowserDelays && !hasGlobalDelays) {
				resolve();
				return;
			}

			if (Date.now() - start > timeoutMs) {
				console.warn("[BrowserRenderer] waitForDelayRender timed out:", {
					browserHandles: handles,
					globalDelays: globalDelays ? Array.from(globalDelays) : [],
				});
				resolve();
				return;
			}

			setTimeout(check, 50);
		};
		check();
	});
};

// ─── Browser render support check ─────────────────────────────────────────────

export const checkBrowserRenderSupport = async (
	format: "mp4" | "webm" | "gif" | "mp3",
	isAudioOnly = false,
	audioCodecOverride?: "aac" | "opus" | "mp3",
): Promise<{ supported: boolean; reason?: string }> => {
	if (typeof window === "undefined") {
		return { supported: false, reason: "Server-side context" };
	}

	if (!("VideoEncoder" in window) || !("AudioEncoder" in window)) {
		return {
			supported: false,
			reason: "Browser does not support WebCodecs (VideoEncoder/AudioEncoder).",
		};
	}

	if (format === "gif") {
		return {
			supported: false,
			reason: `${format.toUpperCase()} export format is not supported for Browser rendering.`,
		};
	}

	const resolvedQuality = QUALITY_VERY_HIGH;

	const isWebM = format === "webm";
	const isMp3 = format === "mp3";
	const videoCodec = isWebM ? "vp8" : "avc";
	const audioCodec =
		audioCodecOverride ?? (isMp3 ? "mp3" : isWebM ? "opus" : "aac");

	// Check audio encoding support
	try {
		const isAudioSupported = await canEncodeAudio(audioCodec, {
			numberOfChannels: 2,
			sampleRate: 48_000,
			bitrate: resolvedQuality,
		});

		if (!isAudioSupported) {
			if (audioCodec === "aac") {
				// AAC unsupported → try opus fallback for mp4
				const isOpusSupported = await canEncodeAudio("opus", {
					numberOfChannels: 2,
					sampleRate: 48_000,
					bitrate: resolvedQuality,
				});
				if (!isOpusSupported) {
					return {
						supported: false,
						reason:
							"Neither AAC nor Opus audio encoding is supported by this browser.",
					};
				}
			} else {
				return {
					supported: false,
					reason: `${audioCodec.toUpperCase()} audio encoding is not supported by this browser.`,
				};
			}
		}
	} catch (e) {
		return {
			supported: false,
			reason: `Failed to verify audio encoder support for ${audioCodec}: ${
				e instanceof Error ? e.message : String(e)
			}`,
		};
	}

	// Check video encoding support (skipped for mp3 / audio-only)
	if (!isMp3 && !isAudioOnly) {
		try {
			const isVideoSupported = await canEncodeVideo(videoCodec, {
				width: 1920,
				height: 1080,
				bitrate: resolvedQuality,
			});

			if (!isVideoSupported) {
				return {
					supported: false,
					reason: `${videoCodec.toUpperCase()} video encoding is not supported by your browser/hardware.`,
				};
			}
		} catch (e) {
			// Assume supported if the check itself throws — better a graceful failure
			// during encoding than a false negative here.
			console.warn(
				"[BrowserRenderer] VideoEncoder support check failed, assuming supported:",
				e,
			);
		}
	}

	return { supported: true };
};

// ─── Cooperative scheduler yield ──────────────────────────────────────────────
//
// scheduler.yield() (Chrome 115+) yields to the browser's task queue at
// "user-blocking" priority, guaranteeing a paint/input opportunity between
// audio chunks. On older browsers setTimeout(0) provides equivalent semantics
// (clamped to ≥4 ms, still sufficient for smooth 60 FPS progress updates).
//
// IMPORTANT: This is the single most impactful change for audio-phase FPS.
// Without it, the tight await-loop inside #encodeChunks() never lets the
// compositor issue a new frame — hence the perceived 2-3 FPS.

const yieldToMain = (): Promise<void> => {
	const sched = (globalThis as Record<string, unknown>).scheduler as
		| { yield?: () => Promise<void> }
		| undefined;
	return typeof sched?.yield === "function"
		? sched.yield()
		: new Promise<void>((resolve) => setTimeout(resolve, 0));
};

// ─── AudioMuxer — zero React dependencies ─────────────────────────────────────

export type AudioMuxPhase = "idle" | "mixing" | "encoding" | "done" | "error";

export interface AudioMuxState {
	phase: AudioMuxPhase;
	/** 0-100; meaningful during the "encoding" phase */
	progress: number;
	error: Error | null;
}

/**
 * Self-contained audio mixing + encoding engine.
 *
 * Exposes the `useSyncExternalStore` contract (subscribe / getSnapshot) so
 * the component can react to state changes without prop-drilling callbacks
 * into the async pipeline.
 *
 * Usage:
 *   const muxer = useMemo(() => new AudioMuxer(), []);
 *   const state = useSyncExternalStore(muxer.subscribe, muxer.getSnapshot);
 *   useEffect(() => { void muxer.run(...) }, [videoFramesDone]);
 *   useEffect(() => () => muxer.abort(), []);
 */
export class AudioMuxer {
	#state: AudioMuxState = { phase: "idle", progress: 0, error: null };
	#listeners = new Set<() => void>();
	#abortController: AbortController | null = null;

	// ── useSyncExternalStore contract ─────────────────────────────────────────

	readonly subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): AudioMuxState => this.#state;

	// ── Control ───────────────────────────────────────────────────────────────

	/** Cancel any in-flight run and reset to idle. Safe to call multiple times. */
	abort(): void {
		this.#abortController?.abort(
			new DOMException("AudioMuxer aborted", "AbortError"),
		);
		this.#abortController = null;
		// Don't overwrite an error state — the error useEffect needs to read it
		if (this.#state.phase !== "error") {
			this.#setState({ phase: "idle", progress: 0, error: null });
		}
	}

	// ── Entry point ───────────────────────────────────────────────────────────

	/**
	 * Mix virtual media audio and feed it into the provided AudioSampleSource.
	 *
	 * Calling run() while a previous run is in-flight cancels the previous
	 * run before starting. Throws on error (error state is also written to
	 * the snapshot for the component to observe).
	 */
	async run(
		virtualMedia: VirtualMediaData,
		fps: number,
		sampleRate: number,
		device: GPUDevice,
		audioSource: AudioSampleSource,
	): Promise<void> {
		// Cancel any previous in-flight run
		this.#abortController?.abort();
		this.#abortController = new AbortController();
		const { signal } = this.#abortController;

		this.#setState({ phase: "mixing", progress: 0, error: null });

		try {
			await this.#execute(
				virtualMedia,
				fps,
				sampleRate,
				device,
				audioSource,
				signal,
			);
		} catch (err) {
			if (signal.aborted) return; // intentional abort — not an error
			const error = err instanceof Error ? err : new Error(String(err));
			this.#setState({ phase: "error", error });
			throw error;
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	#setState(patch: Partial<AudioMuxState>): void {
		this.#state = { ...this.#state, ...patch };
		// useSyncExternalStore requires synchronous notification
		for (const listener of this.#listeners) listener();
	}

	async #execute(
		virtualMedia: VirtualMediaData,
		fps: number,
		sampleRate: number,
		device: GPUDevice,
		audioSource: AudioSampleSource,
		signal: AbortSignal,
	): Promise<void> {
		// ── Phase 1: GPU audio mixing ─────────────────────────────────────────
		//
		// mixAudioTracks performs WebGPU compute work + a blocking readback.
		// Yielding before it lets the browser flush any pending composites from
		// the final video frame before we kick off GPU work again, preventing
		// the GPU timeline from backing up.
		await yieldToMain();
		if (signal.aborted) return;

		let channels: Float32Array[];
		let actualSampleRate: number;

		try {
			const mixed = await mixAudioTracks(virtualMedia, fps, sampleRate, device);
			channels = mixed.channels;
			actualSampleRate = mixed.sampleRate;
		} catch (err) {
			throw new Error(
				`Audio track mixing failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}

		if (signal.aborted) return;

		if (channels.length === 0) {
			this.#setState({ phase: "done", progress: 100 });
			return;
		}

		// ── Phase 2: Encode in cooperative chunks ────────────────────────────
		this.#setState({ phase: "encoding", progress: 0 });
		await this.#encodeChunks(channels, actualSampleRate, audioSource, signal);
	}

	async #encodeChunks(
		channels: Float32Array[],
		sampleRate: number,
		audioSource: AudioSampleSource,
		signal: AbortSignal,
	): Promise<void> {
		const numChannels = channels.length;
		const totalSamples = channels[0].length;

		// 100 ms per chunk — balance between throughput and responsiveness.
		// Smaller chunks yield more frequently (smoother UI) but increase
		// encoder overhead (more AudioSample objects, more IPC round-trips).
		const chunkSize = Math.round(0.1 * sampleRate);

		// ── Throttle progress notifications ──────────────────────────────────
		// React reconciler overhead becomes measurable above ~60 setState/sec.
		// At 48 kHz / 4,800 samples per chunk = 10 chunks/sec, we're already
		// within budget, but guard against low sample rates or tiny chunks.
		const PROGRESS_INTERVAL_MS = 80; // ≈12 updates/sec max
		let lastProgressAt = 0;

		for (let offset = 0; offset < totalSamples; offset += chunkSize) {
			if (signal.aborted) return;

			// ─────────────────────────────────────────────────────────────────
			// KEY FIX: yield BEFORE the work, not after.
			//
			// Yielding *before* guarantees the browser gets a task slot even if
			// the subsequent await (audioSource.add) resolves on a microtask.
			// Without this yield, the entire loop runs as a single long task from
			// the browser's perspective, blocking paint for the full duration.
			// ─────────────────────────────────────────────────────────────────
			await yieldToMain();
			if (signal.aborted) return;

			const chunkLen = Math.min(chunkSize, totalSamples - offset);

			// Interleave planar channels → [L₀, R₀, L₁, R₁, …]
			const interleaved = new Float32Array(chunkLen * numChannels);
			for (let i = 0; i < chunkLen; i++) {
				for (let ch = 0; ch < numChannels; ch++) {
					interleaved[i * numChannels + ch] = channels[ch]?.[offset + i] ?? 0;
				}
			}

			const sample = new AudioSample({
				data: interleaved,
				format: "f32",
				numberOfChannels: numChannels,
				sampleRate,
				timestamp: offset / sampleRate,
			});

			try {
				await audioSource.add(sample);
			} finally {
				// Always close — AudioSample holds a reference to a SharedArrayBuffer
				// backing the encoder; leaking it exhausts the encoder's buffer pool.
				sample.close();
			}

			const now = performance.now();
			if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
				this.#setState({
					phase: "encoding",
					progress: Math.round(((offset + chunkLen) / totalSamples) * 100),
				});
				lastProgressAt = now;
			}
		}

		this.#setState({ phase: "done", progress: 100 });
	}
}

// ─── Component types ──────────────────────────────────────────────────────────

interface BrowserRenderProps {
	nodeId: string;
	virtualMedia: VirtualMediaData;
	format: "mp4" | "webm" | "gif" | "mp3";
	audioCodec?: "aac" | "opus" | "mp3";
	fps: number;
	width: number;
	height: number;
	onProgress: (stage: string, percent: number) => void;
	onComplete: (blob: Blob) => void;
	onError: (error: Error) => void;
}

// ─── Encoder state (non-reactive, mutated during async loop) ──────────────────

interface EncoderState {
	initialized: boolean;
	finalized: boolean; // guards against double-finalize between effect and cleanup
	output: Output | null;
	videoSource: VideoSampleSource | null;
	audioSource: AudioSampleSource | null;
	target: StreamTarget | BufferTarget | null;
	fileHandle: FileSystemFileHandle | null;
	totalFrames: number;
	frameIndex: number;
}

// ─── BrowserVideoRendererInner ─────────────────────────────────────────────────

const BrowserVideoRendererInner: React.FC<BrowserRenderProps> = ({
	nodeId,
	virtualMedia,
	format,
	audioCodec: audioCodecProp,
	fps,
	width,
	height,
	onProgress,
	onComplete,
	onError,
}) => {
	const ctx = useRenderContext();
	const [frame, setFrame] = useState<number>(-1);
	const [videoFramesDone, setVideoFramesDone] = useState(false);
	const activeRef = useRef<boolean>(true);

	const isAudioOnly = getMediaType(virtualMedia) === "Audio";
	const isMp3 = format === "mp3";
	const skipVideo = isMp3 || isAudioOnly;

	// ── Stable callback refs (prevent effect restarts on parent re-renders) ───
	const onProgressRef = useRef(onProgress);
	const onCompleteRef = useRef(onComplete);
	const onErrorRef = useRef(onError);
	useEffect(() => {
		onProgressRef.current = onProgress;
		onCompleteRef.current = onComplete;
		onErrorRef.current = onError;
	});

	// ── AudioMuxer: one stable instance per component mount ──────────────────
	const audioMuxerRef = useRef<AudioMuxer>(null!);
	if (!audioMuxerRef.current) {
		audioMuxerRef.current = new AudioMuxer();
	}

	// Subscribe to muxer state — this is the only source of truth for audio phase
	const audioState = useSyncExternalStore(
		audioMuxerRef.current.subscribe,
		audioMuxerRef.current.getSnapshot,
	);

	// ── Encoder state (non-reactive mutable ref) ─────────────────────────────
	const stateRef = useRef<EncoderState>({
		initialized: false,
		finalized: false,
		output: null,
		videoSource: null,
		audioSource: null,
		target: null,
		fileHandle: null,
		totalFrames: 0,
		frameIndex: 0,
	});

	// ── Cleanup ───────────────────────────────────────────────────────────────

	const cleanup = async () => {
		audioMuxerRef.current.abort();
		const state = stateRef.current;
		if (state.output && !state.finalized) {
			state.finalized = true;
			try {
				await state.output.finalize();
			} catch (_) {
				// Best-effort — we're tearing down anyway
			}
		}
		state.output = null;
		state.videoSource = null;
		state.audioSource = null;
		state.target = null;
		if (state.fileHandle) {
			try {
				const root = await navigator.storage.getDirectory();
				await root.removeEntry(state.fileHandle.name);
			} catch (_) {}
			state.fileHandle = null;
		}
	};

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
			void cleanup();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Effect 1: Muxer initialization ───────────────────────────────────────

	useEffect(() => {
		if (!ctx || stateRef.current.initialized || !activeRef.current) return;

		let effectActive = true;

		const init = async () => {
			try {
				await waitForDelayRender();
				if (!effectActive || !activeRef.current) return;

				const durationMs = virtualMedia.metadata?.durationMs ?? 1_000;
				const totalFrames = Math.max(1, Math.round((durationMs / 1_000) * fps));

				if (format === "gif") {
					throw new Error(
						`${format.toUpperCase()} export is not supported for Browser rendering. ` +
							"Please select MP4 or WebM, or switch to Server rendering.",
					);
				}

				const resolvedQuality = QUALITY_VERY_HIGH;

				const isWebM = format === "webm";
				const videoCodec = isWebM ? "vp8" : "avc";
				let audioCodec: "mp3" | "opus" | "aac" =
					audioCodecProp ?? (isMp3 ? "mp3" : isWebM ? "opus" : "aac");

				if (audioCodec === "aac") {
					try {
						const aacOk = await canEncodeAudio("aac", {
							numberOfChannels: 2,
							sampleRate: 48_000,
							bitrate: resolvedQuality,
						});
						if (!aacOk) {
							console.warn(
								"[BrowserRenderer] AAC not supported, falling back to Opus.",
							);
							audioCodec = "opus";
						}
					} catch {
						console.warn(
							"[BrowserRenderer] AAC check failed, falling back to Opus.",
						);
						audioCodec = "opus";
					}
				}

				if (!effectActive || !activeRef.current) return;

				onProgressRef.current("initializing", 0);

				// ── OPFS target (preferred) or in-memory BufferTarget ─────────────
				let target: StreamTarget | BufferTarget;
				let fileHandle: FileSystemFileHandle | null = null;

				const opfsAvailable =
					typeof navigator !== "undefined" &&
					typeof navigator.storage?.getDirectory === "function";

				if (opfsAvailable) {
					try {
						const root = await navigator.storage.getDirectory();
						const filename = `export-${nodeId}-${Math.random()
							.toString(36)
							.slice(2)}.tmp`;
						fileHandle = await root.getFileHandle(filename, { create: true });
						const writable = await fileHandle.createWritable();

						target = new StreamTarget(
							new WritableStream<unknown>({
								async write(chunk) {
									const c = chunk as { position: number; data: ArrayBuffer };
									await writable.write({
										type: "write",
										position: c.position,
										data: c.data,
									});
								},
								async close() {
									await writable.close();
								},
								async abort(reason) {
									await writable.abort(reason);
								},
							}) as unknown as WritableStream<unknown>,
							{ chunked: true },
						);
					} catch (e) {
						console.warn(
							"[BrowserRenderer] OPFS unavailable, falling back to BufferTarget:",
							e,
						);
						target = new BufferTarget();
					}
				} else {
					target = new BufferTarget();
				}

				if (!effectActive || !activeRef.current) return;

				const output = new Output({
					format: isMp3
						? new Mp3OutputFormat()
						: isWebM
							? new WebMOutputFormat()
							: new Mp4OutputFormat(),
					target,
				});

				let videoSource: VideoSampleSource | null = null;
				if (!skipVideo) {
					videoSource = new VideoSampleSource({
						codec: videoCodec,
						bitrate: resolvedQuality,
					});
					output.addVideoTrack(videoSource);
				}

				const audioSource = new AudioSampleSource({
					codec: audioCodec,
					bitrate: resolvedQuality,
				});
				output.addAudioTrack(audioSource);

				await output.start();

				if (!effectActive || !activeRef.current) {
					await output.finalize();
					return;
				}

				stateRef.current = {
					initialized: true,
					finalized: false,
					output,
					videoSource,
					audioSource,
					target,
					fileHandle,
					totalFrames,
					frameIndex: 0,
				};

				if (skipVideo) {
					// No frames to render — go straight to audio
					setVideoFramesDone(true);
				} else {
					setFrame(0);
				}
			} catch (err) {
				if (effectActive && activeRef.current) {
					onErrorRef.current(
						err instanceof Error ? err : new Error(String(err)),
					);
				}
			}
		};

		void init();
		return () => {
			effectActive = false;
			clearAllVideoCache(ctx?.device);
		};
	}, [ctx, nodeId, format, fps, virtualMedia]);

	// ── Effect 2: Video frame render loop ─────────────────────────────────────
	//
	// Processes one frame per effect invocation. On completion of the last
	// frame it sets videoFramesDone → true, which triggers Effect 3 (audio).
	// Audio is never touched here — clean separation of concerns.

	useEffect(() => {
		const state = stateRef.current;

		if (
			!ctx ||
			!state.initialized ||
			frame !== state.frameIndex ||
			!activeRef.current ||
			skipVideo
		) {
			return;
		}

		let frameActive = true;

		const processFrame = async () => {
			try {
				// 1. Wait for CanvasComposition to signal this frame is drawn
				const renderKey = `browser-render-${nodeId}-${frame}`;
				const renderPromise = new Promise<void>((resolve) => {
					const resolvers = ((
						window as unknown as {
							__frameRenderResolvers?: Map<
								string,
								{ rendered: boolean; resolver?: () => void }
							>;
						}
					).__frameRenderResolvers ??= new Map());

					const existing = resolvers.get(renderKey);
					if (existing?.rendered) {
						resolve();
						resolvers.delete(renderKey);
					} else if (existing) {
						existing.resolver = resolve;
					} else {
						resolvers.set(renderKey, { rendered: false, resolver: resolve });
					}
				});

				await waitForDelayRender();
				await renderPromise;
				if (!frameActive || !activeRef.current) return;

				// 2. Read pixels from WebGPU surface
				let pixels: Uint8Array;
				try {
					const surfacePixels = await ctx.surface.readPixels();
					pixels = new Uint8Array(
						surfacePixels.buffer,
						surfacePixels.byteOffset,
						surfacePixels.byteLength,
					);
				} catch (pixelErr) {
					throw new Error(
						`WebGPU readPixels failed: ${
							pixelErr instanceof Error ? pixelErr.message : String(pixelErr)
						}. Your GPU may be out of memory — try Server rendering.`,
					);
				}

				if (!frameActive || !activeRef.current) return;

				// 3. Wrap pixels in a VideoFrame and hand to the encoder
				let vf: VideoFrame;
				try {
					vf = new (
						window as unknown as {
							VideoFrame: new (data: Uint8Array, init: object) => VideoFrame;
						}
					).VideoFrame(pixels, {
						format: "RGBA",
						codedWidth: width,
						codedHeight: height,
						timestamp: (frame / fps) * 1_000_000,
					});
				} catch (vfErr) {
					throw new Error(
						"Failed to construct VideoFrame — browser may be out of memory. " +
							"Try reducing resolution/FPS or switch to Server rendering.",
					);
				}

				try {
					const sample = new VideoSample(vf, {
						duration: 1 / fps,
						timestamp: frame / fps,
					});
					try {
						await state.videoSource!.add(sample);
					} catch (encErr) {
						throw new Error(
							`Video frame encoding failed: ${
								encErr instanceof Error ? encErr.message : String(encErr)
							}`,
						);
					} finally {
						sample.close();
					}
				} finally {
					vf.close();
				}

				if (!frameActive || !activeRef.current) return;

				const nextFrame = frame + 1;
				state.frameIndex = nextFrame;

				if (nextFrame < state.totalFrames) {
					onProgressRef.current(
						"rendering",
						Math.round((nextFrame / state.totalFrames) * 100),
					);
					setFrame(nextFrame);
				} else {
					console.log(
						"[BrowserRenderer] All video frames encoded, handing off to AudioMuxer.",
					);
					setVideoFramesDone(true);
				}
			} catch (err) {
				if (frameActive && activeRef.current) {
					onErrorRef.current(
						err instanceof Error ? err : new Error(String(err)),
					);
				}
			}
		};

		void processFrame();
		return () => {
			frameActive = false;
		};
	}, [frame, ctx, fps, format, width, height, nodeId, skipVideo]);

	// ── Effect 3: Kick off AudioMuxer once video is done ─────────────────────

	useEffect(() => {
		if (!videoFramesDone || !ctx || !activeRef.current) return;

		const { audioSource, initialized } = stateRef.current;
		if (!initialized || !audioSource) return;

		console.log("[BrowserRenderer] Starting AudioMuxer.run()");

		void audioMuxerRef.current
			.run(virtualMedia, fps, 48_000, ctx.device, audioSource)
			.catch((err) => {
				// Error state is also written to the snapshot — Effect 6 (error
				// bridge) forwards it to onError. No double-dispatch needed here.
				console.error("[BrowserRenderer] AudioMuxer.run() threw:", err);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [videoFramesDone]);

	// ── Effect 4: Finalize mux + yield Blob once audio is done ───────────────

	useEffect(() => {
		if (audioState.phase !== "done" || !activeRef.current) return;

		const finalize = async () => {
			const state = stateRef.current;
			if (!state.output || state.finalized) return;

			state.finalized = true;
			onProgressRef.current("finalizing", 100);

			try {
				await state.output.finalize();
			} catch (finalErr) {
				if (activeRef.current) {
					onErrorRef.current(
						new Error(
							`Finalizing output muxer failed: ${
								finalErr instanceof Error ? finalErr.message : String(finalErr)
							}. This is typically caused by insufficient system memory — ` +
								"please switch to Server rendering.",
						),
					);
				}
				return;
			}

			if (!activeRef.current) return;

			const mimeType = isAudioOnly
				? format === "webm"
					? "audio/webm"
					: "audio/mp4"
				: isMp3
					? "audio/mpeg"
					: format === "webm"
						? "video/webm"
						: "video/mp4";

			let blob: Blob;
			if (state.fileHandle) {
				const raw = await state.fileHandle.getFile();
				blob = new File([raw], `export-${nodeId}.${format}`, {
					type: mimeType,
				});
			} else {
				const bufferTarget = state.target as BufferTarget;
				if (!bufferTarget.buffer) {
					onErrorRef.current(
						new Error(
							"Muxing completed but output buffer is empty — browser may be out of memory.",
						),
					);
					return;
				}
				blob = new Blob([bufferTarget.buffer], { type: mimeType });
			}

			onCompleteRef.current(blob);
		};

		void finalize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [audioState.phase]);

	// ── Effect 5: Audio muxer state → onProgress bridge ──────────────────────
	//
	// useSyncExternalStore deliberately avoids calling onProgress directly
	// from AudioMuxer (which has no knowledge of the prop). This effect is the
	// single bridge between the two worlds.

	useEffect(() => {
		switch (audioState.phase) {
			case "mixing":
				onProgressRef.current("audio", 0);
				break;
			case "encoding":
				onProgressRef.current("audio", audioState.progress);
				break;
		}
	}, [audioState.phase, audioState.progress]);

	// ── Effect 6: Audio muxer error → onError bridge ─────────────────────────

	useEffect(() => {
		if (audioState.phase === "error" && audioState.error && activeRef.current) {
			onErrorRef.current(audioState.error);
		}
	}, [audioState.phase, audioState.error]);

	// ── Render ────────────────────────────────────────────────────────────────

	// Audio-only and mp3 formats don't need a visible canvas
	if (skipVideo) return null;
	// Not yet initialized
	if (frame < 0) return null;

	return (
		<CanvasComposition
			renderId={`browser-render-${nodeId}`}
			virtualMedia={virtualMedia}
			containerWidth={width}
			containerHeight={height}
			frame={frame}
			fps={fps}
		/>
	);
};

// ─── BrowserVideoRenderer (public wrapper) ────────────────────────────────────

export const BrowserVideoRenderer: React.FC<BrowserRenderProps> = (props) => {
	const containerRef = useRef<HTMLDivElement>(null);

	return (
		<div
			ref={containerRef}
			style={{
				position: "fixed",
				// Render off-screen; still in the DOM so WebGPU surface stays alive
				top: -10_000,
				left: -10_000,
				width: props.width,
				height: props.height,
				pointerEvents: "none",
			}}
		>
			<RenderProvider
				containerRef={containerRef}
				width={props.width}
				height={props.height}
			>
				<BrowserVideoRendererInner {...props} />
			</RenderProvider>
		</div>
	);
};
