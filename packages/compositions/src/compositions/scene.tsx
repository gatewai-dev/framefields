import {
	getActiveMediaMetadata,
	getMediaType,
	type VirtualMediaData,
} from "@gitframes/core";
import { type AudioProcessor, audioRegistry } from "@gitframes/node-sdk";
import { PlaybackProvider } from "@gitframes/renderers";
import {
	getDevice,
	mediaDecoderCache,
	RenderProvider,
} from "@gitframes/webgpu-renderers";
import React, {
	useCallback,
	useEffect,
	useId,
	useRef,
	useSyncExternalStore,
} from "react";
import { computeRenderParams } from "../utils/apply-operations.js";
import { normalizeTimeline } from "../utils/normalization.js";
import { CanvasComposition } from "./canvas-composition.js";
import {
	RenderTimelineProvider,
	useRenderTimeline,
} from "./timeline-context.js";

// --
// SECTION 1: Audio / Extractor Pipeline (DOM Context)
// --

// React Context to pass down active Web Audio processors from ancestors
export interface AudioProcessorContextValue {
	processors: Array<{
		opType: string;
		virtualMedia: VirtualMediaData;
	}>;
}

export const AudioProcessorContext =
	React.createContext<AudioProcessorContextValue>({
		processors: [],
	});

let globalAudioCtx: AudioContext | null = null;
const getGlobalAudioContext = () => {
	if (typeof window === "undefined") return null;
	if (!globalAudioCtx) {
		globalAudioCtx = new (
			window.AudioContext || (window as any).webkitAudioContext
		)();
	}
	// Don't eagerly resume here — startPlayback handles resume after user gesture.
	// Calling resume() on every getter invocation before a gesture causes browser warnings.
	return globalAudioCtx;
};

interface NativeAudioClipProps {
	sourceUrl: string;
	renderId: string;
	clipId?: string;
	frame: number;
	fps: number;
	playbackRate: number;
	volume: number;
	startFrame: number;
	trimStartSec: number;
}

