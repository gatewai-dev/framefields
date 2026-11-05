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
	LayerAnimation,
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

	it("breaks a moving layer where it is, its pieces carrying its motion", async () => {
		// Slides right 4 px per frame and turns; breaks at frame 12 with no
		// burst and no gravity: the pieces keep flying as the layer did.
		const slide = () =>
			slab("slab").animate(
				LayerAnimation.create()
					.keys("x", [
						[0, C - 80],
						[40, C + 80],
					])
					.keys("rotateZ", [
						[0, 0],
						[40, 20],
					]),
			);
		const whole = scene([slide()]);
		const target = slide();
		const comp = scene([target]);
		const world = await Physics.world3d({ fps: FPS, frames: 40, gravity: 0 });
		const broken = world.fracture(target, { cells: 10, fractureFrame: 12 });
		world.simulate();
		expect(broken.frame).toBe(12);
		const centroid = async (c: Composition, f: number) => {
			const { pixels } = await decodePngPixels(
				await c.renderFrame({ frame: f }),
			);
			let sx = 0;
			let n = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if ((pixels[i] ?? 0) > 128) {
					sx += (i / 4) % SIZE;
					n++;
				}
			}
			return sx / n;
		};
		for (const f of [12, 13, 20]) {
			// Linear keys sampled with the renderer's eases: the pieces track
			// the animation the whole layer would have followed.
			expect(
				Math.abs((await centroid(comp, f)) - (await centroid(whole, f))),
			).toBeLessThan(1.5);
		}
	});

	it("collides along its animation and breaks on what it hits", async () => {
		const target = slab("slab").animate(
			LayerAnimation.create().keys("x", [
				[0, C - 150],
				[30, C + 150],
			]),
		);
		const ball = Layer3D.sphere({
			id: "ball",
			x: C + 40,
			y: C,
			radius: 20,
			color: "#ffffff",
			material: "unlit",
		});
		const world = await Physics.world3d({ fps: FPS, frames: 30, gravity: 0 });
		const broken = world.fracture(target, { cells: 8 });
		world.body(ball);
		world.simulate();
		// The slab's right face (x + 80) meets the ball's left (C + 20) near frame 9.
		expect(broken.frame).toBeGreaterThan(6);
		expect(broken.frame).toBeLessThan(12);
	});

	it("refuses a layer whose scale is animated", async () => {
		const target = slab("slab").animate(
			LayerAnimation.create().keys("scale", [
				[0, 1],
				[30, 2],
			]),
		);
		const world = await Physics.world3d({ fps: FPS, frames: 30 });
		expect(() => world.fracture(target, { cells: 8 })).toThrow(
			/animates scale/,
		);
	});

	it("flies its pieces in the space of a 3D group, like other bodies", async () => {
		const group = (child: LayoutNode) =>
			Layer.box({
				position: "absolute",
				x: 60,
				y: 0,
				width: SIZE,
				height: SIZE,
				is3D: true,
				transformStyle: "preserve-3d",
				children: [child],
			});
		const target = slab("slab");
		const comp = scene([group(target)]);
		const world = await Physics.world3d({ fps: FPS, frames: 20, gravity: 0 });
		world.fracture(target, { cells: 8, fractureFrame: 5 });
		world.simulate();
		// Still pieces (no burst, no gravity) stay exactly where the whole layer was.
		const before = await comp.renderFrame({ frame: 3 });
		const after = await comp.renderFrame({ frame: 15 });
		const { pixels: a } = await decodePngPixels(before);
		const { pixels: b } = await decodePngPixels(after);
		let diff = 0;
		let lit = 0;
		for (let i = 0; i < a.length; i += 4) {
			if ((a[i] ?? 0) > 128) lit++;
			if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 60) diff++;
		}
		expect(lit).toBeGreaterThan(1000);
		expect(diff).toBeLessThan(lit * 0.02);
	});
});
