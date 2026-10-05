import { decodeAudioSource } from "@framefields/compositions";
import {
	type FrameSignal,
	frameArraySignal,
	type GPUTextureBinding,
} from "@framefields/core";
import {
	type AudioSignalComputeConfig,
	AudioSignalComputePipeline,
	ensureDevice,
} from "@framefields/webgpu-renderers";

export interface AudioSignalOptions extends AudioSignalComputeConfig {
	fps?: number;
	targetWidth?: number;
	previewMode?: "waveform" | "envelope" | "beat_markers" | "spectrum";
}

export interface ExtractedAudioSignalsBundle {
	primary: FrameSignal<number>;
	beat: FrameSignal<number>;
	bass: FrameSignal<number>;
	energy: FrameSignal<number>;
	durationSec: number;
	numFrames: number;
	sampleRate: number;
	textureView: unknown;
	texture: unknown;
	primaryBuffer: unknown;
	beatBuffer: unknown;
	bassBuffer: unknown;
	energyBuffer: unknown;
	seekFrame(frame: number): void;
}

export const AudioSignal = {
	async extractFromChannels(
		channels: Float32Array[],
		sampleRate: number,
		options: AudioSignalOptions = {},
	): Promise<ExtractedAudioSignalsBundle> {
		const device = await ensureDevice();
		const fps = options.fps ?? 24;
		const targetWidth = options.targetWidth ?? 512;

		const extracted = await AudioSignalComputePipeline.extractFeatures(
			device,
			channels,
			sampleRate,
			fps,
			options,
			targetWidth,
		);

		const samples = extracted.channelSamples ?? {
			primary: new Float32Array(extracted.numFrames),
			beat: new Float32Array(extracted.numFrames),
			bass: new Float32Array(extracted.numFrames),
			energy: new Float32Array(extracted.numFrames),
		};

		const primaryBinding: GPUTextureBinding = {
			nodeId: "audio_primary",
			channel: "primary",
			textureView: extracted.textureView,
			texture: extracted.texture,
			buffer: extracted.primaryBuffer,
			stats: extracted.stats.primary,
		};
		const beatBinding: GPUTextureBinding = {
			nodeId: "audio_beat",
			channel: "beat",
			textureView: extracted.textureView,
			texture: extracted.texture,
			buffer: extracted.beatBuffer,
			stats: extracted.stats.beat,
		};
		const bassBinding: GPUTextureBinding = {
			nodeId: "audio_bass",
			channel: "bass",
			textureView: extracted.textureView,
			texture: extracted.texture,
			buffer: extracted.bassBuffer,
			stats: extracted.stats.bass,
		};
		const energyBinding: GPUTextureBinding = {
			nodeId: "audio_energy",
			channel: "energy",
			textureView: extracted.textureView,
			texture: extracted.texture,
			buffer: extracted.energyBuffer,
			stats: extracted.stats.energy,
		};

		const primary = frameArraySignal(samples.primary, fps, primaryBinding);
		const beat = frameArraySignal(samples.beat, fps, beatBinding);
		const bass = frameArraySignal(samples.bass, fps, bassBinding);
		const energy = frameArraySignal(samples.energy, fps, energyBinding);

		return {
			primary,
			beat,
			bass,
			energy,
			durationSec: extracted.durationSec,
			numFrames: extracted.numFrames,
			sampleRate,
			textureView: extracted.textureView,
			texture: extracted.texture,
			primaryBuffer: extracted.primaryBuffer,
			beatBuffer: extracted.beatBuffer,
			bassBuffer: extracted.bassBuffer,
			energyBuffer: extracted.energyBuffer,
			seekFrame(frame: number) {
				primary.seekFrame?.(frame);
				beat.seekFrame?.(frame);
				bass.seekFrame?.(frame);
				energy.seekFrame?.(frame);
			},
		};
	},

	async extract(
		source: string,
		options: AudioSignalOptions = {},
	): Promise<ExtractedAudioSignalsBundle> {
		const decoded = await decodeAudioSource(source);
		if (!decoded || decoded.channels.length === 0) {
			throw new Error(
				`Failed to decode audio source for feature extraction: ${source}`,
			);
		}
		return AudioSignal.extractFromChannels(
			decoded.channels,
			decoded.sampleRate,
			options,
		);
	},
};
