/**
 * Steel through the real renderer: boxes dropped on the ground come to rest
 * stacked, a hinge driven by a joint target swings to it, an MJCF model
 * loads in Node, and the layers follow the bodies frame by frame.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	type LayoutNode,
	Physics,
	truthLabels,
} from "./index.js";

const HALF = 0.05;

describe("Physics.steel", () => {
	it("stacks falling boxes and swings a driven hinge", async () => {
		const world = await Physics.steel({
			fps: 30,
			frames: 60,
			pixelsPerMeter: 1000,
			build(scene) {
				scene.addGroundPlane({ color: [0.2, 0.2, 0.22] });
				for (let i = 0; i < 3; i++) {
					const box = scene.addBody({
						xform: [0, 0, 0.1 + i * 0.15, 0, 0, 0, 1],
						label: `box${i}`,
					});
					scene.addShapeBox(box, {
						hx: HALF,
						hy: HALF,
						hz: HALF,
						color: [0.9, 0.3, 0.2],
					});
				}
				const arm = scene.addBody({
					xform: [0.4, 0, 0.3, 0, 0, 0, 1],
					label: "arm",
				});
				scene.addShapeCapsule(arm, {
					radius: 0.02,
					halfHeight: 0.1,
					xform: [0, 0, -0.1, 0, 0, 0, 1],
				});
				scene.addJointRevolute(-1, arm, {
					axis: [0, 1, 0],
					parentXform: [0.4, 0, 0.3, 0, 0, 0, 1],
					targetKe: 400,
					targetKd: 20,
					label: "hinge",
				});
			},
			control(frame, state) {
				if (frame === 0) state.setJointTarget("hinge", 1);
			},
		});
		expect(world.bodyNames).toEqual(
			expect.arrayContaining(["box0", "box1", "box2", "arm"]),
		);
		await world.simulate();
		const z = (name: string) => world.body(name, 59).position[2];
		expect(z("box0")).toBeCloseTo(HALF, 2);
		expect(z("box1")).toBeCloseTo(3 * HALF, 2);
		expect(z("box2")).toBeCloseTo(5 * HALF, 2);
		expect(world.joint("hinge", 59)[0]).toBeCloseTo(1, 1);

		const layers = world.layers();
		expect(layers).toHaveLength(5);
		const c = new Composition({
			width: 160,
			height: 120,
			fps: 30,
			durationFrames: 60,
		});
		c.add([
			Layer.camera({ x: 200, y: -200, z: -900, targetX: 200, targetY: -150 }),
			Layer.ambientLight("#ffffff", 1),
			...(layers as LayoutNode[]),
		]);
		const boxTop = async (frame: number) => {
			const truth = await c.renderTruth({ frame });
			const top = truthLabels(truth.scenes[0]).objects.find(
				(o) => o.layer === "steel:shape:3",
			);
			expect(top?.pixels).toBeGreaterThan(20);
			return top?.box2d ?? [0, 0, 0, 0];
		};
		// The top box falls: lower in the image at the end than at the start.
		expect((await boxTop(59))[1]).toBeGreaterThan((await boxTop(0))[1] + 5);
	});

	it("loads MJCF in Node", async () => {
		const world = await Physics.steel({
			fps: 30,
			frames: 2,
			async build(scene, load) {
				await load.mjcf(
					scene,
					`<mujoco><worldbody>
					  <body name="link" pos="0 0 0.3">
					    <joint name="swing" type="hinge" axis="0 1 0"/>
					    <geom type="capsule" fromto="0 0 0 0.3 0 0" size="0.03"/>
					  </body>
					</worldbody></mujoco>`,
				);
			},
		});
		expect(world.bodyNames).toContain("link");
		expect(world.jointNames).toContain("swing");
		world.dispose();
	});

	it("lets the pointer drag a body", async () => {
		const c = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationFrames: 90,
		});
		const world = await Physics.steel({
			fps: 30,
			frames: 90,
			pixelsPerMeter: 1000,
			build(scene) {
				scene.addGroundPlane();
				const box = scene.addBody({
					xform: [0, 0, HALF, 0, 0, 0, 1],
					label: "box",
				});
				scene.addShapeBox(box, { hx: HALF, hy: HALF, hz: HALF });
			},
		});
		world.live(c);
		// Looking straight at the box: its middle is the frame's.
		c.add([
			Layer.camera({
				x: 0,
				y: -50,
				z: -1000,
				targetX: 0,
				targetY: -50,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			...(world.layers() as LayoutNode[]),
		]);
		const step = (f: number) =>
			c.notifyFrame({
				frame: f,
				fps: 30,
				time: f / 30,
				duration: 3,
				durationMs: 3000,
				progress: 0,
				deltaTime: 1 / 30,
			});
		await step(0);
		const { input } = c;
		const grabbed = new Promise<string | null>((resolve) =>
			world.draggable(input, { onGrab: resolve }),
		);
		input.pointerDown(100, 100);
		expect(await grabbed).toBe("box");
		// Up the screen by 60 px: 6 cm up at the box's distance (fov 50: ~0.93 px/mm).
		input.pointerMove(100, 40);
		for (let f = 1; f < 45; f++) await step(f);
		const lifted = world.body("box", 44).position[2];
		expect(lifted).toBeGreaterThan(HALF + 0.04);
		input.pointerUp(100, 40);
		expect(world.grabbed).toBeNull();
		for (let f = 45; f < 90; f++) await step(f);
		expect(world.body("box", 89).position[2]).toBeCloseTo(HALF, 2);
	});
});
