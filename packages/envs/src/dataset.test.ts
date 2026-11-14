/**
 * The dataset formats (npy, ustar) as their readers expect them, and a
 * small falling-objects dataset written, read back and reproduced.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DatasetWriter } from "./dataset.js";
import { generate, sampleKey } from "./env.js";
import { falling, fallingMultiView } from "./envs/falling.js";
import { encodeNpy, encodeNpz, toFloat16Bits } from "./npy.js";
import { tarHeader } from "./tar.js";

/** Members of a ustar archive: name and bytes. */
function readTar(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
	const out: Array<{ name: string; data: Uint8Array }> = [];
	let o = 0;
	while (o + 512 <= bytes.length && bytes[o] !== 0) {
		const text = (a: number, n: number) =>
			String.fromCharCode(...bytes.subarray(o + a, o + a + n)).replace(
				/\0.*$/s,
				"",
			);
		const size = Number.parseInt(text(124, 12).trim(), 8);
		out.push({
			name: text(0, 100),
			data: bytes.subarray(o + 512, o + 512 + size),
		});
		o += 512 + Math.ceil(size / 512) * 512;
	}
	return out;
}

/** A .npy file's header dict and data bytes. */
function readNpy(bytes: Uint8Array): { header: string; data: Uint8Array } {
	const len = new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true);
	return {
		header: String.fromCharCode(...bytes.subarray(10, 10 + len)),
		data: bytes.subarray(10 + len),
	};
}

/** The members of a .npz (zip, deflated): name and inflated bytes. */
function readNpz(bytes: Uint8Array): Map<string, Uint8Array> {
	const out = new Map<string, Uint8Array>();
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let o = 0;
	while (v.getUint32(o, true) === 0x04034b50) {
		const packed = v.getUint32(o + 18, true);
		const nameLen = v.getUint16(o + 26, true);
		const name = String.fromCharCode(
			...bytes.subarray(o + 30, o + 30 + nameLen),
		);
		const start = o + 30 + nameLen;
		out.set(
			name,
			new Uint8Array(inflateRawSync(bytes.subarray(start, start + packed))),
		);
		o = start + packed;
	}
	return out;
}

describe("formats", () => {
	it("writes .npy as numpy reads it", () => {
		const npy = encodeNpy(new Float32Array([1, 2, 3, 4, 5, 6]), [2, 3]);
		expect([...npy.subarray(0, 8)]).toEqual([
			0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0,
		]);
		// The whole preamble is a multiple of 64, ending in a newline.
		const { header, data } = readNpy(npy);
		expect((10 + header.length) % 64).toBe(0);
		expect(header.endsWith("\n")).toBe(true);
		expect(header).toContain("'descr': '<f4'");
		expect(header).toContain("'shape': (2, 3)");
		expect(Array.from(new Float32Array(data.slice().buffer))).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
		expect(readNpy(encodeNpy(new Uint32Array(4), [4])).header).toContain(
			"(4,)",
		);
	});

	it("writes .npz members that inflate back to their arrays", () => {
		const a = encodeNpy(new Float32Array([1.5, -2]), [2]);
		const b = encodeNpy(
			toFloat16Bits(new Float32Array([1, 0.5, -0.25])),
			[3],
			"<f2",
		);
		const members = readNpz(
			encodeNpz([
				["a", a],
				["b", b],
			]),
		);
		expect([...members.keys()]).toEqual(["a.npy", "b.npy"]);
		expect(members.get("a.npy")).toEqual(a);
		const half = readNpy(members.get("b.npy") ?? new Uint8Array());
		expect(half.header).toContain("'<f2'");
		expect(Array.from(new Uint16Array(half.data.slice().buffer))).toEqual([
			0x3c00, 0x3800, 0xb400,
		]);
	});

	it("writes ustar headers with a valid checksum", () => {
		const h = tarHeader("a_s000001_front_f0000.json", 1234);
		const stored = Number.parseInt(
			String.fromCharCode(...h.subarray(148, 154)),
			8,
		);
		const blank = h.slice();
		blank.fill(0x20, 148, 156);
		expect(blank.reduce((n, b) => n + b, 0)).toBe(stored);
		expect(String.fromCharCode(...h.subarray(257, 262))).toBe("ustar");
	});
});

describe("generate", () => {
	it("writes samples with ground truth, the same bytes every run", async () => {
		const runs: string[] = [];
		for (const _ of [0, 1]) {
			const dir = mkdtempSync(path.join(tmpdir(), "envs-"));
			try {
				const writer = new DatasetWriter({ dir });
				await generate(falling, { seeds: [7], frames: [0, 30], writer });
				const { shards, samples } = writer.close();
				expect(samples).toBe(2);
				const bytes = new Uint8Array(readFileSync(shards[0]));
				runs.push(createHash("sha256").update(bytes).digest("hex"));
				const members = readTar(bytes);
				const key = sampleKey("falling", 7, "front", 30);
				const names = members
					.filter((m) => m.name.startsWith(key))
					.map((m) => m.name);
				expect(names.sort()).toEqual(
					["json", "png", "truth.npz"].map((ext) => `${key}.${ext}`),
				);
				const json = JSON.parse(
					new TextDecoder().decode(
						members.find((m) => m.name === `${key}.json`)?.data,
					),
				);
				expect(json.params.objects.length).toBe(json.physics.bodies.length);
				const shown = json.objects.filter(
					(o: { layer?: string; pixels: number }) => o.layer?.startsWith("obj"),
				);
				expect(shown.length).toBe(json.params.objects.length);
				expect(json.camera.intrinsics.fx).toBeGreaterThan(0);
				const truth = readNpz(
					members.find((m) => m.name === `${key}.truth.npz`)?.data ??
						new Uint8Array(),
				);
				expect([...truth.keys()].sort()).toEqual([
					"depth.npy",
					"instance.npy",
					"motion.npy",
					"normal.npy",
					"object.npy",
				]);
				expect(
					readNpy(truth.get("depth.npy") ?? new Uint8Array()).header,
				).toContain("(480, 640)");
				expect(
					readNpy(truth.get("normal.npy") ?? new Uint8Array()).header,
				).toContain("(480, 640, 3)");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
		expect(runs[1]).toBe(runs[0]);
	});

	it("renders every view of a shared simulation", async () => {
		const params = fallingMultiView.params(3);
		const views = await fallingMultiView.build(params);
		expect(views.map((v) => v.name)).toEqual(["left", "front", "right"]);
		// One simulation: every view's bodies are where the others' are.
		const states = views.map((v) => JSON.stringify(v.physics?.(40)));
		expect(new Set(states).size).toBe(1);
	});
});
