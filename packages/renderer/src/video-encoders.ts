import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type * as NodeAvModule from "node-av";
import { rendererLogger } from "./logger.js";

type NodeAv = typeof NodeAvModule;
type HardwareContext = NodeAvModule.HardwareContext;
type Codec = NodeAvModule.Codec;

let nodeAv: Promise<NodeAv> | undefined;

/**
 * node-av as @mediabunny/server loads it, with software encoders as the
 * default. The patch and the HardwareContext instances returned to the server
 * must come from that exact module instance, so the file is resolved from the
 * server package and imported natively (a `require()` can be routed through
 * a loader such as tsx and produce a second copy).
 */
function loadNodeAv(): Promise<NodeAv> {
	nodeAv ??= (async () => {
		const require = createRequire(import.meta.url);
		const server = require.resolve("@mediabunny/server");
		const entry = createRequire(server).resolve("node-av");
		const av = (await import(pathToFileURL(entry).href)) as NodeAv;
		preferSoftwareEncoders(av);
		return av;
	})();
	return nodeAv;
}

/**
 * Software encoders to use per codec, best first. @mediabunny/server takes
 * `Codec.findEncoder(id)` as its software encoder, which returns whichever
 * encoder FFmpeg registered first. In node-av's linux-arm64 build that is a
 * hardware encoder (h264_rkmpp, hevc_rkmpp), which fails without Rockchip
 * hardware.
 */
const SOFTWARE_ENCODERS: Record<string, string[]> = {
	AV_CODEC_ID_H264: ["libx264", "libopenh264"],
	AV_CODEC_ID_HEVC: ["libx265"],
	AV_CODEC_ID_VP8: ["libvpx"],
	AV_CODEC_ID_VP9: ["libvpx-vp9"],
	AV_CODEC_ID_AV1: ["libsvtav1", "libaom-av1", "libdav1d"],
};

let patched = false;

/** Makes `Codec.findEncoder` return a software encoder when one exists. */
function preferSoftwareEncoders(av: NodeAv): void {
	if (patched) return;
	patched = true;
	const byId = new Map<number, string[]>();
	for (const [constant, names] of Object.entries(SOFTWARE_ENCODERS)) {
		const id = (av as unknown as Record<string, unknown>)[constant];
		if (typeof id === "number") byId.set(id, names);
	}
	const findEncoder = av.Codec.findEncoder.bind(av.Codec);
	av.Codec.findEncoder = ((id: Parameters<typeof findEncoder>[0]) => {
		for (const name of byId.get(id as number) ?? []) {
			const codec = av.Codec.findEncoderByName(name as never);
			if (codec) return codec;
		}
		return findEncoder(id);
	}) as typeof av.Codec.findEncoder;
}

/**
 * Opens the encoder with the settings @mediabunny/server uses and encodes one
 * frame. A hardware encoder can be compiled in and still be unusable: no such
 * hardware (rkmpp on a non-Rockchip board), or a GPU without an encoder block
 * (NVIDIA A100/H100 have no NVENC).
 */
async function encoderWorks(av: NodeAv, codec: Codec): Promise<boolean> {
	const ctx = new av.CodecContext();
	const frame = new av.Frame();
	const packet = new av.Packet();
	try {
		ctx.allocContext3(codec);
		const formats = codec.pixelFormats;
		const pixelFormat =
			!formats || formats.includes(av.AV_PIX_FMT_YUV420P)
				? av.AV_PIX_FMT_YUV420P
				: formats[0];
		ctx.width = 256;
		ctx.height = 256;
		ctx.pixelFormat = pixelFormat;
		ctx.timeBase = new av.Rational(1, 1e6);
		ctx.framerate = new av.Rational(30, 1);
		ctx.gopSize = 60;
		ctx.bitRate = 1_000_000n;
		if ((await ctx.open2()) < 0) return false;

		frame.alloc();
		frame.format = pixelFormat;
		frame.width = 256;
		frame.height = 256;
		if (frame.getBuffer() < 0) return false;
		frame.pts = 0n;
		packet.alloc();
		if ((await ctx.sendFrame(frame)) < 0) return false;
		if ((await ctx.sendFrame(null)) < 0) return false;
		for (;;) {
			const ret = await ctx.receivePacket(packet);
			if (ret >= 0) return true;
			if (ret !== av.AVERROR_EAGAIN) return false;
		}
	} catch {
		return false;
	} finally {
		packet.free();
		frame.free();
		ctx.freeContext();
	}
}

/** True when the env turns hardware video encoding/decoding off. */
function hardwareDisabled(): boolean {
	const value = process.env.FRAMEFIELDS_HW_CODECS?.toLowerCase();
	return value === "0" || value === "off" || value === "false";
}

/**
 * Returns the `hardwareContext` option for registerMediabunnyServer: the
 * platform's hardware context for codecs whose hardware encoder actually
 * works (NVENC, VideoToolbox, ...), and null otherwise, so that codec is
 * encoded in software. Each codec is tested once per process.
 *
 * The server calls this before it picks any encoder (unless the encoder is
 * created with "prefer-software"), so the software default is patched in by
 * then.
 */
function hardwareContextResolver(
	forceSoftware: boolean,
): (codecId: number) => Promise<HardwareContext | null> {
	let hw: HardwareContext | null | undefined;
	const verdicts = new Map<number, Promise<HardwareContext | null>>();

	const resolve = async (codecId: number): Promise<HardwareContext | null> => {
		const av = await loadNodeAv();
		if (forceSoftware || hardwareDisabled()) return null;
		if (hw === undefined) hw = av.HardwareContext.auto();
		if (!hw) return null;
		const encoder = hw.getEncoderCodec(codecId as never);
		// Decode-only hardware: the encoder falls back to software on its own.
		if (!encoder) return hw;
		if (await encoderWorks(av, encoder)) {
			rendererLogger.info(
				{ encoder: encoder.name, device: hw.deviceTypeName },
				"[video-encoders] Using hardware video encoder",
			);
			return hw;
		}
		rendererLogger.warn(
			{ encoder: encoder.name, device: hw.deviceTypeName },
			"[video-encoders] Hardware video encoder unusable; encoding in software",
		);
		return null;
	};

	return (codecId) => {
		let verdict = verdicts.get(codecId);
		if (!verdict) {
			// A failed hardware probe means software; a failed load surfaces.
			verdict = resolve(codecId).catch(async (err) => {
				await loadNodeAv();
				rendererLogger.warn(
					{ err: err instanceof Error ? err.message : String(err) },
					"[video-encoders] Hardware probe failed; encoding in software",
				);
				return null;
			});
			verdicts.set(codecId, verdict);
		}
		return verdict;
	};
}

/**
 * Options for registerMediabunnyServer: hardware video codecs when they work,
 * software (libx264, libx265, libvpx, SVT-AV1) otherwise. `forceSoftware`
 * keeps every codec in software (used on AMD). Create encoders with
 * "prefer-hardware" so this decides; "prefer-software" skips it.
 */
export function videoCodecServerOptions(forceSoftware: boolean): {
	hardwareContext: (codecId: number) => Promise<HardwareContext | null>;
} {
	return { hardwareContext: hardwareContextResolver(forceSoftware) };
}
