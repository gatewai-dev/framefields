/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
	SessionProvider,
	VisionModelStore,
	VisionTensorInput,
} from "@framefields/vision";
import { describe, expect, it } from "vitest";
import {
	ensureSamModelsRegistered,
	SAM_MODELS,
	SAM3_ENCODER,
} from "../models/registry.js";
import { holdSam3Encoder } from "./encoder.js";

function fakes() {
	const stats = { sessions: 0, runs: 0, released: 0, ensured: [] as string[] };
	const output = (n: number) => ({ data: new Float32Array(n), dims: [n] });
	const provider: SessionProvider = {
		kind: "webgpu",
		createSession: async () => {
			stats.sessions++;
			return {
				run: async () => ({}),
				runMany: async (_inputs: readonly VisionTensorInput[]) => {
					stats.runs++;
					return {
						"image_embeddings.0": output(4),
						"image_embeddings.1": output(4),
						"image_embeddings.2": output(4),
					};
				},
				release: () => {
					stats.released++;
				},
			};
		},
	};
	const store = {
		ensure: async (key: string) => {
			stats.ensured.push(key);
			return new Uint8Array(1);
		},
	} as unknown as VisionModelStore;
	return { provider, store, stats };
}

const frame = (value: number) => ({
	data: new Uint8Array(4 * 4 * 4).fill(value),
	width: 4,
	height: 4,
});

describe("shared SAM 3 encoder", () => {
	it("runs once per frame for every tracker on a provider, and frees with the last", async () => {
		const { provider, store, stats } = fakes();
		const [a, b] = await Promise.all([
			holdSam3Encoder(store, provider, "fp16"),
			holdSam3Encoder(store, provider, "fp16"),
		]);
		expect(stats.sessions).toBe(1);
		expect(stats.ensured).toEqual([
			"sam3-vision_encoder-fp16",
			"sam3-vision_encoder-fp16-data",
		]);
		// Separate decodes of one frame: equal pixels, different buffers.
		await Promise.all([a.encode(frame(7)), b.encode(frame(7))]);
		expect(stats.runs).toBe(1);
		await b.encode(frame(8));
		expect(stats.runs).toBe(2);
		a.release();
		a.release();
		expect(stats.released).toBe(0);
		b.release();
		expect(stats.released).toBe(1);
		await holdSam3Encoder(store, provider, "fp16");
		expect(stats.sessions).toBe(2);
	});

	it("keeps precisions apart", async () => {
		const { provider, store, stats } = fakes();
		await holdSam3Encoder(store, provider, "fp16");
		await holdSam3Encoder(store, provider, "q4");
		expect(stats.sessions).toBe(2);
	});
});

describe("SAM 3 encoder variants", () => {
	it("pins a graph and its weights for every precision a backend picks", () => {
		ensureSamModelsRegistered();
		const keys = new Set(SAM_MODELS.map((model) => model.key));
		for (const precision of Object.values(SAM3_ENCODER)) {
			expect(keys).toContain(`sam3-vision_encoder-${precision}`);
			expect(keys).toContain(`sam3-vision_encoder-${precision}-data`);
		}
		// q4f16 keeps the cache file names it was first downloaded under.
		expect(
			SAM_MODELS.find((m) => m.key === "sam3-vision_encoder-q4f16")?.filename,
		).toBe("sam3-vision_encoder_q4f16.onnx");
	});
});
