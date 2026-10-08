import type { LayerAnimation } from "@framefields/compositions/program";
import type { VirtualMediaData } from "@framefields/core";
import {
	type AudioProcessor,
	audioRegistry,
	resolveBoolean,
	resolveNumber,
} from "@framefields/node-sdk";
import { compileLayerTimeline } from "../shared/compiler.js";

interface CompositorOperation {
	op: "Compositor" | "CompositorLayer";
	id?: string;
	inputHandleId?: string;
	volume?: number;
	muted?: boolean;
	animation?: LayerAnimation;
}

export const compositorLayerAudioProcessor: AudioProcessor = async (
	channels: Float32Array[],
	sampleRate: number,
	virtualMedia: VirtualMediaData,
	ctx,
) => {
	const op = virtualMedia.operation as unknown as CompositorOperation;
	if (!op) return;

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// Master gain (L1): the audio extractor dispatches this processor for the
	// root Compositor op too (registered under the node type "Compositor").
	// The root's channels ARE the fully-mixed composition, so scale them
	// once by the program-level `volume` — the per-layer path below handles
	// each CompositorLayer op's own volume/mute animation.
	if (op.op === "Compositor") {
		const master = resolveNumber(op.volume, 1);
		if (master === 1) return;
		for (let c = 0; c < numChannels; c++) {
			const ch = channels[c];
			for (let i = 0; i < ch.length; i++) ch[i] *= master;
		}
		return;
	}

	const volume = resolveNumber(op.volume, 1);
	const muted = resolveBoolean(op.muted, false);
	const animation = op.animation;
	const fps = ctx?.fps ?? 24;

	// Check if there are active volume or muted animation tracks with keyframes
	const tracks = animation?.tracks || [];
	const hasVolumeKeys = tracks.some(
		(t) => t.prop === "volume" && t.keyframes && t.keyframes.length > 0,
	);
	const hasMutedKeys = tracks.some(
		(t) => t.prop === "muted" && t.keyframes && t.keyframes.length > 0,
	);

	if (!hasVolumeKeys && !hasMutedKeys) {
		// If no animated volume/muted tracks exist, the static volume and mute state
		// have already been applied by the child clip or audio extractor.
		return;
	}

	// Compile or retrieve the GSAP timeline for this layer
	const { tl, stub } = compileLayerTimeline(
		op.id || op.inputHandleId || "layer",
		animation,
		volume,
		muted,
		fps,
	);

	const elapsedMs = ctx?.elapsedMs ?? 0;
	const startTimeSec = elapsedMs / 1000;

	// Process in sub-chunks of 128 samples to be fast and smooth
	const subChunkSize = 128;

	// Seek to the starting time to establish baseline values
	tl.seek(startTimeSec);
	let lastVol = stub.volume;
	let lastMuted = stub.muted;

	const baseGain = muted ? 0 : volume;

	for (let i = 0; i < numSamples; i += subChunkSize) {
		const nextI = Math.min(numSamples, i + subChunkSize);
		const tNext = startTimeSec + (nextI - i) / sampleRate;
		tl.seek(tNext);
		const nextVol = stub.volume;
		const nextMuted = stub.muted;

		for (let j = i; j < nextI; j++) {
			const p = (j - i) / (nextI - i);
			// L3: clamp — keyframes are schema-bounded to 0–1, but a lerp
			// between in-range values can overshoot with custom eases; the
			// relativeGain compensation below must never amplify past the
			// channel's own scale.
			const currentVol = Math.min(
				1,
				Math.max(0, lastVol + (nextVol - lastVol) * p),
			);
			// For muted, if it changes mid-sub-chunk, toggle it at the halfway point
			const currentMuted = j - i < (nextI - i) / 2 ? lastMuted : nextMuted;

			const finalGain = currentMuted ? 0 : currentVol;
			const relativeGain = baseGain === 0 ? 0 : finalGain / baseGain;

			if (relativeGain !== 1) {
				for (let c = 0; c < numChannels; c++) {
					channels[c][j] *= relativeGain;
				}
			}
		}

		lastVol = nextVol;
		lastMuted = nextMuted;
	}
};

// Register immediately on load
audioRegistry.register("CompositorLayer", compositorLayerAudioProcessor);
