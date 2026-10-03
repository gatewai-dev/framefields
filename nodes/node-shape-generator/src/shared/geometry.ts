import type { ShapeGeneratorNodeConfig } from "./config.js";

export interface Point {
	x: number;
	y: number;
}

/**
 * Scale corner radii proportionally if their sum exceeds the box dimensions (W3C CSS standard).
 */
export function normalizeCornerRadii(
	w: number,
	h: number,
	rTL: number,
	rTR: number,
	rBR: number,
	rBL: number,
): [number, number, number, number] {
	const topSum = rTL + rTR;
	const bottomSum = rBL + rBR;
	const leftSum = rTL + rBL;
	const rightSum = rTR + rBR;

	let scale = 1.0;
	if (topSum > w && topSum > 0) scale = Math.min(scale, w / topSum);
	if (bottomSum > w && bottomSum > 0) scale = Math.min(scale, w / bottomSum);
	if (leftSum > h && leftSum > 0) scale = Math.min(scale, h / leftSum);
	if (rightSum > h && rightSum > 0) scale = Math.min(scale, h / rightSum);

	return [
		Math.max(0, rTL * scale),
		Math.max(0, rTR * scale),
		Math.max(0, rBR * scale),
		Math.max(0, rBL * scale),
	];
}

/**
 * Generates an SVG path string for a rounded rectangle with 4 independent corner radii.
 */
