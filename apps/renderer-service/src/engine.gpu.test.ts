/**
 * Engine hooks the in-process worker relies on (PLAN.md §8): progress and
 * abort in renderVideo, and the per-job cache reset. Needs a GPU, so it only
 * runs with FF_GPU_TESTS=1.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { resetRenderCaches } from "@framefields/renderer";
import { ApplyLUT, Composition, FontManager, Media } from "framefields";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const gpu = describe.skipIf(process.env.FF_GPU_TESTS !== "1");

let dir = "";

/** A solid-colour RGB PNG, without pulling in an image library. */
function solidPng(size: number, rgb: [number, number, number]): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf: Buffer) => {
		let c = 0xffffffff;
		for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([
		Buffer.from([0]),
		Buffer.from(Array(size).fill(rgb).flat()),
	]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const cube = (rgb: string) =>
	["LUT_3D_SIZE 2", ...Array(8).fill(rgb)].join("\n");

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-engine-"));
	await fs.writeFile(path.join(dir, "grey.png"), solidPng(64, [128, 128, 128]));
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

gpu("engine hooks", () => {
	const film = () =>
		new Composition({
			width: 64,
			height: 64,
			fps: 24,
			durationFrames: 48,
			backgroundColor: "#204060",
		});

	it("reports progress for every frame, then each phase after them", async () => {
		const seen: string[] = [];
		const result = await film().renderVideo({
			onProgress: (p) => seen.push(`${p.phase}:${p.frame}/${p.totalFrames}`),
		});
		await result.cleanup();
		expect(seen.slice(0, 3)).toEqual([
			"prepare:0/48",
			"render:0/48",
			"render:1/48",
		]);
		// The phase start, then one event per frame.
		expect(seen.filter((s) => s.startsWith("render:"))).toHaveLength(49);
		const last = seen.indexOf("render:48/48");
		expect(seen[last + 1]).toBe("audio:48/48");
		expect(seen).toContain("audio-encode:48/48");
		expect(seen).toContain("mux:48/48");
		expect(seen.at(-1)).toBe("done:48/48");
	}, 120_000);

	it("aborts between frames with the signal's reason", async () => {
		const controller = new AbortController();
		const reason = new Error("job cancelled");
		let frames = 0;
		const render = film().renderVideo({
			signal: controller.signal,
			onProgress: (p) => {
				frames = p.frame;
				if (p.frame === 5) controller.abort(reason);
			},
		});
		await expect(render).rejects.toBe(reason);
		expect(frames).toBe(5);

		// The worker keeps going after an abort.
		const next = await film().renderVideo({});
		await next.cleanup();
	}, 120_000);

	it("serves a changed file at the same path only after resetRenderCaches()", async () => {
		const lut = path.join(dir, "look.cube");
		const grey = path.join(dir, "grey.png");
		const frame = () =>
			Media.image(grey, { width: 64, height: 64 })
				.apply(new ApplyLUT({ lutUrl: lut, intensity: 1 }))
				.renderFrame({ frame: 0 });

		await fs.writeFile(lut, cube("0 1 0"));
		const green = await frame();

		// Same path, new bytes: what the next job's checkout looks like.
		await fs.writeFile(lut, cube("1 0 0"));
		const stale = await frame();

		resetRenderCaches();
		FontManager.clear();
		const red = await frame();

		expect(Buffer.compare(stale, green)).toBe(0);
		expect(Buffer.compare(red, green)).not.toBe(0);
	}, 120_000);
});

gpu("in-process render step (real Node loader)", () => {
	it("renders several jobs back to back in one process", async () => {
		const { execFileSync } = await import("node:child_process");
		const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-render-e2e-"));
		try {
			const out = execFileSync(
				path.resolve(import.meta.dirname, "../node_modules/.bin/tsx"),
				[
					path.resolve(import.meta.dirname, "../test/render-harness.ts"),
					workDir,
				],
				{
					encoding: "utf8",
					env: { ...process.env, NODE_ENV: "test" },
					timeout: 300_000,
				},
			);
			const line = out
				.trim()
				.split("\n")
				.filter((l) => l.startsWith('{"video1"'))
				.at(-1);
			const r = JSON.parse(line ?? "{}");
			expect(r.video1).toMatchObject({
				ok: true,
				files: [{ name: "main", ext: "mp4" }],
			});
			// Same asset path with new bytes in the next job: decoded fresh.
			expect(r.video2.ok).toBe(true);
			expect(r.videosDiffer).toBe(true);
			expect(r.frames).toMatchObject({
				ok: true,
				files: [{ name: "teaser-f0" }, { name: "teaser-f12" }],
			});
			expect(r.exits).toMatchObject({ ok: false, code: "EXPORT_SIDE_EFFECT" });
			expect(r.cancel).toMatchObject({ ok: false, code: "CANCELLED" });
			expect(r.after.ok).toBe(true);
			expect(r.switch).toMatchObject({ ok: false, code: "ENGINE_SWITCH" });
			for (const k of [
				"video1",
				"video2",
				"frames",
				"exits",
				"cancel",
				"after",
			]) {
				expect(r[k].cwdRestored).toBe(true);
			}
		} finally {
			await fs.rm(workDir, { recursive: true, force: true });
		}
	}, 300_000);
});
