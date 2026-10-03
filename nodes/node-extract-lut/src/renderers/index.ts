import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ExtractLutWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ExtractLutWebGPURenderer,
});
