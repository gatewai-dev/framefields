import type {
	GPURenderPassEncoder,
	WebGPUNodeRenderer,
} from "@framefields/node-sdk";
import { parseColor } from "@framefields/webgpu-renderers";
import type { PaintNodeConfig } from "../shared/config.js";

export const PaintWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		pass,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		encoder,
		props,
		drawChild,
	} = args;
	const { virtualMedia } = props;

	if (virtualMedia.operation?.op !== "Paint") return;
	const childMedia = virtualMedia?.children?.[0];

	const containerW =
		props.containerWidth ?? childMedia?.metadata?.width ?? targetWidth;
	const containerH =
		props.containerHeight ?? childMedia?.metadata?.height ?? targetHeight;

	const config = virtualMedia.operation as unknown as PaintNodeConfig & {
		mode?: string;
	};
	const isMaskMode = config.mode === "mask";
	const strokes = config.strokes ?? [];

	// End incoming pass
	pass.end();

	ctx.renderer.pushIdentity();

	// 1. Draw Child or Background
	const baseTex = ctx.renderer.getTemporaryTexture(containerW, containerH, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const baseView = baseTex.createView();

	if (isMaskMode) {
		const basePass = ctx.renderer.beginFrame(
			encoder,
			baseView,
			{ r: 0, g: 0, b: 0, a: 1 },
			containerW,
			containerH,
			"clear",
		);
		basePass.end();
	} else if (childMedia) {
		await drawChild(
			childMedia,
			props,
			baseView,
			baseTex,
			containerW,
			containerH,
		);
	} else {
		const basePass = ctx.renderer.beginFrame(
			encoder,
			baseView,
			{ r: 0, g: 0, b: 0, a: 0 },
			containerW,
			containerH,
			"clear",
		);
		if (config.backgroundColor) {
			ctx.renderer.drawRect(
				basePass,
				{ x: 0, y: 0, width: containerW, height: containerH },
				config.backgroundColor,
			);
		}
		basePass.end();
	}

	let finalTex = baseTex;

	if (strokes.length > 0) {
		const origW = childMedia?.metadata?.width ?? containerW;
		const origH = childMedia?.metadata?.height ?? containerH;
		const scaleX = origW > 0 ? containerW / origW : 1;
		const scaleY = origH > 0 ? containerH / origH : 1;

		let scalePushed = false;
		if (scaleX !== 1 || scaleY !== 1) {
			ctx.renderer.pushTransform(new DOMMatrix().scale(scaleX, scaleY));
			scalePushed = true;
		}

		// 2. Render Paint Layer
		const paintTex = ctx.renderer.getTemporaryTexture(containerW, containerH, [
			baseTex,
			targetTexture,
			...(props.excludeTextures || []),
		]);
		const paintView = paintTex.createView();
		ctx.renderer
			.beginFrame(
				encoder,
				paintView,
				{ r: 0, g: 0, b: 0, a: 0 },
				containerW,
				containerH,
				"clear",
			)
			.end();

		const allStrokes = strokes;
		let currentLayer = paintTex;
		let currentPass: GPURenderPassEncoder | null = null;

		for (const stroke of allStrokes) {
			if (stroke.tool === "brush") {
				if (!currentPass) {
					currentPass = ctx.renderer.beginFrame(
						encoder,
						currentLayer.createView(),
						{ r: 0, g: 0, b: 0, a: 0 },
						containerW,
						containerH,
						"load",
					);
				}
				const parsedColor = parseColor(stroke.color);
				const drawColor = isMaskMode
					? {
							r: parsedColor.a,
							g: parsedColor.a,
							b: parsedColor.a,
							a: parsedColor.a,
						}
					: {
							r: parsedColor.r * parsedColor.a,
							g: parsedColor.g * parsedColor.a,
							b: parsedColor.b * parsedColor.a,
							a: parsedColor.a,
						};
				ctx.renderer.drawPath(
					currentPass,
					stroke.path,
					drawColor,
					stroke.size,
					{
						opacity: stroke.opacity ?? 1,
						blendMode: "max" as any,
					},
				);
			} else if (stroke.tool === "eraser") {
				if (currentPass) {
					currentPass.end();
					currentPass = null;
				}
				const maskTex = ctx.renderer.getTemporaryTexture(
					containerW,
					containerH,
					[baseTex, paintTex, targetTexture, ...(props.excludeTextures || [])],
				);
				const maskView = maskTex.createView();
				const maskPass = ctx.renderer.beginFrame(
					encoder,
					maskView,
					{ r: 0, g: 0, b: 0, a: 0 },
					containerW,
					containerH,
					"clear",
				);
				ctx.renderer.drawPath(maskPass, stroke.path, "#ffffff", stroke.size, {
					blendMode: "max" as any,
				});
				maskPass.end();

				const nextLayer = ctx.renderer.composite(
					encoder,
					currentLayer,
					maskTex,
					"mask-out",
					[baseTex, paintTex, targetTexture, ...(props.excludeTextures || [])],
				);
				currentLayer = nextLayer;
			}
		}
		if (currentPass) currentPass.end();

		// 3. Composite Paint Layer over Base
		finalTex = ctx.renderer.composite(
			encoder,
			baseTex,
			currentLayer,
			"normal",
			[baseTex, currentLayer, targetTexture, ...(props.excludeTextures || [])],
		);

		if (scalePushed) {
			ctx.renderer.popTransform();
		}
	}

	ctx.renderer.popTransform();

	// 4. Draw to target
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(finalPass, finalTex, {
		x: 0,
		y: 0,
		width: containerW,
		height: containerH,
	});

	(args as any).pass = finalPass;
};