export const NativeAudioClip: React.FC<NativeAudioClipProps> = ({
	sourceUrl,
	renderId,
	clipId,
	frame,
	fps,
	playbackRate,
	volume,
	startFrame,
	trimStartSec,
}) => {
	const state = useCompositionState(renderId);
	const isPlaying = state.isPlaying;
	const activeProcessors = React.useContext(AudioProcessorContext);
	const activeProcessorsRef = useRef(activeProcessors);
	activeProcessorsRef.current = activeProcessors;

	const { accumulatedSeekOffsetSec } = useRenderTimeline();
	const accumulatedSeekOffsetSecRef = useRef(accumulatedSeekOffsetSec);
	accumulatedSeekOffsetSecRef.current = accumulatedSeekOffsetSec;

	const audioCtx = getGlobalAudioContext();
	const decoderRef = useRef<any | null>(null);
	const isPlayingRef = useRef(isPlaying);
	isPlayingRef.current = isPlaying;

	const activeNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
	const gainNodeRef = useRef<GainNode | null>(null);
	const currentGeneratorRef = useRef<any | null>(null);
	const nextScheduleTimeRef = useRef<number>(0);
	const lastStartFrameRef = useRef<number | null>(null);
	const playbackStartTimeRef = useRef<number | null>(null);
	const playbackStartFrameRef = useRef<number>(0);

	const lastTrimStartSecRef = useRef<number | null>(null);
	const lastStartFramePropRef = useRef<number | null>(null);
	const lastPlaybackRateRef = useRef<number | null>(null);

	// Setup GainNode
	useEffect(() => {
		if (!audioCtx) return;
		const gainNode = audioCtx.createGain();
		gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
		gainNode.connect(audioCtx.destination);
		gainNodeRef.current = gainNode;

		return () => {
			gainNode.disconnect();
			gainNodeRef.current = null;
		};
	}, [audioCtx]);

	// Update Volume in real-time
	useEffect(() => {
		if (gainNodeRef.current && audioCtx) {
			gainNodeRef.current.gain.setValueAtTime(volume, audioCtx.currentTime);
		}
	}, [volume, audioCtx]);

	// Initialize Audio Decoder
	useEffect(() => {
		const decoderKey = clipId || renderId;
		const decoder = mediaDecoderCache.getAudio(sourceUrl, decoderKey);
		decoderRef.current = decoder;

		if (isPlayingRef.current) {
			startPlayback(frame);
		}

		return () => {
			stopAllNodes();
			decoderRef.current = null;
			// Note: We don't destroy the decoder here because it's cached and might be needed by the next segment
		};
	}, [sourceUrl, renderId, clipId]);

	const stopAllNodes = () => {
		activeNodesRef.current.forEach((node) => {
			try {
				node.stop();
			} catch (_) {}
			try {
				node.disconnect();
			} catch (_) {}
		});
		activeNodesRef.current.clear();
		currentGeneratorRef.current = null;
		playbackStartTimeRef.current = null;
	};

	const startPlayback = async (targetFrame: number) => {
		stopAllNodes();
		const decoder = decoderRef.current;
		const audioCtx = getGlobalAudioContext();
		const gainNode = gainNodeRef.current;
		if (!decoder || !audioCtx || !gainNode) return;

		if (audioCtx.state === "suspended") {
			await audioCtx.resume();
		}

		// Calculate media timestamp:
		// timestamp = (currentFrame - startFrame) / fps * playbackRate + trimStartSec
		const localFrame = targetFrame - startFrame;
		const mediaTimeSec = (localFrame / fps) * playbackRate + trimStartSec;

		const startTimestamp = Math.max(0, mediaTimeSec);
		const generator = decoder.getBuffers(startTimestamp);
		currentGeneratorRef.current = generator;

		// We add an initial lookahead offset so Web Audio and WebGPU have sufficient headroom
		nextScheduleTimeRef.current = audioCtx.currentTime + 0.15;
		lastStartFrameRef.current = targetFrame;

		lastTrimStartSecRef.current = trimStartSec;
		lastStartFramePropRef.current = startFrame;
		lastPlaybackRateRef.current = playbackRate;

		const scheduleLoop = async () => {
			try {
				for await (const wrapped of generator) {
					if (
						!isPlayingRef.current ||
						currentGeneratorRef.current !== generator
					) {
						break;
					}

					if (playbackStartTimeRef.current === null) {
						playbackStartTimeRef.current = audioCtx.currentTime + 0.15;
						nextScheduleTimeRef.current = audioCtx.currentTime + 0.15;
						playbackStartFrameRef.current = targetFrame;
					}

					const scheduledTime = nextScheduleTimeRef.current;
					const durationSec = wrapped.duration / playbackRate;
					const buffer = wrapped.buffer;

					// Upmix to stereo if the buffer is mono to ensure panners / processors can output/work in stereo
					let finalBuffer = buffer;
					if (buffer.numberOfChannels === 1) {
						const stereoBuffer = audioCtx.createBuffer(
							2,
							buffer.length,
							buffer.sampleRate,
						);
						const monoData = buffer.getChannelData(0);
						stereoBuffer.getChannelData(0).set(monoData);
						stereoBuffer.getChannelData(1).set(monoData);
						finalBuffer = stereoBuffer;
					}

					// Extract underlying PCM channel arrays from the AudioBuffer
					const channels: Float32Array[] = [];
					for (let c = 0; c < finalBuffer.numberOfChannels; c++) {
						channels.push(finalBuffer.getChannelData(c));
					}
					const device = getDevice();

					const elapsedSec = Math.max(
						0,
						scheduledTime - (playbackStartTimeRef.current ?? scheduledTime),
					);
					const chunkFrame =
						playbackStartFrameRef.current + (elapsedSec * fps) / playbackRate;

					for (const procInfo of activeProcessorsRef.current.processors) {
						const proc = audioRegistry.get(
							procInfo.opType,
						) as AudioProcessor | null;
						if (proc) {
							const procLocalFrame =
								chunkFrame +
								accumulatedSeekOffsetSecRef.current * fps -
								(procInfo.virtualMedia.operation?.startFrame ?? 0);
							const elapsedMs = (procLocalFrame / fps) * 1000;
							const durationMs =
								getActiveMediaMetadata(procInfo.virtualMedia)?.durationMs ?? 0;

							try {
								await proc(
									channels,
									finalBuffer.sampleRate,
									procInfo.virtualMedia,
									{
										device,
										frame:
											chunkFrame + accumulatedSeekOffsetSecRef.current * fps,
										fps,
										elapsedMs,
										durationMs,
									},
								);
							} catch (err) {
								console.error(`Error in audio plugin ${procInfo.opType}:`, err);
							}
						}
					}

					const sourceNode = audioCtx.createBufferSource();
					sourceNode.buffer = finalBuffer;
					sourceNode.playbackRate.value = playbackRate;

					sourceNode.connect(gainNode);

					const now = audioCtx.currentTime;
					const playTime = Math.max(now + 0.02, scheduledTime);

					sourceNode.start(playTime);
					activeNodesRef.current.add(sourceNode);

					sourceNode.onended = () => {
						activeNodesRef.current.delete(sourceNode);
					};

					nextScheduleTimeRef.current = playTime + durationSec;

					// Throttle generator if we are scheduling more than 400ms in advance
					while (nextScheduleTimeRef.current - audioCtx.currentTime > 0.4) {
						await new Promise((resolve) => setTimeout(resolve, 50));
						if (
							!isPlayingRef.current ||
							currentGeneratorRef.current !== generator
						) {
							break;
						}
					}
				}
			} catch (e) {
				console.error("NativeAudioClip scheduleLoop error:", e);
			}
		};

		scheduleLoop();
	};

	// Handle play/pause & seek events
	useEffect(() => {
		if (!decoderRef.current || !audioCtx) return;

		// Keep the audio decoder alive and update the ref in case it was pruned/recreated
		const decoderKey = clipId || renderId;
		const decoder = mediaDecoderCache.getAudio(sourceUrl, decoderKey);
		decoderRef.current = decoder;

		if (isPlaying) {
			// If we transitioned to playing, or if we seeked while playing
			const elapsedSec = Math.max(
				0,
				audioCtx.currentTime -
					(playbackStartTimeRef.current ?? audioCtx.currentTime),
			);
			const expectedFrame =
				playbackStartFrameRef.current + (elapsedSec * fps) / playbackRate;
			const hasSeekedWhilePlaying =
				playbackStartTimeRef.current !== null &&
				Math.abs(frame - expectedFrame) > 15;

			const hasParamsChanged =
				lastTrimStartSecRef.current !== trimStartSec ||
				lastStartFramePropRef.current !== startFrame ||
				lastPlaybackRateRef.current !== playbackRate;

			if (
				currentGeneratorRef.current === null ||
				hasSeekedWhilePlaying ||
				hasParamsChanged
			) {
				startPlayback(frame);
			}
		} else {
			stopAllNodes();
			playbackStartTimeRef.current = null;
			lastStartFrameRef.current = null;
		}
	}, [isPlaying, frame, fps, playbackRate, trimStartSec, startFrame]);

	return null;
};

