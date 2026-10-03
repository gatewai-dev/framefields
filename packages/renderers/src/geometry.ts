export interface StrokeRect {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}

export function computeStrokeRect(
	w: number,
	h: number,
	cornerRadius: number,
	strokeWidth: number,
	align: "inside" | "outside" | "center" = "outside",
): StrokeRect {
	if (align === "inside") {
		const half = strokeWidth / 2;
		return {
			x: half,
			y: half,
			width: Math.max(0, w - strokeWidth),
			height: Math.max(0, h - strokeWidth),
			radius: cornerRadius === 0 ? 0 : Math.max(0, cornerRadius - half),
		};
	}
	if (align === "outside") {
		const half = strokeWidth / 2;
		return {
			x: -half,
			y: -half,
			width: w + strokeWidth,
			height: h + strokeWidth,
			radius: cornerRadius === 0 ? 0 : cornerRadius + half,
		};
	}
	// center
	return { x: 0, y: 0, width: w, height: h, radius: cornerRadius };
}
