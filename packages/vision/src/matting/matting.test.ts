import { describe, expect, it } from "vitest";
import {
	defaultMatteBand,
	distanceTransform,
	TRIMAP_BACKGROUND,
	TRIMAP_FOREGROUND,
	TRIMAP_UNKNOWN,
	trimapFromMask,
} from "./trimap.js";
import { composeMatte, matteWindow, vitmatteInput } from "./vitmatte.js";

function disc(
	width: number,
	height: number,
	cx: number,
	cy: number,
	r: number,
) {
	const mask = new Uint8Array(width * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * width + x] = 255;
	return mask;
}

describe("distanceTransform", () => {
	it("matches brute force, with the nearest seed", () => {
		const width = 23;
		const height = 17;
		const seeds = [
			[3, 4],
			[18, 2],
			[11, 14],
			[20, 15],
		] as const;
		const isSeed = (i: number) => seeds.some(([x, y]) => y * width + x === i);
		const { distance, nearest } = distanceTransform(width, height, isSeed);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const best = Math.min(
					...seeds.map(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2),
				);
				const i = y * width + x;
				expect(distance[i]).toBe(best);
				const n = nearest[i] as number;
				const nx = n % width;
				const ny = Math.floor(n / width);
				expect(isSeed(n)).toBe(true);
				expect((x - nx) ** 2 + (y - ny) ** 2).toBe(best);
			}
		}
	});

	it("reports no seed as −1", () => {
		const { nearest } = distanceTransform(4, 3, () => false);
		expect([...nearest].every((n) => n === -1)).toBe(true);
	});
});

describe("trimapFromMask", () => {
	it("puts a band of `band` px either side of the edge", () => {
		const width = 64;
		const height = 48;
		const r = 14;
		const band = 3;
		const trimap = trimapFromMask(
			disc(width, height, 32, 24, r),
			width,
			height,
			band,
		);
		const at = (x: number, y: number) => trimap.data[y * width + x];
		expect(at(32, 24)).toBe(TRIMAP_FOREGROUND);
		expect(at(2, 2)).toBe(TRIMAP_BACKGROUND);
		// Along the horizontal through the centre: the edge sits at x = 32 ± 14.
		expect(at(32 + r, 24)).toBe(TRIMAP_UNKNOWN);
		expect(at(32 + r + band, 24)).toBe(TRIMAP_UNKNOWN);
		expect(at(32 + r + band + 1, 24)).toBe(TRIMAP_BACKGROUND);
		expect(at(32 + r - band + 1, 24)).toBe(TRIMAP_UNKNOWN);
		expect(at(32 + r - band - 1, 24)).toBe(TRIMAP_FOREGROUND);
		expect(trimap.unknown).toEqual([
			32 - r - band,
			24 - r - band,
			32 + r + band + 1,
			24 + r + band + 1,
		]);
	});

	it("has no unknown band for an empty or a full mask", () => {
		expect(trimapFromMask(new Uint8Array(30), 6, 5, 2).unknown).toBeNull();
		const full = trimapFromMask(new Uint8Array(30).fill(255), 6, 5, 2);
		expect(full.unknown).toBeNull();
		expect([...full.data].every((v) => v === TRIMAP_FOREGROUND)).toBe(true);
	});

	it("points every pixel at the nearest mask pixel", () => {
		const width = 20;
		const height = 4;
		const mask = new Uint8Array(width * height);
		for (let y = 0; y < height; y++) {
			mask[y * width + 2] = 255;
			mask[y * width + 15] = 255;
		}
		const { nearest } = trimapFromMask(mask, width, height, 2);
		expect((nearest[1 * width + 6] as number) % width).toBe(2);
		expect((nearest[1 * width + 10] as number) % width).toBe(15);
	});

	it("scales the default band with the frame", () => {
		expect(defaultMatteBand(1920, 1080)).toBe(13);
		expect(defaultMatteBand(64, 64)).toBe(3);
		expect(defaultMatteBand(8000, 8000)).toBe(40);
	});
});

describe("ViTMatte input and output", () => {
	const width = 100;
	const height = 60;
	const trimap = trimapFromMask(
		disc(width, height, 50, 30, 16),
		width,
		height,
		4,
	);

	it("grows the window by the context and pads to multiples of 32", () => {
		const window = matteWindow(trimap, 10, 1024);
		expect(window).toMatchObject({
			x0: 20,
			y0: 0,
			x1: 81,
			y1: 60,
			scale: 1,
			contentWidth: 61,
			contentHeight: 60,
			inputWidth: 64,
			inputHeight: 64,
		});
	});

	it("scales a window larger than the resolution", () => {
		const window = matteWindow(trimap, 100, 50);
		expect(window?.scale).toBeCloseTo(0.5);
		expect(window?.contentWidth).toBe(50);
		expect(window?.contentHeight).toBe(30);
		expect(window?.inputWidth).toBe(64);
		expect(window?.inputHeight).toBe(32);
	});

	it("normalizes RGB to −1…1 and the trimap to 0…1, zero padded", () => {
		const data = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			data[i * 4] = 255;
			data[i * 4 + 1] = 0;
			data[i * 4 + 2] = 127.5;
			data[i * 4 + 3] = 255;
		}
		const window = matteWindow(trimap, 10, 1024);
		if (!window) throw new Error("no window");
		const tensor = vitmatteInput({ data, width, height }, trimap, window);
		const plane = window.inputWidth * window.inputHeight;
		expect(tensor).toHaveLength(4 * plane);
		expect(tensor[0]).toBeCloseTo(1);
		expect(tensor[plane]).toBeCloseTo(-1);
		expect(tensor[2 * plane]).toBeCloseTo(0, 1);
		// Window pixel (30, 30) is source (50, 30): the disc's centre.
		expect(tensor[3 * plane + 30 * window.inputWidth + 30]).toBe(1);
		expect(tensor[3 * plane]).toBe(0);
		// Padding column.
		expect(tensor[window.inputWidth - 1]).toBe(0);
		expect(tensor[3 * plane + window.inputWidth - 1]).toBe(0);
	});

	it("keeps the trimap's certain pixels and takes the model's alpha in the band", () => {
		const window = matteWindow(trimap, 10, 1024);
		if (!window) throw new Error("no window");
		const alphas = new Float32Array(
			window.inputWidth * window.inputHeight,
		).fill(0.4);
		const alpha = composeMatte(trimap, window, alphas);
		for (let i = 0; i < alpha.length; i++) {
			const t = trimap.data[i];
			if (t === TRIMAP_UNKNOWN) expect(alpha[i]).toBe(102);
			else expect(alpha[i]).toBe(t);
		}
	});
});
