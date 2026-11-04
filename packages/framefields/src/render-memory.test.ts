import { describe, expect, it } from "vitest";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	LayerAnimation,
} from "./index.js";

type Proto = Record<string, (...args: unknown[]) => unknown>;

describe("render memory", () => {
	it("recycles 3D buffers from frame to frame instead of allocating new ones", async () => {
		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#000000",
		});
		comp.add([
			Layer.camera({ x: 100, y: 100, z: -400, targetX: 100, targetY: 100 }),
			Layer.ambientLight("#ffffff", 1),
			...[0, 1, 2, 3].map((i) =>
				Layer3D.roundedBox({
					x: 40 + i * 40,
					y: 100,
					z: 0,
					width: 30,
					height: 30,
					depth: 30,
					color: "#ff8800",
				}).animate(
					LayerAnimation.create().keys("rotateY", [
						[0, 0],
						[60, 360],
					]),
				),
			),
		]);
		const renderer = new HeadlessMediaRenderer();
		for (let f = 0; f < 4; f++) await comp.renderFrame({ frame: f, renderer });
		const proto = (globalThis as unknown as { GPUDevice: { prototype: Proto } })
			.GPUDevice.prototype;
		const createBuffer = proto.createBuffer;
		let created = 0;
		proto.createBuffer = function (...args: unknown[]) {
			created++;
			return createBuffer.apply(this, args);
		};
		try {
			for (let f = 4; f < 34; f++)
				await comp.renderFrame({ frame: f, renderer });
		} finally {
			proto.createBuffer = createBuffer;
		}
		// Thirty more frames of the same scene reuse the pools: next to nothing new.
		expect(created).toBeLessThan(30);
	});
});
