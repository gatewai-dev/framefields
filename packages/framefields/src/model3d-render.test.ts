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

const SAMPLE_OBJ = `
# Wavefront OBJ 3D Pyramid
v 0.0 100.0 0.0
v -100.0 -100.0 100.0
v 100.0 -100.0 100.0
v 100.0 -100.0 -100.0
v -100.0 -100.0 -100.0

vn 0.0 0.707 0.707
vn 0.707 0.707 0.0
vn 0.0 0.707 -0.707
vn -0.707 0.707 0.0
vn 0.0 -1.0 0.0

f 1//1 2//1 3//1
f 1//2 3//2 4//2
f 1//3 4//3 5//3
f 1//4 5//4 2//4
f 2//5 5//5 4//5 3//5
`;

const SAMPLE_FBX = `
; FBX 7.4.0 project file
FBXHeaderExtension: {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
Objects: {
	Geometry: 1001, "Geometry::Pyramid", "Mesh" {
		Vertices: *15 {
			a: 0.0,100.0,0.0,-100.0,-100.0,100.0,100.0,-100.0,100.0,100.0,-100.0,-100.0,-100.0,-100.0,-100.0
		}
		PolygonVertexIndex: *16 {
			a: 0,1,-3,0,2,-4,0,3,-5,0,4,-2,1,4,3,-3
		}
		LayerElementNormal: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			Normals: *48 {
				a: 0,0.7,0.7,0,0.7,0.7,0,0.7,0.7,0.7,0.7,0,0.7,0.7,0,0.7,0.7,0,0,0.7,-0.7,0,0.7,-0.7,0,0.7,-0.7,-0.7,0.7,0,-0.7,0.7,0,-0.7,0.7,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0
			}
		}
	}
	Model: 2001, "Model::PyramidMesh", "Mesh" {
		Version: 232
		Properties70: {
			P: "Lcl Translation", "Lcl Translation", "", "A", 0,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A", 0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A", 1,1,1
		}
	}
	AnimationStack: 3001, "AnimStack::Take001", "" {
	}
	AnimationLayer: 4001, "AnimLayer::BaseLayer", "" {
	}
	AnimationCurveNode: 5001, "AnimCurveNode::T", "" {
		Properties70: {
			P: "d|X", "Number", "", "A", 0
			P: "d|Y", "Number", "", "A", 0
			P: "d|Z", "Number", "", "A", 0
		}
	}
	AnimationCurve: 6001, "AnimCurve::", "" {
		KeyTime: *2 {
			a: 0, 46186158000
		}
		KeyValueFloat: *2 {
			a: 0.0, 150.0
		}
	}
}
Connections: {
	C: "OO", 1001, 2001
	C: "OO", 4001, 3001
	C: "OO", 5001, 4001
	C: "OP", 6001, 5001, "d|Y"
	C: "OP", 5001, 2001, "Lcl Translation"
}
`;

describe("WebGPU 3D Model Loading & Rendering Conformance", () => {
	it("renders a 3D Wavefront OBJ model headlessly with WebGPU shaders and lighting", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-obj-"));
		const objPath = path.join(tmpDir, "pyramid.obj");
		await fs.writeFile(objPath, SAMPLE_OBJ);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
		});

		// 3D Camera looking at the model
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

		// Directional light from top-left
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

		// 3D Model Layer using Layer.obj
		const model = Layer.obj(objPath, {
			id: "pyramid-model",
			x: 400,
			y: 300,
			z: 0,
			rotateX: 20,
			rotateY: 45,
			scale: 1.5,
			color: "#3b82f6",
			shininess: 64,
			specularIntensity: 0.8,
			material: "lit",
		});
		comp.add(model);

		const buffer = await comp.renderFrame({ frame: 0 });
		expect(buffer).toBeInstanceOf(Buffer);
		expect(buffer.length).toBeGreaterThan(1000);

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
		expect(nonBgPixels.length).toBeGreaterThan(50);

		// Corner pixel should remain background color (#050814)
		const cornerPix = getPixel(img, 10, 10);
		expect(cornerPix.r).toBeLessThan(20);
		expect(cornerPix.g).toBeLessThan(20);
		expect(cornerPix.b).toBeLessThan(30);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders a 3D Autodesk FBX model with animation scrubbing", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-fbx-"));
		const fbxPath = path.join(tmpDir, "pyramid.fbx");
		await fs.writeFile(fbxPath, SAMPLE_FBX);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
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
				id: "sun-fbx",
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

		// Add FBX model animated along animationProgress and rotateY
		const fbxModel = Layer.fbx(fbxPath, {
			id: "fbx-pyramid",
			x: 400,
			y: 300,
			z: 0,
			scale: 1.2,
			color: "#10b981",
			material: "lit",
		});

		fbxModel.animate(
			LayerAnimation.fromTo("rotateY", 0, 180, {
				durationFrames: 60,
			}).fromTo("animationProgress", 0, 1, {
				durationFrames: 60,
			}),
		);

		comp.add(fbxModel);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame30 = await comp.renderFrame({ frame: 30 });

		const img0 = await decodePngPixels(frame0);
		const img30 = await decodePngPixels(frame30);

		// Frame 0 and Frame 30 must have significant visual delta due to rotation and directional illumination
		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("binds 3D model properties reactively to Signal generators", async () => {
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "framefields-signal-"),
		);
		const objPath = path.join(tmpDir, "model.obj");
		await fs.writeFile(objPath, SAMPLE_OBJ);

		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050814",
			signals: {
				meshRotate: Signal.builder({
					fn: (ctx) => ctx.frame * 4.5,
				}),
			},
		});

		comp.add(
			Layer.camera({
				id: "cam-sig",
				x: 400,
				y: 300,
				z: -600,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(Light.ambient("#ffffff", 0.4));

		comp.add(
			Light.directional({
				id: "sun-sig",
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

		const model = Layer3D.obj(objPath, {
			id: "signal-mesh",
			x: 400,
			y: 300,
			z: 0,
			rotateX: 20,
			color: "#f59e0b",
			scale: 1.5,
			material: "lit",
		});

		model.animate(
			LayerAnimation.signal("rotateY", "meshRotate", { multiplier: 1.0 }),
		);

		comp.add(model);

		// Render at frame 0 and frame 20 (90 deg difference with directional shading)
		const frameA = await comp.renderFrame({ frame: 0 });
		const frameB = await comp.renderFrame({ frame: 20 });

		const imgA = await decodePngPixels(frameA);
		const imgB = await decodePngPixels(frameB);

		const mse = computeMse(imgA.pixels, imgB.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});
});
