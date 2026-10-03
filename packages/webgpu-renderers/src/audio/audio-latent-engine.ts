/**
 * @file audio-latent-engine.ts
 * Real-time Audio Latent & Spectral Vector Engine for 3D Mesh Deformation.
 * Implements 2048-point Hann-windowed Radix-2 STFT, 1024-band frequency spectrum calculation,
 * multi-band latent energy extraction (bass, drum transient flux, vocal formant),
 * and WebGPU AudioLatentBuffer storage packing.
 */

export interface AudioLatentData {
	/** 1024 positive frequency bin magnitudes [0, 1023] normalized */
	fftBins: Float32Array; // length 1024
	/** Normalized low-frequency energy (20 - 150 Hz sub-bass / kick envelope) */
	bassEnergy: number;
	/** Percussive transient attack / spectral flux delta */
	drumTransient: number;
	/** Mid-frequency speech / melody formant presence (300 - 3400 Hz) */
	vocalEnergy: number;
	/** Frame timestamp in milliseconds */
	timeMs: number;
}

export const FFT_SIZE = 2048;
export const NUM_BINS = 1024;
export const AUDIO_LATENT_BUFFER_SIZE = (NUM_BINS + 4) * 4; // (1024 + 4) * 4 = 4112 bytes

// Pre-computed Hann window for N = 2048
const HANN_WINDOW = new Float32Array(FFT_SIZE);
for (let n = 0; n < FFT_SIZE; n++) {
	HANN_WINDOW[n] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / (FFT_SIZE - 1)));
}

// Pre-computed bit-reversal permutation table for N = 2048
const BIT_REVERSE = new Uint16Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
	let rev = 0;
	let val = i;
	for (let j = 0; j < 11; j++) {
		// 2^11 = 2048
		rev = (rev << 1) | (val & 1);
		val >>= 1;
	}
	BIT_REVERSE[i] = rev;
}

// Pre-computed twiddle factors
const COS_TABLE = new Float32Array(FFT_SIZE / 2);
const SIN_TABLE = new Float32Array(FFT_SIZE / 2);
for (let k = 0; k < FFT_SIZE / 2; k++) {
	const angle = (-2.0 * Math.PI * k) / FFT_SIZE;
	COS_TABLE[k] = Math.cos(angle);
	SIN_TABLE[k] = Math.sin(angle);
}

/**
 * Computes in-place 2048-point Radix-2 Cooley-Tukey FFT.
 * Accepts real and imaginary Float32Array buffers of length 2048.
 */
export function computeFFT2048(real: Float32Array, imag: Float32Array): void {
	// Bit-reversal permutation
	for (let i = 0; i < FFT_SIZE; i++) {
		const j = BIT_REVERSE[i] ?? 0;
		if (j > i) {
			const tr = real[i] ?? 0;
			real[i] = real[j] ?? 0;
			real[j] = tr;

			const ti = imag[i] ?? 0;
			imag[i] = imag[j] ?? 0;
			imag[j] = ti;
		}
	}

	// Cooley-Tukey butterfly stages
	for (let len = 2; len <= FFT_SIZE; len <<= 1) {
		const halfLen = len >> 1;
		const step = FFT_SIZE / len;

		for (let i = 0; i < FFT_SIZE; i += len) {
			for (let k = 0; k < halfLen; k++) {
				const twiddleIdx = k * step;
				const cos = COS_TABLE[twiddleIdx] ?? 1.0;
				const sin = SIN_TABLE[twiddleIdx] ?? 0.0;

				const uReal = real[i + k] ?? 0;
				const uImag = imag[i + k] ?? 0;

				const vReal = real[i + k + halfLen] ?? 0;
				const vImag = imag[i + k + halfLen] ?? 0;

				// Complex multiplication: (vReal + i * vImag) * (cos + i * sin)
				const tReal = vReal * cos - vImag * sin;
				const tImag = vReal * sin + vImag * cos;

				real[i + k] = uReal + tReal;
				imag[i + k] = uImag + tImag;

				real[i + k + halfLen] = uReal - tReal;
				imag[i + k + halfLen] = uImag - tImag;
			}
		}
	}
}

