import { defineRenderer } from "@framefields/node-sdk/renderer";
import { PatchHealWebGPURenderer } from "./webgpu-renderer.js";

export { PatchHealWebGPURenderer };

export default defineRenderer({
	WebGPURenderer: PatchHealWebGPURenderer,
});
