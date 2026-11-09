/// <reference lib="dom" />
/// <reference types="webgpu" />
/**
 * Draws a composition's frames with WebGPU in a browser, as the export does
 * in Node: clocks set, the first frame (and any that first meets a LUT or a
 * glyph) drawn once ahead so uploads finish, each frame waiting for its LUTs
 * and exact video frame. The preview player and the on-device export draw
 * through it, so both show the same pixels.
 */
import {
	compositionStateStore,
	drawCompositionTree,
} from "@framefields/compositions";
import { updateClockSignals, type VirtualMediaData } from "@framefields/core";
import {
	type BrowserSurfaceProvider,
	getRenderer2D,
	lutStore,
	type RenderContextValue,
	SlugFontCache,
} from "@framefields/webgpu-renderers";

export interface FrameTiming {
	fps: number;
	durationMs: number;
}

export interface DrawTarget {
	/** Texture the frame is drawn into (its size is the surface's). */
	texture: GPUTexture;
	/** Records more work after the frame, in the same submit (e.g. a copy). */
	after?: (encoder: GPUCommandEncoder) => void;
}

export class FrameDrawer {
	private first = true;

	constructor(
		private readonly device: GPUDevice,
		private readonly surface: BrowserSurfaceProvider,
		private readonly vm: VirtualMediaData,
		private readonly timing: FrameTiming,
	) {}

	/** Draws the next frame as if it were the first (after caches were dropped). */
	restart(): void {
		this.first = true;
	}

	/** Draws `frame` into `target` and submits it. */
	async draw(
		frame: number,
		renderId: string,
		target: DrawTarget,
	): Promise<void> {
		const device = this.device;
		const surface = this.surface;
		const vm = this.vm;
		const { fps, durationMs } = this.timing;
		const renderer = getRenderer2D(device, surface.colorFormat);
		const ctx: RenderContextValue = { device, renderer, surface };
		const w = surface.width;
		const h = surface.height;
		const props = {
			frame,
			compositionFrame: frame,
			fps,
			isHeadless: false,
			renderId,
			virtualMedia: vm,
			containerWidth: w,
			containerHeight: h,
			// As the export decides it, so text entrances play the same.
			isVideoMode: vm.operation?.dataType === "Video",
			// Wait for LUTs and the exact video frame, never a stand-in.
			forceWait: true,
		};
		updateClockSignals(frame, fps, durationMs || undefined);

		// Shader, LUT and glyph uploads finish on a pass whose output is dropped.
		if (
			this.first ||
			lutStore.hasPending(device) ||
			SlugFontCache.hasPending()
		) {
			this.first = false;
			const pre = device.createCommandEncoder();
			const tex = renderer.getTemporaryTexture(w, h);
			const view = tex.createView();
			renderer
				.beginFrame(pre, view, { r: 0, g: 0, b: 0, a: 0 }, w, h, "clear")
				.end();
			await drawCompositionTree(ctx, pre, view, tex, w, h, vm, props);
			device.queue.submit([pre.finish()]);
			await lutStore.awaitAllPending(device);
		}

		compositionStateStore.setState(renderId, frame, fps, true);
		const encoder = device.createCommandEncoder();
		const view = target.texture.createView();
		renderer
			.beginFrame(encoder, view, { r: 0, g: 0, b: 0, a: 0 }, w, h, "clear")
			.end();
		await drawCompositionTree(
			ctx,
			encoder,
			view,
			target.texture,
			w,
			h,
			vm,
			props,
		);
		target.after?.(encoder);
		device.queue.submit([encoder.finish()]);
	}
}
