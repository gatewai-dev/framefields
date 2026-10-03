import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	SessionProvider,
	YoloSession,
	YoloTensorInput,
} from "../runtime/session-provider.js";
import { YoloVisionRunner } from "./yolo-runner.js";

/** Deterministic fake ONNX session: stores the input tensor, replays scripted outputs. */
class ScriptedSession implements YoloSession {
	public inputs: YoloTensorInput[] = [];
	constructor(
		private outputs: Record<
			string,
			{ data: Float32Array; dims: readonly number[] }
		>,
	) {}
	async run(
		input: YoloTensorInput | readonly YoloTensorInput[],
	): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> {
		const list = Array.isArray(input) ? input : [input];
		for (const inp of list) {
			this.inputs.push({
				name: inp.name,
				data: inp.data.slice(),
				dims: [...inp.dims],
			});
		}
		return this.outputs;
	}
	async release(): Promise<void> {}
}

class ScriptedProvider implements SessionProvider {
	public readonly kind = "node" as const;
	public created: ScriptedSession[] = [];
	private script: ScriptedSession[];
	constructor(
		script: Array<
			Record<string, { data: Float32Array; dims: readonly number[] }>
		>,
	) {
		this.script = script.map((outputs) => new ScriptedSession(outputs));
	}
	async createSession(): Promise<YoloSession> {
		const session = this.script[this.created.length] ?? new ScriptedSession({});
		this.created.push(session);
		return session;
	}
}

function dummyImage(width = 640, height = 640) {
	return {
		data: new Uint8ClampedArray(width * height * 4).fill(128),
		width,
		height,
	};
}

function detectOutput() {
	// [1, 4+1, 1] — a single person at input center
	const out = new Float32Array(5);
	out[0] = 320;
	out[1] = 320;
	out[2] = 200;
	out[3] = 300;
	out[4] = 0.9;
	return { output0: { data: out, dims: [1, 5, 1] } };
}

function poseOutput() {
	const rows = 4 + 1 + 17 * 3;
	const out = new Float32Array(rows);
	out[0] = 320;
	out[1] = 320;
	out[2] = 200;
	out[3] = 300;
	out[4] = 0.8;
	out[5] = 320;
	out[6] = 280;
	out[7] = 0.99; // nose
	return { output0: { data: out, dims: [1, rows, 1] } };
}

function obbOutput() {
	// OBB head: [1, 4 + nc + 1, 1] — one plane (DOTA class 0) with a 30° rotation.
	const nc = 15;
	const rows = 4 + nc + 1;
	const out = new Float32Array(rows);
	out[0] = 320;
	out[1] = 320;
	out[2] = 200;
	out[3] = 120;
	out[4 + 0] = 0.9;
	out[4 + nc] = Math.PI / 6;
	return { output0: { data: out, dims: [1, rows, 1] } };
}

function segOutput() {
	// seg head, full layout: [1, 4 + 80 + 32, 8400] — one person (class 0) at anchor 0
	const anchors = 8400;
	const nc = 80;
	const rows = 4 + nc + 32;
	const preds = new Float32Array(rows * anchors);
	preds[0 * anchors] = 320;
	preds[1 * anchors] = 320;
	preds[2 * anchors] = 200;
	preds[3 * anchors] = 300;
	preds[4 * anchors] = 0.9;
	for (let c = 0; c < 32; c++) preds[(4 + nc + c) * anchors] = 1;
	// proto masks: [1, 32, 160, 160]
	const proto = new Float32Array(32 * 160 * 160).fill(0);
	// a solid blob on the 160-grid covering input pixels ~220..260 (grid 55..65),
	// inside the detection box (x 220..420, y 170..470) — the instance mask is non-empty
	for (let c = 0; c < 32; c++) {
		for (let y = 55; y < 65; y++) {
			for (let x = 55; x < 65; x++) {
				proto[c * 160 * 160 + y * 160 + x] = 1;
			}
		}
	}
	return {
		output0: { data: preds, dims: [1, rows, anchors] },
		output1: { data: proto, dims: [1, 32, 160, 160] },
	};
}

