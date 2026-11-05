import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	type LayoutNode,
} from "./index.js";
import { Physics } from "./physics/index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 320;
const H = 180;

type Rgb = [number, number, number];

function comp(layers: LayoutNode[], frames = 1): Composition {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: frames,
		backgroundColor: "#000000",
	});
	c.add([
		Layer.camera({
			x: 160,
			y: 40,
			z: -520,
			targetX: 160,
			targetY: 300,
			targetZ: 0,
		}),
		...layers,
	]);
	return c;
}

async function pixels(c: Composition, frame = 0): Promise<Uint8ClampedArray> {
	return (await decodePngPixels(await c.renderFrame({ frame }))).pixels;
}

function count(px: Uint8ClampedArray, test: (rgb: Rgb) => boolean): number {
	let n = 0;
	for (let i = 0; i < px.length; i += 4)
		if (test([px[i]!, px[i + 1]!, px[i + 2]!])) n++;
	return n;
}

function mean(
	px: Uint8ClampedArray,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): Rgb {
	const sum: Rgb = [0, 0, 0];
	let n = 0;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const i = (y * W + x) * 4;
			for (let c = 0; c < 3; c++) sum[c] += px[i + c]!;
			n++;
		}
	return sum.map((v) => v / n) as Rgb;
}

const red = ([r, g, b]: Rgb) => r > 150 && g < 80 && b < 80;
const green = ([r, g, b]: Rgb) => g > 120 && r < 90 && b < 90;
const blue = ([r, g, b]: Rgb) => b > 150 && r < 80 && g < 80;

/** Rolling ground under the camera; its valley floor at y = 320. */
const ground = (extra: Record<string, unknown> = {}) =>
	Layer3D.terrain({
		id: "ground",
		x: 160,
		y: 320,
		z: 0,
		width: 900,
		depth: 900,
		height: 80,
		segments: 64,
		noise: { seed: 4, octaves: 4 },
		material: "unlit",
		...extra,
	});

const flat = () => ground({ heightFn: () => 0.5, color: "#20c040" });

