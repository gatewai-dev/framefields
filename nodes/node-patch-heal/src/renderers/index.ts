import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { PatchHealWebGPURenderer } from "./webgpu-renderer.js";

export { PatchHealWebGPURenderer };

export default defineRenderer({
	WebGPURenderer: PatchHealWebGPURenderer,
});
