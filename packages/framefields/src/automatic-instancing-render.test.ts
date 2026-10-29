import { Renderer3D } from "@framefields/webgpu-renderers";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it, vi } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";

describe("automatic repeated mesh instancing", () => {
	it("renders repeated opaque meshes with one instanced draw and separates different materials", async () => {
		const calls = vi.spyOn(Renderer3D.prototype, "drawMesh3D");
		try {
			const comp = new Composition({
				width: 600,
				height: 300,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#000000",
			});
			comp.add(
				Layer.camera({
					x: 300,
					y: 150,
					z: -600,
					targetX: 300,
					targetY: 150,
					targetZ: 0,
				}),
			);
			for (const x of [150, 300, 450])
				comp.add(
					Layer3D.roundedBox({
						width: 70,
						height: 70,
						depth: 70,
						radius: 0,
						x,
						y: 150,
						color: "#ff0000",
						material: "unlit",
					}),
				);
			comp.add(
				Layer3D.roundedBox({
					width: 70,
					height: 70,
					depth: 70,
					radius: 0,
					x: 300,
					y: 245,
					color: "#0000ff",
					material: "unlit",
				}),
			);
			const png = await comp.renderFrame({ frame: 0 });
			const image = await loadImage(png);
			const canvas = new Canvas(image.width, image.height);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0);
			const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
			const redAt = (x: number, y: number) =>
				pixels[(y * image.width + x) * 4] ?? 0;
			for (const x of [220, 300, 380])
				expect(redAt(x, 150)).toBeGreaterThan(100);
			expect(
				calls.mock.calls.some(
					(call) => call[5]?.matrixInstances && call[5]?.instanceCount === 3,
				),
			).toBe(true);
			expect(calls.mock.calls.some((call) => !call[5]?.matrixInstances)).toBe(
				true,
			);
		} finally {
			calls.mockRestore();
		}
	});
	it("matches separate draws for rotated, non-uniformly scaled lit meshes", async () => {
		const calls = vi.spyOn(Renderer3D.prototype, "drawMesh3D");
		try {
			const render = async (separate: boolean) => {
				const comp = new Composition({
					width: 600,
					height: 300,
					fps: 30,
					durationMs: 1000,
					backgroundColor: "#000000",
				});
				comp.add(
					Layer.camera({
						x: 300,
						y: 150,
						z: -600,
						targetX: 300,
						targetY: 150,
						targetZ: 0,
					}),
				);
				comp.add(Layer.ambientLight("#ffffff", 0.25));
				comp.add(
					Layer.directionalLight({
						x: 0,
						y: -200,
						z: -400,
						targetX: 300,
						targetY: 150,
						targetZ: 0,
						color: "#ffffff",
						intensity: 1,
					}),
				);
				for (const [i, x] of [150, 300, 450].entries())
					comp.add(
						Layer3D.roundedBox({
							width: 70,
							height: 70,
							depth: 70,
							radius: 0,
							x,
							y: 150,
							rotateY: i * 18,
							rotateZ: i * 11,
							scaleX: 0.6 + i * 0.3,
							scaleY: 1.2,
							color: "#cc9966",
							material: "lit",
							specularIntensity: 0,
							shininess: separate ? 20 + i : 20,
						}),
					);
				const img = await loadImage(await comp.renderFrame({ frame: 0 }));
				const canvas = new Canvas(img.width, img.height);
				const ctx = canvas.getContext("2d");
				ctx.drawImage(img, 0, 0);
				return ctx.getImageData(0, 0, img.width, img.height).data;
			};
			const batched = await render(false);
			expect(
				calls.mock.calls.some(
					(call) => call[5]?.matrixInstances && call[5]?.instanceCount === 3,
				),
			).toBe(true);
			calls.mockClear();
			const separate = await render(true);
			expect(calls.mock.calls.some((call) => call[5]?.matrixInstances)).toBe(
				false,
			);
			let difference = 0;
			for (let i = 0; i < batched.length; i++)
				difference += Math.abs((batched[i] ?? 0) - (separate[i] ?? 0));
			expect(difference / batched.length).toBeLessThan(0.1);
		} finally {
			calls.mockRestore();
		}
	});
});