export function buildRectanglePath(
	w: number,
	h: number,
	rTL: number,
	rTR: number,
	rBR: number,
	rBL: number,
	strokeWidth = 0,
): string {
	const inset = strokeWidth > 0 ? strokeWidth / 2 : 0;
	const x = inset;
	const y = inset;
	const boxW = Math.max(0.1, w - strokeWidth);
	const boxH = Math.max(0.1, h - strokeWidth);

	const [rtl, rtr, rbr, rbl] = normalizeCornerRadii(
		boxW,
		boxH,
		rTL,
		rTR,
		rBR,
		rBL,
	);

	return [
		`M ${x + rtl} ${y}`,
		`L ${x + boxW - rtr} ${y}`,
		rtr > 0 ? `A ${rtr} ${rtr} 0 0 1 ${x + boxW} ${y + rtr}` : "",
		`L ${x + boxW} ${y + boxH - rbr}`,
		rbr > 0 ? `A ${rbr} ${rbr} 0 0 1 ${x + boxW - rbr} ${y + boxH}` : "",
		`L ${x + rbl} ${y + boxH}`,
		rbl > 0 ? `A ${rbl} ${rbl} 0 0 1 ${x} ${y + boxH - rbl}` : "",
		`L ${x} ${y + rtl}`,
		rtl > 0 ? `A ${rtl} ${rtl} 0 0 1 ${x + rtl} ${y}` : "",
		"Z",
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * Generates an SVG path string for an ellipse/circle.
 */
export function buildEllipsePath(
	w: number,
	h: number,
	strokeWidth = 0,
): string {
	const cx = w / 2;
	const cy = h / 2;
	const rx = Math.max(0.1, (w - strokeWidth) / 2);
	const ry = Math.max(0.1, (h - strokeWidth) / 2);

	return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

/**
 * Generates an SVG path string for a regular polygon with N sides.
 */
export function buildPolygonPath(
	w: number,
	h: number,
	sides: number,
	strokeWidth = 0,
): string {
	const n = Math.max(3, Math.min(64, Math.floor(sides)));
	const cx = w / 2;
	const cy = h / 2;
	const radius = Math.max(0.1, Math.min(w - strokeWidth, h - strokeWidth) / 2);

	const points: Point[] = [];
	const angleStep = (2 * Math.PI) / n;
	const startAngle = -Math.PI / 2; // Pointing upwards

	for (let i = 0; i < n; i++) {
		const angle = startAngle + i * angleStep;
		points.push({
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
		});
	}

	return (
		points
			.map(
				(p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`,
			)
			.join(" ") + " Z"
	);
}

/**
 * Generates an SVG path string for a star with N spikes and configurable inner radius ratio.
 */
export function buildStarPath(
	w: number,
	h: number,
	pointsCount: number,
	innerRadiusRatio: number,
	strokeWidth = 0,
): string {
	const n = Math.max(3, Math.min(64, Math.floor(pointsCount)));
	const ratio = Math.max(0.01, Math.min(0.99, innerRadiusRatio));
	const cx = w / 2;
	const cy = h / 2;
	const outerRadius = Math.max(
		0.1,
		Math.min(w - strokeWidth, h - strokeWidth) / 2,
	);
	const innerRadius = outerRadius * ratio;

	const points: Point[] = [];
	const totalVertices = n * 2;
	const angleStep = Math.PI / n;
	const startAngle = -Math.PI / 2; // Top tip pointing up

	for (let i = 0; i < totalVertices; i++) {
		const r = i % 2 === 0 ? outerRadius : innerRadius;
		const angle = startAngle + i * angleStep;
		points.push({
			x: cx + r * Math.cos(angle),
			y: cy + r * Math.sin(angle),
		});
	}

	return (
		points
			.map(
				(p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`,
			)
			.join(" ") + " Z"
	);
}

/**
 * Generates an SVG path string for a parametric arrow pointing right.
 */
export function buildArrowPath(
	w: number,
	h: number,
	headWidth: number,
	headLength: number,
	shaftWidth: number,
	strokeWidth = 0,
): string {
	const inset = strokeWidth > 0 ? strokeWidth / 2 : 0;
	const boxW = Math.max(1, w - strokeWidth);
	const boxH = Math.max(1, h - strokeWidth);
	const cy = h / 2;

	const hw = Math.min(boxH, Math.max(4, headWidth));
	const hl = Math.min(boxW * 0.9, Math.max(4, headLength));
	const sw = Math.min(hw * 0.95, Math.max(2, shaftWidth));

	const leftX = inset;
	const rightX = inset + boxW;
	const headBaseX = rightX - hl;

	const topShaftY = cy - sw / 2;
	const bottomShaftY = cy + sw / 2;
	const topHeadY = cy - hw / 2;
	const bottomHeadY = cy + hw / 2;

	return [
		`M ${leftX.toFixed(2)} ${topShaftY.toFixed(2)}`,
		`L ${headBaseX.toFixed(2)} ${topShaftY.toFixed(2)}`,
		`L ${headBaseX.toFixed(2)} ${topHeadY.toFixed(2)}`,
		`L ${rightX.toFixed(2)} ${cy.toFixed(2)}`,
		`L ${headBaseX.toFixed(2)} ${bottomHeadY.toFixed(2)}`,
		`L ${headBaseX.toFixed(2)} ${bottomShaftY.toFixed(2)}`,
		`L ${leftX.toFixed(2)} ${bottomShaftY.toFixed(2)}`,
		"Z",
	].join(" ");
}

/**
 * Calculates linear gradient coordinate vector from an angle in degrees.
 */
export function calculateLinearGradientCoords(angleDeg = 0): {
	x1: string;
	y1: string;
	x2: string;
	y2: string;
} {
	const rad = (angleDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	// Standard CSS/SVG angle mapping:
	// 0deg: left -> right (dx = 0.5, dy = 0)
	// 90deg: top -> bottom (dx = 0, dy = 0.5)
	const x1 = ((0.5 - cos * 0.5) * 100).toFixed(2);
	const y1 = ((0.5 - sin * 0.5) * 100).toFixed(2);
	const x2 = ((0.5 + cos * 0.5) * 100).toFixed(2);
	const y2 = ((0.5 + sin * 0.5) * 100).toFixed(2);

	return {
		x1: `${x1}%`,
		y1: `${y1}%`,
		x2: `${x2}%`,
		y2: `${y2}%`,
	};
}

/**
 * Builds the complete shape geometry path for any ShapeGenerator config.
 */
export function generateShapePath(
	config: Partial<ShapeGeneratorNodeConfig>,
): string {
	const width = Math.max(1, config.width ?? 500);
	const height = Math.max(1, config.height ?? 500);
	const strokeWidth = config.strokeWidth ?? 0;

	switch (config.shapeType) {
		case "Rectangle":
			return buildRectanglePath(
				width,
				height,
				config.radiusTL ?? 0,
				config.radiusTR ?? 0,
				config.radiusBR ?? 0,
				config.radiusBL ?? 0,
				strokeWidth,
			);
		case "Ellipse":
			return buildEllipsePath(width, height, strokeWidth);
		case "Polygon":
			return buildPolygonPath(
				width,
				height,
				config.polygonSides ?? 5,
				strokeWidth,
			);
		case "Star":
			return buildStarPath(
				width,
				height,
				config.starPoints ?? 5,
				config.starInnerRadius ?? 0.5,
				strokeWidth,
			);
		case "Arrow":
			return buildArrowPath(
				width,
				height,
				config.arrowHeadWidth ?? 40,
				config.arrowHeadLength ?? 40,
				config.arrowShaftWidth ?? 20,
				strokeWidth,
			);
		case "CustomPath":
			return (
				config.customPath?.trim() ||
				buildRectanglePath(width, height, 0, 0, 0, 0, strokeWidth)
			);
		default:
			return buildRectanglePath(width, height, 0, 0, 0, 0, strokeWidth);
	}
}
