import { GltfLoader } from "@framefields/webgpu-renderers";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";

/** Two overlapping glTF meshes. The front red and back blue each have 50% alpha. */
function model(order: ("front" | "back")[]) {
	const positions = new Float32Array([
		-150, -150, 0, 150, -150, 0, 150, 150, 0, -150, 150, 0,
	]);
	const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
	const bin = Buffer.concat([
		Buffer.from(positions.buffer),
		Buffer.from(indices.buffer),
	]);
	return GltfLoader.parse(
		JSON.stringify({
			asset: { version: "2.0" },
			buffers: [
				{
					byteLength: bin.length,
					uri: `data:application/octet-stream;base64,${bin.toString("base64")}`,
				},
			],
			bufferViews: [
				{ buffer: 0, byteOffset: 0, byteLength: 48 },
				{ buffer: 0, byteOffset: 48, byteLength: 12 },
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
				{ bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
			],
			materials: [
				{
					name: "red",
					alphaMode: "BLEND",
					doubleSided: true,
					pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.5] },
					extensions: { KHR_materials_unlit: {} },
				},
				{
					name: "blue",
					alphaMode: "BLEND",
					doubleSided: true,
					pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 0.5] },
					extensions: { KHR_materials_unlit: {} },
				},
			],
			meshes: [0, 1].map((material) => ({
				primitives: [{ attributes: { POSITION: 0 }, indices: 1, material }],
			})),
			nodes: order.map((name) =>
				name === "front"
					? { mesh: 0, translation: [0, 0, 0] }
					: { mesh: 1, translation: [0, 0, 100] },
			),
			scenes: [{ nodes: order.map((_, i) => i) }],
			scene: 0,
		}),
	);
}

async function center(
	order: ("front" | "back")[],
	separate = false,
	reverseCamera = false,
) {
	const comp = new Composition({
		width: 400,
		height: 400,
		fps: 30,
		durationMs: 1000,
		backgroundColor: "#000000",
	});
	comp.add(
		Layer.camera({
			x: 200,
			y: 200,
			z: reverseCamera ? 500 : -500,
			targetX: 200,
			targetY: 200,
			targetZ: 0,
		}),
	);
	if (separate) {
		for (const name of order)
			comp.add(
				Layer.model({ id: name, x: 200, y: 200, modelData: model([name]) }),
			);
	} else
		comp.add(
			Layer.model({ id: "model", x: 200, y: 200, modelData: model(order) }),
		);
	const png = await comp.renderFrame({ frame: 0 });
	const canvas = new Canvas(400, 400);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(await loadImage(png), 0, 0);
	return Array.from(ctx.getImageData(200, 200, 1, 1).data);
}

describe("3D transparent meshes", () => {
	it("sorts by camera direction when viewed from behind", async () => {
		const frontFirst = await center(["front", "back"], true, true);
		const backFirst = await center(["back", "front"], true, true);
		for (let i = 0; i < 4; i++)
			expect(frontFirst[i]).toBeCloseTo(backFirst[i], 0);
		expect(frontFirst[2]).toBeGreaterThan(115);
		expect(frontFirst[2]).toBeLessThan(140);
		expect(frontFirst[0]).toBeGreaterThan(55);
		expect(frontFirst[0]).toBeLessThan(75);
	});

	it("keeps opaque meshes in the depth buffer before blending", async () => {
		const render = async (blueZ: number) => {
			const comp = new Composition({
				width: 400,
				height: 400,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#000000",
			});
			comp.add(
				Layer.camera({
					x: 200,
					y: 200,
					z: -500,
					targetX: 200,
					targetY: 200,
					targetZ: 0,
				}),
			);
			const blue = model(["back"]);
			if (!blue.materials.blue) throw new Error("Missing blue material");
			blue.materials.blue.alphaMode = "opaque";
			blue.materials.blue.diffuseColor = [0, 0, 1, 1];
			comp.add(
				Layer.model({ id: "red", x: 200, y: 200, modelData: model(["front"]) }),
			);
			comp.add(
				Layer.model({ id: "blue", x: 200, y: 200, z: blueZ, modelData: blue }),
			);
			const canvas = new Canvas(400, 400);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(
				await loadImage(await comp.renderFrame({ frame: 0 })),
				0,
				0,
			);
			return Array.from(ctx.getImageData(200, 200, 1, 1).data);
		};
		const behind = await render(0);
		const inFront = await render(-200);
		expect(behind[0]).toBeGreaterThan(115);
		expect(behind[2]).toBeGreaterThan(115);
		expect(inFront[0]).toBeLessThan(5);
		expect(inFront[2]).toBeGreaterThan(245);
	});
	for (const separate of [false, true]) {
		it(`blends glTF meshes back to front regardless of authoring order (${separate ? "separate models" : "one model"})`, async () => {
			const frontFirst = await center(["front", "back"], separate);
			const backFirst = await center(["back", "front"], separate);
			for (let i = 0; i < 4; i++)
				expect(frontFirst[i]).toBeCloseTo(backFirst[i], 0);
			expect(frontFirst[0]).toBeGreaterThan(115);
			expect(frontFirst[0]).toBeLessThan(140);
			expect(frontFirst[2]).toBeGreaterThan(55);
			expect(frontFirst[2]).toBeLessThan(75);
		});
	}
});
