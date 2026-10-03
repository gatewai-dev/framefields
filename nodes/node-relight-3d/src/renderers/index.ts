import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { Relight3DWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: Relight3DWebGPURenderer,
});
