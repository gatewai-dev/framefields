import { defineRenderer } from "@framefields/node-sdk/renderer";
import { MeshWarpWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: MeshWarpWebGPURenderer,
});
