import { describe, expect, it } from "vitest";
import {
	hasWebGPU,
	type OrtWebModule,
	type OrtWebSession,
	WebGPUProvider,
} from "./webgpu-provider.js";

class FakeOrtSession implements OrtWebSession {
	public readonly inputNames = ["input"];
	async run(): Promise<
		Record<string, { data: Float32Array; dims: readonly number[] }>
	> {
		return { output0: { data: new Float32Array([0.5]), dims: [1, 1, 1] } };
	}
	async release(): Promise<void> {}
}

function fakeModule(opts: { failWebGPU?: boolean } = {}) {
	const calls: { executionProviders: string[] }[] = [];
	const module: OrtWebModule = {
		InferenceSession: {
			async create(_bytes, options) {
				calls.push({ executionProviders: [...options.executionProviders] });
				if (opts.failWebGPU && options.executionProviders.includes("webgpu")) {
					throw new Error("webgpu unavailable");
				}
				return new FakeOrtSession();
			},
		},
		Tensor: class {
			constructor(
				public type: string,
				public data: Float32Array,
				public dims: readonly number[],
			) {}
		} as unknown as OrtWebModule["Tensor"],
	};
	return { module, calls };
}

describe("WebGPUProvider", () => {
	it("creates a session with the injected module and maps tensor outputs", async () => {
		const { module, calls } = fakeModule();
		let loads = 0;
		const provider = new WebGPUProvider({
			loader: async () => {
				loads++;
				return module;
			},
		});

		expect(provider.kind).toBe("webgpu");
		const session = await provider.createSession(new Uint8Array([1, 2, 3]));
		const outputs = await session.run({
			name: "input",
			data: new Float32Array(3 * 8 * 8),
			dims: [1, 3, 8, 8],
		});
		expect(outputs.output0.dims).toEqual([1, 1, 1]);
		expect(outputs.output0.data[0]).toBeCloseTo(0.5, 6);
		expect(calls[0].executionProviders).toEqual(["webgpu", "wasm"]);

		// loader is memoized across sessions
		await provider.createSession(new Uint8Array([1]));
		expect(loads).toBe(1);
	});

	it("falls back to wasm when the WebGPU session fails", async () => {
		const { module, calls } = fakeModule({ failWebGPU: true });
		const provider = new WebGPUProvider({ loader: async () => module });
		await provider.createSession(new Uint8Array([1]));
		expect(calls.map((c) => c.executionProviders)).toEqual([
			["webgpu", "wasm"],
			["wasm"],
		]);
	});

	it("does not fall back when disabled", async () => {
		const { module } = fakeModule({ failWebGPU: true });
		const provider = new WebGPUProvider({
			loader: async () => module,
			wasmFallback: false,
		});
		await expect(provider.createSession(new Uint8Array([1]))).rejects.toThrow(
			"webgpu unavailable",
		);
	});

	it("hasWebGPU() is false in Node", () => {
		expect(hasWebGPU()).toBe(false);
	});
});
