import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, hoistMattes, Layer, Layer3D } from "./index.js";

const W = 400;
const H = 200;
/** The default camera's distance at its 50° field of view: z = 0 maps 1:1 to pixels. */
const D = H / 2 / Math.tan((50 * Math.PI) / 360);

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return (x: number, y: number) => {
		const i = (Math.round(y) * img.width + Math.round(x)) * 4;
		return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
	};
}

const box = { position: "absolute", x: 0, y: 0, width: W, height: H } as const;

const square = (background: string) =>
	Layer.box({
		position: "absolute",
		x: 140,
		y: 40,
		width: 120,
		height: 120,
		background,
	});

/** A red plate with a green square, lifted 80 px there, and a blue card 40 px in front of it. */
function scene(relief: boolean, eyeX = W / 2) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationMs: 100,
		backgroundColor: "#000000",
	});
	const plate = Layer.box({
		...box,
		id: "plate",
		background: "#ff0000",
		is3D: true,
		material: "unlit",
		children: [square("#00ff00")],
	});
	c.add([
		Layer.camera({
			id: "lens",
			mode: "lookAt",
			x: eyeX,
			y: H / 2,
			z: -D,
			targetX: W / 2,
			targetY: H / 2,
			targetZ: 0,
		}),
		relief
			? plate.withRelief(
					Layer.box({
						...box,
						id: "height",
						background: "#000000",
						children: [square("#ffffff")],
					}),
					{ amount: 80 },
				)
			: plate,
		Layer3D.plane({
			id: "card",
			x: W / 2 - 15,
			y: H / 2 - 15,
			z: -40,
			width: 30,
			height: 30,
			background: "#0000ff",
			material: "unlit",
		}),
	]);
	return c;
}

describe("relief", () => {
	it("hoists a relief into a flat sibling sized like its owner", () => {
		const [owner, relief] = hoistMattes([
			{
				id: "plate",
				kind: "box",
				x: 0,
				y: 0,
				width: W,
				height: H,
				is3D: true,
				relief: { node: { id: "d", kind: "box", is3D: true }, amount: 50 },
			} as never,
		]) as Array<Record<string, unknown>>;
		expect(owner).toMatchObject({ reliefId: "d", reliefAmount: 50 });
		expect(owner.relief).toBeUndefined();
		expect(relief).toMatchObject({
			id: "d",
			reliefOf: "plate",
			is3D: false,
			x: 0,
			y: 0,
			width: W,
			height: H,
		});
	});

	describe.skipIf(process.env.FRAMEFIELDS_SKIP_GPU === "1")("render", () => {
		it("looks like the flat layer from the default camera", async () => {
			const flat = await decode(await scene(false).renderFrame({ frame: 0 }));
			const lifted = await decode(await scene(true).renderFrame({ frame: 0 }));
			for (const [x, y] of [
				[20, 20],
				[150, 50],
				[250, 150],
				[380, 180],
			] as const) {
				expect(lifted(x, y)).toEqual(flat(x, y));
			}
		});

		it("rises in front of what sits between it and the camera", async () => {
			const flat = await decode(await scene(false).renderFrame({ frame: 0 }));
			const lifted = await decode(await scene(true).renderFrame({ frame: 0 }));
			// Flat, the card 40 px in front shows; lifted 80 px, the plate's square covers it.
			expect(flat(W / 2, H / 2)).toMatchObject({ g: 0, b: 255 });
			expect(lifted(W / 2, H / 2)).toMatchObject({ g: 255, b: 0 });
		});

		it("shows its height to a camera off the original lens", async () => {
			const side = await decode(
				await scene(true, W / 2 + 300).renderFrame({ frame: 0 }),
			);
			const sideFlat = await decode(
				await scene(false, W / 2 + 300).renderFrame({ frame: 0 }),
			);
			// Seen from the side, the raised square stands off the plate, so its
			// edge lands elsewhere than the flat square's.
			const leftEdge = (at: (x: number, y: number) => { g: number }) => {
				for (let x = 0; x < W; x++) if (at(x, 60).g > 128) return x;
				return W;
			};
			expect(Math.abs(leftEdge(sideFlat) - leftEdge(side))).toBeGreaterThan(8);
		});
	});
});