describe("YoloVisionRunner (lazy + decode integration)", () => {
	it("create() performs zero provider work; first detect() downloads + runs", async () => {
		// Stub fetch BEFORE create(): the store captures the fetch implementation at
		// construction time (lazy by design — it uses whatever fetch exists on first use).
		let storeFetches = 0;
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			storeFetches++;
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as typeof fetch;
		const provider = new ScriptedProvider([detectOutput()]);
		const runner = YoloVisionRunner.create({
			modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
			provider,
			imgsz: 640,
		});
		try {
			// session provider recorded nothing yet — zero I/O at create()
			expect(provider.created.length).toBe(0);
			expect(runner.downloadStatus.get("yolo11n")).toBe("pending");

			const res = await runner.detect(dummyImage());
			expect(storeFetches).toBe(1); // one lazy fetch, on first call
			expect(runner.downloadStatus.get("yolo11n")).toBe("ready");
			expect(res).toHaveLength(1);
			expect(res[0].category).toBe("person");
			expect(res[0].score).toBeCloseTo(0.9, 6);
			expect(provider.created.length).toBe(1);

			// second call reuses everything — no additional fetch/session
			await runner.detect(dummyImage());
			expect(storeFetches).toBe(1);
			expect(provider.created.length).toBe(1);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("segment() runs the seg pipeline and returns masks aligned to source", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
		try {
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider: new ScriptedProvider([segOutput()]),
				imgsz: 640,
			});
			const img = dummyImage(640, 640);
			const res = await runner.segment(img);
			expect(res.detections).toHaveLength(1);
			expect(res.masks).toHaveLength(1);
			expect(res.masks[0].width).toBe(640);
			expect(res.masks[0].height).toBe(640);
			expect(res.masks[0].category).toBe("person");
			expect(res.masks[0].area).toBeGreaterThan(0);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("pose() decodes keypoints through the letterbox inverse", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
		try {
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider: new ScriptedProvider([poseOutput()]),
				imgsz: 640,
			});
			const img = dummyImage(1920, 1080);
			const res = await runner.pose(img);
			expect(res.people).toHaveLength(1);
			const p = res.people[0];
			expect(p.score).toBeCloseTo(0.8, 6);
			expect(p.keypoints).toHaveLength(17);
			// nose input (320, 280): letterbox scale 1/3, dh = 140
			// source x = (320 - 0) * 3 = 960, y = (280 - 140) * 3 = 420
			expect(p.keypoints[0].x).toBeCloseTo(960, 3);
			expect(p.keypoints[0].y).toBeCloseTo(420, 3);
			expect(p.keypoints[0].visibility).toBeCloseTo(0.99, 5);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("close() releases sessions and clears memory", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
		try {
			const provider = new ScriptedProvider([detectOutput(), detectOutput()]);
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				imgsz: 640,
			});
			await runner.detect(dummyImage());
			expect(provider.created.length).toBe(1);
			runner.close();
			// next detect() re-creates the session from scratch (buffers were dropped)
			await runner.detect(dummyImage());
			expect(provider.created.length).toBe(2);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("preload() explicitly fetches ahead of use", async () => {
		const origFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (async () => {
			fetches++;
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as typeof fetch;
		try {
			const provider = new ScriptedProvider([detectOutput(), poseOutput()]);
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				imgsz: 640,
			});
			await runner.preload(["detect", "pose"]);
			expect(fetches).toBe(2);
			expect(provider.created.length).toBe(2);
			expect(runner.downloadStatus.get("yolo11n-pose")).toBe("ready");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("letterbox tensor shape matches ONNX input expectations", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
		try {
			const provider = new ScriptedProvider([detectOutput()]);
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				imgsz: 640,
			});
			await runner.detect(dummyImage());
			const input = provider.created[0]?.inputs[0];
			expect(input?.dims).toEqual([1, 3, 640, 640]);
			expect(input?.name).toBe("images");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("detectObb() lazily loads ONLY the obb model (I1/I2)", async () => {
		const origFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (async () => {
			fetches++;
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as typeof fetch;
		try {
			const provider = new ScriptedProvider([obbOutput()]);
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				imgsz: 640,
			});
			expect(runner.downloadStatus.get("yolo11n-obb")).toBe("pending");

			const res = await runner.detectObb(dummyImage());
			expect(fetches).toBe(1);
			expect(res.detections).toHaveLength(1);
			expect(res.detections[0].category).toBe("plane");
			expect(res.detections[0].boundingBox.angle).toBeCloseTo(Math.PI / 6, 6);
			expect(runner.downloadStatus.get("yolo11n-obb")).toBe("ready");
			// the detect model was never touched by an obb-only run
			expect(runner.downloadStatus.get("yolo11n")).toBe("pending");
			expect(provider.created.length).toBe(1);

			const input = provider.created[0]?.inputs[0];
			expect(input?.dims).toEqual([1, 3, 1024, 1024]);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("detectWorld() lazily loads yolov8s-worldv2 and decodes open-vocabulary prompts", async () => {
		const origFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (async () => {
			fetches++;
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as typeof fetch;
		try {
			const prompts = ["neon helmet", "cyberpunk car", "energy drink"] as const;
			const nc = prompts.length;
			const out = new Float32Array(4 + nc);
			out[0] = 320;
			out[1] = 320;
			out[2] = 200;
			out[3] = 300;
			out[4 + 1] = 0.92; // second prompt: "cyberpunk car"

			const provider = new ScriptedProvider([
				{ output0: { data: out, dims: [1, 4 + nc, 1] } },
			]);
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				enableWorld: true,
				prompts,
				imgsz: 640,
			});
			expect(runner.downloadStatus.get("yolov8s-worldv2")).toBe("pending");

			const detections = await runner.detect(dummyImage());
			expect(fetches).toBe(1);
			expect(detections).toHaveLength(1);
			expect(detections[0].category).toBe("cyberpunk car");
			expect(detections[0].score).toBeCloseTo(0.92, 5);
			expect(runner.downloadStatus.get("yolov8s-worldv2")).toBe("ready");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("customModel config routes inference to custom session and classes", async () => {
		const customClasses = ["custom_gear", "rare_mineral"];
		const nc = customClasses.length;
		const out = new Float32Array(4 + nc);
		out[0] = 320;
		out[1] = 320;
		out[2] = 150;
		out[3] = 150;
		out[4 + 0] = 0.88; // "custom_gear"

		const provider = new ScriptedProvider([
			{ output0: { data: out, dims: [1, 4 + nc, 1] } },
		]);
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
		try {
			const runner = YoloVisionRunner.create({
				modelsDir: mkdtempSync(join(tmpdir(), "yolo-runner-")),
				provider,
				customModel: {
					url: "https://example.com/custom-yolo.onnx",
					task: "detect",
					classes: customClasses,
					imgsz: 640,
				},
			});

			const detections = await runner.detect(dummyImage());
			expect(detections).toHaveLength(1);
			expect(detections[0].category).toBe("custom_gear");
			expect(detections[0].score).toBeCloseTo(0.88, 5);
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
