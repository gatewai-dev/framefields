/**
 * @file packages/framefields/src/audio/synth/wav-encoder.ts
 * High-performance 16-bit PCM RIFF/WAVE stereo audio encoder.
 */

export interface EncodeWavOptions {
	sampleRate?: number;
}

/**
 * Encodes stereo Float32Array PCM channels (-1.0 to +1.0) into a standard 16-bit RIFF/WAVE Buffer.
 */
export function encodeStereoWav(
	channels: [Float32Array, Float32Array],
	options: EncodeWavOptions = {},
): Buffer {
	const sampleRate = options.sampleRate ?? 48000;
	const numChannels = 2;
	const left = channels[0];
	const right = channels[1];
	const numSamples = Math.min(left.length, right.length);

	const bytesPerSample = 2; // 16-bit
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numSamples * blockAlign;
	const totalSize = 44 + dataSize;

	const buffer = Buffer.alloc(totalSize);

	// RIFF Header
	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8, "ascii");

	// "fmt " chunk
	buffer.write("fmt ", 12, "ascii");
	buffer.writeUInt32LE(16, 16); // PCM header size
	buffer.writeUInt16LE(1, 20); // AudioFormat 1 = PCM
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(16, 34); // Bits per sample

	// "data" chunk
	buffer.write("data", 36, "ascii");
	buffer.writeUInt32LE(dataSize, 40);

	let offset = 44;
	for (let i = 0; i < numSamples; i++) {
		// Left channel
		const sl = Math.max(-1, Math.min(1, left[i] ?? 0));
		const intL = sl < 0 ? sl * 0x8000 : sl * 0x7fff;
		buffer.writeInt16LE(Math.round(intL), offset);
		offset += 2;

		// Right channel
		const sr = Math.max(-1, Math.min(1, right[i] ?? 0));
		const intR = sr < 0 ? sr * 0x8000 : sr * 0x7fff;
		buffer.writeInt16LE(Math.round(intR), offset);
		offset += 2;
	}

	return buffer;
}
