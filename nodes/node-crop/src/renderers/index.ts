import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { CropWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CropWebGPURenderer,
});
