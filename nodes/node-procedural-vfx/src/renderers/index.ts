import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ProceduralVFXWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ProceduralVFXWebGPURenderer,
});
export { ProceduralVFXWebGPURenderer };
