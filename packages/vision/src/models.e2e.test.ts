/**
 * Real-model end-to-end checks — opt-in, because they download ~380 MB of weights:
 *
 *   pnpm --filter @framefields/vision test:models
 *
 * Verifies every pinned model downloads, passes its size + SHA-256 check and matches the
 * registry's input shape, then runs each size on reference frames from `examples/` and checks
 * behaviour that regressed during development (subject selection, merging, pose duplicates).
 * Models are cached in `$FRAMEFIELDS_MODELS_DIR` (default `~/.cache/framefields/models`).
 */

import { fileURLToPath } from "node:url";
import { Canvas, loadImage } from "skia-canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageToTensor, preprocessSpec } from "./decode/preprocess.js";
import { decodeRtmdetIns } from "./decode/rtmdet-ins.js";
import { FrameTensorPipeline } from "./gpu/frame-tensor.js";
import { needsNchwLayout } from "./model/conv-layout.js";
import { VisionModelStore } from "./model/model-store.js";
import {
	COCO_CLASSES,
	VISION_MODELS,
	VISION_VARIANTS,
	type VisionModelKey,
} from "./model/registry.js";
import { VisionRunner } from "./runner/vision-runner.js";
import { NodeWebGPUProvider } from "./runtime/node-webgpu-provider.js";
import { mergeSubjectMask } from "./segmentation/subject.js";
import type { VisionImageInput } from "./types.js";

const enabled = process.env.FRAMEFIELDS_VISION_E2E === "1";
const EXAMPLES = fileURLToPath(new URL("../../../examples/", import.meta.url));
const ASSETS = {
	dancer: "19_framefields_film/assets/dancer.png",
	portrait: "19_framefields_film/assets/portrait.png",
	ink: "19_framefields_film/assets/ink.png",
	crema: "21_full_circle/assets/crema.png",
	eclipse: "21_full_circle/assets/eclipse.png",
	spotlight: "21_full_circle/assets/spotlight.png",
	tunnel: "21_full_circle/assets/tunnel.png",
} as const;

