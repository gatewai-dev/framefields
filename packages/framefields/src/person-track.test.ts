import { describe, expect, it } from "vitest";
import { PersonTrack, type PersonTrackJSON } from "./index.js";

/** Two frames of a 160×80 clip: a wrist moving right, a 40×40 square silhouette moving right. */
function synthetic(): PersonTrack {
	const frames = 2;
	const keypoints = new Array(frames * 17 * 3).fill(0);
	const set = (f: number, k: number, x: number, y: number) =>
		keypoints.splice((f * 17 + k) * 3, 3, x, y, 1);
	set(0, 9, 20, 10); // leftWrist
	set(1, 9, 60, 30);
	const cell = 4;
	const w = 40;
	const h = 20;
	const mask = new Uint8Array(frames * w * h);
	for (let f = 0; f < frames; f++) {
		for (let y = 5; y < 15; y++)
			for (let x = 5 + f * 10; x < 15 + f * 10; x++)
				mask[f * w * h + y * w + x] = 255;
	}
	const json: PersonTrackJSON = {
		version: 1,
		fps: 24,
		frames,
		sourceWidth: 160,
		sourceHeight: 80,
		keypoints,
		mask: {
			cell,
			width: w,
			height: h,
			data: Buffer.from(mask).toString("base64"),
		},
	};
	return PersonTrack.fromJSON(JSON.parse(JSON.stringify(json)));
}

describe("PersonTrack", () => {
	it("interpolates keypoints and maps them into a layer box", () => {
		const t = synthetic();
		expect(t.point("leftWrist", 0.5)).toMatchObject({
			x: 40,
			y: 20,
			visibility: 1,
		});
		// 160×80 covering 320×320 at (100, 0): scale 4, centered → x offset 100 − 160.
		const placed = t.place({
			x: 100,
			y: 0,
			width: 320,
			height: 320,
			fit: "cover",
		});
		expect(placed.point("leftWrist", 0)).toMatchObject({
			x: 100 - 160 + 80,
			y: 40,
		});
		const sig = placed.signals("leftWrist");
		expect(sig.x.get({ frame: 1, fps: 24 } as never)).toBeCloseTo(
			100 - 160 + 240,
		);
	});

	it("samples the silhouette with a gradient pointing inward", () => {
		const t = synthetic();
		// Frame 0 square spans source px 20–60 × 20–60.
		expect(t.sample(0, 40, 40).alpha).toBeGreaterThan(0.9);
		expect(t.sample(0, 120, 40).alpha).toBe(0);
		const edge = t.sample(0, 62, 40);
		expect(edge.alpha).toBeGreaterThan(0);
		expect(edge.gx).toBeLessThan(0); // inside is to the left
		expect(t.sample(1, 40, 40).alpha).toBeLessThan(t.sample(1, 80, 40).alpha);
	});

	it("round-trips through JSON", () => {
		const t = synthetic();
		const again = PersonTrack.fromJSON(t.toJSON());
		expect(again.point("leftWrist", 1)).toEqual(t.point("leftWrist", 1));
		expect(again.sample(0, 40, 40)).toEqual(t.sample(0, 40, 40));
	});
});
