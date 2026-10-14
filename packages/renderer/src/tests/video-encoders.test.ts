import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type * as NodeAvModule from "node-av";
import { afterEach, describe, expect, it } from "vitest";
import { videoCodecServerOptions } from "../video-encoders.js";

// node-av exactly as @mediabunny/server resolves it.
const require = createRequire(import.meta.url);
const av = (await import(
	pathToFileURL(
		createRequire(require.resolve("@mediabunny/server")).resolve("node-av"),
	).href
)) as typeof NodeAvModule;

describe("videoCodecServerOptions", () => {
	afterEach(() => {
		delete process.env.FRAMEFIELDS_HW_CODECS;
	});

	it("resolves to a working hardware context or null, never throws", async () => {
		const { hardwareContext } = videoCodecServerOptions(false);
		const hw = await hardwareContext(av.AV_CODEC_ID_H264);
		expect(hw === null || hw instanceof av.HardwareContext).toBe(true);
	});

	it("makes software encoders the default for each codec", async () => {
		await videoCodecServerOptions(true).hardwareContext(av.AV_CODEC_ID_H264);
		// node-av's linux-arm64 build lists h264_rkmpp/hevc_rkmpp first.
		expect(av.Codec.findEncoder(av.AV_CODEC_ID_H264)?.name).toBe("libx264");
		expect(av.Codec.findEncoder(av.AV_CODEC_ID_HEVC)?.name).toBe("libx265");
		expect(av.Codec.findEncoder(av.AV_CODEC_ID_VP9)?.name).toBe("libvpx-vp9");
	});

	it("keeps every codec in software when forced", async () => {
		const { hardwareContext } = videoCodecServerOptions(true);
		await expect(hardwareContext(av.AV_CODEC_ID_H264)).resolves.toBeNull();
	});

	it("turns hardware codecs off with FRAMEFIELDS_HW_CODECS=off", async () => {
		process.env.FRAMEFIELDS_HW_CODECS = "off";
		const { hardwareContext } = videoCodecServerOptions(false);
		await expect(hardwareContext(av.AV_CODEC_ID_H264)).resolves.toBeNull();
	});
});