async function loadFrame(path: string): Promise<VisionImageInput> {
	const image = await loadImage(EXAMPLES + path);
	const canvas = new Canvas(image.width, image.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	return {
		data: ctx.getImageData(0, 0, image.width, image.height).data,
		width: image.width,
		height: image.height,
	};
}

describe.skipIf(!enabled)("vision models (real weights)", () => {
	const frames = {} as Record<keyof typeof ASSETS, VisionImageInput>;

	beforeAll(async () => {
		for (const [name, path] of Object.entries(ASSETS)) {
			frames[name as keyof typeof ASSETS] = await loadFrame(path);
		}
	});

	it.each(
		(Object.keys(VISION_MODELS) as VisionModelKey[]).filter(
			(key) => VISION_MODELS[key].family !== "sam2",
		),
	)("%s downloads, verifies and matches its registry input shape", async (key) => {
		const bytes = await new VisionModelStore().ensure(key);
		const ort = await import("onnxruntime-node");
		const session = await ort.InferenceSession.create(bytes);
		const meta = session.inputMetadata[0];
		const shape = meta?.isTensor ? meta.shape : [];
		const [w, h] = VISION_MODELS[key].input;
		expect(shape.slice(2)).toEqual([h, w]);
		await session.release();
	}, 600_000);

	it("runs only RTMO in NCHW (its grouped convs break the NHWC kernels)", async () => {
		const store = new VisionModelStore();
		expect(needsNchwLayout(await store.ensure("rtmo-s"))).toBe(true);
		expect(needsNchwLayout(await store.ensure("rtmdet-ins-s"))).toBe(false);
		expect(needsNchwLayout(await store.ensure("selfie-landscape"))).toBe(false);
	}, 600_000);

	describe("GPU frames", () => {
		let device: GPUDevice;
		// Held for the test's lifetime: Dawn crashes if its instance is collected
		// while a device is alive.
		const keepAlive: unknown[] = [];
		const upload = (frame: VisionImageInput) => {
			const texture = device.createTexture({
				size: [frame.width, frame.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			device.queue.writeTexture(
				{ texture },
				frame.data as Uint8Array<ArrayBuffer>,
				{ bytesPerRow: frame.width * 4 },
				[frame.width, frame.height],
			);
			return { texture, device, width: frame.width, height: frame.height };
		};

		beforeAll(async () => {
			const { create, globals } = await import("webgpu");
			Object.assign(globalThis, globals);
			const instance = create([]);
			keepAlive.push(instance);
			const adapter = await instance.requestAdapter();
			if (!adapter) throw new Error("no WebGPU adapter");
			device = await adapter.requestDevice();
		});

		// Dawn can crash the worker at exit while a device is alive.
		afterAll(() => {
			device?.destroy();
			keepAlive.length = 0;
		});

		it("preprocesses on the GPU like imageToTensor", async () => {
			for (const family of ["rtmdet-ins", "rtmo", "selfie"] as const) {
				const spec = preprocessSpec(
					family,
					family === "selfie" ? [256, 144] : [640, 640],
				);
				const frame = frames.dancer;
				const expected = imageToTensor(frame, spec).tensor;
				const out = device.createBuffer({
					size: FrameTensorPipeline.tensorBytes(spec),
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
				});
				const staging = device.createBuffer({
					size: out.size,
					usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
				});
				FrameTensorPipeline.for(device).toTensor(upload(frame), spec, out);
				const encoder = device.createCommandEncoder();
				encoder.copyBufferToBuffer(out, 0, staging, 0, out.size);
				device.queue.submit([encoder.finish()]);
				await staging.mapAsync(GPUMapMode.READ);
				const actual = new Float32Array(staging.getMappedRange().slice(0));
				let worst = 0;
				for (let i = 0; i < expected.length; i++) {
					worst = Math.max(
						worst,
						Math.abs((actual[i] as number) - (expected[i] as number)),
					);
				}
				// A step of one 8-bit level is 1/std ≈ 0.017 (rtmdet), 1 (rtmo), 1/255 (selfie).
				expect(worst).toBeLessThan(family === "rtmo" ? 0.05 : 1e-3);
			}
		}, 120_000);

		it("gives the same detections, masks and poses as CPU frames", async () => {
			const gpu = VisionRunner.create({
				provider: new NodeWebGPUProvider({ device }),
			});
			const cpu = VisionRunner.create();
			for (const name of ["dancer", "crema"] as const) {
				const a = await gpu.segment(upload(frames[name]));
				const b = await cpu.segment(frames[name]);
				expect(a.detections.map((d) => d.category)).toEqual(
					b.detections.map((d) => d.category),
				);
				a.detections.forEach((d, i) => {
					expect(d.score).toBeCloseTo((b.detections[i] as typeof d).score, 2);
				});
				expect(a.masks.map((m) => Math.round(m.coverage * 1000))).toEqual(
					b.masks.map((m) => Math.round(m.coverage * 1000)),
				);
			}
			const pose = await gpu.pose(upload(frames.dancer));
			expect(pose.people).toHaveLength(1);
			gpu.close();
			cpu.close();
		}, 600_000);
	});

	describe.each(VISION_VARIANTS)("variant %s", (variant) => {
		const runner = VisionRunner.create({ variant });

		it("matches the end2end graph (head cut + own NMS and masks)", async () => {
			const key = runner.modelKeyFor("segment");
			const ort = await import("onnxruntime-node");
			const full = await ort.InferenceSession.create(
				await new VisionModelStore().ensure(key),
			);
			const decodeOptions = {
				confidence: 0.3,
				classNames: COCO_CLASSES,
				maskThreshold: 0.5,
			};
			for (const name of ["dancer", "crema", "tunnel", "spotlight"] as const) {
				const frame = frames[name];
				const spec = preprocessSpec("rtmdet-ins", VISION_MODELS[key].input);
				const { tensor, transform } = imageToTensor(frame, spec);
				const out = await full.run({
					input: new ort.Tensor("float32", tensor, [
						1,
						3,
						spec.height,
						spec.width,
					]),
				});
				const dets = out.dets as unknown as {
					data: Float32Array;
					dims: readonly number[];
				};
				const masks = out.masks as unknown as {
					data: Float32Array;
					dims: readonly number[];
				};
				const expected = decodeRtmdetIns(
					{
						dets: dets.data,
						labels: (out.labels as { data: BigInt64Array }).data,
						masks: masks.data,
						count: dets.dims[1] ?? 0,
						maskHeight: masks.dims[2] ?? 0,
						maskWidth: masks.dims[3] ?? 0,
					},
					{
						...decodeOptions,
						transform,
						sourceWidth: frame.width,
						sourceHeight: frame.height,
					},
				);
				const actual = await runner.segment(frame);

				expect(actual.detections.map((d) => d.category)).toEqual(
					expected.detections.map((d) => d.category),
				);
				actual.detections.forEach((d, i) => {
					const e = expected.detections[i] as (typeof expected.detections)[0];
					expect(d.score).toBeCloseTo(e.score, 4);
					expect(d.boundingBox.originX).toBeCloseTo(e.boundingBox.originX, 2);
					expect(d.boundingBox.width).toBeCloseTo(e.boundingBox.width, 2);
				});
				expect(actual.masks).toHaveLength(expected.masks.length);
				actual.masks.forEach((m, i) => {
					const e = expected.masks[i] as (typeof expected.masks)[0];
					let inter = 0;
					let union = 0;
					for (let p = 0; p < m.mask.length; p++) {
						const a = (m.mask[p] as number) >= 128;
						const b = (e.mask[p] as number) >= 128;
						if (a && b) inter++;
						if (a || b) union++;
					}
					// Edges differ slightly: end2end upsamples twice (graph ×8, then to
					// the frame) with the sigmoid in between; the head path upsamples the
					// logits once, straight to the frame.
					expect(union === 0 ? 1 : inter / union).toBeGreaterThan(0.98);
				});
			}
			await full.release();
		}, 600_000);

		it("cuts out the whole dancer, dress included", async () => {
			const seg = await runner.segment(frames.dancer);
			const subject = mergeSubjectMask(seg.masks);
			expect(subject?.category).toBe("person");
			// the bare person mask is ~3% of the frame; with the dress merged it is ~12.5%
			expect(subject?.coverage).toBeGreaterThan(0.08);
			expect(subject?.coverage).toBeLessThan(0.2);
		}, 120_000);

		it("cuts out the whole dancer when the subject is limited to people", async () => {
			// The dress comes back as other classes ("kite", "umbrella"); a person-only
			// filter before the merge leaves just the bare person (~3%).
			const seg = await runner.segment(frames.dancer);
			const subject = mergeSubjectMask(seg.masks, { classes: ["person"] });
			expect(subject?.category).toBe("person");
			expect(subject?.coverage).toBeGreaterThan(0.08);
			expect(subject?.coverage).toBeLessThan(0.2);
		}, 120_000);

		it("finds one dancer with a full skeleton", async () => {
			const { people } = await runner.pose(frames.dancer);
			expect(people).toHaveLength(1);
			const visible = people[0].keypoints.filter((k) => k.visibility > 0.5);
			expect(visible.length).toBeGreaterThanOrEqual(12);
			const nose = people[0].keypoints[0];
			expect(nose.x).toBeGreaterThan(1000);
			expect(nose.x).toBeLessThan(1120);
			expect(nose.y).toBeGreaterThan(250);
			expect(nose.y).toBeLessThan(360);
		}, 120_000);

		it("reports the spotlight dancer once (no duplicate skeletons)", async () => {
			const { people } = await runner.pose(frames.spotlight);
			expect(people).toHaveLength(1);
		}, 120_000);

		it("picks the cup, not the table, as a non-person subject", async () => {
			const seg = await runner.segment(frames.crema);
			expect(mergeSubjectMask(seg.masks)?.category).toBe("cup");
		}, 120_000);

		it("keeps a tiny figure separate from the tunnel around it", async () => {
			const seg = await runner.segment(frames.tunnel);
			const subject = mergeSubjectMask(seg.masks);
			expect(subject?.category).toBe("person");
			expect(subject?.coverage).toBeLessThan(0.02);
		}, 120_000);

		it("sees no confident person in abstract frames", async () => {
			for (const frame of [frames.ink, frames.eclipse]) {
				const detections = await runner.detect(frame);
				const people = detections.filter(
					(d) => d.category === "person" && d.score >= 0.5,
				);
				expect(people).toHaveLength(0);
			}
		}, 120_000);

		it("mattes a portrait with the Selfie Segmenter", async () => {
			const matte = await runner.matte(frames.portrait);
			expect(matte.width).toBe(frames.portrait.width);
			expect(matte.coverage).toBeGreaterThan(0.3);
			expect(matte.coverage).toBeLessThan(0.6);
		}, 120_000);
	});
});