export const AudioCompositionClip: React.FC<{
	renderId: string;
	rootRenderId?: string;
	virtualMedia: VirtualMediaData;
	volume?: number;
	playbackRateOverride?: number;
	trimStartOverride?: number;
	trimEndOverride?: number;
	renderingContext?: "visual" | "audio";
	fps?: number;
	frame?: number;
	disableFrameExtraction?: boolean;
}> = (props) => {
	const {
		renderId,
		rootRenderId = props.renderId,
		virtualMedia: rawVirtualMedia,
		volume = 1,
		playbackRateOverride,
		trimStartOverride,
		trimEndOverride: _trimEndOverride,
	} = props;
	const rawFrame = props.frame;
	let fps = props.fps;
	if (!fps) {
		console.warn("FPS is missing or smaller than 1. Defaulting to 24.");
		fps = 24;
	}
	const { virtualMedia } = React.useMemo(() => {
		const normalized = normalizeTimeline(rawVirtualMedia, fps);
		return { virtualMedia: normalized };
	}, [rawVirtualMedia, fps]);

	const state = useCompositionState(renderId);
	const frame = rawFrame ?? state.frame;
	const op = virtualMedia?.operation;

	const parentAudioContext = React.useContext(AudioProcessorContext);
	const activeProcessors = React.useMemo(() => {
		const hasProcessor = op && audioRegistry.get(op.op) !== null;
		if (hasProcessor && op) {
			return {
				processors: [
					{ opType: op.op, virtualMedia },
					...parentAudioContext.processors,
				],
			};
		}
		return parentAudioContext;
	}, [parentAudioContext, op, virtualMedia]);

	if (!op) return null;

	const opVolume = op.volume ?? 1;
	const effectiveVolume = volume * opVolume;

	// 1. Coordinate System
	const nodeStartFrame = op.startFrame ?? op.timeline?.startFrame ?? 0;
	const localFrame = frame - nodeStartFrame;

	// Multi-Segment Rendering Logic
	const segments = op.timeline?.segments || [];

	const {
		accumulatedSeekOffsetSec: inheritedSeekOffset,
		accumulatedClockOffsetSec: inheritedClockOffset,
	} = useRenderTimeline();

	const renderSegmentInstance = (
		seg: { startSec: number; endSec?: number } | null,
		windowStartFrame: number,
		instanceId: string,
	) => {
		const segmentSeekOffset = seg ? seg.startSec : 0;
		const segmentLocalFrame = localFrame - windowStartFrame;

		const renderChild = (
			childVirtualMedia: VirtualMediaData,
			overrideProps: Partial<typeof props> = {},
		) => {
			const childId = overrideProps.renderId || `${instanceId}-child`;
			if (!childVirtualMedia) {
				return null;
			}
			const childOp = childVirtualMedia.operation;
			const childStartFrame =
				childOp?.startFrame ?? childOp?.timeline?.startFrame ?? 0;
			const childDurationMs =
				getActiveMediaMetadata(childVirtualMedia)?.durationMs ?? 0;
			const childDurationFrames =
				childDurationMs > 0 ? Math.round((childDurationMs / 1000) * fps) : null;

			const currentFrame =
				segmentLocalFrame + Math.round(segmentSeekOffset * (fps || 30));
			if (currentFrame < childStartFrame) {
				return null;
			}
			if (
				childDurationFrames !== null &&
				currentFrame >= childStartFrame + childDurationFrames
			) {
				return null;
			}

			const clip = (
				<AudioCompositionClip
					{...props}
					{...overrideProps}
					frame={overrideProps.frame ?? currentFrame}
					fps={overrideProps.fps ?? fps}
					renderId={childId}
					rootRenderId={rootRenderId}
					virtualMedia={childVirtualMedia}
					renderingContext={overrideProps.renderingContext ?? "audio"}
					volume={overrideProps.volume ?? effectiveVolume}
				/>
			);

			return clip;
		};

		const accumulatedSeekOffsetSec =
			op.op === "Compositor" ? 0 : inheritedSeekOffset + segmentSeekOffset;
		const accumulatedClockOffsetSec =
			inheritedClockOffset + windowStartFrame / (fps || 30);

		// Temporal Barrier: Ensure requested time (frame + inherited seek) is within node duration
		const totalEffectiveFrame = localFrame;

		const renderContent = () => {
			// Temporal Clipping
			if (!seg) {
				const durationMs =
					getActiveMediaMetadata(virtualMedia)?.durationMs ?? 0;
				const durationFrames = Math.round((durationMs / 1000) * fps);
				if (totalEffectiveFrame < 0 || totalEffectiveFrame >= durationFrames) {
					return null;
				}
			} else {
				const durSec = (seg.endSec ?? 0) - seg.startSec;
				const durFrames = Math.max(1, Math.round(durSec * fps));
				if (
					totalEffectiveFrame < windowStartFrame ||
					totalEffectiveFrame >= windowStartFrame + durFrames
				) {
					return null;
				}
			}

			if (op.op === "source") {
				const mediaType = getMediaType(virtualMedia);
				const params = computeRenderParams(virtualMedia);
				if (!params.sourceUrl) return null;

				const finalPlaybackRate = Math.max(
					0.01,
					(Number(playbackRateOverride) || 1) * (Number(params.speed) || 1),
				);

				const effectiveTrimSec = Math.max(
					0,
					(Number(trimStartOverride) || 0) +
						(Number(params.trimStartSec) || 0) +
						accumulatedSeekOffsetSec,
				);

				if (mediaType === "Audio" || mediaType === "Video") {
					return (
						<NativeAudioClip
							sourceUrl={params.sourceUrl}
							renderId={rootRenderId}
							clipId={instanceId}
							frame={frame - Math.round(accumulatedSeekOffsetSec * (fps || 30))}
							fps={fps}
							playbackRate={finalPlaybackRate}
							volume={effectiveVolume * (op.opacity === 0 ? 0 : 1)}
							startFrame={nodeStartFrame}
							trimStartSec={effectiveTrimSec}
						/>
					);
				}

				return null;
			}

			if (virtualMedia.children && virtualMedia.children.length > 0) {
				return (
					<>
						{virtualMedia.children.map((child, index) => (
							<React.Fragment key={index}>
								{renderChild?.(child, {
									renderId: `${instanceId}-c${index}`,
								})}
							</React.Fragment>
						))}
					</>
				);
			}

			return null;
		};

		return (
			<RenderTimelineProvider
				value={{ accumulatedSeekOffsetSec, accumulatedClockOffsetSec }}
			>
				{renderContent()}
			</RenderTimelineProvider>
		);
	};

	if (segments.length > 0) {
		let activeSeg: { startSec: number; endSec?: number } | null = null;
		let windowStartFrame = 0;
		let currentStart = 0;

		for (const seg of segments) {
			const durSec = (seg.endSec ?? 0) - seg.startSec;
			const durFrames = Math.max(1, Math.round(durSec * fps));
			const start = currentStart;
			currentStart += durFrames;

			if (localFrame >= start && localFrame < start + durFrames) {
				activeSeg = seg;
				windowStartFrame = start;
				break;
			}
		}

		if (!activeSeg) {
			return null;
		}

		return (
			<AudioProcessorContext.Provider value={activeProcessors}>
				{renderSegmentInstance(
					activeSeg,
					windowStartFrame,
					`${renderId}-active-seg`,
				)}
			</AudioProcessorContext.Provider>
		);
	}

	return (
		<AudioProcessorContext.Provider value={activeProcessors}>
			{renderSegmentInstance(null, 0, renderId)}
		</AudioProcessorContext.Provider>
	);
};

