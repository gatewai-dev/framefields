import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureDevice } from "../device.js";
import {
	type DecodedHdrImage,
	encodeHdr,
	equirectDirection,
} from "../loaders/hdr-loader.js";
import {
	cubeFaceSize,
	getOrCreateHdrEnvironment,
	MAX_HDR_CACHE_ENTRIES,
} from "./hdr-environment.js";

let device: GPUDevice;
beforeAll(async () => {
	device = await ensureDevice();
	device.addEventListener("uncapturederror", (e) => {
		throw new Error(`WebGPU: ${(e as GPUUncapturedErrorEvent).error.message}`);
	});
});

function panorama(
	width: number,
	height: number,
	radiance: (d: [number, number, number]) => [number, number, number],
): DecodedHdrImage {
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const d = equirectDirection((x + 0.5) / width, (y + 0.5) / height);
			data.set([...radiance(d), 1], (y * width + x) * 4);
		}
	}
	return { width, height, data };
}

function halfToFloat(h: number): number {
	const s = h & 0x8000 ? -1 : 1;
	const e = (h >> 10) & 0x1f;
	const m = h & 0x3ff;
	if (e === 0) return s * m * 2 ** -24;
	if (e === 31) return m ? Number.NaN : s * Number.POSITIVE_INFINITY;
	return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Reads one mip of all six faces: `[face][y * size + x] = rgb`. */
async function readMip(
	cube: GPUTexture,
	mip: number,
): Promise<[number, number, number][][]> {
	const size = Math.max(1, cube.width >> mip);
	const bytesPerRow = Math.ceil((size * 8) / 256) * 256;
	const buffer = device.createBuffer({
		size: bytesPerRow * size * 6,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	device.pushErrorScope("validation");
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer(
		{ texture: cube, mipLevel: mip },
		{ buffer, bytesPerRow, rowsPerImage: size },
		{ width: size, height: size, depthOrArrayLayers: 6 },
	);
	device.queue.submit([encoder.finish()]);
	expect(await device.popErrorScope()).toBeNull();
	await buffer.mapAsync(GPUMapMode.READ);
	const half = new Uint16Array(buffer.getMappedRange().slice(0));
	buffer.destroy();
	const faces: [number, number, number][][] = [];
	for (let f = 0; f < 6; f++) {
		const texels: [number, number, number][] = [];
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const i = (f * size * bytesPerRow + y * bytesPerRow) / 2 + x * 4;
				texels.push([
					halfToFloat(half[i] ?? 0),
					halfToFloat(half[i + 1] ?? 0),
					halfToFloat(half[i + 2] ?? 0),
				]);
			}
		}
		faces.push(texels);
	}
	return faces;
}

/** WebGPU cube face orientation, as the prefilter shader writes it. */
function faceDirection(
	face: number,
	s: number,
	t: number,
): [number, number, number] {
	const d: [number, number, number][] = [
		[1, -t, -s],
		[-1, -t, s],
		[s, 1, t],
		[s, -1, -t],
		[s, -t, 1],
		[-s, -t, -1],
	];
	const [x, y, z] = d[face] ?? [0, 0, 1];
	const len = Math.hypot(x, y, z);
	return [x / len, y / len, z / len];
}

describe("HDR environment cubemap prefilter", () => {
	it("sizes faces to about a quarter of the panorama width, within 8..256", () => {
		expect(cubeFaceSize(64)).toBe(16);
		expect(cubeFaceSize(512)).toBe(128);
		expect(cubeFaceSize(4096)).toBe(256);
		expect(cubeFaceSize(8)).toBe(8);
	});

	it("stores the panorama at mirror roughness in every face's orientation", async () => {
		// Radiance encodes direction, so each texel shows where it looks.
		const env = getOrCreateHdrEnvironment(
			device,
			panorama(512, 256, (d) => [d[0] + 1, d[1] + 1, d[2] + 1]),
		);
		expect(env.faceSize).toBe(128);
		expect(env.mipLevelCount).toBe(6);
		const faces = await readMip(env.cube, 0);
		const size = env.faceSize;
		for (let f = 0; f < 6; f++) {
			for (const [x, y] of [
				[3, 5],
				[64, 64],
				[120, 17],
			] as const) {
				const want = faceDirection(
					f,
					((x + 0.5) / size) * 2 - 1,
					((y + 0.5) / size) * 2 - 1,
				);
				const got = faces[f]?.[y * size + x] ?? [0, 0, 0];
				for (let c = 0; c < 3; c++) {
					expect(Math.abs((got[c] ?? 0) - 1 - (want[c] ?? 0))).toBeLessThan(
						0.03,
					);
				}
			}
		}
	});

	it("keeps a uniform environment uniform at every roughness", async () => {
		const env = getOrCreateHdrEnvironment(
			device,
			panorama(128, 64, () => [0.25, 1.5, 4]),
		);
		for (let mip = 0; mip < env.mipLevelCount; mip++) {
			for (const face of await readMip(env.cube, mip)) {
				for (const [r, g, b] of face) {
					expect(r).toBeCloseTo(0.25, 1);
					expect(g).toBeCloseTo(1.5, 1);
					expect(b).toBeCloseTo(4, 0);
				}
			}
		}
	});

	it("spreads a small bright source wider and dimmer as roughness rises", async () => {
		// A hot disc straight ahead (-z) on a black panorama.
		const env = getOrCreateHdrEnvironment(
			device,
			panorama(512, 256, (d) => (d[2] < -0.995 ? [200, 200, 200] : [0, 0, 0])),
		);
		const peaks: number[] = [];
		const lit: number[] = [];
		for (let mip = 0; mip < env.mipLevelCount; mip++) {
			// Face 5 is -z.
			const face = (await readMip(env.cube, mip))[5] ?? [];
			peaks.push(Math.max(...face.map((t) => t[0])));
			lit.push(face.filter((t) => t[0] > 0.05).length / face.length);
		}
		for (let mip = 1; mip < peaks.length; mip++) {
			expect(peaks[mip]).toBeLessThan(peaks[mip - 1] ?? 0);
			expect(lit[mip]).toBeGreaterThanOrEqual(lit[mip - 1] ?? 0);
		}
		expect(lit[peaks.length - 1]).toBeGreaterThan(0.9);
	});

	it("projects irradiance SH alongside the cubemap", () => {
		const env = getOrCreateHdrEnvironment(
			device,
			panorama(64, 32, () => [1, 2, 3]),
		);
		// DC term of a uniform radiance L: L * sqrt(4π) * 1.
		expect(env.sh[0]).toBeCloseTo(Math.sqrt(4 * Math.PI), 2);
		expect(env.sh[2]).toBeCloseTo(3 * Math.sqrt(4 * Math.PI), 1);
	});
});

describe("HDR environment cache", () => {
	const variant = (k: number) => {
		const px = new Float32Array(16 * 8 * 4).fill(1);
		px[0] = k + 2;
		return encodeHdr(16, 8, px);
	};

	it("reuses one environment per content, not per byte array", () => {
		const a = getOrCreateHdrEnvironment(device, variant(100));
		expect(getOrCreateHdrEnvironment(device, variant(100))).toBe(a);
		expect(getOrCreateHdrEnvironment(device, variant(101))).not.toBe(a);
	});

	it("evicts the least recently used environment past the cap", () => {
		const sources = Array.from({ length: MAX_HDR_CACHE_ENTRIES + 1 }, (_, k) =>
			variant(k),
		);
		const first = sources.map((s) => getOrCreateHdrEnvironment(device, s));
		// Everything past the cap evicted the oldest; touching keeps one alive.
		const touched = getOrCreateHdrEnvironment(device, sources[1] as Uint8Array);
		expect(touched).toBe(first[1]);
		getOrCreateHdrEnvironment(device, variant(500));
		expect(getOrCreateHdrEnvironment(device, sources[1] as Uint8Array)).toBe(
			first[1],
		);
		expect(
			getOrCreateHdrEnvironment(device, sources[0] as Uint8Array),
		).not.toBe(first[0]);
	});

	it("reloads a file path after the file changes on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "hdr-environment-"));
		const file = join(dir, "env.hdr");
		writeFileSync(file, variant(900));
		utimesSync(file, 1000, 1000);
		const first = getOrCreateHdrEnvironment(device, file);
		expect(getOrCreateHdrEnvironment(device, file)).toBe(first);
		writeFileSync(file, encodeHdr(64, 32, new Float32Array(64 * 32 * 4)));
		utimesSync(file, 2000, 2000);
		const second = getOrCreateHdrEnvironment(device, file);
		expect(second).not.toBe(first);
		expect(second.faceSize).toBe(16);
	});
});
