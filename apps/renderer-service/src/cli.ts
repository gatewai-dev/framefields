import "reflect-metadata";
import { configureAssetUrls } from "@framefields/client-utils";
import { HeadlessMediaRenderer } from "@framefields/renderer";
import "@framefields/renderer/offscreen-gl-polyfill";
import {
	container,
	rendererLogger,
	type StorageService,
	TOKENS,
} from "@framefields/server-utils";
import { registerBackendServices } from "./di-setup.js";
import { RENDERER_ENV_CONFIG } from "./env-config.js";

async function main() {
	const jobArgIndex = process.argv.indexOf("--job");
	if (jobArgIndex === -1 || !process.argv[jobArgIndex + 1]) {
		console.error("Missing --job parameter containing JSON input payload");
		process.exit(1);
	}

	let jobData: any;
	try {
		jobData = JSON.parse(process.argv[jobArgIndex + 1]);
	} catch (e: any) {
		console.error("Failed to parse JSON job input:", e.message);
		process.exit(1);
	}

	const { virtualMedia, type, frame, bucket, key, codec, audioCodec, quality } =
		jobData;

	if (!virtualMedia || !type || !bucket || !key) {
		console.error(
			"Missing required job data fields (virtualMedia, type, bucket, key)",
		);
		process.exit(1);
	}

	try {
		// Initialize configurations
		configureAssetUrls({
			baseUrl: RENDERER_ENV_CONFIG.BASE_URL,
			r2CustomDomain: RENDERER_ENV_CONFIG.R2_CUSTOM_DOMAIN,
		});

		// Boot DI services
		await registerBackendServices();

		// Eagerly initialize renderer
		await HeadlessMediaRenderer.initialize();

		const normalizedType = type.toLowerCase();
		rendererLogger.info(
			{ type: normalizedType, key },
			"[CLI] Starting render process...",
		);

		const renderer = new HeadlessMediaRenderer();
		let buffer: Buffer | undefined;
		let filePath: string | undefined;
		let contentType: string;
		let fileCleanup: (() => Promise<void>) | undefined;
		let probedMeta: any;

		if (normalizedType === "video" || normalizedType === "gif") {
			const renderResult = await renderer.renderVideo(virtualMedia, {
				codec,
				audioCodec,
				quality,
			});
			filePath = renderResult.filePath;
			fileCleanup = renderResult.cleanup;
			contentType =
				codec === "vp8" || codec === "vp9"
					? "video/webm"
					: codec === "gif"
						? "image/gif"
						: codec === "mp3"
							? "audio/mpeg"
							: codec === "aac"
								? "audio/mp4"
								: codec === "opus"
									? "audio/webm"
									: "video/mp4";
		} else if (normalizedType === "lut") {
			buffer = await renderer.renderLut(virtualMedia, frame);
			contentType = "text/plain";
		} else {
			buffer = await renderer.renderImage(virtualMedia, frame);
			contentType = "image/png";
		}

		const storage = container.get<StorageService>(TOKENS.STORAGE);
		if (filePath) {
			rendererLogger.info(
				{ filePath },
				"[CLI] Render complete - uploading file to storage.",
			);
			await storage.uploadFileToStorage(filePath, key, contentType, bucket);
		} else if (buffer) {
			rendererLogger.info(
				{ fileSize: buffer.length },
				"[CLI] Render complete - uploading buffer to storage.",
			);
			await storage.uploadToStorage(buffer, key, contentType, bucket);
		}

		const publicUrl = storage.getPublicUrl?.(key, bucket);
		rendererLogger.info(
			{ key, bucket, contentType },
			"[CLI] Render complete and uploaded to R2 successfully.",
		);

		if (fileCleanup) {
			await fileCleanup().catch(() => {});
		}

		// Print the final result in JSON format as stdout for the wrapper script to read
		console.log(
			JSON.stringify({
				success: true,
				key,
				bucket,
				publicUrl,
				metadata: probedMeta,
			}),
		);
		process.exit(0);
	} catch (error: any) {
		rendererLogger.error(
			{ err: error.message || String(error) },
			"[CLI] Rendering job failed.",
		);
		console.error(error.message || String(error));
		process.exit(1);
	}
}

main();
