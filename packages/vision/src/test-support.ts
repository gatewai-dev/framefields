/**
 * Offline test doubles shared by the package's unit tests (not part of any build entry).
 *
 * `ScriptedProvider` hands out sessions that replay canned model outputs, so runner, node
 * and analysis tests exercise real preprocessing + decoding without ONNX Runtime or network.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisionModelStore } from "./model/model-store.js";
import type {
	SessionProvider,
	VisionSession,
	VisionTensorInput,
	VisionTensorOutputs,
} from "./runtime/session-provider.js";

export class ScriptedSession implements VisionSession {
	public inputs: VisionTensorInput[] = [];
	constructor(private readonly outputs: VisionTensorOutputs) {}
	async run(input: VisionTensorInput): Promise<VisionTensorOutputs> {
		this.inputs.push({
			name: input.name,
			data: input.data.slice(),
			dims: [...input.dims],
		});
		return this.outputs;
	}
	release(): void {}
}

/** Replays `script[i]` for the i-th session created (one per model). */
export class ScriptedProvider implements SessionProvider {
	public readonly kind = "node" as const;
	public created: ScriptedSession[] = [];
	private readonly script: ScriptedSession[];
	constructor(script: readonly VisionTensorOutputs[]) {
		this.script = script.map((outputs) => new ScriptedSession(outputs));
	}
	async createSession(): Promise<VisionSession> {
		const session = this.script[this.created.length] ?? new ScriptedSession({});
		this.created.push(session);
		return session;
	}
}

/** A store that serves fake bytes from a temp dir and records every download URL. */
export function fakeStore(): { store: VisionModelStore; fetches: string[] } {
	const fetches: string[] = [];
	const store = new VisionModelStore({
		modelsDir: mkdtempSync(join(tmpdir(), "vision-test-")),
		baseUrl: "https://example.test/models",
		verify: false,
		fetchImpl: (async (url: unknown) => {
			fetches.push(String(url));
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as typeof fetch,
	});
	return { store, fetches };
}

export function grayImage(width = 640, height = 640) {
	return {
		data: new Uint8ClampedArray(width * height * 4).fill(128),
		width,
		height,
	};
}

/**
 * One COCO instance (default: person) at input box (220,170)–(420,470), score 0.9, with a
 * solid mask over input pixels 260..380 × 220..420.
 */
export function rtmdetInsOutput(
	opts: { label?: number; score?: number } = {},
): VisionTensorOutputs {
	const masks = new Float32Array(640 * 640);
	for (let y = 220; y < 420; y++) {
		for (let x = 260; x < 380; x++) masks[y * 640 + x] = 1;
	}
	return {
		dets: {
			data: new Float32Array([220, 170, 420, 470, opts.score ?? 0.9]),
			dims: [1, 1, 5],
		},
		labels: {
			data: new BigInt64Array([BigInt(opts.label ?? 0)]),
			dims: [1, 1],
		},
		masks: { data: masks, dims: [1, 1, 640, 640] },
	};
}

/** One person, box (220,170)–(420,470), nose at input (320, 200). */
export function rtmoOutput(score = 0.8): VisionTensorOutputs {
	const keypoints = new Float32Array(17 * 3);
	for (let k = 0; k < 17; k++) {
		keypoints[k * 3] = 320;
		keypoints[k * 3 + 1] = 200 + k * 15;
		keypoints[k * 3 + 2] = 0.9;
	}
	return {
		dets: {
			data: new Float32Array([220, 170, 420, 470, score]),
			dims: [1, 1, 5],
		},
		keypoints: { data: keypoints, dims: [1, 1, 17, 3] },
	};
}

/** Left half person (1), right half background (0). */
export function selfieOutput(width = 256, height = 256): VisionTensorOutputs {
	const alphas = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width / 2; x++) alphas[y * width + x] = 1;
	}
	return { alphas: { data: alphas, dims: [1, 1, height, width] } };
}