const DEFAULT_STATE = { frame: 0, fps: 30, isPlaying: false };

class CompositionStateStore {
	private states = new Map<
		string,
		{ frame: number; fps: number; isPlaying: boolean }
	>();
	private listeners = new Map<string, Set<() => void>>();

	setState(key: string, frame: number, fps: number, isPlaying?: boolean) {
		const current = this.states.get(key);
		const resolvedPlaying =
			isPlaying !== undefined ? isPlaying : (current?.isPlaying ?? false);
		if (
			current?.frame === frame &&
			current?.fps === fps &&
			current?.isPlaying === resolvedPlaying
		)
			return;
		this.states.set(key, { frame, fps, isPlaying: resolvedPlaying });
		this.notify(key);
	}

	getState(key: string) {
		if (this.states.has(key)) return this.states.get(key)!;
		for (const [storeKey, value] of this.states.entries()) {
			if (key.startsWith(storeKey)) return value;
		}
		return DEFAULT_STATE;
	}

	subscribe(key: string, listener: () => void) {
		if (!this.listeners.has(key)) this.listeners.set(key, new Set());
		this.listeners.get(key)!.add(listener);
		return () => {
			const set = this.listeners.get(key);
			set?.delete(listener);
			if (set?.size === 0) {
				this.listeners.delete(key);
				this.states.delete(key);
			}
		};
	}

