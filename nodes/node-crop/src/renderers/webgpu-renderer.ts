import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";

const maskWgsl = `
struct MaskUniforms {
	rect      : vec4<f32>,
	roundness : f32,
	mode      : f32,
	numPoints : f32,
	padding   : f32,
	points    : array<vec2<f32>, 64>,
};

@group(0) @binding(0) var<uniform> u : MaskUniforms;

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
	var pos = array<vec2<f32>, 4>(
		vec2<f32>(-1.0, 1.0),
		vec2<f32>(1.0, 1.0),
		vec2<f32>(-1.0, -1.0),
		vec2<f32>(1.0, -1.0)
	);
	var uv = array<vec2<f32>, 4>(
		vec2<f32>(0.0, 0.0),
		vec2<f32>(1.0, 0.0),
		vec2<f32>(0.0, 1.0),
		vec2<f32>(1.0, 1.0)
	);
	return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
	let q = abs(p) - b + r;
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let p = in.pos.xy;
	
	if (u.mode > 0.5) { // Path
		var inside = false;
		let count = u32(u.numPoints);
		for (var i = 0u; i < count; i = i + 1u) {
			let j = (i + 1u) % count;
			let pi = u.points[i];
			let pj = u.points[j];
			if (((pi.y > p.y) != (pj.y > p.y)) &&
				(p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x)) {
				inside = !inside;
			}
		}
		return select(vec4<f32>(0.0), vec4<f32>(1.0), inside);
	} else { // RRect
		let center = u.rect.xy + u.rect.zw * 0.5;
		let size = u.rect.zw * 0.5;
		let d = sdRoundedRect(p - center, size, u.roundness);
		let alpha = 1.0 - smoothstep(0.0, 1.5, d);
		return vec4<f32>(1.0, 1.0, 1.0, alpha);
	}
}
`;

const deviceResourceCache = new WeakMap<GPUDevice, GPURenderPipeline>();

