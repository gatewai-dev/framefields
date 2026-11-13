/**
 * Shutter motion blur of motion that lives below the model matrix: a mesh
 * moved by its morph targets alone, and a text layer drawn as native glyphs
 * in the 3D scene. Before the velocity pass saw deformed vertices and glyph
 * planes, both rendered sharp under a moving shutter; and after a seek the
 * history pass skipped layers placed in 3D by z alone.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GltfDocument } from "@framefields/webgpu-renderers/gltf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	Composition,
	FontManager,
	Layer,
	LayerAnimation,
	type LayoutNode,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 400;
const C = SIZE / 2;
/** Morph slide over the 60-frame clip, px: 12 px per frame. */
const SLIDE = 720;

let dir = "";
let file = "";

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-deform-blur-"));
	file = path.join(dir, "slider.glb");
	const doc = new GltfDocument();
	const white = doc.addMaterial({ color: "#ffffff", unlit: true });
	const h = 30;
	doc.addNode({
		mesh: doc.addMesh({
			primitives: [
				{
					positions: [-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0],
					normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
					indices: [0, 1, 2, 0, 2, 3],
					material: white,
					targets: [
						{
							name: "slide",
							positions: [SLIDE, 0, 0, SLIDE, 0, 0, SLIDE, 0, 0, SLIDE, 0, 0],
						},
					],
				},
			],
		}),
	});
	await fs.writeFile(file, doc.toGlb());
	await FontManager.register("assets/fonts/Inter.ttf");
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function scene(layer: LayoutNode, motionBlur: boolean): Composition {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: 30,
		durationFrames: 60,
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
		layer,
	]);
	return comp;
}

/** The quad slides from x = C - SLIDE / 2 to C + SLIDE / 2 by its morph weight. */
const slider = () =>
	Layer.glb(file, {
		id: "slider",
		x: C - SLIDE / 2,
		y: C,
		z: 0,
		rotateX: 180,
		morphs: {
			slide: [
				[0, 0],
				[60, 1],
			],
		},
	}) as LayoutNode;

/** A bold "I" on its own 3D plane, moving right 16 px per frame. */
const word = () =>
	Layer.text("I", {
		id: "word",
		position: "absolute",
		x: C - 480 - 50,
		y: C - 100,
		z: 1,
		width: 100,
		height: 200,
		fontFamily: "Inter",
		fontWeight: 700,
		fontSize: 160,
		fill: "#ffffff",
	} as never).animate(
		LayerAnimation.create().keys("x", [
			[0, C - 480 - 50],
			[60, C + 480 - 50],
		]),
	) as LayoutNode;

async function row(comp: Composition, frame: number, y: number) {
	const png = await comp.renderFrame({ frame });
	const { pixels } = await decodePngPixels(png);
	return {
		png,
		line: Array.from(
			{ length: SIZE },
			(_, x) => pixels[(y * SIZE + x) * 4] ?? 0,
		),
	};
}
/** Pixels partly covered: neither background nor solid. */
const partial = (line: number[]) =>
	line.filter((v) => v > 12 && v < 243).length;

describe("motion blur below the model matrix", () => {
	it("streaks a mesh moved by its morph targets", async () => {
		const sharp = await row(scene(slider(), false), 30, C);
		const blurred = await row(scene(slider(), true), 30, C);
		expect(partial(sharp.line)).toBeLessThan(4);
		// 12 px per frame at a 180° shutter: each edge ramps over ~6 px.
		expect(partial(blurred.line)).toBeGreaterThan(8);
	});

	it("renders a morphing frame the same after a seek as in order", async () => {
		const inOrder = scene(slider(), true);
		for (const f of [27, 28, 29]) await inOrder.renderFrame({ frame: f });
		const sequential = (await row(inOrder, 30, C)).png;
		const seeked = (await row(scene(slider(), true), 30, C)).png;
		expect(seeked).toEqual(sequential);
	});

	it("streaks text glyphs on a moving 3D plane", async () => {
		const sharp = await row(scene(word(), false), 30, C);
		const blurred = await row(scene(word(), true), 30, C);
		// The stem's two antialiased edges.
		expect(partial(sharp.line)).toBeLessThan(6);
		// 16 px per frame at a 180° shutter: each edge ramps over ~8 px.
		expect(partial(blurred.line)).toBeGreaterThan(10);
		const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
		expect(sum(sharp.line)).toBeGreaterThan(0);
		expect(
			Math.abs(sum(blurred.line) - sum(sharp.line)) / sum(sharp.line),
		).toBeLessThan(0.1);
	});

	it("renders moving 3D text the same after a seek as in order", async () => {
		// The seek's history pass records layers placed in 3D by z alone.
		const inOrder = scene(word(), true);
		for (const f of [27, 28, 29]) await inOrder.renderFrame({ frame: f });
		const sequential = (await row(inOrder, 30, C)).png;
		const seeked = (await row(scene(word(), true), 30, C)).png;
		expect(seeked).toEqual(sequential);
	});
});
