import type { ShapeGeneratorNodeConfig } from "./config.js";
import {
	calculateLinearGradientCoords,
	generateShapePath,
} from "./geometry.js";

/**
 * Generates an SVG string representation of the parametric shape configuration.
 */
export function generateShapeSvg(
	config: Partial<ShapeGeneratorNodeConfig>,
): string {
	const width = Math.max(1, config.width ?? 500);
	const height = Math.max(1, config.height ?? 500);
	const pathD = generateShapePath(config);

	const fillType = config.fillType ?? "solid";
	const fillColor = config.fillColor ?? "#3b82f6";
	const gradientEndColor = config.gradientEndColor ?? "#1d4ed8";
	const gradientAngle = config.gradientAngle ?? 0;

	const strokeColor = config.strokeColor ?? "#ffffff";
	const strokeWidth = Math.max(0, config.strokeWidth ?? 0);
	const strokeDashArray = config.strokeDashArray?.trim();
	const strokeLineCap = config.strokeLineCap ?? "round";
	const strokeLineJoin = config.strokeLineJoin ?? "round";
	const strokeDashOffset = config.strokeDashOffset ?? 0;

	const rotation = config.rotation ?? 0;
	const opacity = Math.max(0, Math.min(1, config.opacity ?? 1));
	const customPathScale =
		config.shapeType === "CustomPath" ? (config.customPathScale ?? 1) : 1;

	const gradId = `gw_shape_grad_${Math.abs(
		Math.round(gradientAngle) * 31 + (fillType === "linear" ? 1 : 2),
	)}`;

	let defs = "";
	let fillAttr = fillColor;

	if (fillType === "none") {
		fillAttr = "none";
	} else if (fillType === "linear") {
		const coords = calculateLinearGradientCoords(gradientAngle);
		defs = `<defs><linearGradient id="${gradId}" x1="${coords.x1}" y1="${coords.y1}" x2="${coords.x2}" y2="${coords.y2}"><stop offset="0%" stop-color="${fillColor}"/><stop offset="100%" stop-color="${gradientEndColor}"/></linearGradient></defs>`;
		fillAttr = `url(#${gradId})`;
	} else if (fillType === "radial") {
		defs = `<defs><radialGradient id="${gradId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${fillColor}"/><stop offset="100%" stop-color="${gradientEndColor}"/></radialGradient></defs>`;
		fillAttr = `url(#${gradId})`;
	}

	const strokeAttrs =
		strokeWidth > 0
			? `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="${strokeLineCap}" stroke-linejoin="${strokeLineJoin}" ${
					strokeDashArray ? `stroke-dasharray="${strokeDashArray}"` : ""
				} ${strokeDashOffset ? `stroke-dashoffset="${strokeDashOffset}"` : ""}`
			: 'stroke="none"';

	const cx = width / 2;
	const cy = height / 2;

	const transformParts: string[] = [];
	if (rotation !== 0) {
		transformParts.push(`rotate(${rotation} ${cx} ${cy})`);
	}
	if (customPathScale !== 1) {
		transformParts.push(`scale(${customPathScale})`);
	}

	const transformAttr =
		transformParts.length > 0 ? `transform="${transformParts.join(" ")}"` : "";
	const opacityAttr = opacity < 1 ? `opacity="${opacity}"` : "";

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${defs}<g ${transformAttr} ${opacityAttr}><path d="${pathD}" fill="${fillAttr}" ${strokeAttrs} /></g></svg>`;
}

/**
 * Encodes the SVG into a base64 data URL for robust cross-environment rendering.
 */
export function generateShapeSvgDataUrl(
	config: ShapeGeneratorNodeConfig,
): string {
	const svgString = generateShapeSvg(config);
	if (typeof Buffer !== "undefined") {
		return `data:image/svg+xml;base64,${Buffer.from(svgString).toString("base64")}`;
	}
	return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
}
