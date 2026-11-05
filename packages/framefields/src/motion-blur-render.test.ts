/**
 * Shutter motion blur of 3D scenes through the real renderer: objects
 * streak along their own motion (model matrix, skinning, instances,
 * fractured pieces), still things stay sharp, and a frame renders the same
 * whether reached in order or by a seek.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Physics,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 400;
const C = SIZE / 2;

function scene(
	layers: LayoutNode[],
	motionBlur: boolean | { shutter?: number } = true,
	camera: Record<string, unknown> = {},
): Composition {
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
			// One model unit per pixel at z = 0.
			z: -C / Math.tan((25 * Math.PI) / 180),
			targetX: C,
			targetY: C,
			targetZ: 0,
			motionBlur,
			...camera,
		}),
		...layers,
	]);
	return comp;
}

/** A white box moving right at `speed` px per frame. */
const mover = (speed: number, y = C) =>
	Layer3D.roundedBox({
		id: "mover",
		x: C,
		y,
		z: 0,
		width: 60,
		height: 60,
		depth: 20,
		radius: 0,
		color: "#ffffff",
		material: "unlit",
	}).animate(
		LayerAnimation.create().keys("x", [
			[0, C - 30 * speed],
			[60, C + 30 * speed],
		]),
	);

async function row(comp: Composition, frame: number, y: number) {
	const { pixels } = await decodePngPixels(await comp.renderFrame({ frame }));
	return Array.from(
		{ length: SIZE },
		(_, x) => pixels[(y * SIZE + x) * 4] ?? 0,
	);
}
async function column(comp: Composition, frame: number, x: number) {
	const { pixels } = await decodePngPixels(await comp.renderFrame({ frame }));
	return Array.from(
		{ length: SIZE },
		(_, y) => pixels[(y * SIZE + x) * 4] ?? 0,
	);
}
/** Pixels partly covered: neither background nor solid. */
const partial = (line: number[]) =>
	line.filter((v) => v > 12 && v < 243).length;
/** Width of the leading edge's ramp, from 5% to 95% coverage, px. */
function ramp(line: number[]): number {
	const start = line.findIndex((v) => v > 12);
	const end = line.findIndex((v, i) => i > start && v > 243);
	return end - start;
}

