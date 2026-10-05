import type { VirtualMediaData } from "@framefields/core";
import { describe, expect, it } from "vitest";
import { ensureDevice } from "../device.js";
import { WebGPUAudioProcessor } from "./webgpu-audio-processor.js";

const GAIN_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate  : f32,
    gain        : f32,
    baseTime    : f32,
    frame       : f32,
    numSamples  : f32,
    numChannels : f32,
    pad1        : f32,
    pad2        : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }
    
    let numSamples = u32(u.numSamples);
    let numChannels = u32(u.numChannels);
    let gain = u.gain;
    
    state[0] = state[0];
    
    for (var index = 0u; index < numSamples; index = index + 1u) {
        for (var c = 0u; c < numChannels; c = c + 1u) {
            let sampleIndex = c * numSamples + index;
            outputChannels[sampleIndex] = inputChannels[sampleIndex] * gain;
        }
    }
}
`;

describe("WebGPUAudioProcessor Caching and Execution", () => {
	it("should process audio correctly across consecutive calls using cached buffers", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (err) {
			console.warn(
				"Skipping WebGPU integration test due to missing driver/GPU environment.",
			);
			return;
		}

		const nodeId = "test-gain-node";
		const sampleRate = 48000;
		const virtualMedia = {
			id: "test-media",
			type: "audio",
			operation: {
				id: nodeId,
			},
		} as unknown as VirtualMediaData;

		// 1. First Call: 1024 samples, stereo
		const channels1 = [
			new Float32Array(1024).fill(0.5),
			new Float32Array(1024).fill(0.25),
		];

		await WebGPUAudioProcessor.process(
			device,
			nodeId,
			channels1,
			sampleRate,
			virtualMedia,
			0, // frame
			24, // fps
			GAIN_SHADER_TEMPLATE,
			() => [sampleRate, 2.0, 0.0, 0, 1024, 2, 0, 0],
			8, // uniformsFloatCount
			1, // stateFloatCount
		);

		// Expect gain of 2.0 to be applied correctly
		expect(channels1[0][0]).toBeCloseTo(1.0, 5);
		expect(channels1[1][0]).toBeCloseTo(0.5, 5);
		expect(channels1[0][1023]).toBeCloseTo(1.0, 5);
		expect(channels1[1][1023]).toBeCloseTo(0.5, 5);

		// 2. Second Call: 512 samples, stereo (should reuse cached buffers since they are larger/aligned)
		const channels2 = [
			new Float32Array(512).fill(0.5),
			new Float32Array(512).fill(0.25),
		];

		await WebGPUAudioProcessor.process(
			device,
			nodeId,
			channels2,
			sampleRate,
			virtualMedia,
			0,
			24,
			GAIN_SHADER_TEMPLATE,
			() => [sampleRate, 3.0, 0.0, 0, 512, 2, 0, 0],
			8,
			1,
		);

		// Expect gain of 3.0 to be applied correctly using cached buffers
		expect(channels2[0][0]).toBeCloseTo(1.5, 5);
		expect(channels2[1][0]).toBeCloseTo(0.75, 5);
		expect(channels2[0][511]).toBeCloseTo(1.5, 5);
		expect(channels2[1][511]).toBeCloseTo(0.75, 5);
	});
});
