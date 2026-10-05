import type { WebGPUNodeRenderer } from "@framefields/node-sdk";

/**
 * WebGPU renderer for the ExtractFrame operation.
 *
 * Renders the child media (Video/Lottie/GIF) at a specific frame number,
 * producing a static image output. The frame number is stored in the operation
 * and the child is rendered at the corresponding timestamp.
 */
export const ExtractFrameWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		props,
		drawChild,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		encoder,
	} = args;

	const { virtualMedia, opacity = 1 } = props;
	const op = virtualMedia?.operation as Record<string, unknown> | undefined;
	if (!op || op.op !== "ExtractFrame") return;

	const childMedia = virtualMedia.children?.[0];
	if (!childMedia) return;

	const frame = (op.frame as number) ?? 0;
	const childMeta = childMedia.metadata;
	const childFps = childMeta?.fps ?? 24;

	// Compute the timestamp for the child based on the frame number and child's FPS
	const timestampSec = frame / childFps;

	// End incoming pass to avoid conflicts
	args.pass.end();

	const sourceWidth = childMeta?.width ?? props.containerWidth ?? targetWidth;
	const sourceHeight =
		childMeta?.height ?? props.containerHeight ?? targetHeight;
	const containerWidth = props.containerWidth ?? ctx.surface.width;
	const containerHeight = props.containerHeight ?? ctx.surface.height;

	// Render the child into a temporary texture at the specified frame
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

	// Override the child's render props to set the specific frame/timestamp
	await drawChild(
		childMedia,
		{
			...props,
			containerWidth: sourceWidth,
			containerHeight: sourceHeight,
			frame,
			fps: childFps,
			timestampSec,
			forceWait: true,
		},
		childView,
		childTex,
		sourceWidth,
		sourceHeight,
	);

	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// Draw the result to the target
	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(
		outPass,
		childTex,
		{
			x: 0,
			y: 0,
			width: containerWidth,
			height: containerHeight,
		},
		{ opacity },
	);

	args.pass = outPass;
};
