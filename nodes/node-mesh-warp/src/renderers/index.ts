import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { MeshWarpWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: MeshWarpWebGPURenderer,
});
