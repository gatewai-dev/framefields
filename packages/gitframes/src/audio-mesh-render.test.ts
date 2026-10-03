import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Signal } from "@gitframes/core";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, Light } from "./index.js";

interface DecodedImage {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
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

// 3D Cylinder / Column mesh with multiple height slices for wave and normal displacement
function generateCylinderObj(
	slices = 16,
	heightSegments = 8,
	radius = 80,
	height = 240,
): string {
	let out = "# Procedural Cylinder\n";
	for (let j = 0; j <= heightSegments; j++) {
		const y = (j / heightSegments - 0.5) * height;
		const v = j / heightSegments;
		for (let i = 0; i < slices; i++) {
			const u = i / slices;
			const angle = (i / slices) * Math.PI * 2;
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			out += `v ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}\n`;
			out += `vt ${u.toFixed(4)} ${v.toFixed(4)}\n`;
			out += `vn ${Math.cos(angle).toFixed(4)} 0 ${Math.sin(angle).toFixed(4)}\n`;
		}
	}

	for (let j = 0; j < heightSegments; j++) {
		for (let i = 0; i < slices; i++) {
			const nextI = (i + 1) % slices;
			const p0 = j * slices + i + 1;
			const p1 = j * slices + nextI + 1;
			const p2 = (j + 1) * slices + nextI + 1;
			const p3 = (j + 1) * slices + i + 1;
			out += `f ${p0}/${p0}/${p0} ${p1}/${p1}/${p1} ${p2}/${p2}/${p2}\n`;
			out += `f ${p0}/${p0}/${p0} ${p2}/${p2}/${p2} ${p3}/${p3}/${p3}\n`;
		}
	}
	return out;
}

describe("Headless WebGPU Audio Latent 3D Mesh Deformation Engine", () => {
	it("renders normal_extrusion mesh deformation driven by audio FFT spectrum", async () => {
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "gitframes-audio-mesh-"),
		);
		const objPath = path.join(tmpDir, "cylinder.obj");
		await fs.writeFile(objPath, generateCylinderObj(16, 8, 80, 200));

		// Synthesize 1-second audio: Frame 0 has silence; Frame 15 (0.5s) has massive 60Hz kick drum
		const sampleRate = 48000;
		const fps = 30;
		const totalSamples = sampleRate * 1;
		const audioChannel = new Float32Array(totalSamples);
		for (let i = sampleRate / 2; i < sampleRate / 2 + 4000; i++) {
			audioChannel[i] =
				Math.sin((2.0 * Math.PI * 60.0 * (i - sampleRate / 2)) / sampleRate) *
				0.95;
		}

		const comp = new Composition({
			width: 640,
			height: 480,
			fps,
			durationMs: 1000,
			backgroundColor: "#050814",
		});

		comp.add(
			Layer.camera({
				id: "cam3d",
				x: 320,
				y: 240,
				z: -500,
				targetX: 320,
				targetY: 240,
				targetZ: 0,
			}),
		);

		comp.add(Light.ambient("#ffffff", 0.4));
		comp.add(
			Light.directional({
				id: "sun",
				color: "#ffffff",
				intensity: 1.2,
				x: 200,
				y: -300,
				z: -400,
				targetX: 320,
				targetY: 240,
				targetZ: 0,
			}),
		);

		const mesh = Layer3D.obj(objPath, {
			id: "audio-cylinder",
			x: 320,
			y: 240,
			z: 0,
			rotateX: 15,
			color: "#00f0ff",
			material: "lit",
			shininess: 64,
		}).deformWithAudio({
			audioTrackId: "kick",
			audioData: [audioChannel],
			mode: "normal_extrusion",
			frequencyRange: [20, 120],
			amplitudeMultiplier: 2.5,
		});

		comp.add(mesh);

		// Frame 0: Silence (baseline rest geometry)
		const frame0Buffer = await comp.renderFrame({ frame: 0 });
		// Frame 15: Strong kick transient (displaced along normal)
		const frame15Buffer = await comp.renderFrame({ frame: 15 });

		const img0 = await decodePngPixels(frame0Buffer);
		const img15 = await decodePngPixels(frame15Buffer);

		// Assert significant visual difference between silence and audio kick
		const mse = computeMse(img0.pixels, img15.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders radial_pulse mesh deformation with omnidirectional center expansion", async () => {
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "gitframes-radial-"),
		);
		const objPath = path.join(tmpDir, "cylinder_radial.obj");
		await fs.writeFile(objPath, generateCylinderObj(16, 6, 70, 180));

		const sampleRate = 48000;
		const fps = 30;
		const audioChannel = new Float32Array(sampleRate);
		for (let i = sampleRate / 2; i < sampleRate / 2 + 4000; i++) {
			audioChannel[i] = Math.sin((2.0 * Math.PI * 80.0 * i) / sampleRate);
		}

		const comp = new Composition({
			width: 640,
			height: 480,
			fps,
			durationMs: 1000,
			backgroundColor: "#080c18",
		});

		comp.add(
			Layer.camera({
				id: "cam-pulse",
				x: 320,
				y: 240,
				z: -500,
				targetX: 320,
				targetY: 240,
				targetZ: 0,
			}),
		);
		comp.add(Light.ambient("#ffffff", 0.5));

		const mesh = Layer3D.obj(objPath, {
			id: "pulse-mesh",
			x: 320,
			y: 240,
			z: 0,
			color: "#f59e0b",
			material: "lit",
		}).deformWithAudio({
			audioTrackId: "pulse_track",
			audioData: [audioChannel],
			mode: "radial_pulse",
			amplitudeMultiplier: 2.0,
			damping: 0.1,
		});

		comp.add(mesh);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame15 = await comp.renderFrame({ frame: 15 });

		const img0 = await decodePngPixels(frame0);
		const img15 = await decodePngPixels(frame15);

		const mse = computeMse(img0.pixels, img15.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("renders harmonic_wave deformation modulated reactively by Signal multiplier", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitframes-wave-"));
		const objPath = path.join(tmpDir, "cylinder_wave.obj");
		await fs.writeFile(objPath, generateCylinderObj(16, 8, 60, 220));

		const sampleRate = 48000;
		const fps = 30;
		const audioChannel = new Float32Array(sampleRate);
		for (let i = 0; i < sampleRate; i++) {
			audioChannel[i] =
				Math.sin((2.0 * Math.PI * 120.0 * i) / sampleRate) * 0.8;
		}

		const comp = new Composition({
			width: 640,
			height: 480,
			fps,
			durationMs: 1000,
			backgroundColor: "#02040a",
		});

		comp.add(
			Layer.camera({
				id: "cam-wave",
				x: 320,
				y: 240,
				z: -500,
				targetX: 320,
				targetY: 240,
				targetZ: 0,
			}),
		);
		comp.add(Light.ambient("#ffffff", 0.6));

		// Modulate amplitudeMultiplier reactively via Signal
		const dynamicAmpSignal = Signal.builder({
			type: "sine",
			frequency: 1.0,
			amplitude: 1.25,
			offset: 1.75,
		});

		const mesh = Layer3D.obj(objPath, {
			id: "wave-mesh",
			x: 320,
			y: 240,
			z: 0,
			color: "#10b981",
			material: "lit",
		}).deformWithAudio({
			audioTrackId: "wave_track",
			audioData: [audioChannel],
			mode: "harmonic_wave",
			amplitudeMultiplier: dynamicAmpSignal,
		});

		comp.add(mesh);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame15 = await comp.renderFrame({ frame: 15 });

		const img0 = await decodePngPixels(frame0);
		const img15 = await decodePngPixels(frame15);

		const mse = computeMse(img0.pixels, img15.pixels);
		expect(mse).toBeGreaterThan(5.0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	/** A square bar (4-sided prism) lit from the side: twisting it changes its silhouette. */
	async function renderBar(
		mode: "twist" | "ripple" | null,
		frame: number,
		audioChannel: Float32Array,
	) {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitframes-bar-"));
		const objPath = path.join(tmpDir, "bar.obj");
		await fs.writeFile(objPath, generateCylinderObj(4, 24, 90, 260));
		const comp = new Composition({
			width: 640,
			height: 480,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#080c18",
		});
		comp.add(
			Layer.camera({ id: "cam-bar", x: 320, y: 240, z: -500, targetX: 320, targetY: 240, targetZ: 0 }),
		);
		comp.add(Light.ambient("#ffffff", 0.5));
		comp.add(
			Light.directional({ id: "sun", color: "#ffffff", intensity: 1.2, x: 100, y: -300, z: -400, targetX: 320, targetY: 240, targetZ: 0 }),
		);
		const bar = Layer3D.obj(objPath, { id: "bar", x: 320, y: 240, z: 0, color: "#f0f0f0", material: "lit" });
		comp.add(
			mode
				? bar.deformWithAudio({ audioTrackId: `bar-${mode}`, audioData: [audioChannel], mode, amplitudeMultiplier: 1.5 })
				: bar,
		);
		const img = await decodePngPixels(await comp.renderFrame({ frame }));
		await fs.rm(tmpDir, { recursive: true, force: true });
		return img;
	}

	it("twists a mesh about Y by height, harder on the bass", async () => {
		const sampleRate = 48000;
		const audio = new Float32Array(sampleRate);
		for (let i = sampleRate / 2; i < sampleRate / 2 + 6000; i++)
			audio[i] = Math.sin((2 * Math.PI * 70 * i) / sampleRate);
		const straight = await renderBar(null, 0, audio);
		const resting = await renderBar("twist", 0, audio);
		const onBass = await renderBar("twist", 15, audio);
		// A resting twist already turns the bar; the bass winds it further.
		expect(computeMse(straight.pixels, resting.pixels)).toBeGreaterThan(5);
		expect(computeMse(resting.pixels, onBass.pixels)).toBeGreaterThan(5);
	});

	it("ripples a mesh with waves that travel over time", async () => {
		const audio = new Float32Array(48000);
		const straight = await renderBar(null, 0, audio);
		const early = await renderBar("ripple", 3, audio);
		const late = await renderBar("ripple", 18, audio);
		expect(computeMse(straight.pixels, early.pixels)).toBeGreaterThan(5);
		expect(computeMse(early.pixels, late.pixels)).toBeGreaterThan(5);
	});
});
