import type { Renderer2D } from "./renderer2d/index.js";
import type { SurfaceProvider } from "./surface-provider.js";

export interface RenderContextValue {
	device: GPUDevice;
	renderer: Renderer2D;
	surface: SurfaceProvider;
}
