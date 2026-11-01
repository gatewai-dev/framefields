/**
 * Joins the chunks of one render split across workers. Each chunk is made
 * with `renderVideo({ frames, audio: false })`, starts on a keyframe and
 * timestamps from 0; the stitch copies their encoded frames into one track,
 * shifted to follow each other, and copies in the audio track of a separate
 * audio-only render. Nothing is decoded or re-encoded, so it needs no GPU.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
	ALL_FORMATS,
	EncodedAudioPacketSource,
	type EncodedPacket,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	FilePathSource,
	FilePathTarget,
	Input,
	type InputAudioTrack,
	type InputVideoTrack,
	Mp4OutputFormat,
	Output,
	type VideoCodec,
	WebMOutputFormat,
} from "mediabunny";

export interface StitchOptions {
	/** Chunk files in timeline order, each a `renderVideo({ frames, audio: false })` output. */
	chunks: readonly string[];
	/**
	 * An audio-only render of the whole timeline (`renderVideo({ codec: "aac" })`,
	 * or `"opus"` for WebM chunks), copied in as the audio track.
	 */
	audio?: string;
	outputPath: string;
	/** Stops between packets; the promise rejects and no file is left behind. */
	signal?: AbortSignal;
}

export interface StitchResult {
	filePath: string;
	/** Video frames written, across all chunks. */
	frames: number;
	/** End of the video track, in seconds. */
	durationSec: number;
}

type VideoConfig = NonNullable<
	Awaited<ReturnType<InputVideoTrack["getDecoderConfig"]>>
>;
type AudioConfig = NonNullable<
	Awaited<ReturnType<InputAudioTrack["getDecoderConfig"]>>
>;

interface VideoChunk {
	file: string;
	input: Input;
	track: InputVideoTrack;
	codec: VideoCodec;
	config: VideoConfig;
}

export async function stitchChunks(
	options: StitchOptions,
): Promise<StitchResult> {
	if (options.chunks.length === 0)
		throw new Error("stitchChunks needs at least one chunk.");
	const inputs: Input[] = [];
	const open = (file: string) => {
		const input = new Input({
			source: new FilePathSource(file),
			formats: ALL_FORMATS,
		});
		inputs.push(input);
		return input;
	};
	let output: Output | undefined;
	try {
		const chunks = await Promise.all(
			options.chunks.map((file) => openVideoChunk(file, open(file))),
		);
		const [reference] = chunks as [VideoChunk, ...VideoChunk[]];
		for (const chunk of chunks.slice(1)) assertSameEncoding(reference, chunk);

		const webm = (await reference.input.getMimeType()).includes("webm");
		await fs.mkdir(path.dirname(path.resolve(options.outputPath)), {
			recursive: true,
		});
		output = new Output({
			format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(),
			target: new FilePathTarget(options.outputPath),
		});
		const video = new EncodedVideoPacketSource(reference.codec);
		output.addVideoTrack(video);
		const audio = options.audio
			? await AudioCopier.open(options.audio, open(options.audio), output)
			: undefined;

		await output.start();
		const written = await copyVideo(chunks, video, audio, options.signal);
		await audio?.writeUntil(Number.POSITIVE_INFINITY, options.signal);
		await output.finalize();
		output = undefined;
		return { filePath: options.outputPath, ...written };
	} catch (error) {
		if (output) {
			await output.cancel().catch(() => {});
			await fs.rm(options.outputPath, { force: true });
		}
		throw error;
	} finally {
		for (const input of inputs) input.dispose();
	}
}

async function openVideoChunk(file: string, input: Input): Promise<VideoChunk> {
	const track = await input.getPrimaryVideoTrack();
	if (!track) throw new Error(`Chunk ${file} has no video track.`);
	const codec = await track.getCodec();
	const config = await track.getDecoderConfig();
	if (!codec || !config)
		throw new Error(`Chunk ${file}: its video codec cannot be read.`);
	return { file, input, track, codec, config };
}

/**
 * Copied frames are decoded with the first chunk's codec configuration, so
 * every chunk must have been encoded with the same one.
 */
