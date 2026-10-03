import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { YoloWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: YoloWebGPURenderer,
});
