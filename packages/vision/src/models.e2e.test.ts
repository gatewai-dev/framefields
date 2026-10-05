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
import { beforeAll, describe, expect, it } from "vitest";
import { VisionModelStore } from "./model/model-store.js";
import {
	VISION_MODELS,
	VISION_VARIANTS,
	type VisionModelKey,
} from "./model/registry.js";
import { VisionRunner } from "./runner/vision-runner.js";
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
		Object.keys(VISION_MODELS) as VisionModelKey[],
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

	describe.each(VISION_VARIANTS)("variant %s", (variant) => {
		const runner = VisionRunner.create({ variant });

		it("cuts out the whole dancer, dress included", async () => {
			const seg = await runner.segment(frames.dancer);
			const subject = mergeSubjectMask(seg.masks);
			expect(subject?.category).toBe("person");
			// the bare person mask is ~3% of the frame; with the dress merged it is ~12.5%
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
