import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { TemporalDeflickerWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: TemporalDeflickerWebGPURenderer,
});
