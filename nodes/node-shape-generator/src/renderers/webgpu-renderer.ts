/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { drawSvgNode } from "@gitframes/webgpu-renderers";
import type { ShapeGeneratorNodeConfig } from "../shared/config.js";
import { generateShapeSvgDataUrl } from "../shared/svg-generator.js";

export const ShapeGeneratorWebGPURenderer: WebGPUNodeRenderer = async (
	args,
) => {
	const { ctx, pass, props, targetWidth, targetHeight } = args;

	const op = props.virtualMedia?.operation as unknown as
		| (ShapeGeneratorNodeConfig & { op: string })
		| undefined;

	if (!op || (op.op !== "ShapeGenerator" && op.op !== "source")) return;

	const svgDataUrl = generateShapeSvgDataUrl(op);
	const width = targetWidth > 0 ? targetWidth : (op.width ?? 500);
	const height = targetHeight > 0 ? targetHeight : (op.height ?? 500);

	const isHeadless = Boolean(
		(ctx as { isHeadless?: boolean }).isHeadless ||
			typeof window === "undefined",
	);

	await drawSvgNode(ctx, pass, {
		src: svgDataUrl,
		dstRect: { x: 0, y: 0, width, height },
		opacity: op.opacity ?? 1,
		isHeadless,
	});
};
