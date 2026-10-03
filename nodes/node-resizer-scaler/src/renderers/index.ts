import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ResizerScalerWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ResizerScalerWebGPURenderer,
});
