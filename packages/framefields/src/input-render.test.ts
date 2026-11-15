/**
 * Input and picking through the real renderer: a pick names the layer the
 * GPU drew at the pixel and the surface point there (the ray matches the
 * picture), and input is latched once per frame.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	type LayoutNode,
	rayPlane,
} from "./index.js";

const scene = () => {
	const c = new Composition({
		width: 200,
		height: 200,
		fps: 30,
		durationFrames: 10,
	});
	c.add([
		Layer.camera({ x: 0, y: 0, z: -1000, targetX: 0, targetY: 0, targetZ: 0 }),
		Layer.ambientLight("#ffffff", 1),
		Layer3D.sphere({
			id: "left",
			label: "ball",
			x: -150,
			radius: 80,
		}) as LayoutNode,
		Layer3D.sphere({ id: "right", x: 150, radius: 80 }) as LayoutNode,
	]);
	return c;
};

describe("picking", () => {
	it("names the layer under a pixel and where its surface is", async () => {
		const c = scene();
		// Which side each sphere lands on is the renderer's business: find them.
		const left = await c.pick(68, 100);
		const right = await c.pick(132, 100);
		const hits = [left.hit, right.hit];
		expect(hits.map((h) => h?.layer).sort()).toEqual(["left", "right"]);
		for (const hit of hits) {
			if (!hit) throw new Error("no hit");
			const cx = hit.layer === "left" ? -150 : 150;
			// On that sphere's camera-facing side.
			expect(
				Math.hypot(hit.point[0] - cx, hit.point[1], hit.point[2]),
			).toBeCloseTo(80, -1);
			expect(hit.point[2]).toBeLessThan(0);
			expect(hit.normal?.[2]).toBeLessThan(-0.5);
		}
		expect(left.hit?.layer === "left" ? left.hit.label : right.hit?.label).toBe(
			"ball",
		);

		// Empty space: no hit, but a ray from the same camera.
		const miss = await c.pick(100, 10);
		expect(miss.hit).toBeNull();
		const ray = miss.ray(100, 100);
		expect(ray?.direction[2]).toBeCloseTo(1, 3);
		const onPlane = ray && rayPlane(ray, [0, 0, 0], [0, 0, -1]);
		expect(Math.abs(onPlane?.[0] ?? 99)).toBeLessThan(3); // through the pixel's center
		expect(Math.abs(onPlane?.[1] ?? 99)).toBeLessThan(3);
	});
});

describe("input", () => {
	it("latches once per frame", async () => {
		const c = scene();
		const seen: Array<[number, boolean, boolean, number]> = [];
		const { input } = c;
		c.onRequestFrame((ctx) => {
			seen.push([
				ctx.frame,
				input.down("Space"),
				input.pressed("Space"),
				input.axis("KeyA", "KeyD"),
			]);
		});
		const frame = (f: number) =>
			c.notifyFrame({
				frame: f,
				fps: 30,
				time: f / 30,
				duration: 1,
				durationMs: 1000,
				progress: 0,
				deltaTime: 1 / 30,
			});
		await frame(0);
		input.keyDown("Space");
		input.keyDown("KeyD");
		await frame(1);
		await frame(1); // a re-render keeps the frame's state
		input.keyUp("Space");
		await frame(2);
		expect(seen).toEqual([
			[0, false, false, 0],
			[1, true, true, 1],
			[1, true, true, 1],
			[2, false, false, 1],
		]);
		expect(input.released("Space")).toBe(true);

		const events: string[] = [];
		input.on("pointerdown", (e) =>
			events.push(`${e.type} ${e.x},${e.y} ${e.buttons}`),
		);
		input.pointerDown(20, 30);
		expect(events).toEqual(["pointerdown 20,30 1"]);
		const hit = await new Promise<string | undefined>((resolve) => {
			input.on("pointerup", async (e) => resolve((await e.pick()).hit?.layer));
			input.pointerUp(68, 100);
		});
		expect(["left", "right"]).toContain(hit);
	});
});
