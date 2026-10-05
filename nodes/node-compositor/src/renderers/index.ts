import { defineRenderer } from "@framefields/node-sdk/renderer";
import { CompositorWebGPURenderer } from "./webgpu-renderer.js";
import "./audio-processor.js";

export default defineRenderer({
	WebGPURenderer: CompositorWebGPURenderer,
});

export * from "./transform3d.js";
