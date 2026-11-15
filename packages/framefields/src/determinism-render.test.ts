/**
 * Reproducibility: a lit, shadowed 3D physics scene built twice from the
 * same description renders bit-identical frames, in the same renderer and in
 * a fresh one. Training environments and split renders depend on it.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";
import { Physics } from "./physics/index.js";
import { HeadlessMediaRenderer } from "./render.js";

const FPS = 30;
const FRAMES = [0, 24, 47];

async function scene(): Promise<Composition> {
	const c = new Composition({
		width: 320,
		height: 240,
		fps: FPS,
		durationFrames: 48,
		backgroundColor: "#101018",
	});
	c.add([
		Layer.camera({
			x: 160,
			y: 60,
			z: -520,
			targetX: 160,
			targetY: 140,
			targetZ: 0,
		}),
		Layer.ambientLight("#ffffff", 0.2),
		Layer.directionalLight({
			x: -300,
			y: -400,
			z: -300,
			targetX: 160,
			targetY: 200,
			targetZ: 0,
			color: "#ffffff",
			intensity: 0.9,
			castShadow: true,
		}),
	]);
	const bodies = [
		Layer3D.sphere({
			id: "a",
			radius: 24,
			x: 120,
			y: -40,
			z: 0,
			color: "#e04040",
		}),
		Layer3D.sphere({
			id: "b",
			radius: 18,
			x: 150,
			y: -120,
			z: 20,
			color: "#40a0e0",
		}),
		Layer3D.shard({
			id: "c",
			radius: 26,
			facets: 10,
			seed: 7,
			x: 200,
			y: -80,
			z: -10,
			color: "#60d060",
		}),
	];
	c.add(bodies);
	const world = await Physics.world3d({ fps: FPS, frames: 48 });
	world.ground({ y: 220 });
	for (const body of bodies) world.body(body, { restitution: 0.4 });
	await world.simulate();
	return c;
}

async function hashes(
	c: Composition,
	renderer?: HeadlessMediaRenderer,
): Promise<string[]> {
	const out: string[] = [];
	for (const frame of FRAMES) {
		const rgba = await c.renderFrame({ frame, format: "rgba", renderer });
		out.push(createHash("sha256").update(rgba).digest("hex"));
	}
	return out;
}

describe("determinism", () => {
	it("renders the same scene bit-identically across builds and renderers", async () => {
		const first = await hashes(await scene());
		const rebuilt = await hashes(await scene());
		const fresh = await hashes(await scene(), new HeadlessMediaRenderer());
		expect(new Set(first).size).toBe(FRAMES.length);
		expect(rebuilt).toEqual(first);
		expect(fresh).toEqual(first);
	});
});
