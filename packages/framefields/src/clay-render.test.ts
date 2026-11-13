import { describe, expect, it } from "vitest";
import {
	type ClayOp,
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	type LayoutNode,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 400;
const H = 300;

function stage(layers: LayoutNode[], cameraY = 150): Composition {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	c.add([
		Layer.camera({
			x: 200,
			y: cameraY,
			z: -560,
			targetX: 200,
			targetY: 150,
		}),
		...layers,
	]);
	return c;
}

async function pixels(c: Composition): Promise<Uint8ClampedArray> {
	return (await decodePngPixels(await c.renderFrame({ frame: 0 }))).pixels;
}

const at = (px: Uint8ClampedArray, x: number, y: number) =>
	[0, 1, 2].map((c) => px[(y * W + x) * 4 + c]);
const lum = (rgb: number[]) => (rgb[0] + rgb[1] + rgb[2]) / 3;

/** A sculpture that uses every kind of operation, flat-colored. */
const figure: ClayOp[] = [
	{ type: "sphere", radius: 70, color: "#ff0000" },
	{
		type: "box",
		size: [60, 150, 60],
		radius: 10,
		rotation: [0, 30, 0],
		smoothness: 16,
		color: "#00ff00",
	},
	{
		type: "stroke",
		radius: 9,
		color: "#0000ff",
		path: [
			[-95, 30, -50],
			[-30, -30, -85],
			[40, 20, -80, 14],
			[100, -30, -40, 5],
		],
	},
	{ type: "torus", radius: 60, tube: 10, center: [0, 60, 0], color: "#ffff00" },
	{ type: "sphere", radius: 30, center: [0, -10, -70], mode: "carve" },
	{ type: "grab", center: [0, -75, 0], radius: 35, delta: [10, -30, 0] },
	{ type: "twist", center: [0, 50, 0], radius: 60, axis: [0, 1, 0], angle: 35 },
	{ type: "bulge", center: [-70, 0, 0], radius: 30, amount: 0.3 },
	{ type: "inflate", center: [60, -20, -30], radius: 45, amount: 8 },
];

describe("Layer3D.clay", () => {
	it("draws the field as the same shape its triangles make", async () => {
		const place = { x: 200, y: 150, z: 0, rotateY: 25, rotateX: -10 };
		const field = await pixels(
			stage([Layer3D.clay({ ...place, ops: figure, material: "unlit" })]),
		);
		// A layer texture wraps by UVs, so this one is drawn from the mesh.
		const triangles = await pixels(
			stage([
				Layer3D.clay({
					...place,
					ops: figure,
					material: "unlit",
					resolution: 140,
					texture: Layer.box({ width: 8, height: 8, background: "#ffffff" }),
				}),
			]),
		);
		const far = (a: number[], b: number[]) =>
			Math.max(...a.map((v, c) => Math.abs(v - b[c]))) > 90;
		/** No color border or silhouette within a pixel. */
		const flat = (px: Uint8ClampedArray, x: number, y: number) => {
			const center = at(px, x, y);
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++)
					if (far(center, at(px, x + dx, y + dy))) return false;
			return true;
		};
		let covered = 0;
		let differ = 0;
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const a = at(field, x, y);
				const b = at(triangles, x, y);
				if (lum(a) > 20 || lum(b) > 20) covered++;
				// Borders land a pixel apart (the mesh is the coarser of the
				// two): away from them the two pictures must agree.
				if (far(a, b) && flat(field, x, y) && flat(triangles, x, y)) differ++;
			}
		expect(covered).toBeGreaterThan(5000);
		expect(differ / covered).toBeLessThan(0.005);
	});

	it("shades smoothly across its bricks and where shading leaves the cache", async () => {
		// Lit and filling the frame: a normal read past the end of a brick's
		// cache draws a line along the brick's face, and one that differs
		// between cached and evaluated shading draws the seam between them.
		const px = await pixels(
			stage([
				Layer.environment("studio", { intensity: 0.6 }),
				Layer.directionalLight({
					x: -300,
					y: -400,
					z: -500,
					targetX: 200,
					targetY: 150,
					intensity: 1.4,
				}),
				Layer3D.clay({
					x: 200,
					y: 150,
					rotateY: 30,
					color: "#d8c8b0",
					roughness: 0.6,
					ops: [
						{ type: "capsule", radius: 70, height: 160, rotation: [0, 0, 90] },
						{
							type: "sphere",
							radius: 60,
							center: [0, -60, 20],
							smoothness: 30,
						},
					],
				}),
			]),
		);
		// Well inside the surface (silhouettes turn from the light fast), the
		// largest second difference of brightness along rows and columns.
		const MARGIN = 12;
		const lit = (x: number, y: number) => lum(at(px, x, y)) > 40;
		/** Pixels to the nearest unlit pixel along a row or column, capped. */
		const run = new Uint8Array(W * H);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				let n = 0;
				while (
					n < MARGIN &&
					[
						[x + n, y],
						[x - n, y],
						[x, y + n],
						[x, y - n],
					].every(([u, v]) => u >= 0 && v >= 0 && u < W && v < H && lit(u, v))
				)
					n++;
				run[y * W + x] = n;
			}
		let worst = 0;
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				if (run[y * W + x] < MARGIN) continue;
				const c = lum(at(px, x, y));
				worst = Math.max(
					worst,
					Math.abs(lum(at(px, x - 1, y)) - 2 * c + lum(at(px, x + 1, y))),
					Math.abs(lum(at(px, x, y - 1)) - 2 * c + lum(at(px, x, y + 1))),
				);
			}
		expect(worst).toBeLessThan(6);
	});

	it("antialiases its silhouette from the field", async () => {
		const px = await pixels(
			stage([
				Layer3D.clay({
					x: 200,
					y: 150,
					ops: [{ type: "sphere", radius: 90 }],
					material: "unlit",
				}),
			]),
		);
		expect(at(px, 200, 150)).toEqual([255, 255, 255]);
		expect(at(px, 20, 20)).toEqual([0, 0, 0]);
		let partial = 0;
		let solid = 0;
		for (let i = 0; i < px.length; i += 4) {
			if (px[i] > 250) solid++;
			else if (px[i] > 25) partial++;
		}
		// A ring of partly covered pixels, about one pixel wide.
		expect(partial).toBeGreaterThan(120);
		expect(partial).toBeLessThan(solid * 0.06);
	});

	it("casts shadows on meshes and receives theirs", async () => {
		const render = async (castShadow: boolean) =>
			pixels(
				stage(
					[
						Layer.ambientLight({ intensity: 0.25 }),
						Layer.directionalLight({
							x: 200,
							y: -600,
							z: 0,
							targetX: 200,
							targetY: 150,
							targetZ: 0,
							intensity: 1.4,
							castShadow,
						}),
						// Left: a clay ball over a mesh floor.
						Layer3D.roundedBox({
							x: 90,
							y: 250,
							width: 180,
							height: 20,
							depth: 300,
							color: "#bbbbbb",
						}),
						Layer3D.clay({
							x: 90,
							y: 150,
							color: "#bbbbbb",
							ops: [{ type: "sphere", radius: 40 }],
						}),
						// Right: a mesh ball over a clay floor.
						Layer3D.clay({
							x: 310,
							y: 250,
							color: "#bbbbbb",
							ops: [{ type: "box", size: [180, 20, 300] }],
						}),
						Layer3D.sphere({ x: 310, y: 150, radius: 40, color: "#bbbbbb" }),
					],
					-250,
				),
			);
		const lit = await render(false);
		const shadowed = await render(true);
		/** Pixels of a column range the shadow darkened by a quarter or more. */
		const darkened = (x0: number, x1: number) => {
			let n = 0;
			for (let y = 0; y < H; y++)
				for (let x = x0; x < x1; x++) {
					const before = lum(at(lit, x, y));
					if (before > 40 && lum(at(shadowed, x, y)) < before * 0.75) n++;
				}
			return n;
		};
		expect(darkened(0, W / 2)).toBeGreaterThan(400);
		expect(darkened(W / 2, W)).toBeGreaterThan(400);
		// Shadows fall under the balls, not across the floors.
		expect(darkened(0, W)).toBeLessThan(6000);
	});

	it("renders the same frame twice and validates its program", async () => {
		const c = stage([
			Layer3D.clay({
				x: 200,
				y: 150,
				symmetry: "x",
				ops: [
					...figure,
					{ type: "detail", amplitude: 3, scale: 20, ridged: true },
				],
			}),
		]);
		expect(await pixels(c)).toEqual(await pixels(c));
		expect(CompositorProgramSchema.safeParse(c.toSpec()).success).toBe(true);
		const bad = stage([
			Layer3D.clay({
				ops: [{ type: "sphere", radius: -5 }],
			}),
		]);
		expect(CompositorProgramSchema.safeParse(bad.toSpec()).success).toBe(false);
	});
});