describe("Layer3D.terrain / sdf / scatter", () => {
	it("colors terrain by altitude", async () => {
		const c = comp([
			ground({
				colorByElevation: { lowColor: "#00c000", highColor: "#ffffff" },
			}),
		]);
		const px = await pixels(c);
		expect(count(px, green)).toBeGreaterThan(500);
		expect(
			count(px, ([r, g, b]) => r > 220 && g > 220 && b > 220),
		).toBeGreaterThan(200);
		expect(await pixels(c)).toEqual(px);
	});

	it("wraps any layer onto a mesh as its texture", async () => {
		const half = (x: number, background: string) =>
			Layer.box({
				position: "absolute",
				x,
				y: 0,
				width: W / 2,
				height: H,
				background,
			});
		const halves = Layer.box({
			width: W,
			height: H,
			children: [half(0, "#ff0000"), half(W / 2, "#0000ff")],
		});
		const px = await pixels(
			comp([ground({ heightFn: () => 0, texture: halves })]),
		);
		// u runs left to right across the terrain's x.
		expect(red(mean(px, 40, 150, 120, 175))).toBe(true);
		expect(blue(mean(px, 200, 150, 280, 175))).toBe(true);
		// The texture layer is not drawn flat on its own: the sky stays black.
		expect(mean(px, 0, 0, W, 10).every((v) => v < 5)).toBe(true);
	});

	it("meshes SDF booleans with their primitives' colors", async () => {
		const px = await pixels(
			comp([
				Layer3D.sdf({
					x: 160,
					y: 230,
					z: 0,
					rotateY: 35,
					rotateX: 30,
					bounds: [220, 220, 220],
					resolution: 48,
					material: "unlit",
					primitives: [
						{
							shape: "box",
							size: [160, 160, 160],
							radius: 12,
							color: "#ff2020",
						},
						{ shape: "sphere", radius: 105, op: "intersect", smoothness: 6 },
						{
							shape: "cylinder",
							radius: 45,
							height: 400,
							op: "subtract",
							color: "#2020ff",
						},
					],
				}),
			]),
		);
		expect(count(px, red)).toBeGreaterThan(800);
		expect(count(px, blue)).toBeGreaterThan(100);
	});

	it("scatters deterministic instances that stand on the surface", async () => {
		const terrain = flat();
		const scatter = (seed: number) =>
			Layer3D.scatter({
				id: "rocks",
				surface: terrain,
				mesh: Layer3D.sphere({
					radius: 10,
					color: "#ff0000",
					material: "unlit",
				}),
				material: "unlit",
				count: 40,
				minDistance: 40,
				seed,
				exclude: [{ x: 160, z: 0, radius: 120 }],
			});
		const a = scatter(9);
		const points = a.points();
		expect(points.length).toBe(40);
		for (const p of points) {
			expect(p.position[1]).toBeCloseTo(
				terrain.heightAt(p.position[0], p.position[2]),
				3,
			);
			expect(
				Math.hypot(p.position[0] - 160, p.position[2]),
			).toBeGreaterThanOrEqual(120);
		}
		const px = await pixels(comp([terrain, a]));
		expect(count(px, red)).toBeGreaterThan(150);
		expect(await pixels(comp([terrain, scatter(9)]))).toEqual(px);
		expect(await pixels(comp([terrain, scatter(10)]))).not.toEqual(px);
		// The clearing in front of the camera stays grass.
		expect(green(mean(px, 150, 120, 170, 135))).toBe(true);
	});

	it("sways scattered meshes in the wind, frame by frame", async () => {
		const scene = (wind: boolean) =>
			comp(
				[
					flat(),
					Layer3D.scatter({
						surface: flat(),
						mesh: Layer3D.capsule({ radius: 6, length: 60, color: "#ff0000" }),
						material: "unlit",
						count: 30,
						seed: 2,
						alignToNormal: 0,
						...(wind && { wind: { amplitudeDeg: 25, frequency: 1 } }),
					}),
				],
				30,
			);
		const still = scene(false);
		expect(await pixels(still, 0)).toEqual(await pixels(still, 7));
		const windy = scene(true);
		expect(await pixels(windy, 0)).not.toEqual(await pixels(windy, 7));
	});

	it("lands physics bodies on the terrain's own triangles", async () => {
		const world = await Physics.world3d({ fps: 30, frames: 90 });
		const terrain = flat();
		world.body(terrain, { type: "fixed" });
		const ball = world.body(
			Layer3D.sphere({ radius: 20, x: 200, y: 0, z: 40 }),
			{ restitution: 0, angularDamping: 4, linearDamping: 2 },
		);
		world.simulate();
		const y = ball.y.get({ frame: 89, fps: 30 } as never);
		expect(y).toBeCloseTo(terrain.heightAt(200, 40) - 20, 0);
	});

	it("validates specs and lints filters that reject the whole surface", () => {
		const terrain = flat();
		const ok = comp([
			terrain,
			Layer3D.scatter({
				surface: terrain,
				mesh: Layer3D.sphere({ radius: 5 }),
				count: 10,
				wind: { amplitudeDeg: 5 },
			}),
			Layer3D.sdf({
				bounds: [100, 100, 100],
				primitives: [{ shape: "gyroid", scale: 40, thickness: 6 }],
			}),
		]);
		expect(CompositorProgramSchema.safeParse(ok.toSpec()).success).toBe(true);
		expect(ok.lint().some((d) => d.code === "scatter_filters_reject_all")).toBe(
			false,
		);
		const bad = comp([ground({ segments: 9999 })]);
		expect(CompositorProgramSchema.safeParse(bad.toSpec()).success).toBe(false);
		const empty = comp([
			terrain,
			Layer3D.scatter({
				surface: terrain,
				mesh: Layer3D.sphere({ radius: 5 }),
				count: 10,
				slopeRange: [40, 60],
			}),
		]);
		expect(
			empty.lint().some((d) => d.code === "scatter_filters_reject_all"),
		).toBe(true);
	});
});
