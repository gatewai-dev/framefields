/**
 * A decoded image: a browser bitmap or, headless, raw RGBA8 pixels.
 * `buffer` must already be premultiplied (see `premultiplyPixels`).
 */
export interface DecodedImageData {
	width: number;
	height: number;
	bitmap?: GPUCopyExternalImageSource | null;
	buffer?: Parameters<GPUQueue["writeTexture"]>[1] | null;
}

/**
 * A premultiplied-alpha rgba8unorm texture holding `data` (left empty when
 * it has neither form).
 */
export function createImageTexture(
	device: GPUDevice,
	data: DecodedImageData,
): GPUTexture {
	const tex = device.createTexture({
		size: [data.width, data.height],
		format: "rgba8unorm",
		usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_DST |
			GPUTextureUsage.RENDER_ATTACHMENT,
	});

	if (data.bitmap) {
		device.queue.copyExternalImageToTexture(
			{ source: data.bitmap },
			{ texture: tex, premultipliedAlpha: true },
			[data.width, data.height],
		);
	} else if (data.buffer) {
		device.queue.writeTexture(
			{ texture: tex },
			data.buffer,
			{ bytesPerRow: data.width * 4 },
			[data.width, data.height],
		);
	}
	return tex;
}
