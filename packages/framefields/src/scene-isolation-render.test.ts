import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	Transition,
} from "./index.js";

async function centre(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const [r, g, b] = ctx.getImageData(img.width / 2, img.height / 2, 1, 1).data;
	return { r, g, b };
}

/** A scene that films one glowing cube at `x` through its own camera. */
function scene(x: number, color: string) {
	return Layer.box({
		width: 200,
		height: 200,
		background: "#000000",
		children: [
			Layer.camera({
				x,
				y: 100,
				z: -400,
				targetX: x,
				targetY: 100,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.roundedBox({
				x,
				y: 100,
				z: 0,
				width: 160,
				height: 160,
				depth: 160,
				radius: 4,
				color,
				emissive: color,
				emissiveIntensity: 1,
			}),
		],
	});
}

describe("3D scenes in a sequence", () => {
	it("renders each scene through its own camera, and blends them in a transition", async () => {
		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationFrames: 50,
			backgroundColor: "#000000",
		});
		// The cubes stand far apart: one shared world filmed by either camera
		// would show only one of them.
		comp.add(
			Layer.sequence(
				[
					{ scene: scene(100, "#ff0000"), duration: 30 },
					{
						scene: scene(5000, "#0000ff"),
						duration: 30,
						transition: Transition.crossfade(10),
					},
				],
				{ width: 200, height: 200 },
			),
		);
		const renderer = new HeadlessMediaRenderer();
		const at = async (frame: number) =>
			centre(await comp.renderFrame({ frame, renderer }));
		const first = await at(10);
		const both = await at(25);
		const second = await at(40);
		expect(first.r).toBeGreaterThan(150);
		expect(first.b).toBeLessThan(60);
		expect(second.b).toBeGreaterThan(150);
		expect(second.r).toBeLessThan(60);
		// Mid-crossfade both cubes show, each through its own camera.
		expect(both.r).toBeGreaterThan(50);
		expect(both.b).toBeGreaterThan(50);
	});
});
