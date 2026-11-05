/**
 * Voronoi destruction through the real renderer: a fractured layer looks
 * whole until it breaks, then its pieces fall as rigid bodies; a hit breaks
 * it on contact.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	type LayoutNode,
} from "../index.js";
import { decodePngPixels } from "../test-utils/pixels.js";
import { Physics } from "./index.js";

const FPS = 30;
const SIZE = 400;
const C = SIZE / 2;

function scene(layers: LayoutNode[]): Composition {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: FPS,
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
		}),
		...layers,
	]);
	return comp;
}

const slab = (id: string) =>
	Layer3D.roundedBox({
		id,
		x: C,
		y: C,
		z: 0,
		width: 160,
		height: 60,
		depth: 60,
		radius: 0,
		color: "#ffffff",
		material: "unlit",
	});

/** Lit pixels and their mean y. */
async function coverage(comp: Composition, frame: number) {
	const { pixels } = await decodePngPixels(await comp.renderFrame({ frame }));
	let lit = 0;
	let sy = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		if ((pixels[i] ?? 0) > 128) {
			lit++;
			sy += Math.floor(i / 4 / SIZE);
		}
	}
	return { lit, meanY: sy / Math.max(1, lit), pixels };
}

describe("Physics.fracture", () => {
	it("looks whole until its fracture frame, then falls apart", async () => {
		const whole = scene([slab("whole")]);
		const target = slab("slab");
		const comp = scene([target]);
		const world = await Physics.world3d({ fps: FPS, frames: 40 });
		world.ground({ y: C + 140 });
		const broken = world.fracture(target, {
			cells: 16,
			fractureFrame: 10,
			explosionSpeed: 300,
			interiorColor: "#ff0000",
		});
		world.simulate();
		expect(broken.frame).toBe(10);
		expect(broken.pieces.length).toBeGreaterThan(8);

		const ref = await coverage(whole, 5);
		const before = await coverage(comp, 5);
		// The pieces tile the slab exactly: the same picture, no cut faces showing.
		let diff = 0;
		for (let i = 0; i < ref.pixels.length; i += 4) {
			if (Math.abs((ref.pixels[i] ?? 0) - (before.pixels[i] ?? 0)) > 40) diff++;
		}
		expect(diff).toBeLessThan(ref.lit * 0.01);

		const after = await coverage(comp, 39);
		// Pieces fell (y down) onto the ground; red cut faces show.
		expect(after.meanY).toBeGreaterThan(before.meanY + 50);
		let red = 0;
		for (let i = 0; i < after.pixels.length; i += 4) {
			if ((after.pixels[i] ?? 0) > 150 && (after.pixels[i + 1] ?? 0) < 80)
				red++;
		}
		expect(red).toBeGreaterThan(50);
	});

	it("breaks on impact, and the spec carries the pieces' track", async () => {
		const target = slab("slab");
		const ball = Layer3D.sphere({
			id: "ball",
			x: C,
			y: C - 200,
			z: 0,
			radius: 20,
			color: "#ffffff",
			material: "unlit",
		});
		const comp = scene([target, ball]);
		const world = await Physics.world3d({ fps: FPS, frames: 40 });
		const broken = world.fracture(target, { cells: 12, seed: 4 });
		world.body(ball, { velocity: [0, 600, 0] });
		world.simulate();
		// Falling ~170 px at 600 px/s plus gravity: contact within a few frames of 0.25 s.
		expect(broken.frame).toBeGreaterThan(4);
		expect(broken.frame).toBeLessThan(12);

		const spec = comp.toSpec();
		expect(CompositorProgramSchema.safeParse(spec).success).toBe(true);
		const fracture = (target as unknown as { fracture3d: { track: number[] } })
			.fracture3d;
		expect(fracture.track.length).toBe(40 * broken.pieces.length * 7);

		// Pieces stay put before the hit and move after it.
		const at = (f: number, piece: number) =>
			fracture.track.slice(
				(f * broken.pieces.length + piece) * 7,
				(f * broken.pieces.length + piece) * 7 + 3,
			);
		const f0 = broken.frame ?? 0;
		expect(at(0, 0)).toEqual(at(f0, 0));
		const moved = broken.pieces.some(
			(_, i) => Math.hypot(...at(39, i).map((v, k) => v - at(0, i)[k]!)) > 20,
		);
		expect(moved).toBe(true);
	});

	it("rebuilds the pieces when modelData is lost (a JSON spec)", async () => {
		const target = slab("slab");
		const world = await Physics.world3d({ fps: FPS, frames: 30 });
		world.ground({ y: C + 140 });
		world.fracture(target, {
			cells: 10,
			fractureFrame: 5,
			explosionSpeed: 200,
		});
		world.simulate();
		const direct = await scene([target]).renderFrame({ frame: 25 });
		// The renderer rebuilds the box from its options and fractures it again.
		const copy = JSON.parse(
			JSON.stringify({ ...target, modelData: undefined }),
		) as LayoutNode;
		const replay = await scene([copy]).renderFrame({ frame: 25 });
		expect(replay).toEqual(direct);
	});
});
