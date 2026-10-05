import { defineRenderer } from "@framefields/node-sdk/renderer";
import { CornerPinWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CornerPinWebGPURenderer,
});