function getMaskPipeline(device: GPUDevice, format: GPUTextureFormat) {
	let pipeline = deviceResourceCache.get(device);
	if (!pipeline) {
		pipeline = device.createRenderPipeline({
			label: "CropMaskPipeline",
			layout: "auto",
			vertex: {
				module: device.createShaderModule({ code: maskWgsl }),
				entryPoint: "vs",
			},
			fragment: {
				module: device.createShaderModule({ code: maskWgsl }),
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		deviceResourceCache.set(device, pipeline);
	}
	return pipeline;
}

export const CropWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		props,
		drawChild,
		targetTexture,
		targetView,
		targetWidth,
		targetHeight,
		encoder,
	} = args;
	const {
		virtualMedia,
		containerWidth: propsContainerWidth,
		containerHeight: propsContainerHeight,
		opacity = 1,
	} = props;
	const op = virtualMedia?.operation as any;
	if (!op || op.op !== "Crop") return;

	const childMedia = virtualMedia.children?.[0];
	if (!childMedia) return;

	const containerWidth = propsContainerWidth ?? ctx.surface.width;
	const containerHeight = propsContainerHeight ?? ctx.surface.height;

	const isRest = op.mode === "rest";
	const isPath = op.cropType === "path";
	const pathPoints = op.pathPoints || [];
	const roundness = Number(op.roundness) || 0;

	let finalLp = Number(op.leftPercentage) || 0;
	let finalTp = Number(op.topPercentage) || 0;
	let finalWp = Math.max(0.01, Number(op.widthPercentage) || 100);
	let finalHp = Math.max(0.01, Number(op.heightPercentage) || 100);

	if (isPath && pathPoints.length > 0) {
		const xs = pathPoints.map((p: any) => p.x);
		const ys = pathPoints.map((p: any) => p.y);
		finalLp = Math.min(...xs);
		finalTp = Math.min(...ys);
		finalWp = Math.max(0.01, Math.max(...xs) - finalLp);
		finalHp = Math.max(0.01, Math.max(...ys) - finalTp);
	}

	// Determine source dimensions - where the child "lives" naturally
	const sourceWidth =
		op.originalWidth ??
		childMedia.metadata?.width ??
		props.containerWidth ??
		targetWidth;
	const sourceHeight =
		op.originalHeight ??
		childMedia.metadata?.height ??
		props.containerHeight ??
		targetHeight;

	// Calculate source and destination rectangles
	const srcRect = {
		x: (finalLp / 100) * sourceWidth,
		y: (finalTp / 100) * sourceHeight,
		width: (finalWp / 100) * sourceWidth,
		height: (finalHp / 100) * sourceHeight,
	};
	const dstRect = {
		x: 0,
		y: 0,
		width: containerWidth,
		height: containerHeight,
	};

	// End incoming pass to avoid conflicts
	args.pass.end();

	// 1. Render child into a temporary offscreen texture at its native size
	const childTex = ctx.renderer.getTemporaryTexture(sourceWidth, sourceHeight, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const childView = childTex.createView();

	const clearPass = ctx.renderer.beginFrame(
		encoder,
		childView,
		{ r: 0, g: 0, b: 0, a: 0 },
		sourceWidth,
		sourceHeight,
		"clear",
	);
	clearPass.end();

	ctx.renderer.pushScissor({
		x: 0,
		y: 0,
		width: sourceWidth,
		height: sourceHeight,
	});
	ctx.renderer.pushIdentity();

	await drawChild(
		childMedia,
		{
			...props,
			containerWidth: sourceWidth,
			containerHeight: sourceHeight,
		},
		childView,
		childTex,
		sourceWidth,
		sourceHeight,
	);

	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// Determine if we need complex masking (roundness/path)
	const needsComplexMask = roundness > 0 || isPath || isRest;

	if (!needsComplexMask && !isRest) {
		// Simple rectangular crop
		const outPass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"load",
		);
		ctx.renderer.drawTextureRegion(outPass, childTex, srcRect, dstRect, {
			opacity,
		});
		args.pass = outPass;
		return;
	}

	// 2. Complex masking using intermediate textures
	// If we are in "cropped" mode, we first need to upscale the cropped region to fill containerWidth/Height
	let maskedSourceTex = childTex;

	if (!isRest) {
		// Upscale cropped region to a temporary texture
		const upscaledTex = ctx.renderer.getTemporaryTexture(
			containerWidth,
			containerHeight,
			[childTex, targetTexture, ...(props.excludeTextures || [])],
		);
		const upscaledView = upscaledTex.createView();
		const upscaledPass = ctx.renderer.beginFrame(
			encoder,
			upscaledView,
			{ r: 0, g: 0, b: 0, a: 0 },
			containerWidth,
			containerHeight,
			"clear",
		);
		ctx.renderer.drawTextureRegion(upscaledPass, childTex, srcRect, dstRect);
		upscaledPass.end();
		maskedSourceTex = upscaledTex;
		// After upscaling, the mask is relative to the full container
	} else {
		// In rest mode, we apply the mask relative to the full child (positioned by percentages)
		// and the source is already the childTex (at sourceWidth/Height)
		// However, the mask shader works in pixel coordinates.
		// We should probably upscale the child to containerWidth/Height first to match mask coordinates if they differ
		if (sourceWidth !== containerWidth || sourceHeight !== containerHeight) {
			const upscaledTex = ctx.renderer.getTemporaryTexture(
				containerWidth,
				containerHeight,
				[childTex, targetTexture, ...(props.excludeTextures || [])],
			);
			const upscaledView = upscaledTex.createView();
			const upscaledPass = ctx.renderer.beginFrame(
				encoder,
				upscaledView,
				{ r: 0, g: 0, b: 0, a: 0 },
				containerWidth,
				containerHeight,
				"clear",
			);
			ctx.renderer.drawTexture(upscaledPass, childTex, {
				x: 0,
				y: 0,
				width: containerWidth,
				height: containerHeight,
			});
			upscaledPass.end();
			maskedSourceTex = upscaledTex;
		}
	}

	const maskTex = ctx.renderer.getTemporaryTexture(
		containerWidth,
		containerHeight,
		[maskedSourceTex, targetTexture, ...(props.excludeTextures || [])],
	);
	const maskView = maskTex.createView();

	const maskPass = ctx.renderer.beginFrame(
		encoder,
		maskView,
		{ r: 0, g: 0, b: 0, a: 0 },
		containerWidth,
		containerHeight,
		"clear",
	);

	const maskPipeline = getMaskPipeline(ctx.device, ctx.renderer.format);
	const maskData = new Float32Array(8 + 64 * 2);

	const rectX = isRest ? (finalLp / 100) * containerWidth : 0;
	const rectY = isRest ? (finalTp / 100) * containerHeight : 0;
	const rectW = isRest ? (finalWp / 100) * containerWidth : containerWidth;
	const rectH = isRest ? (finalHp / 100) * containerHeight : containerHeight;

	const pixelRoundness = (roundness / 100) * (Math.min(rectW, rectH) / 2);

	maskData[0] = rectX;
	maskData[1] = rectY;
	maskData[2] = rectW;
	maskData[3] = rectH;
	maskData[4] = pixelRoundness;
	maskData[5] = isPath ? 1 : 0;
	maskData[6] = pathPoints.length;

	if (isPath) {
		for (let i = 0; i < Math.min(pathPoints.length, 64); i++) {
			let px = (pathPoints[i].x / 100) * containerWidth;
			let py = (pathPoints[i].y / 100) * containerHeight;

			if (!isRest) {
				// If cropped, the path points need to be re-mapped to the zoomed coordinate system
				// points are originally in 0-100% of containerWidth/Height
				// we need them in 0-containerWidth/Height where finalWp/Hp/Lp/Tp are accounted for
				px = ((pathPoints[i].x - finalLp) / finalWp) * containerWidth;
				py = ((pathPoints[i].y - finalTp) / finalHp) * containerHeight;
			}

			maskData[8 + i * 2] = px;
			maskData[8 + i * 2 + 1] = py;
		}
	}

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(maskData);
	const bindGroup = ctx.device.createBindGroup({
		layout: maskPipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	maskPass.setPipeline(maskPipeline);
	maskPass.setBindGroup(0, bindGroup);
	maskPass.draw(4);
	maskPass.end();

	const resultTex = ctx.renderer.composite(
		encoder,
		maskedSourceTex,
		maskTex,
		isRest ? "mask-out" : "mask-in",
		[maskedSourceTex, maskTex, targetTexture, ...(props.excludeTextures || [])],
	);

	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(
		finalPass,
		resultTex,
		{
			x: 0,
			y: 0,
			width: containerWidth,
			height: containerHeight,
		},
		{ opacity },
	);

	args.pass = finalPass;
};