function assertSameEncoding(reference: VideoChunk, chunk: VideoChunk): void {
	const a = reference.config;
	const b = chunk.config;
	const differs =
		a.codec !== b.codec
			? `codec ${b.codec}, not ${a.codec}`
			: a.codedWidth !== b.codedWidth || a.codedHeight !== b.codedHeight
				? `size ${b.codedWidth}x${b.codedHeight}, not ${a.codedWidth}x${a.codedHeight}`
				: !sameBytes(a.description, b.description)
					? "different encoder parameters (SPS/PPS)"
					: undefined;
	if (differs)
		throw new Error(
			`Chunk ${chunk.file} has ${differs} than ${reference.file}. Render every chunk with the same framefields version, codec and quality, on the same GPU type.`,
		);
}

function sameBytes(
	a: VideoConfig["description"],
	b: VideoConfig["description"],
): boolean {
	if (!a || !b) return a === b;
	const x = toBytes(a);
	const y = toBytes(b);
	return x.length === y.length && x.every((v, i) => v === y[i]);
}

function toBytes(data: NonNullable<VideoConfig["description"]>): Uint8Array {
	return ArrayBuffer.isView(data)
		? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		: new Uint8Array(data);
}

/** Writes every chunk's frames, each chunk starting where the last one ended. */
async function copyVideo(
	chunks: readonly VideoChunk[],
	video: EncodedVideoPacketSource,
	audio: AudioCopier | undefined,
	signal: AbortSignal | undefined,
): Promise<{ frames: number; durationSec: number }> {
	let offset = 0;
	let frames = 0;
	for (const chunk of chunks) {
		let first: number | undefined;
		let end = offset;
		for await (const packet of new EncodedPacketSink(chunk.track).packets()) {
			signal?.throwIfAborted();
			if (first === undefined) {
				if (packet.type !== "key")
					throw new Error(`Chunk ${chunk.file} does not start on a keyframe.`);
				first = packet.timestamp;
			}
			const timestamp = offset + packet.timestamp - first;
			// Interleaved: audio up to this frame goes in first.
			await audio?.writeUntil(timestamp, signal);
			await video.add(
				packet.clone({ timestamp }),
				frames === 0 ? { decoderConfig: chunk.config } : undefined,
			);
			frames++;
			end = Math.max(end, timestamp + packet.duration);
		}
		if (first === undefined)
			throw new Error(`Chunk ${chunk.file} has no video frames.`);
		offset = end;
	}
	return { frames, durationSec: offset };
}

/** Copies an audio track's packets in timestamp order, as far as asked. */
class AudioCopier {
	private readonly packets: AsyncGenerator<EncodedPacket, void>;
	/** The next packet to write; `undefined` until read, `null` at the end. */
	private next: EncodedPacket | null | undefined;
	private written = 0;

	private constructor(
		track: InputAudioTrack,
		private readonly config: AudioConfig,
		private readonly source: EncodedAudioPacketSource,
	) {
		this.packets = new EncodedPacketSink(track).packets();
	}

	static async open(
		file: string,
		input: Input,
		output: Output,
	): Promise<AudioCopier> {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error(`Audio file ${file} has no audio track.`);
		const config = await track.getDecoderConfig();
		const codec = await track.getCodec();
		if (!config || !codec)
			throw new Error(`Audio file ${file}: its codec cannot be read.`);
		const source = new EncodedAudioPacketSource(codec);
		output.addAudioTrack(source);
		return new AudioCopier(track, config, source);
	}

	async writeUntil(timestamp: number, signal?: AbortSignal): Promise<void> {
		for (;;) {
			if (this.next === undefined)
				this.next = (await this.packets.next()).value ?? null;
			const packet = this.next;
			if (!packet || packet.timestamp > timestamp) return;
			signal?.throwIfAborted();
			await this.source.add(
				packet,
				this.written === 0 ? { decoderConfig: this.config } : undefined,
			);
			this.written++;
			this.next = undefined;
		}
	}
}
