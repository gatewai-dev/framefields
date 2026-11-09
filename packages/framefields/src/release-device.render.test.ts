/**
 * `releaseDevice` destroys the GPU device between jobs (the on-device
 * export's `recycleDevice`): the next render runs on a new device and must
 * draw the same pixels, so no cache may keep objects of the destroyed one.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDevice, releaseDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import {
	Blur,
	Composition,
	FontManager,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	LayerAnimation,
} from "./index.js";

// Fonts are kept on disk, not in git (see font-manager.test.ts).
const INTER = path.resolve(
	import.meta.dirname,
	"../../..",
	"assets/fonts/Inter.ttf",
);
const hasInter = fs.existsSync(INTER);

async function film(): Promise<Composition> {
	await FontManager.register(INTER);
	const comp = new Composition({
		width: 160,
		height: 90,
		fps: 30,
		durationFrames: 30,
		backgroundColor: "#0b0d12",
	});
	comp.add([
		Layer.camera({ x: 80, y: 45, z: -300, targetX: 80, targetY: 45 }),
		Layer.ambientLight("#ffffff", 0.6),
		Layer.directionalLight("#ffffff", 1.2, { x: -1, y: -1, z: 1 }),
		Layer3D.roundedBox({
			x: 110,
			y: 45,
			z: 0,
			width: 30,
			height: 30,
			depth: 30,
			color: "#ff8800",
		}).animate(
			LayerAnimation.create().keys("rotateY", [
				[0, 0],
				[30, 180],
			]),
		),
		Layer.shape("rect", {
			x: 10,
			y: 10,
			width: 50,
			height: 30,
			fillColor: "#3060ff",
		}).withEffect(new Blur({ radius: 4 })),
		Layer.text("Seam", { x: 10, y: 50, fontSize: 22, color: "#ffffff" }),
	]);
	return comp;
}

describe("releaseDevice", () => {
	it.skipIf(!hasInter)(
		"renders the same frames on the device that replaces it",
		async () => {
			const frames = [0, 12, 29];
			const render = async () => {
				const comp = await film();
				const renderer = new HeadlessMediaRenderer();
				const out: Buffer[] = [];
				for (const frame of frames)
					out.push(Buffer.from(await comp.renderFrame({ frame, renderer })));
				return out;
			};
			const before = await render();
			const old = await ensureDevice();
			releaseDevice(old);
			const after = await render();
			expect(await ensureDevice()).not.toBe(old);
			for (let i = 0; i < frames.length; i++)
				expect(Buffer.compare(after[i], before[i]), `frame ${frames[i]}`).toBe(
					0,
				);
		},
		120_000,
	);
});
