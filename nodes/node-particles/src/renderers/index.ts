import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ParticlesWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ParticlesWebGPURenderer,
});
export { ParticlesWebGPURenderer };
