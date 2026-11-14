/**
 * `generateDataset`: a tiny env rendered whole, and in two parts merged by
 * `finishDataset`, gives the same samples byte for byte and the same card.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "../index.js";
import { type Env, finishDataset, generateDataset, random } from "./index.js";

interface Params {
	x: number;
	color: string;
}

const dot: Env<Params> = {
	name: "dot",
	description: "A sphere at a seeded place.",
	fps: 24,
	frames: 2,
	width: 64,
	height: 48,
	params: (seed) => {
		const r = random(seed);
		return {
			x: Math.round(r.range(-20, 20)),
			color: r.pick(["#ff0000", "#00ff00"]),
		};
	},
	build: async (p) => {
		const c = new Composition({
			width: 64,
			height: 48,
			fps: 24,
			durationFrames: 2,
		});
		c.add([
			Layer.camera({ x: 0, y: 0, z: -300, targetX: 0, targetY: 0, targetZ: 0 }),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.sphere({
				id: "dot",
				label: "sphere",
				radius: 12,
				x: p.x,
				color: p.color,
			}),
		]);
		return [{ name: "front", composition: c }];
	},
};

/** The tar members of every shard in `dir`, by name. */
function members(dir: string): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	for (const f of readdirSync(dir).filter((f) => f.endsWith(".tar"))) {
		const bytes = readFileSync(path.join(dir, f));
		let o = 0;
		while (o + 512 <= bytes.length && bytes[o] !== 0) {
			const name = bytes
				.subarray(o, o + 100)
				.toString("utf8")
				.replace(/\0.*$/s, "");
			const size = Number.parseInt(
				bytes
					.subarray(o + 124, o + 136)
					.toString("utf8")
					.replace(/\0.*$/s, ""),
				8,
			);
			out.set(name, bytes.subarray(o + 512, o + 512 + size));
			o += 512 + Math.ceil(size / 512) * 512;
		}
	}
	return out;
}

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs = [];
});
const temp = () => {
	const d = mkdtempSync(path.join(tmpdir(), "ff-dataset-"));
	dirs.push(d);
	return d;
};

describe("generateDataset", () => {
	it("renders the same samples whole and in merged parts", async () => {
		const seeds = [0, 1, 2];
		const whole = temp();
		const one = await generateDataset(dot, {
			out: whole,
			seeds,
			amodal: false,
		});
		expect(one.samples).toBe(6);

		const parted = temp();
		for (const index of [1, 0])
			await generateDataset(dot, {
				out: parted,
				seeds,
				part: { index, count: 2 },
				amodal: false,
			});
		expect(readdirSync(parted).includes("README.md")).toBe(false);
		const merged = finishDataset(parted, dot);
		expect(merged.samples).toBe(6);

		const a = members(whole);
		const b = members(parted);
		expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
		for (const [name, bytes] of a)
			expect(Buffer.compare(bytes, b.get(name) ?? Buffer.alloc(0))).toBe(0);
		expect(readFileSync(path.join(parted, "README.md"), "utf8")).toBe(
			readFileSync(path.join(whole, "README.md"), "utf8"),
		);
		expect(() => finishDataset(parted, { ...dot, name: "other" })).toThrow(
			"env dot, not other",
		);
	});
});
