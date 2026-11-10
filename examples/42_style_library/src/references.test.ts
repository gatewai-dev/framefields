import { styleLibrary } from "framefields/styles";
import { describe, expect, it } from "vitest";
import { CROP_IDS, crop } from "./frame.js";
import { REFERENCES } from "./looks/index.js";

describe("style references", () => {
	it("has exactly one reference per look in the library", () => {
		expect(REFERENCES.map((r) => r.look).sort()).toEqual(
			styleLibrary.looks.map((l) => l.id).sort(),
		);
	});

	it("puts every hero frame inside its clip, and describes it", () => {
		for (const r of REFERENCES) {
			expect(r.alt.length).toBeGreaterThan(20);
			expect(r.hero).toBeGreaterThanOrEqual(0);
			expect(r.hero).toBeLessThan(r.frames);
		}
	});

	it("takes each crop's size and safe area from its format", () => {
		for (const id of CROP_IDS) {
			const c = crop(id);
			expect(c.safe.x + c.safe.width).toBeLessThanOrEqual(c.width);
			expect(c.safe.y + c.safe.height).toBeLessThanOrEqual(c.height);
		}
		expect(crop("9:16").safe).toEqual({
			x: 60,
			y: 250,
			width: 900,
			height: 1270,
		});
	});
});
