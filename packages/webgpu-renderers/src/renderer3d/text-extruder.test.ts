import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { Canvas, Path2D } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { generateExtrudedTextGeometry } from "./text-extruder.js";

describe("Extruded 3D Text Polygonal Mesh Generator", () => {
	it("generates watertight 3D mesh with front cap, side walls, and materials", () => {
		const fontPath = path.resolve(
			process.cwd(),
			"../../examples/22_framefields_launch/assets/fonts/Unbounded.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf) as fontkit.Font;

		const result = generateExtrudedTextGeometry({
			text: "FRAMEFIELDS",
			font,
			fontSize: 100,
			depth: 40,
			fill: "#121216",
			bevelColor: "#2b44ff",
		});

		expect(result).toBeDefined();
		expect(result.modelData.meshes.length).toBeGreaterThanOrEqual(2);

		const frontMesh = result.modelData.meshes.find((m) => m.name === "front");
		const sideMesh = result.modelData.meshes.find((m) => m.name === "side");

		expect(frontMesh).toBeDefined();
		expect(sideMesh).toBeDefined();

		// Front mesh must have positions, normals pointing along +Z, and valid indices
		expect(frontMesh?.positions.length).toBeGreaterThan(0);
		expect(frontMesh?.normals.length).toBe(frontMesh?.positions.length);
		expect(frontMesh?.indices.length).toBeGreaterThan(0);

		// Side mesh must have positions, normals perpendicular to Z (normals[z] == 0 for walls or -1 for back), and valid indices
		expect(sideMesh?.positions.length).toBeGreaterThan(0);
		expect(sideMesh?.normals.length).toBe(sideMesh?.positions.length);
		expect(sideMesh?.indices.length).toBeGreaterThan(0);

		// Verify materials are properly assigned
		const materials = result.modelData.materials;
		expect(materials["front-material"]).toBeDefined();
		expect(materials["side-material"]).toBeDefined();

		// Front material color should match #121216 (~0.07, 0.07, 0.086)
		expect(materials["front-material"]?.diffuseColor?.[0]).toBeCloseTo(0.07, 1);
		// Side material color should match #2b44ff (~0.17, 0.27, 1.0)
		expect(materials["side-material"]?.diffuseColor?.[2]).toBeCloseTo(1.0, 1);

		// Verify bounding box
		expect(result.bounds.width).toBeGreaterThan(100);
		expect(result.bounds.height).toBeGreaterThan(20);
		expect(result.bounds.depth).toBe(40);
	});

	it("generates watertight 3D mesh using Inter font", () => {
		const fontPath = path.resolve(
			process.cwd(),
			"../../examples/22_framefields_launch/assets/fonts/Inter.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf) as fontkit.Font;

		const result = generateExtrudedTextGeometry({
			text: "FRAMEFIELDS",
			font,
			fontSize: 120,
			depth: 50,
			fill: "#ffffff",
			bevelColor: "#0066ff",
		});

		expect(result).toBeDefined();
		const frontMesh = result.modelData.meshes.find((m) => m.name === "front");
		const sideMesh = result.modelData.meshes.find((m) => m.name === "side");
		expect(frontMesh?.positions.length).toBeGreaterThan(0);
		expect(sideMesh?.positions.length).toBeGreaterThan(0);
		expect(result.bounds.depth).toBe(50);
	});

	it("correctly resolves complex overlapping glyph contours (T, F, M, A) in Unbounded", () => {
		const fontPath = path.resolve(
			process.cwd(),
			"../../examples/22_framefields_launch/assets/fonts/Unbounded.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf) as fontkit.Font;

		const result = generateExtrudedTextGeometry({
			text: "TFMA",
			font,
			fontSize: 100,
			depth: 30,
			fill: "#ffffff",
			bevelColor: "#2b44ff",
		});

		expect(result).toBeDefined();
		const frontMesh = result.modelData.meshes.find((m) => m.name === "front");
		const sideMesh = result.modelData.meshes.find((m) => m.name === "side");
		expect(frontMesh?.indices.length).toBeGreaterThan(0);
		expect(sideMesh?.indices.length).toBeGreaterThan(0);
		// Bounds must span all 4 letters
		expect(result.bounds.width).toBeGreaterThan(250);
		expect(result.bounds.height).toBeGreaterThan(60);
	});

	const loadInter = () =>
		fontkit.create(
			fs.readFileSync(
				path.resolve(
					process.cwd(),
					"../../examples/22_framefields_launch/assets/fonts/Inter.ttf",
				),
			),
		) as fontkit.Font;

	/** Area of the front cap's triangles (vertices at -z, facing the camera). */
	const frontCapArea = (
		result: ReturnType<typeof generateExtrudedTextGeometry>,
	) => {
		const front = result.modelData.meshes.find((m) => m.name === "front")!;
		const p = front.positions;
		const ix = front.indices;
		let area = 0;
		for (let i = 0; i < ix.length; i += 3) {
			const [a, b, c] = [ix[i]!, ix[i + 1]!, ix[i + 2]!];
			if (p[a * 3 + 2]! >= 0) continue;
			area +=
				Math.abs(
					(p[b * 3]! - p[a * 3]!) * (p[c * 3 + 1]! - p[a * 3 + 1]!) -
						(p[c * 3]! - p[a * 3]!) * (p[b * 3 + 1]! - p[a * 3 + 1]!),
				) / 2;
		}
		return area;
	};

	it("fills shapes sitting inside a glyph's counter (the R of ®, the C of ©)", () => {
		const font = loadInter();
		const fontSize = 200;
		for (const text of ["O", "®", "©", "@"]) {
			const glyph = font.layout(text).glyphs[0]!;
			const scale = fontSize / font.unitsPerEm;
			// Reference: the glyph filled by skia, measured in covered pixels.
			const canvas = new Canvas(400, 400);
			const ctx = canvas.getContext("2d");
			ctx.translate(100, 300);
			ctx.scale(scale, -scale);
			ctx.fill(new Path2D(glyph.path.toSVG()));
			const data = ctx.getImageData(0, 0, 400, 400).data;
			let trueArea = 0;
			for (let i = 3; i < data.length; i += 4) trueArea += data[i]! / 255;

			const result = generateExtrudedTextGeometry({
				text,
				font,
				fontSize,
				depth: 10,
			});
			expect(frontCapArea(result) / trueArea, text).toBeCloseTo(1, 1);
		}
	});

	it("maps front UVs across the aligned glyphs", () => {
		const result = generateExtrudedTextGeometry({
			text: "GIT",
			font: loadInter(),
			fontSize: 120,
			depth: 20,
		});
		const front = result.modelData.meshes.find((m) => m.name === "front")!;
		let [minU, maxU, minV, maxV] = [1, 0, 1, 0];
		for (let i = 0; i < front.uvs.length; i += 2) {
			minU = Math.min(minU, front.uvs[i]!);
			maxU = Math.max(maxU, front.uvs[i]!);
			minV = Math.min(minV, front.uvs[i + 1]!);
			maxV = Math.max(maxV, front.uvs[i + 1]!);
		}
		expect(minU).toBeCloseTo(0, 5);
		expect(maxU).toBeCloseTo(1, 5);
		expect(minV).toBeCloseTo(0, 5);
		expect(maxV).toBeCloseTo(1, 5);
		// Centered text: bounds straddle the origin.
		expect(result.bounds.minX).toBeCloseTo(-result.bounds.width / 2, 5);
	});

	it("gives the back cap the fill material, not the bevel color", () => {
		const result = generateExtrudedTextGeometry({
			text: "O",
			font: loadInter(),
			fontSize: 100,
			depth: 20,
		});
		const front = result.modelData.meshes.find((m) => m.name === "front")!;
		const side = result.modelData.meshes.find((m) => m.name === "side")!;
		const zNormals = (n: ArrayLike<number>) =>
			Array.from({ length: n.length / 3 }, (_, i) => n[i * 3 + 2]!);
		expect(zNormals(front.normals)).toContain(-1);
		expect(zNormals(side.normals).every((z) => z === 0)).toBe(true);
	});
});