/**
 * Fast Audio Latent and Spectral Vector Processor.
 */
export class AudioLatentEngine {
	private tempReal = new Float32Array(FFT_SIZE);
	private tempImag = new Float32Array(FFT_SIZE);
	private previousBins = new Float32Array(NUM_BINS);

	/**
	 * Extracts 1024-band FFT and audio latent energies at a specific playback time.
	 */
	public extractAtTime(
		channels: Float32Array[],
		sampleRate: number,
		timeSec: number,
	): AudioLatentData {
		const numChannels = channels.length;
		const totalSamples = numChannels > 0 ? (channels[0]?.length ?? 0) : 0;
		const centerSample = Math.round(timeSec * sampleRate);
		const startSample = centerSample - (FFT_SIZE >> 1);

		// 1. Ingest windowed samples into real buffer
		for (let i = 0; i < FFT_SIZE; i++) {
			const sampleIdx = startSample + i;
			let sampleVal = 0;
			if (sampleIdx >= 0 && sampleIdx < totalSamples) {
				if (numChannels === 1) {
					sampleVal = channels[0]?.[sampleIdx] ?? 0;
				} else if (numChannels >= 2) {
					// Mix stereo to mono
					sampleVal =
						((channels[0]?.[sampleIdx] ?? 0) +
							(channels[1]?.[sampleIdx] ?? 0)) *
						0.5;
				}
			}
			this.tempReal[i] = sampleVal * (HANN_WINDOW[i] ?? 1.0);
			this.tempImag[i] = 0.0;
		}

		// 2. Execute 2048-point Radix-2 FFT
		computeFFT2048(this.tempReal, this.tempImag);

		// 3. Compute 1024 positive frequency magnitudes
		const fftBins = new Float32Array(NUM_BINS);
		const normFactor = 2.0 / FFT_SIZE;

		for (let k = 0; k < NUM_BINS; k++) {
			const r = this.tempReal[k] ?? 0;
			const im = this.tempImag[k] ?? 0;
			// Magnitude scaled with Hann window compensation
			fftBins[k] = Math.sqrt(r * r + im * im) * normFactor * 2.0;
		}

		// 4. Compute Sub-band Latent Energies
		const hzPerBin = sampleRate / FFT_SIZE;

		// Bass band: 20 Hz to 150 Hz
		const bassStartBin = Math.max(1, Math.round(20 / hzPerBin));
		const bassEndBin = Math.max(bassStartBin + 1, Math.round(150 / hzPerBin));
		let bassSum = 0;
		for (let k = bassStartBin; k <= bassEndBin && k < NUM_BINS; k++) {
			bassSum += (fftBins[k] ?? 0) * (fftBins[k] ?? 0);
		}
		const bassEnergy = Math.min(
			1.0,
			Math.sqrt(bassSum / (bassEndBin - bassStartBin + 1)) * 4.0,
		);

		// Drum transient: Half-wave rectified spectral flux
		let fluxSum = 0;
		for (let k = 0; k < NUM_BINS; k++) {
			const diff = (fftBins[k] ?? 0) - (this.previousBins[k] ?? 0);
			if (diff > 0) fluxSum += diff;
			this.previousBins[k] = fftBins[k] ?? 0;
		}
		const drumTransient = Math.min(1.0, fluxSum * 0.15);

		// Vocal formant band: 300 Hz to 3400 Hz
		const vocalStartBin = Math.round(300 / hzPerBin);
		const vocalEndBin = Math.min(NUM_BINS - 1, Math.round(3400 / hzPerBin));
		let vocalSum = 0;
		for (let k = vocalStartBin; k <= vocalEndBin; k++) {
			vocalSum += (fftBins[k] ?? 0) * (fftBins[k] ?? 0);
		}
		const vocalEnergy = Math.min(
			1.0,
			Math.sqrt(vocalSum / (vocalEndBin - vocalStartBin + 1)) * 3.5,
		);

		return {
			fftBins,
			bassEnergy,
			drumTransient,
			vocalEnergy,
			timeMs: timeSec * 1000,
		};
	}

