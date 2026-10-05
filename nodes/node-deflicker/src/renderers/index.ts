import { defineRenderer } from "@framefields/node-sdk/renderer";
import { TemporalDeflickerWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: TemporalDeflickerWebGPURenderer,
});
