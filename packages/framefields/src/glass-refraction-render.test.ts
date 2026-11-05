/**
 * Glass refracts the 3D scene behind it, not only the layers under the
 * 3D batch: a red box behind a glass sphere shows red through it.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const S = 300;
const C = S / 2;

async function centerColor(withBox: boolean) {
	const comp = new Composition({
		width: S,
		height: S,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({ x: C, y: C, z: -600, targetX: C, targetY: C, targetZ: 0 }),
		Layer.environment("night", { intensity: 0.2 }),
		...(withBox
			? [
					Layer3D.roundedBox({
						id: "box",
						x: C,
						y: C,
						z: 200,
						width: 260,
						height: 260,
						depth: 20,
						radius: 0,
						color: "#ff2010",
						material: "unlit",
					}),
				]
			: []),
		Layer3D.sphere({
			id: "lens",
			x: C,
			y: C,
			z: 0,
			radius: 60,
			material: "glass",
			color: "#ffffff",
			roughness: 0.02,
		}),
	]);
	const { pixels } = await decodePngPixels(
		await comp.renderFrame({ frame: 0 }),
	);
	const i = (C * S + C) * 4;
	return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
}

describe("glass", () => {
	it("refracts the 3D scene behind it", async () => {
		const [r, g, b] = await centerColor(true);
		expect(r).toBeGreaterThan(120);
		expect(r).toBeGreaterThan(g + 60);
		expect(r).toBeGreaterThan(b + 60);
		// Without the box, the same pixel shows the dark background.
		const [r0] = await centerColor(false);
		expect(r0).toBeLessThan(60);
	});
});
