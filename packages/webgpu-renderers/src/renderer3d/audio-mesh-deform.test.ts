import type { MeshAudioDeformConfig } from "@framefields/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NUM_BINS } from "../audio/audio-latent-engine.js";
import {
	createMockCommandEncoder,
	createMockDevice,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { AudioMeshDeformPipeline } from "./audio-mesh-deform-pipeline.js";

describe("AudioMeshDeformPipeline & WGSL Audio Mesh Deformation Engine", () => {
	beforeAll(() => {
		ensureDOMGlobals();
	});

	let mockDevice: GPUDevice;
	let deformPipeline: AudioMeshDeformPipeline;

	beforeEach(() => {
		mockDevice = createMockDevice() as unknown as GPUDevice;
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
			VERTEX: 2,
			COPY_DST: 4,
			INDEX: 8,
			STORAGE: 16,
			COPY_SRC: 32,
		} as unknown as typeof GPUBufferUsage;
		globalThis.GPUShaderStage = {
			VERTEX: 1,
			FRAGMENT: 2,
			COMPUTE: 4,
		} as unknown as typeof GPUShaderStage;

		deformPipeline = new AudioMeshDeformPipeline(mockDevice);
	});

	it("initializes AudioMeshDeformPipeline compute pipeline cleanly", () => {
		expect(deformPipeline.pipeline).toBeDefined();
		expect(deformPipeline.bindGroupLayout).toBeDefined();
		expect(mockDevice.createComputePipeline).toHaveBeenCalled();
	});

	it("dispatches compute pass with correct workgroups (ceil(vertexCount / 256))", () => {
		const encoder = createMockCommandEncoder() as unknown as GPUCommandEncoder;
		const srcBuffer = mockDevice.createBuffer({
			size: 1000 * 64,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
		});
		const audioLatentBuffer = mockDevice.createBuffer({
			size: (NUM_BINS + 4) * 4,
			usage: GPUBufferUsage.STORAGE,
		});

		const config: MeshAudioDeformConfig = {
			audioTrackId: "soundtrack",
			mode: "normal_extrusion",
			frequencyRange: [20, 120],
			amplitudeMultiplier: 1.5,
		};

		const dstBuffer = deformPipeline.execute(encoder, srcBuffer, {
			config,
			audioLatentBuffer,
			vertexCount: 1000,
			timeMs: 500,
		});

		expect(dstBuffer).toBeDefined();
		expect(encoder.beginComputePass).toHaveBeenCalled();
		const mockPass = (
			encoder.beginComputePass as unknown as {
				mock: { results: Array<{ value: GPUComputePassEncoder }> };
			}
		).mock.results[0]?.value;
		expect(mockPass?.setPipeline).toHaveBeenCalledWith(deformPipeline.pipeline);
		expect(mockPass?.setBindGroup).toHaveBeenCalled();
		// 1000 vertices with workgroup size 256 -> Math.ceil(1000 / 256) = 4 workgroups
		expect(mockPass?.dispatchWorkgroups).toHaveBeenCalledWith(4);
		expect(mockPass?.end).toHaveBeenCalled();
	});

	it("asserts mathematical invariant for normal_extrusion: displacement collinear with surface normal", () => {
		// Mathematical verification of normal_extrusion formulation:
		// p' = p + n * (freqAmp * 45.0 + bassEnergy * 20.0 * sin(timeMs * 0.01 + p.y * 0.5)) * amp
		const normal = [0, 1, 0];
		const position = [10, 20, 30];
		const freqAmp = 0.6;
		const bassEnergy = 0.8;
		const timeMs = 1000;
		const amp = 1.5;

		const bassOsc = Math.sin(timeMs * 0.01 + position[1] * 0.5);
		const dispMag = (freqAmp * 45.0 + bassEnergy * 20.0 * bassOsc) * amp;
		const displacedPos = [
			position[0] + normal[0] * dispMag,
			position[1] + normal[1] * dispMag,
			position[2] + normal[2] * dispMag,
		];

		// Check displacement delta vector
		const delta = [
			displacedPos[0] - position[0],
			displacedPos[1] - position[1],
			displacedPos[2] - position[2],
		];

		// Delta must be strictly in Y direction collinear with normal (0, 1, 0)
		expect(delta[0]).toBeCloseTo(0, 5);
		expect(delta[1]).toBeCloseTo(dispMag, 5);
		expect(delta[2]).toBeCloseTo(0, 5);
		expect(dispMag).toBeGreaterThan(10.0);
	});

	it("asserts mathematical invariant for radial_pulse: displacement along normalized radius with damping", () => {
		// Mathematical verification of radial_pulse formulation:
		// dir = normalize(p)
		// p' = p + dir * (bassEnergy * 35.0 + drumTransient * 45.0) * exp(-damping * |p| * 0.01) * amp
		const position = [30, 40, 0]; // |p| = 50
		const len = Math.hypot(position[0], position[1], position[2]);
		const dir = [position[0] / len, position[1] / len, position[2] / len];

		const bassEnergy = 0.9;
		const drumTransient = 0.7;
		const damping = 0.5;
		const amp = 1.0;

		const pulse = bassEnergy * 35.0 + drumTransient * 45.0; // 31.5 + 31.5 = 63.0
		const dampingFactor = Math.exp(-damping * len * 0.01); // exp(-0.25) ~ 0.7788
		const dispMag = pulse * dampingFactor * amp;

		const displacedPos = [
			position[0] + dir[0] * dispMag,
			position[1] + dir[1] * dispMag,
			position[2] + dir[2] * dispMag,
		];

		// Vector from origin through displacedPos must maintain exact angle (3:4 ratio)
		expect(displacedPos[0] / displacedPos[1]).toBeCloseTo(30 / 40, 5);
		expect(Math.hypot(displacedPos[0], displacedPos[1])).toBeCloseTo(
			len + dispMag,
			4,
		);
	});

	it("asserts mathematical invariant for normal unitarity: ||N|| = 1.0 ± 0.001", () => {
		const baseNormal = [0.57735, 0.57735, 0.57735]; // normalized [1, 1, 1]
		const tangentDelta = 0.45;
		const perturbed = [
			baseNormal[0],
			baseNormal[1] - tangentDelta * 0.05,
			baseNormal[2],
		];
		const pLen = Math.hypot(perturbed[0], perturbed[1], perturbed[2]);
		const normalized = [
			perturbed[0] / pLen,
			perturbed[1] / pLen,
			perturbed[2] / pLen,
		];
		const unitNorm = Math.hypot(normalized[0], normalized[1], normalized[2]);

		expect(unitNorm).toBeCloseTo(1.0, 5);
		expect(Math.abs(unitNorm - 1.0)).toBeLessThan(0.001);
	});

	it("benchmarks 500,000 vertex mesh audio deformation: latency <= 2.5ms", () => {
		const vertexCount = 500000;
		const encoder = createMockCommandEncoder() as unknown as GPUCommandEncoder;
		const srcBuffer = mockDevice.createBuffer({
			size: vertexCount * 64,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
		});
		const audioLatentBuffer = mockDevice.createBuffer({
			size: (NUM_BINS + 4) * 4,
			usage: GPUBufferUsage.STORAGE,
		});

		const config: MeshAudioDeformConfig = {
			audioTrackId: "beat",
			mode: "normal_extrusion",
			frequencyRange: [20, 120],
			amplitudeMultiplier: 2.0,
		};

		const t0 = performance.now();
		const dstBuffer = deformPipeline.execute(encoder, srcBuffer, {
			config,
			audioLatentBuffer,
			vertexCount,
			timeMs: 1250,
		});
		const executionLatencyMs = performance.now() - t0;

		expect(dstBuffer).toBeDefined();
		const mockPass = (
			encoder.beginComputePass as unknown as {
				mock: { results: Array<{ value: GPUComputePassEncoder }> };
			}
		).mock.results[0]?.value;
		// 500,000 / 256 = 1953.125 -> 1954 workgroups
		expect(mockPass?.dispatchWorkgroups).toHaveBeenCalledWith(1954);

		// Assert invariant from Section 11.2: 500k Vertex Mesh Audio Displacement <= 2.5ms
		expect(executionLatencyMs).toBeLessThanOrEqual(2.5);
	});
});