	/**
	 * Packs AudioLatentData into a Float32Array suitable for WebGPU storage buffer upload.
	 * Struct layout:
	 *  0..1023: fftBins (array<f32, 1024>)
	 *  1024:    bassEnergy
	 *  1025:    drumTransient
	 *  1026:    vocalEnergy
	 *  1027:    timeMs
	 */
	public static packBufferData(data: AudioLatentData): Float32Array {
		const bufferData = new Float32Array(NUM_BINS + 4);
		bufferData.set(data.fftBins, 0);
		bufferData[1024] = data.bassEnergy;
		bufferData[1025] = data.drumTransient;
		bufferData[1026] = data.vocalEnergy;
		bufferData[1027] = data.timeMs;
		return bufferData;
	}

	/**
	 * Creates a WebGPU GPUBuffer initialized with AudioLatentData.
	 */
	public static createGpuBuffer(
		device: GPUDevice,
		data?: AudioLatentData,
	): GPUBuffer {
		const rawFloats = data
			? AudioLatentEngine.packBufferData(data)
			: new Float32Array(NUM_BINS + 4);

		const buffer = device.createBuffer({
			label: "AudioLatentBuffer",
			size: AUDIO_LATENT_BUFFER_SIZE,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Float32Array(buffer.getMappedRange()).set(rawFloats);
		buffer.unmap();
		return buffer;
	}

	/**
	 * Updates an existing WebGPU AudioLatentBuffer with new frame data.
	 */
	public static updateGpuBuffer(
		device: GPUDevice,
		buffer: GPUBuffer,
		data: AudioLatentData,
	): void {
		const rawFloats = AudioLatentEngine.packBufferData(data);
		device.queue.writeBuffer(buffer, 0, rawFloats);
	}
}

/**
 * Cache for a full audio track timeline providing O(1) frame lookup during video rendering.
 */
export class AudioLatentTrackCache {
	private frames: AudioLatentData[] = [];
	private gpuBuffers = new WeakMap<GPUDevice, Map<number, GPUBuffer>>();

	constructor(
		public readonly channels: Float32Array[],
		public readonly sampleRate: number,
		public readonly fps: number,
		public readonly totalFrames: number,
	) {
		const engine = new AudioLatentEngine();
		const sRate = sampleRate || 48000;
		const safeFps = fps || 30;
		const channelLength = channels[0]?.length ?? 0;
		const fallbackFrames = Math.max(10, Math.ceil((channelLength / sRate) * safeFps) + 10);
		const safeTotal =
			typeof totalFrames === "number" && Number.isFinite(totalFrames) && totalFrames > 0
				? Math.round(totalFrames)
				: fallbackFrames;
		this.frames = new Array(safeTotal);
		for (let f = 0; f < safeTotal; f++) {
			const timeSec = f / safeFps;
			this.frames[f] = engine.extractAtTime(channels, sRate, timeSec);
		}
	}

	public getFrameData(frame: number): AudioLatentData {
		const clampedFrame = Math.max(
			0,
			Math.min(this.totalFrames - 1, Math.round(frame)),
		);
		return (
			this.frames[clampedFrame] ?? {
				fftBins: new Float32Array(NUM_BINS),
				bassEnergy: 0,
				drumTransient: 0,
				vocalEnergy: 0,
				timeMs: (clampedFrame / this.fps) * 1000,
			}
		);
	}

	public getGpuBuffer(device: GPUDevice, frame: number): GPUBuffer {
		let deviceMap = this.gpuBuffers.get(device);
		if (!deviceMap) {
			deviceMap = new Map();
			this.gpuBuffers.set(device, deviceMap);
		}

		const clampedFrame = Math.max(
			0,
			Math.min(this.totalFrames - 1, Math.round(frame)),
		);
		let buffer = deviceMap.get(clampedFrame);
		if (!buffer) {
			const data = this.getFrameData(clampedFrame);
			buffer = AudioLatentEngine.createGpuBuffer(device, data);
			deviceMap.set(clampedFrame, buffer);
		}
		return buffer;
	}
}
