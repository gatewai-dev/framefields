/**
 * Program documents: a 3D scene saved with `toProgram()` is plain JSON, and
 * `Composition.fromProgram` loads it back to render the same bytes; a
 * document with mistakes is refused with every issue named.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Lighting,
	Physics,
} from "./index.js";

function scene(): Composition {
	const c = new Composition({
		width: 160,
		height: 120,
		fps: 24,
		durationFrames: 10,
		backgroundColor: "#101418",
	});
	c.add([
		Layer.camera({
			x: 0,
			y: -150,
			z: -700,
			targetX: 0,
			targetY: 0,
			targetZ: 0,
			fov: 45,
		}),
		...(Lighting.studio({ target: [0, 0, 0] }) as unknown as LayoutNode[]),
		Layer3D.sphere({
			id: "ball",
			label: "sphere",
			radius: 40,
			color: "#e6194b",
			roughness: 0.3,
		}).animate(
			LayerAnimation.create().keys("x", [
				[0, -80],
				[9, 80],
			]),
		),
		Layer3D.torus({
			id: "ring",
			label: "torus",
			radius: 50,
			tube: 15,
			material: "metallic",
			metallic: 1,
			y: 60,
			rotateX: 90,
		}),
	]);
	return c;
}

describe("program documents", () => {
	it("round-trips a 3D scene through JSON to the same frames", async () => {
		const original = scene();
		const json = JSON.stringify(original.toProgram());
		// The recipe, not the triangles.
		expect(json).not.toContain("modelData");
		expect(json.length).toBeLessThan(20000);
		const loaded = Composition.fromProgram(JSON.parse(json), {
			durationFrames: 10,
		});
		for (const frame of [0, 9]) {
			const a = await original.renderFrame({ frame, format: "rgba" });
			const b = await loaded.renderFrame({ frame, format: "rgba" });
			expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
		}
	});

	it("names every issue in a document", () => {
		expect(() =>
			Composition.fromProgram({
				width: 100,
				height: 100,
				layout: [
					{ id: "a", kind: "lottie" },
					{ id: "a", kind: "box" },
				],
			}),
		).toThrow(/E1201 layout\.0\.kind[\s\S]*E1202 layout\.1\.id/);
		expect(() =>
			Composition.fromProgram({ width: 0, height: 100, layout: [] }),
		).toThrow("width");
	});

	it("refuses to save what only code can rebuild", async () => {
		const track = Physics.poses({
			fps: 24,
			bodies: {
				a: {
					position: [
						[0, 0, 0],
						[1, 0, 0],
					],
				},
			},
		});
		const c = new Composition({ width: 10, height: 10, fps: 24 });
		c.add(track.follow("a", Layer3D.sphere({ id: "s", radius: 5 })));
		expect(() => c.toProgram()).toThrow(
			/toProgram: layout\[0\]\.animation\.tracks\[0\]\.source is bound to a signal object/,
		);
	});
});
