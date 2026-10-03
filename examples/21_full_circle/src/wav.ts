/**
 * RIFF/WAVE reader for the score analyzer: integer PCM (16/24/32-bit) and
 * 32-bit float, any channel count, mixed down to mono.
 */
import fs from "node:fs/promises";

export interface MonoAudio {
	samples: Float32Array;
	sampleRate: number;
}

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export async function readWav(file: string): Promise<MonoAudio> {
	return decodeWav(await fs.readFile(file));
}

export function decodeWav(buf: Buffer): MonoAudio {
	if (
		buf.toString("ascii", 0, 4) !== "RIFF" ||
		buf.toString("ascii", 8, 12) !== "WAVE"
	) {
		throw new Error("not a RIFF/WAVE file");
	}
	let format = 0;
	let channels = 0;
	let sampleRate = 0;
	let bits = 0;
	for (let at = 12; at + 8 <= buf.length; ) {
		const id = buf.toString("ascii", at, at + 4);
		const size = buf.readUInt32LE(at + 4);
		const body = at + 8;
		if (id === "fmt ") {
			format = buf.readUInt16LE(body);
			channels = buf.readUInt16LE(body + 2);
			sampleRate = buf.readUInt32LE(body + 4);
			bits = buf.readUInt16LE(body + 14);
			// WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
			if (format === EXTENSIBLE) format = buf.readUInt16LE(body + 24);
		} else if (id === "data") {
			if (!channels) throw new Error("data chunk before fmt chunk");
			const end = Math.min(buf.length, body + size);
			return {
				samples: mixdown(buf.subarray(body, end), format, channels, bits),
				sampleRate,
			};
		}
		at = body + size + (size & 1);
	}
	throw new Error("no data chunk");
}

function mixdown(
	data: Buffer,
	format: number,
	channels: number,
	bits: number,
): Float32Array {
	const read = sampleReader(format, bits);
	const bytes = bits / 8;
	const frames = Math.floor(data.length / (bytes * channels));
	const out = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		let sum = 0;
		for (let c = 0; c < channels; c++)
			sum += read(data, (i * channels + c) * bytes);
		out[i] = sum / channels;
	}
	return out;
}

function sampleReader(
	format: number,
	bits: number,
): (b: Buffer, at: number) => number {
	if (format === FLOAT && bits === 32) return (b, at) => b.readFloatLE(at);
	if (format !== PCM)
		throw new Error(`unsupported WAV format ${format}/${bits}-bit`);
	if (bits === 16) return (b, at) => b.readInt16LE(at) / 32768;
	if (bits === 24) return (b, at) => b.readIntLE(at, 3) / 8388608;
	if (bits === 32) return (b, at) => b.readInt32LE(at) / 2147483648;
	throw new Error(`unsupported PCM depth ${bits}`);
}