describe("shutter motion blur", () => {
	it("streaks a moving mesh along its motion only", async () => {
		const sharp = await row(scene([mover(24)], false), 30, C);
		const blurred = await row(scene([mover(24)]), 30, C);
		expect(ramp(sharp)).toBeLessThan(3);
		// 24 px per frame at a 180° shutter: each edge ramps over ~12 px.
		expect(ramp(blurred)).toBeGreaterThan(9);
		expect(ramp(blurred)).toBeLessThan(15);
		// A 360° shutter streaks twice as far.
		const open = await row(scene([mover(24)], { shutter: 360 }), 30, C);
		expect(ramp(open)).toBeGreaterThan(ramp(blurred) + 6);
		// The streak spreads coverage past the box's edges, keeping its total.
		const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
		expect(Math.abs(sum(blurred) - sum(sharp)) / sum(sharp)).toBeLessThan(0.05);
		// Across the motion the edges stay sharp.
		const across = await column(scene([mover(24)]), 30, C);
		expect(partial(across)).toBeLessThan(6);
	});

	it("leaves a still scene exactly as it was", async () => {
		const still = (blur: boolean) =>
			scene(
				[
					Layer3D.roundedBox({
						id: "still",
						x: C,
						y: C,
						width: 100,
						height: 80,
						depth: 40,
						rotateY: 30,
						color: "#d0a060",
					}),
					Layer.directionalLight({ x: -200, y: -300, z: -300 }),
				],
				blur,
			);
		const a = await still(false).renderFrame({ frame: 12 });
		const b = await still(true).renderFrame({ frame: 12 });
		expect(b).toEqual(a);
	});

	it("renders a frame the same after a seek as in order", async () => {
		const inOrder = scene([mover(10)]);
		for (const f of [17, 18, 19]) await inOrder.renderFrame({ frame: f });
		const sequential = await inOrder.renderFrame({ frame: 20 });
		const seeked = await scene([mover(10)]).renderFrame({ frame: 20 });
		expect(seeked).toEqual(sequential);
	});

	it("blurs a camera pan over still objects", async () => {
		const pan = LayerAnimation.create()
			.keys("x", [
				[0, C - 300],
				[60, C + 300],
			])
			.keys("targetX", [
				[0, C - 300],
				[60, C + 300],
			]);
		const comp = (blur: boolean) => {
			const c = new Composition({
				width: SIZE,
				height: SIZE,
				fps: 30,
				durationFrames: 60,
				backgroundColor: "#000000",
			});
			c.add([
				Layer.camera({
					id: "cam",
					x: C,
					y: C,
					z: -C / Math.tan((25 * Math.PI) / 180),
					targetX: C,
					targetY: C,
					targetZ: 0,
					motionBlur: blur,
				}).animate(pan),
				Layer3D.roundedBox({
					id: "post",
					x: C,
					y: C,
					width: 40,
					height: 200,
					depth: 20,
					radius: 0,
					color: "#ffffff",
					material: "unlit",
				}),
			]);
			return c;
		};
		// 10 px per frame on screen: a ~5 px ramp at 180°.
		expect(ramp(await row(comp(false), 30, C))).toBeLessThan(3);
		const panned = ramp(await row(comp(true), 30, C));
		expect(panned).toBeGreaterThan(3);
		expect(panned).toBeLessThan(8);
	});

	it("blurs fractured pieces by their own motion (skinned velocity)", async () => {
		const build = async (blur: boolean) => {
			const slab = Layer3D.roundedBox({
				id: "slab",
				x: C,
				y: C - 60,
				width: 160,
				height: 60,
				depth: 60,
				radius: 0,
				color: "#ffffff",
				material: "unlit",
			});
			const world = await Physics.world3d({ fps: 30, frames: 40 });
			world.fracture(slab, {
				cells: 12,
				fractureFrame: 5,
				explosionSpeed: 900,
			});
			world.simulate();
			return scene([slab], blur);
		};
		const sharp = await build(false);
		const blurred = await build(true);
		// Whole and still before the break: identical.
		expect(await blurred.renderFrame({ frame: 3 })).toEqual(
			await sharp.renderFrame({ frame: 3 }),
		);
		const { pixels: a } = await decodePngPixels(
			await sharp.renderFrame({ frame: 12 }),
		);
		const { pixels: b } = await decodePngPixels(
			await blurred.renderFrame({ frame: 12 }),
		);
		let partialA = 0;
		let partialB = 0;
		for (let i = 0; i < a.length; i += 4) {
			if ((a[i] ?? 0) > 12 && (a[i] ?? 0) < 243) partialA++;
			if ((b[i] ?? 0) > 12 && (b[i] ?? 0) < 243) partialB++;
		}
		expect(partialB).toBeGreaterThan(partialA * 1.3);
	});

	it("keeps each composition's motion history its own", async () => {
		// Still renders reuse render ids across compositions: B must not read
		// A's frame 20 (same node id, moving the other way) as its own.
		const backward = () => scene([mover(-24)]);
		await backward().renderFrame({ frame: 20 });
		const after = await scene([mover(24)]).renderFrame({ frame: 21 });
		const fresh = scene([mover(24)]);
		await fresh.renderFrame({ frame: 20 });
		expect(after).toEqual(await fresh.renderFrame({ frame: 21 }));
	});

	it("blurs with an environment floor and bloom", async () => {
		const comp = scene([
			Layer.environment({ floor: { y: C + 60 }, bloom: true } as never),
			Layer3D.sphere({
				id: "orb",
				x: C,
				y: C,
				radius: 30,
				color: "#ffffff",
				emissive: "#ffffff",
				emissiveIntensity: 4,
			}).animate(
				LayerAnimation.create().keys("x", [
					[0, C - 600],
					[60, C + 600],
				]),
			),
		]);
		const { pixels } = await decodePngPixels(
			await comp.renderFrame({ frame: 30 }),
		);
		expect(pixels.some((v, i) => i % 4 === 0 && v > 200)).toBe(true);
	});
});
