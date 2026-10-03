import { describe, expect, it } from "vitest";
import { PREPROCESS_BY_FAMILY } from "../decode/preprocess.js";
import { VISION_MODELS } from "../model/registry.js";
import {
	fakeStore,
	grayImage,
	rtmdetInsOutput,
	rtmoOutput,
	ScriptedProvider,
	selfieOutput,
} from "../test-support.js";
import { VisionRunner } from "./vision-runner.js";

describe("VisionRunner (lazy + decode integration)", () => {
	it("create() performs zero I/O; the first detect() downloads + runs RTMDet-Ins", async () => {
		const { store, fetches } = fakeStore();
		const provider = new ScriptedProvider([rtmdetInsOutput()]);
		const runner = VisionRunner.create({ store, provider });

		expect(fetches).toHaveLength(0);
		expect(provider.created).toHaveLength(0);
		expect(runner.downloadStatus.get("rtmdet-ins-s")).toBe("pending");

		const detections = await runner.detect(grayImage());
		expect(fetches).toEqual([
			`https://example.test/models/${VISION_MODELS["rtmdet-ins-s"].filename}`,
		]);
		expect(runner.downloadStatus.get("rtmdet-ins-s")).toBe("ready");
		expect(runner.downloadStatus.get("rtmo-s")).toBe("pending");
		expect(detections).toHaveLength(1);
		expect(detections[0].category).toBe("person");
		expect(detections[0].score).toBeCloseTo(0.9);
		// 640×640 source, top-left letterbox at scale 1 → input box == source box
		expect(detections[0].boundingBox.originX).toBeCloseTo(220);
		expect(detections[0].boundingBox.width).toBeCloseTo(200);
	});

	it("detect() and segment() on the same frame share one forward pass", async () => {
		const { store } = fakeStore();
		const provider = new ScriptedProvider([rtmdetInsOutput()]);
		const runner = VisionRunner.create({ store, provider });
		const frame = grayImage();

		await runner.detect(frame);
		const seg = await runner.segment(frame);
		expect(provider.created).toHaveLength(1);
		expect(provider.created[0].inputs).toHaveLength(1);

		expect(seg.masks).toHaveLength(1);
		const m = seg.masks[0];
		expect(m.width).toBe(640);
		expect(m.mask[300 * 640 + 300]).toBe(255); // inside the blob
		expect(m.mask[180 * 640 + 230]).toBe(0); // inside the box, outside the blob
		expect(m.coverage).toBeGreaterThan(0);

		// A new frame buffer runs the model again.
		await runner.segment(grayImage());
		expect(provider.created[0].inputs).toHaveLength(2);
	});

	it("maps boxes and masks back through a top-left letterbox on wide frames", async () => {
		const { store } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new ScriptedProvider([rtmdetInsOutput()]),
		});
		// 1280×720 → scale 0.5, content at input (0,0)–(640,360), no offset
		const seg = await runner.segment(grayImage(1280, 720));
		const box = seg.detections[0].boundingBox;
		expect(box.originX).toBeCloseTo(440);
		expect(box.originY).toBeCloseTo(340);
		expect(seg.masks[0].width).toBe(1280);
		expect(seg.masks[0].mask[600 * 1280 + 600]).toBe(255);
	});

	it("applies confidence and class filters", async () => {
		const { store } = fakeStore();
		const low = VisionRunner.create({
			store,
			confidence: 0.95,
			provider: new ScriptedProvider([rtmdetInsOutput()]),
		});
		expect(await low.detect(grayImage())).toHaveLength(0);

		const cars = VisionRunner.create({
			store,
			classes: ["car"],
			provider: new ScriptedProvider([rtmdetInsOutput()]),
		});
		expect(await cars.detect(grayImage())).toHaveLength(0);

		const horse = VisionRunner.create({
			store,
			classes: ["Horse"],
			provider: new ScriptedProvider([rtmdetInsOutput({ label: 17 })]),
		});
		expect((await horse.detect(grayImage()))[0].category).toBe("horse");
	});

	it("preprocesses RTMDet-Ins input as BGR, ImageNet-normalized, padded with 114", async () => {
		const { store } = fakeStore();
		const provider = new ScriptedProvider([rtmdetInsOutput()]);
		const runner = VisionRunner.create({ store, provider });
		const image = grayImage(640, 320);
		image.data.fill(0);
		for (let i = 0; i < image.data.length; i += 4) {
			image.data[i] = 255; // pure red, opaque
			image.data[i + 3] = 255;
		}
		await runner.detect(image);
		const input = provider.created[0].inputs[0];
		expect(input.name).toBe("input");
		expect(input.dims).toEqual([1, 3, 640, 640]);
		const plane = 640 * 640;
		const { mean, std } = PREPROCESS_BY_FAMILY["rtmdet-ins"];
		// content row: B plane = 0, R plane (index 2) = 255
		expect(input.data[0]).toBeCloseTo((0 - mean[0]) / std[0], 4);
		expect(input.data[2 * plane]).toBeCloseTo((255 - mean[2]) / std[2], 4);
		// padded row (y = 400, below the 320-row content)
		expect(input.data[400 * 640]).toBeCloseTo((114 - mean[0]) / std[0], 4);
	});

	it("pose() decodes RTMO keypoints through the centered letterbox inverse", async () => {
		const { store, fetches } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new ScriptedProvider([rtmoOutput()]),
		});
		// 1280×640 → scale 0.5, content centered vertically: offsetY = 160
		const res = await runner.pose(grayImage(1280, 640));
		expect(fetches[0]).toContain(VISION_MODELS["rtmo-s"].filename);
		expect(res.people).toHaveLength(1);
		const nose = res.people[0].keypoints[0];
		expect(nose.x).toBeCloseTo(640);
		expect(nose.y).toBeCloseTo(80);
		expect(nose.visibility).toBeCloseTo(0.9);
		expect(res.people[0].keypoints).toHaveLength(17);
	});

	it("matte() picks the aspect-matched Selfie Segmenter and upsamples to the frame", async () => {
		const { store, fetches } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new ScriptedProvider([selfieOutput(256, 144)]),
		});
		const matte = await runner.matte(grayImage(1280, 720));
		expect(fetches[0]).toContain(VISION_MODELS["selfie-landscape"].filename);
		expect(matte.width).toBe(1280);
		expect(matte.mask[360 * 1280 + 100]).toBe(255);
		expect(matte.mask[360 * 1280 + 1200]).toBe(0);
		expect(matte.coverage).toBeGreaterThan(0.4);
		expect(matte.coverage).toBeLessThan(0.6);
	});

	it("preload() fetches only the requested tasks' models", async () => {
		const { store, fetches } = fakeStore();
		const runner = VisionRunner.create({
			store,
			variant: "t",
			provider: new ScriptedProvider([]),
		});
		await runner.preload(["segment", "pose"]);
		expect(fetches).toHaveLength(2);
		expect(runner.downloadStatus.get("rtmdet-ins-t")).toBe("ready");
		expect(runner.downloadStatus.get("rtmo-t")).toBe("ready");
		expect(runner.downloadStatus.get("rtmdet-ins-s")).toBe("pending");
	});

	it("names the missing output when a model does not match its family", async () => {
		const { store } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new ScriptedProvider([{}]),
		});
		await expect(runner.pose(grayImage())).rejects.toThrow(
			/'rtmo-s' returned no 'dets' output/,
		);
	});

	it("close() releases sessions and recreates them on next use", async () => {
		const { store } = fakeStore();
		const provider = new ScriptedProvider([
			rtmdetInsOutput(),
			rtmdetInsOutput(),
		]);
		const runner = VisionRunner.create({ store, provider });
		await runner.detect(grayImage());
		runner.close();
		await runner.detect(grayImage());
		expect(provider.created).toHaveLength(2);
	});
});
