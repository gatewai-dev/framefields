import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { RefractionCaustics3DWebGPURenderer } from "./webgpu-renderer.js";

export { RefractionCaustics3DWebGPURenderer };

export default defineRenderer({
	WebGPURenderer: RefractionCaustics3DWebGPURenderer,
});