	clearKey(key: string) {
		this.states.delete(key);
	}

	private notify(key: string) {
		for (const [listenerKey, set] of this.listeners.entries()) {
			if (listenerKey === key || listenerKey.startsWith(key)) {
				set.forEach((l) => l());
			}
		}
	}
}

export const compositionStateStore = new CompositionStateStore();

export const useCompositionState = (renderId: string) => {
	const isRendering =
		typeof globalThis !== "undefined" &&
		(globalThis as any).__IS_HEADLESS_RENDERER__ === true;

	if (isRendering) {
		return compositionStateStore.getState(renderId);
	}

	return useSyncExternalStore(
		useCallback(
			(onStoreChange: () => void) =>
				compositionStateStore.subscribe(renderId, onStoreChange),
			[renderId],
		),
		() => compositionStateStore.getState(renderId),
		() => DEFAULT_STATE,
	);
};

export interface SceneProps {
	viewportWidth: number;
	viewportHeight: number;
	containerWidth?: number;
	containerHeight?: number;
	virtualMedia?: VirtualMediaData;
	backgroundColor?: string;
	type?: "Video" | "Audio" | "Image";
	volume?: number;
	renderId?: string;
	frame?: number;
	fps?: number;
	[key: string]: unknown;
}

const noopRenderChild = () => null;

