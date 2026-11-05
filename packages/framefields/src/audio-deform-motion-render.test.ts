/**
 * Audio-deformed meshes through the real renderer: layers sharing one mesh
 * keep their own deformation (each dispatch has its own output; before,
 * every layer drew the last one's), and motion blur streaks the deformation
 * itself, the same after a seek as in order.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, type LayoutNode } from "./index.js";
import { computeMse, decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 400;
const C = SIZE / 2;
const FPS = 30;
/** One second of silence: ripple and twist still move by time alone. */
const silence = new Float32Array(48000);

let dir = "";
let ribbon = "";

/** A flat ribbon facing the camera, `w` × `h`, cut into `rows` horizontal strips. */
function ribbonObj(w: number, h: number, rows: number): string {
	let out = "";
	for (let j = 0; j <= rows; j++) {
		const y = (j / rows - 0.5) * h;
		for (const x of [-w / 2, 0, w / 2])
			out += `v ${x} ${y} 0\nvt ${x / w + 0.5} ${j / rows}\nvn 0 0 -1\n`;
	}
	for (let j = 0; j < rows; j++)
		for (let i = 0; i < 2; i++) {
			const a = j * 3 + i + 1;
			const b = a + 1;
			const c = a + 4;
			const d = a + 3;
			out += `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`;
			out += `f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}\n`;
		}
	return out;
}

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-audio-deform-"));
	ribbon = path.join(dir, "ribbon.obj");
	await fs.writeFile(ribbon, ribbonObj(120, 240, 24));
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function scene(layers: LayoutNode[], motionBlur: boolean): Composition {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: FPS,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: C,
			y: C,
			z: -C / Math.tan((25 * Math.PI) / 180),
			targetX: C,
			targetY: C,
			targetZ: 0,
			motionBlur,
		}),
		...layers,
	]);
	return comp;
}

const deformed = (
	id: string,
	x: number,
	mode: "twist" | "ripple",
	amplitudeMultiplier: number,
) =>
	Layer3D.obj(ribbon, {
		id,
		x,
		y: C,
		z: 0,
		color: "#ffffff",
		material: "unlit",
	}).deformWithAudio({
		audioData: [silence],
		mode,
		amplitudeMultiplier,
	}) as LayoutNode;

/** Lit pixels in row `y` between x0 and x1. */
function width(pixels: Uint8Array, y: number, x0: number, x1: number) {
	let n = 0;
	for (let x = x0; x < x1; x++)
		if ((pixels[(y * SIZE + x) * 4] ?? 0) > 128) n++;
	return n;
}

describe("audio-deformed meshes", () => {
	it("keeps each layer's own deformation of a shared mesh", async () => {
		// Same mesh: the left one untwisted, the right one twisted hard.
		const comp = scene(
			[
				deformed("flat", C - 90, "twist", 0),
				deformed("twisted", C + 90, "twist", 150),
			],
			false,
		);
		const { pixels } = await decodePngPixels(
			await comp.renderFrame({ frame: 0 }),
		);
		// Near the top the twisted ribbon has turned edge-on; the flat one has not.
		const top = C - 100;
		const flat = width(pixels, top, 0, C);
		const twisted = width(pixels, top, C, SIZE);
		expect(flat).toBeGreaterThan(100);
		expect(twisted).toBeLessThan(flat * 0.8);
	});

	it("streaks a deformation by its own motion, the same after a seek", async () => {
		const ripple = () => [deformed("ripple", C, "ripple", 6)];
		const sharp = await decodePngPixels(
			await scene(ripple(), false).renderFrame({ frame: 15 }),
		);
		const blurredPng = await scene(ripple(), true).renderFrame({ frame: 15 });
		const blurred = await decodePngPixels(blurredPng);
		// The mesh holds still; only its vertices move, and now they blur.
		expect(computeMse(sharp.pixels, blurred.pixels)).toBeGreaterThan(0.5);
		const inOrder = scene(ripple(), true);
		for (const f of [12, 13, 14]) await inOrder.renderFrame({ frame: f });
		expect(await inOrder.renderFrame({ frame: 15 })).toEqual(blurredPng);
	});
});
