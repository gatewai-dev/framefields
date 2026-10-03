import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { CornerPinWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CornerPinWebGPURenderer,
});
