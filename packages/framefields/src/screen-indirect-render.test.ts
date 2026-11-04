import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	type EnvironmentOptions,
	Layer,
	Layer3D,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 320;
const H = 180;

type Rgb = [number, number, number];

interface Floor {
	color: string;
	metallic: number;
	roughness: number;
}

const CHROME: Floor = { color: "#d0d0d0", metallic: 1, roughness: 0.05 };
const MATTE: Floor = { color: "#d8d8d8", metallic: 0, roughness: 0.9 };

/**
 * A slab floor (top face at y = 300) with a hot magenta sphere resting on
 * it and, optionally, a box on its right, seen from above and in front.
 */
function scene(
	floor: Floor,
	env: EnvironmentOptions,
	options: { box?: boolean; sun?: boolean } = {},
): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: 160,
			y: 120,
			z: -700,
			targetX: 160,
			targetY: 260,
			targetZ: 0,
		}),
		Layer.environment("night", { intensity: 0.5, ...env }),
		...(options.sun
			? [
					Layer.directionalLight({
						x: -400,
						y: -900,
						z: -500,
						targetX: 160,
						targetY: 300,
						targetZ: 0,
						intensity: 1.2,
					}),
				]
			: []),
		Layer3D.roundedBox({
			x: 160,
			y: 320,
			z: 0,
			width: 1400,
			height: 40,
			depth: 1400,
			...floor,
		}),
		Layer3D.sphere({
			x: 110,
			y: 230,
			z: 0,
			radius: 70,
			segments: 64,
			color: "#101010",
			emissive: "#ff2a8a",
			emissiveIntensity: 3,
		}),
		...(options.box
			? [
					Layer3D.roundedBox({
						x: 290,
						y: 220,
						z: 0,
						width: 90,
						height: 160,
						depth: 90,
						color: "#e0e0e0",
						metallic: 0,
						roughness: 0.9,
					}),
				]
			: []),
	]);
	return comp;
}

async function render(comp: Composition): Promise<Uint8ClampedArray> {
	return (await decodePngPixels(await comp.renderFrame({ frame: 0 }))).pixels;
}

/** Mean RGB over the box [x0, x1) × [y0, y1). */
function mean(
	px: Uint8ClampedArray,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): Rgb {
	const sum: Rgb = [0, 0, 0];
	let n = 0;
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const i = (y * W + x) * 4;
			for (let c = 0; c < 3; c++) sum[c] += px[i + c] ?? 0;
			n++;
		}
	}
	return sum.map((v) => v / n) as Rgb;
}

interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Bounding box of the pixels whose color passes `test`. */
function bounds(px: Uint8ClampedArray, test: (rgb: Rgb) => boolean): Box {
	const box = { x0: W, y0: H, x1: -1, y1: -1 };
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			if (!test([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0])) continue;
			box.x0 = Math.min(box.x0, x);
			box.y0 = Math.min(box.y0, y);
			box.x1 = Math.max(box.x1, x + 1);
			box.y1 = Math.max(box.y1, y + 1);
		}
	}
	expect(box.x1).toBeGreaterThan(box.x0);
	return box;
}

/** The glowing sphere: bright magenta. */
const isSphere = ([r, g, b]: Rgb) => r > 200 && r > g + 60 && b > g;

const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("screen-space reflections and GI", () => {
	it("reflects an emissive object off the floor in a chrome floor", async () => {
		const off = await render(scene(CHROME, {}));
		const on = await render(scene(CHROME, { ssr: true }));
		// Below the sphere, where its mirror image lies, the floor shows the
		// dark night environment without SSR and the magenta sphere with it.
		const s = bounds(off, isSphere);
		const cx = Math.round((s.x0 + s.x1) / 2);
		const mirrored = (px: Uint8ClampedArray) =>
			mean(px, cx - 8, s.y1 + 6, cx + 8, s.y1 + 26);
		const [r0, g0, b0] = mirrored(off);
		const [r1, g1, b1] = mirrored(on);
		expect(r0).toBeLessThan(40);
		expect(r1).toBeGreaterThan(r0 + 150);
		expect(r1).toBeGreaterThan(g1 + 100);
		expect(b1 - b0).toBeGreaterThan(g1 - g0 + 30);
		// Nothing above the far floor: it keeps reflecting the environment.
		const far = (px: Uint8ClampedArray) => mean(px, 240, 150, 300, 175);
		const [fr0, fg0, fb0] = far(off);
		const [fr1, fg1, fb1] = far(on);
		expect(
			Math.abs(fr1 - fr0) + Math.abs(fg1 - fg0) + Math.abs(fb1 - fb0),
		).toBeLessThan(3);
	});

	it("leaves rough surfaces above maxRoughness to the environment", async () => {
		const rough: Floor = { ...CHROME, roughness: 0.8 };
		const off = await render(scene(rough, {}));
		const on = await render(scene(rough, { ssr: { maxRoughness: 0.5 } }));
		let diff = 0;
		for (let i = 0; i < off.length; i++)
			diff += Math.abs((off[i] ?? 0) - (on[i] ?? 0));
		expect(diff / (W * H)).toBeLessThan(0.05);
	});

	it("bleeds an emissive object's color onto a matte floor", async () => {
		const off = await render(scene(MATTE, {}));
		const on = await render(scene(MATTE, { gi: true }));
		// On the floor just below the sphere's base red and blue rise
		// against green: magenta light.
		const s = bounds(off, isSphere);
		const cx = Math.round((s.x0 + s.x1) / 2);
		const [r0, g0, b0] = mean(off, cx - 10, s.y1 + 2, cx + 10, s.y1 + 10);
		const [r1, g1, b1] = mean(on, cx - 10, s.y1 + 2, cx + 10, s.y1 + 10);
		expect(r1 - r0).toBeGreaterThan(25);
		expect(b1 - b0).toBeGreaterThan(5);
		expect(Math.abs(g1 - g0)).toBeLessThan(6);
		// Far from the sphere the floor is lit as before.
		const far = (px: Uint8ClampedArray) => luma(mean(px, 20, 150, 60, 175));
		expect(Math.abs(far(on) - far(off))).toBeLessThan(3);
	});

	it("darkens environment light where a box meets the floor", async () => {
		const comp = (gi: boolean) =>
			scene(
				MATTE,
				{ intensity: 2.5, ...(gi && { gi: { intensity: 0 } }) },
				{ box: true },
			);
		const off = await render(comp(false));
		const on = await render(comp(true));
		// The grey box: blue-leaning and darker than the lit floor.
		const b = bounds(off, ([r, , bl]) => bl > r + 25 && r < 120);
		const contact = (px: Uint8ClampedArray) =>
			luma(mean(px, b.x0 + 4, b.y1, b.x1 - 4, b.y1 + 3));
		const open = (px: Uint8ClampedArray) => luma(mean(px, 40, 150, 80, 170));
		expect(contact(on)).toBeLessThan(contact(off) - 8);
		expect(Math.abs(open(on) - open(off))).toBeLessThan(2);
	});

	it("keeps comp.toSpec() schema-valid with ssr and gi settings", () => {
		const comp = scene(CHROME, {
			ssr: { intensity: 0.7, maxRoughness: 0.4, thickness: 80, steps: 48 },
			gi: { intensity: 1.5, radius: 300, samples: 8 },
		});
		expect(CompositorProgramSchema.safeParse(comp.toSpec()).success).toBe(true);
		const bad = scene(CHROME, { ssr: { steps: 8 } });
		expect(CompositorProgramSchema.safeParse(bad.toSpec()).success).toBe(false);
	});
});
