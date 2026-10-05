import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Signal } from "@framefields/core";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, LayerAnimation, Light } from "./index.js";

interface DecodedImage {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
}

interface PixelRgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

async function decodePngPixels(pngBuffer: Buffer): Promise<DecodedImage> {
	const img = await loadImage(pngBuffer);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const imgData = ctx.getImageData(0, 0, img.width, img.height);
	return {
		width: img.width,
		height: img.height,
		pixels: imgData.data,
	};
}

function getPixel(image: DecodedImage, x: number, y: number): PixelRgba {
	const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
	const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
	const index = (clampedY * image.width + clampedX) * 4;
	return {
		r: image.pixels[index] ?? 0,
		g: image.pixels[index + 1] ?? 0,
		b: image.pixels[index + 2] ?? 0,
		a: image.pixels[index + 3] ?? 0,
	};
}

function computeMse(
	pixelsA: Uint8ClampedArray,
	pixelsB: Uint8ClampedArray,
): number {
	if (pixelsA.length !== pixelsB.length) {
		throw new Error(
			`Pixel buffer size mismatch: ${pixelsA.length} vs ${pixelsB.length}`,
		);
	}
	let sumSquaredDiff = 0;
	for (let i = 0; i < pixelsA.length; i += 4) {
		const dr = (pixelsA[i] ?? 0) - (pixelsB[i] ?? 0);
		const dg = (pixelsA[i + 1] ?? 0) - (pixelsB[i + 1] ?? 0);
		const db = (pixelsA[i + 2] ?? 0) - (pixelsB[i + 2] ?? 0);
		sumSquaredDiff += (dr * dr + dg * dg + db * db) / 3;
	}
	return sumSquaredDiff / (pixelsA.length / 4);
}

