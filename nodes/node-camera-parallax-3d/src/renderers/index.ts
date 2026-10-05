import { defineRenderer } from "@framefields/node-sdk/renderer";
import { CameraParallax3DWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CameraParallax3DWebGPURenderer,
});
