import { Renderer3D } from "@framefields/webgpu-renderers";
import { describe, expect, it, vi } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

describe("multiple shadow lights", () => {
	it("renders the shadow maps for both directional lights", async () => {
		const spy = vi.spyOn(Renderer3D.prototype, "renderShadowMap");
		const draws = vi.spyOn(Renderer3D.prototype, "drawMesh3D");
		try {
			const render = async (left: boolean, right: boolean) => {
				const c = new Composition({
					width: 600,
					height: 500,
					fps: 30,
					durationMs: 1000,
					backgroundColor: "#101010",
				});
				c.add(
					Layer.camera({
						x: 300,
						y: -300,
						z: -750,
						targetX: 300,
						targetY: 250,
						targetZ: 0,
					}),
				);
				c.add(Layer.ambientLight("#ffffff", 0.12));
				c.add(
					Layer.directionalLight({
						x: -400,
						y: -500,
						z: -300,
						targetX: 300,
						targetY: 300,
						targetZ: 0,
						color: "#ffffff",
						intensity: 0.55,
						castShadow: left,
					}),
				);
				c.add(
					Layer.directionalLight({
						x: 1000,
						y: -500,
						z: -300,
						targetX: 300,
						targetY: 300,
						targetZ: 0,
						color: "#ffffff",
						intensity: 0.55,
						castShadow: right,
					}),
				);
				c.add(
					Layer3D.roundedBox({
						x: 300,
						y: 330,
						z: 0,
						width: 500,
						height: 20,
						depth: 500,
						radius: 0,
						color: "#cccccc",
						material: "lit",
					}),
				);
				c.add(
					Layer3D.sphere({
						x: 300,
						y: 240,
						z: 0,
						radius: 60,
						color: "#ffffff",
						material: "lit",
					}),
				);
				c.add(
					Layer3D.sphere({
						x: 420,
						y: 240,
						z: 0,
						radius: 60,
						color: "#ffffff",
						material: "lit",
					}),
				);
				return (await decodePngPixels(await c.renderFrame({ frame: 0 })))
					.pixels;
			};
			const none = await render(false, false);
			const left = await render(true, false);
			const right = await render(false, true);
			spy.mockClear();
			const both = await render(true, true);
			expect(
				draws.mock.calls.some(
					(call) => call[5]?.matrixInstances && call[5]?.instanceCount === 2,
				),
			).toBe(true);
			expect(new Set(spy.mock.calls.map((call) => call[2])).size).toBe(2);
			const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
				a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0);
			expect(diff(none, left)).toBeGreaterThan(1000);
			expect(diff(none, right)).toBeGreaterThan(1000);
			expect(diff(left, both)).toBeGreaterThan(1000);
			expect(diff(right, both)).toBeGreaterThan(1000);
		} finally {
			spy.mockRestore();
			draws.mockRestore();
		}
	});
});