describe("Extended WebGPU 3D Model Rendering Conformance (glTF/GLB, STL, PLY, VOX, 3DS, OFF)", () => {
	it("renders binary GLB 3D models with directional lighting and signal reactivity", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-glb-"));
		const glbPath = path.join(tmpDir, "prism.glb");

		// Build a minimal valid GLB
		const posBuffer = Buffer.alloc(3 * 3 * 4); // 1 triangle
		const positions = [-50, -50, 0, 50, -50, 0, 0, 50, 0];
		for (let i = 0; i < positions.length; i++) {
			posBuffer.writeFloatLE(positions[i]!, i * 4);
		}

		const gltfJson = {
			asset: { version: "2.0" },
			buffers: [{ byteLength: posBuffer.length }],
			bufferViews: [
				{
					buffer: 0,
					byteOffset: 0,
					byteLength: posBuffer.length,
					target: 34962,
				},
			],
			accessors: [
				{
					bufferView: 0,
					byteOffset: 0,
					componentType: 5126,
					count: 3,
					type: "VEC3",
					min: [-50, -50, 0],
					max: [50, 50, 0],
				},
			],
			meshes: [
				{
					primitives: [
						{
							attributes: { POSITION: 0 },
						},
					],
				},
			],
		};

		const jsonString = JSON.stringify(gltfJson);
		const jsonBuffer = Buffer.from(jsonString, "utf8");
		const paddedJsonLen = Math.ceil(jsonBuffer.length / 4) * 4;
		const paddedJson = Buffer.alloc(paddedJsonLen, 0x20);
		jsonBuffer.copy(paddedJson);

		const totalLength = 12 + 8 + paddedJson.length + 8 + posBuffer.length;
		const glbHeader = Buffer.alloc(12);
		glbHeader.writeUInt32LE(0x46546c67, 0); // "glTF"
		glbHeader.writeUInt32LE(2, 4);
		glbHeader.writeUInt32LE(totalLength, 8);

		const jsonChunkHeader = Buffer.alloc(8);
		jsonChunkHeader.writeUInt32LE(paddedJson.length, 0);
		jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

		const binChunkHeader = Buffer.alloc(8);
		binChunkHeader.writeUInt32LE(posBuffer.length, 0);
		binChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

		const fullGlb = Buffer.concat([
			glbHeader,
			jsonChunkHeader,
			paddedJson,
			binChunkHeader,
			posBuffer,
		]);
		await fs.writeFile(glbPath, fullGlb);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
			signals: {
				glbRotate: Signal.builder({
					fn: (ctx) => ctx.frame * 3.0,
				}),
			},
		});

		comp.add(
			Layer.camera({
				id: "cam3d",
				x: 400,
				y: 300,
				z: -600,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(
			Light.directional({
				id: "sun",
				color: "#ffffff",
				intensity: 1.2,
				x: 200,
				y: -500,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		const model = Layer.glb(glbPath, {
			id: "glb-prism",
			x: 400,
			y: 300,
			z: 0,
			scale: 2.0,
			color: "#3b82f6",
			material: "lit",
		});
		model.animate(LayerAnimation.signal("rotateY", "glbRotate"));
		comp.add(model);

		const buffer = await comp.renderFrame({ frame: 0 });
		expect(buffer).toBeInstanceOf(Buffer);

		const img = await decodePngPixels(buffer);
		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		// Non-bg pixel check
		const nonBgPixels: Array<{
			x: number;
			y: number;
			r: number;
			g: number;
			b: number;
		}> = [];
		for (let y = 0; y < img.height; y += 10) {
			for (let x = 0; x < img.width; x += 10) {
				const pix = getPixel(img, x, y);
				if (pix.r !== 5 || pix.g !== 8 || pix.b !== 20) {
					nonBgPixels.push({ x, y, r: pix.r, g: pix.g, b: pix.b });
				}
			}
		}
		expect(nonBgPixels.length).toBeGreaterThan(10);

		// Frame delta check driven by Signal
		const frame30 = await comp.renderFrame({ frame: 30 });
		const img30 = await decodePngPixels(frame30);
		const mse = computeMse(img.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(2.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders STL 3D models with keyframe animations and lighting", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-stl-"));
		const stlPath = path.join(tmpDir, "tetra.stl");

		const stlContent = `solid tetrahedron
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 100 0 0
vertex 50 100 0
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 0 0 0
vertex 50 100 0
vertex 50 50 80
endloop
endfacet
endsolid tetrahedron`;
		await fs.writeFile(stlPath, stlContent);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
		});

		comp.add(
			Layer.camera({
				id: "cam3d",
				x: 400,
				y: 300,
				z: -600,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(
			Light.directional({
				id: "sun-stl",
				color: "#ffffff",
				intensity: 1.2,
				x: 200,
				y: -400,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		const stlModel = Layer.stl(stlPath, {
			id: "stl-tetra",
			x: 400,
			y: 300,
			z: 0,
			scale: 1.5,
			color: "#10b981",
			material: "lit",
		});

		stlModel.animate(
			LayerAnimation.fromTo("rotateY", 0, 90, { durationFrames: 30 }),
		);

		comp.add(stlModel);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame30 = await comp.renderFrame({ frame: 30 });

		const img0 = await decodePngPixels(frame0);
		const img30 = await decodePngPixels(frame30);

		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders MagicaVoxel VOX models with voxel colors", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-vox-"));
		const voxPath = path.join(tmpDir, "cube.vox");

		// Build a minimal 1x1x1 VOX file
		const sizeChunk = Buffer.alloc(12 + 12);
		sizeChunk.write("SIZE", 0);
		sizeChunk.writeUInt32LE(12, 4); // content bytes
		sizeChunk.writeUInt32LE(0, 8); // children bytes
		sizeChunk.writeInt32LE(2, 12); // sx
		sizeChunk.writeInt32LE(2, 16); // sy
		sizeChunk.writeInt32LE(2, 20); // sz

		const xyziChunk = Buffer.alloc(12 + 4 + 4);
		xyziChunk.write("XYZI", 0);
		xyziChunk.writeUInt32LE(8, 4); // content bytes
		xyziChunk.writeUInt32LE(0, 8); // children bytes
		xyziChunk.writeUInt32LE(1, 12); // 1 voxel
		xyziChunk.writeUInt8(0, 16); // x
		xyziChunk.writeUInt8(0, 17); // y
		xyziChunk.writeUInt8(0, 18); // z
		xyziChunk.writeUInt8(1, 19); // color index 1

		const mainChildren = Buffer.concat([sizeChunk, xyziChunk]);
		const mainChunk = Buffer.alloc(12);
		mainChunk.write("MAIN", 0);
		mainChunk.writeUInt32LE(0, 4);
		mainChunk.writeUInt32LE(mainChildren.length, 8);

		const voxHeader = Buffer.alloc(8);
		voxHeader.write("VOX ", 0);
		voxHeader.writeInt32LE(150, 4);

		const fullVox = Buffer.concat([voxHeader, mainChunk, mainChildren]);
		await fs.writeFile(voxPath, fullVox);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
		});

		comp.add(
			Layer.camera({
				id: "cam3d",
				x: 400,
				y: 300,
				z: -600,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(Light.ambient("#ffffff", 0.5));
		comp.add(
			Light.directional({
				id: "sun-vox",
				color: "#ffffff",
				intensity: 1.0,
				x: 200,
				y: -400,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		const voxModel = Layer.vox(voxPath, {
			id: "vox-cube",
			x: 400,
			y: 300,
			z: 0,
			scale: 50.0,
			rotateX: 25,
			rotateY: 45,
			material: "lit",
		});

		comp.add(voxModel);

		const buffer = await comp.renderFrame({ frame: 0 });
		expect(buffer).toBeInstanceOf(Buffer);

		const img = await decodePngPixels(buffer);
		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders Stanford PLY and OFF models via Layer3D helper constructors", async () => {
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "framefields-ply-off-"),
		);
		const plyPath = path.join(tmpDir, "quad.ply");
		const offPath = path.join(tmpDir, "quad.off");

		const plyText = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar int vertex_indices
end_header
-50.0 -50.0 0.0
 50.0 -50.0 0.0
 50.0  50.0 0.0
-50.0  50.0 0.0
3 0 1 2
3 0 2 3
`;
		const offText = `OFF
4 2 6
-50.0 -50.0 0.0
 50.0 -50.0 0.0
 50.0  50.0 0.0
-50.0  50.0 0.0
3 0 1 2
3 0 2 3
`;

		await fs.writeFile(plyPath, plyText);
		await fs.writeFile(offPath, offText);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
		});

		comp.add(
			Layer.camera({
				id: "cam3d",
				x: 400,
				y: 300,
				z: -600,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(Light.ambient("#ffffff", 0.8));

		const plyModel = Layer3D.ply(plyPath, {
			id: "ply-quad",
			x: 300,
			y: 300,
			z: 0,
			color: "#ec4899",
			scale: 1.0,
		});

		const offModel = Layer3D.off(offPath, {
			id: "off-quad",
			x: 500,
			y: 300,
			z: 0,
			color: "#8b5cf6",
			scale: 1.0,
		});

		comp.add(plyModel);
		comp.add(offModel);

		const buffer = await comp.renderFrame({ frame: 0 });
		expect(buffer).toBeInstanceOf(Buffer);

		const img = await decodePngPixels(buffer);
		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		// Sample around (300, 300) for PLY (pink/purple) and (500, 300) for OFF (purple)
		const plyCenterPix = getPixel(img, 300, 300);
		expect(plyCenterPix.r).toBeGreaterThan(30);

		const offCenterPix = getPixel(img, 500, 300);
		expect(offCenterPix.r).toBeGreaterThan(30);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});
});
