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
	const calls: {
		executionProviders: string[];
		raw: unknown[];
		devices: unknown[];
	}[] = [];
	const fromGpuBuffer: unknown[] = [];
	const name = (ep: string | { name: string }) =>
		typeof ep === "string" ? ep : ep.name;
	const module: OrtWebModule = {
		InferenceSession: {
			async create(_bytes, options) {
				const providers = options.executionProviders.map(name);
				calls.push({
					executionProviders: providers,
					raw: [...options.executionProviders],
					devices: options.executionProviders.map((p) =>
						typeof p === "string" ? undefined : p.device,
					),
				});
				if (opts.failWebGPU && providers.includes("webgpu")) {
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
			static fromGpuBuffer(buffer: unknown) {
				fromGpuBuffer.push(buffer);
				return { buffer };
			}
		} as unknown as OrtWebModule["Tensor"],
	};
	return { module, calls, fromGpuBuffer };
}

describe("WebGPUProvider", () => {
	it("makes one ORT call at a time per runtime, as its WebGPU build requires", async () => {
		const { module } = fakeModule();
		// The real runtime throws on a concurrent create and corrupts its heap on a concurrent run.
		let busy = false;
		const exclusive = async <T>(call: () => Promise<T>): Promise<T> => {
			if (busy) throw new Error("concurrent ORT call");
			busy = true;
			await new Promise((resolve) => setTimeout(resolve, 5));
			busy = false;
			return call();
		};
		const create = module.InferenceSession.create;
		module.InferenceSession.create = (bytes, options) =>
			exclusive(async () => {
				const session = await create(bytes, options);
				const run = session.run.bind(session);
				return {
					...session,
					inputNames: ["input"],
					run: (feeds) => exclusive(() => run(feeds)),
				};
			});
		const providers = [1, 2, 3].map(
			() => new WebGPUProvider({ loader: async () => module }),
		);
		const sessions = await Promise.all(
			providers.map((p) => p.createSession(new Uint8Array([1]))),
		);
		const input = { name: "input", data: new Float32Array([1]), dims: [1] };
		await expect(
			Promise.all(sessions.map((session) => session.run(input))),
		).resolves.toHaveLength(3);
	});

	it("passes multiple named float and integer tensors without renaming", async () => {
		const { module } = fakeModule();
		let feeds: Record<string, unknown> = {};
		const baseCreate = module.InferenceSession.create;
		const provider = new WebGPUProvider({
			loader: async () => ({
				...module,
				InferenceSession: {
					create: async (bytes, options) => {
						const session = await baseCreate(bytes, options);
						return {
							...session,
							inputNames: ["features", "labels"],
							run: async (input: Record<string, unknown>) => {
								feeds = input;
								return {};
							},
							release: async () => {},
						};
					},
				},
			}),
		});
		const session = await provider.createSession(new Uint8Array([1]));
		await session.runMany?.([
			{ name: "features", data: new Float32Array([1]), dims: [1] },
			{ name: "labels", data: new Int32Array([2]), dims: [1] },
		]);
		expect(feeds.features).toMatchObject({
			type: "float32",
			data: new Float32Array([1]),
		});
		expect(feeds.labels).toMatchObject({
			type: "int32",
			data: new Int32Array([2]),
		});
	});

	it("runs sessions on a given device and feeds GPU-buffer inputs", async () => {
		const { module, calls, fromGpuBuffer } = fakeModule();
		const device = { label: "renderer" } as unknown as GPUDevice;
		const provider = new WebGPUProvider({ loader: async () => module, device });
		expect(provider.device).toBe(device);
		const session = await provider.createSession(new Uint8Array([1]));
		expect(calls[0]?.devices).toEqual([device, undefined]);
		const buffer = { label: "input" } as unknown as GPUBuffer;
		await session.run({
			name: "input",
			data: new Float32Array(0),
			gpuBuffer: buffer,
			dims: [1, 3, 8, 8],
		});
		expect(fromGpuBuffer).toEqual([buffer]);
	});

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
		// NHWC miscomputes grouped convs with channels/group not a multiple of 4 (RTMO)
		expect(calls[0].raw[0]).toEqual({
			name: "webgpu",
			preferredLayout: "NCHW",
		});

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
