import { describe, expect, it } from "vitest";
import {
	buildArrowPath,
	buildEllipsePath,
	buildPolygonPath,
	buildRectanglePath,
	buildStarPath,
	calculateLinearGradientCoords,
	normalizeCornerRadii,
} from "./geometry.js";
import { generateShapeSvg } from "./svg-generator.js";

describe("ShapeGenerator Vector Geometry & SVG Generation", () => {
	it("normalizes corner radii when radii exceed rectangle dimensions", () => {
		const [rtl, rtr, rbr, rbl] = normalizeCornerRadii(100, 100, 80, 80, 80, 80);
		// Sum of top corners is 160 > 100 -> scale factor 100/160 = 0.625 -> 50
		expect(rtl).toBe(50);
		expect(rtr).toBe(50);
		expect(rbr).toBe(50);
		expect(rbl).toBe(50);
	});

	it("generates valid SVG rectangle with per-corner radii", () => {
		const path = buildRectanglePath(200, 100, 10, 20, 15, 5);
		expect(path).toContain("M 10 0");
		expect(path).toContain("A 20 20");
		expect(path).toContain("Z");
	});

	it("generates valid ellipse path", () => {
		const path = buildEllipsePath(200, 100);
		expect(path).toContain("M 0 50");
		expect(path).toContain("A 100 50");
		expect(path).toContain("Z");
	});

	it("generates regular polygon with correct vertex count", () => {
		const path = buildPolygonPath(200, 200, 6);
		const vertices = path.split(" ").filter((s) => s === "M" || s === "L");
		expect(vertices).toHaveLength(6);
	});

	it("generates star path with correct tip count", () => {
		const path = buildStarPath(200, 200, 5, 0.5);
		const vertices = path.split(" ").filter((s) => s === "M" || s === "L");
		expect(vertices).toHaveLength(10); // 5 outer + 5 inner
	});

	it("generates parametric arrow path", () => {
		const path = buildArrowPath(300, 150, 80, 60, 30);
		expect(path).toContain("M 0.00");
		expect(path).toContain("Z");
	});

	it("calculates linear gradient vector coordinates for angles", () => {
		const deg0 = calculateLinearGradientCoords(0);
		expect(deg0.x1).toBe("0.00%");
		expect(deg0.y1).toBe("50.00%");
		expect(deg0.x2).toBe("100.00%");
		expect(deg0.y2).toBe("50.00%");

		const deg90 = calculateLinearGradientCoords(90);
		expect(deg90.x1).toBe("50.00%");
		expect(deg90.y1).toBe("0.00%");
		expect(deg90.x2).toBe("50.00%");
		expect(deg90.y2).toBe("100.00%");
	});

	it("generates complete valid SVG element string for solid fill", () => {
		const svg = generateShapeSvg({
			shapeType: "Rectangle",
			width: 400,
			height: 300,
			fillType: "solid",
			fillColor: "#ff0000",
			strokeColor: "#00ff00",
			strokeWidth: 4,
			rotation: 45,
			opacity: 0.8,
		});

		expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('viewBox="0 0 400 300"');
		expect(svg).toContain('width="400"');
		expect(svg).toContain('height="300"');
		expect(svg).toContain('fill="#ff0000"');
		expect(svg).toContain('stroke="#00ff00"');
		expect(svg).toContain('stroke-width="4"');
		expect(svg).toContain('transform="rotate(45 200 150)"');
		expect(svg).toContain('opacity="0.8"');
	});

	it("generates linear gradient definition in SVG", () => {
		const svg = generateShapeSvg({
			shapeType: "Star",
			width: 500,
			height: 500,
			starPoints: 6,
			starInnerRadius: 0.4,
			fillType: "linear",
			fillColor: "#3b82f6",
			gradientEndColor: "#1d4ed8",
			gradientAngle: 45,
		});

		expect(svg).toContain("<linearGradient");
		expect(svg).toContain('stop-color="#3b82f6"');
		expect(svg).toContain('stop-color="#1d4ed8"');
		expect(svg).toContain("url(#gw_shape_grad_");
	});

	it("generates radial gradient definition in SVG", () => {
		const svg = generateShapeSvg({
			shapeType: "Ellipse",
			width: 300,
			height: 300,
			fillType: "radial",
			fillColor: "#ec4899",
			gradientEndColor: "#be185d",
		});

		expect(svg).toContain("<radialGradient");
		expect(svg).toContain('stop-color="#ec4899"');
		expect(svg).toContain('stop-color="#be185d"');
	});

	it("generates custom path with scale transform", () => {
		const svg = generateShapeSvg({
			shapeType: "CustomPath",
			width: 500,
			height: 500,
			customPath: "M 0,0 L 100,100 Z",
			customPathScale: 2.5,
		});

		expect(svg).toContain('transform="scale(2.5)"');
		expect(svg).toContain('d="M 0,0 L 100,100 Z"');
	});
});
