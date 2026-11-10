/**
 * Joins the chunks of one split render without decoding or re-encoding: their
 * encoded frames are copied into one track, each chunk shifted to follow the
 * last, and the audio track of a separate audio-only render is copied in
 * beside them. Every chunk starts on a keyframe with timestamps from 0 and
 * was encoded with the same settings. Works on any mediabunny `Source` and
 * `Target`, so the same stitch runs on files in Node (`stitchChunks`) and on
 * OPFS files or Blobs in a browser.
 */
import {
	ALL_FORMATS,
	EncodedAudioPacketSource,
	type EncodedPacket,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	type InputAudioTrack,
	type InputVideoTrack,
	Mp4OutputFormat,
	Output,
	type Source,
	type Target,
	type VideoCodec,
	WebMOutputFormat,
} from "mediabunny";

/** A file to read: a name for errors, and its bytes as a mediabunny `Source`. */
export interface StitchInput {
	name: string;
	source: Source;
}

export interface StitchSegmentsOptions {
	/** The chunks in timeline order, each a video-only render of its frames. */
	chunks: readonly StitchInput[];
	/** An audio-only render of the whole timeline, copied in as the audio track. */
	audio?: StitchInput;
	/** Where the joined file goes (MP4, or WebM when the chunks are WebM). */
	target: Target;
	/** Stops between packets; the promise rejects and the output is cancelled. */
	signal?: AbortSignal;
}

export interface StitchedTracks {
	/** Video frames written, across all chunks. */
	frames: number;
	/** End of the video track, in seconds. */
	durationSec: number;
}

/**
 * Copies every chunk's frames, then the rest of the audio, into `target`.
 * On failure the output is cancelled; deleting what `target` wrote is the
 * caller's.
 */
export async function stitchSegments(
	options: StitchSegmentsOptions,
): Promise<StitchedTracks> {
	if (options.chunks.length === 0)
		throw new Error("stitchSegments needs at least one chunk.");
	const inputs: Input[] = [];
	const open = (file: StitchInput) => {
		const input = new Input({ source: file.source, formats: ALL_FORMATS });
		inputs.push(input);
		return input;
	};
	let output: Output | undefined;
	try {
		const chunks = await Promise.all(
			options.chunks.map((file) => openVideoChunk(file.name, open(file))),
		);
		const [reference] = chunks as [VideoChunk, ...VideoChunk[]];
		for (const chunk of chunks.slice(1)) assertSameEncoding(reference, chunk);

		const webm = (await reference.input.getMimeType()).includes("webm");
		output = new Output({
			// Metadata last: the file streams out without being held in memory.
			format: webm
				? new WebMOutputFormat()
				: new Mp4OutputFormat({ fastStart: false }),
			target: options.target,
		});
		const video = new EncodedVideoPacketSource(reference.codec);
		output.addVideoTrack(video);
		const audio = options.audio
			? await AudioCopier.open(options.audio.name, open(options.audio), output)
			: undefined;

		await output.start();
		const written = await copyVideo(chunks, video, audio, options.signal);
		await audio?.writeUntil(Number.POSITIVE_INFINITY, options.signal);
		await output.finalize();
		output = undefined;
		return written;
	} finally {
		if (output) await output.cancel().catch(() => {});
		for (const input of inputs) input.dispose();
	}
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