const CompositionSceneInner: React.FC<SceneProps> = ({
	viewportWidth,
	viewportHeight,
	virtualMedia,
	type,
	backgroundColor = "#00000000",
	renderId: propRenderId,
	frame: propFrame,
	fps: propFps,
	...props
}) => {
	const containerRef = useRef<HTMLDivElement>(null);

	// Generate a unique ID for this specific CompositionScene instance
	const sceneId = useId();
	const finalRenderId = (propRenderId ||
		`${sceneId}-root-virtual-media`) as string;

	const state = useCompositionState(finalRenderId);
	const fps = (propFps ?? state.fps ?? 24) as number;
	const frame = (propFrame ?? state.frame ?? 0) as number;
	const isPlaying = state.isPlaying ?? false;

	const resolvedViewportW = viewportWidth || 1080;
	const resolvedViewportH = viewportHeight || 1080;
	const hasAudio =
		virtualMedia?.operation.dataType === "Audio" ||
		virtualMedia?.operation.dataType === "Video";

	const renderContent = () => {
		if (type === "Audio") {
			return (
				<>
					{virtualMedia && hasAudio && (
						<AudioCompositionClip
							renderId={finalRenderId}
							virtualMedia={virtualMedia}
							renderingContext="audio"
							fps={fps}
							frame={frame}
							volume={props.volume}
						/>
					)}
				</>
			);
		}

		return (
			<>
				{virtualMedia && hasAudio && (
					<AudioCompositionClip
						renderId={finalRenderId}
						virtualMedia={virtualMedia}
						renderingContext="audio"
						fps={fps}
						frame={frame}
						volume={props.volume}
					/>
				)}
				<div
					style={{ width: "100%", height: "100%", position: "relative" }}
					ref={containerRef}
				>
					{virtualMedia && virtualMedia.operation.dataType !== "Audio" && (
						<RenderProvider
							width={resolvedViewportW}
							height={resolvedViewportH}
						>
							<CanvasComposition
								renderChild={noopRenderChild}
								renderId={finalRenderId}
								virtualMedia={virtualMedia}
								containerWidth={resolvedViewportW}
								containerHeight={resolvedViewportH}
								frame={frame}
								fps={fps}
								isPlaying={isPlaying}
							/>
						</RenderProvider>
					)}
				</div>
			</>
		);
	};

	return (
		<PlaybackProvider value={{ frame, fps, isPlaying }}>
			{renderContent()}
		</PlaybackProvider>
	);
};

export const CompositionScene: React.FC<SceneProps> = (props) => {
	return <CompositionSceneInner {...props} />;
};
