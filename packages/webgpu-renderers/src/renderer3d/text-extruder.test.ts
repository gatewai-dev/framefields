import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { generateExtrudedTextGeometry } from "./text-extruder.js";

describe("Extruded 3D Text Polygonal Mesh Generator", () => {
	it("generates watertight 3D mesh with front cap, side walls, and materials", () => {
		const fontPath = path.resolve(
			process.cwd(),
			"../../examples/22_gitframes_launch/assets/fonts/Unbounded.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf);

		const result = generateExtrudedTextGeometry({
			text: "GITFRAMES",
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
			"../../examples/22_gitframes_launch/assets/fonts/Inter.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf);

		const result = generateExtrudedTextGeometry({
			text: "GITFRAMES",
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
			"../../examples/22_gitframes_launch/assets/fonts/Unbounded.ttf",
		);
		const fontBuf = fs.readFileSync(fontPath);
		const font = fontkit.create(fontBuf);

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
});
