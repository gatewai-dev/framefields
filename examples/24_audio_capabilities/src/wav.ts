/**
 * Encodes stereo/mono Float32Array PCM channel buffers to a 16-bit PCM RIFF WAV buffer.
 */
export function pcmToWav(
	channels: readonly Float32Array[],
	sampleRate = 48000,
): Buffer {
	const numChannels = channels.length;
	if (numChannels === 0) {
		throw new Error("Cannot encode WAV: channels array is empty");
	}
	const numSamples = channels[0]?.length ?? 0;
	const byteRate = sampleRate * numChannels * 2;
	const blockAlign = numChannels * 2;
	const dataSize = numSamples * numChannels * 2;
	const buffer = Buffer.alloc(44 + dataSize);

	// RIFF chunk header
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);

	// "fmt " subchunk
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16); // Subchunk1Size for PCM
	buffer.writeUInt16LE(1, 20); // AudioFormat: 1 (PCM)
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(16, 34); // BitsPerSample: 16

	// "data" subchunk
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);

	let offset = 44;
	for (let i = 0; i < numSamples; i++) {
		for (let c = 0; c < numChannels; c++) {
			const channelData = channels[c];
			const sample = Math.max(-1, Math.min(1, channelData?.[i] ?? 0));
			const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
			buffer.writeInt16LE(Math.round(intSample), offset);
			offset += 2;
		}
	}

	return buffer;
}
