import { resetDeviceInstance } from "@framefields/webgpu-renderers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PreviewPlayer, startPlayer } from "./player.js";

// Everything that draws is stubbed: these tests are about which GPU objects
// a player makes and frees. The device comes from the real `ensureDevice`.
const surfaces = vi.hoisted(() => [] as Array<{ device: unknown }>);
vi.mock("framefields-preview:renderers", () => ({
	BUILTIN_NODE_RENDERERS: [],
}));
vi.mock("@framefields/compositions", () => ({
	compositionStateStore: { setState: () => {} },
	drawCompositionTree: async () => {},
}));
vi.mock("@framefields/renderers", () => ({
	preloadCompositionFonts: async () => {},
}));
vi.mock("@framefields/vision/web", () => ({
	setDefaultSessionProvider: () => {},
	WebGPUProvider: class {},
}));
vi.mock("./blit.js", () => ({ Blitter: class {} }));
vi.mock("@framefields/webgpu-renderers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@framefields/webgpu-renderers")>()),
	BrowserSurfaceProvider: class {
		colorFormat = "bgra8unorm";
		width = 64;
		height = 36;
		destroyed = false;
		constructor(readonly device: unknown) {
			surfaces.push(this);
		}
		getCurrentTexture() {
			return texture();
		}
		present() {}
		destroy() {
			this.destroyed = true;
		}
	},
	getRenderer2D: () => ({
		getTemporaryTexture: () => texture(),
		beginFrame: () => ({ end: () => {} }),
	}),
	lutStore: { hasPending: () => false, awaitAllPending: async () => {} },
	SlugFontCache: { hasPending: () => false },
}));

const textures: Array<{ label?: string; destroy: ReturnType<typeof vi.fn> }> =
	[];
function texture(label?: string) {
	const t = { label, destroy: vi.fn(), createView: () => ({}) };
	textures.push(t);
	return t;
}

const composition = (width: number) => ({
	film: () => ({
		fps: 10,
		toVirtualMedia: () => ({
			metadata: { width, height: 36, durationMs: 1000 },
			operation: { op: "compose" },
		}),
	}),
});

function start(mod: Record<string, unknown>): Promise<PreviewPlayer> {
	startPlayer(mod, "film", { modelsDir: "", ortBase: "/ort/" });
	return window.framefieldsPlayer as Promise<PreviewPlayer>;
}

describe("startPlayer", () => {
	let requestDevice: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		resetDeviceInstance();
		surfaces.length = 0;
		textures.length = 0;
		const device = {
			lost: new Promise(() => {}),
			createTexture: (d: { label?: string }) => texture(d.label),
			createCommandEncoder: () => ({
				copyTextureToTexture: () => {},
				finish: () => ({}),
			}),
			queue: { submit: () => {}, onSubmittedWorkDone: async () => {} },
		};
		requestDevice = vi.fn(async () => device);
		vi.stubGlobal("navigator", {
			gpu: {
				requestAdapter: async () => ({
					features: new Set(),
					limits: {},
					requestDevice,
				}),
			},
		});
		vi.stubGlobal(
			"window",
			Object.assign(new EventTarget(), { framefieldsPlayer: undefined }),
		);
		const canvas = { width: 0, height: 0 };
		vi.stubGlobal("document", { getElementById: () => canvas });
		vi.stubGlobal("GPUTextureUsage", {
			RENDER_ATTACHMENT: 16,
			TEXTURE_BINDING: 4,
			COPY_DST: 2,
			COPY_SRC: 1,
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		resetDeviceInstance();
	});

	it("replaces the player on the same device and frees the old one's frames", async () => {
		const first = await start(composition(64));
		await first.render(0);
		await first.render(1);
		const cached = textures.filter((t) => t.label === "preview_frame_cache");
		expect(cached).toHaveLength(2);

		// A prop change: the page builds the composition again.
		const second = await start(composition(48));
		expect(requestDevice).toHaveBeenCalledTimes(1);
		expect(surfaces.map((s) => s.device)).toEqual([
			surfaces[0].device,
			surfaces[0].device,
		]);
		for (const t of cached) expect(t.destroy).toHaveBeenCalled();
		expect(surfaces[0]).toMatchObject({ destroyed: true });

		expect(second.meta.width).toBe(48);
		expect(await second.render(3)).toBe(3);
		// The old player draws no more.
		const before = textures.length;
		await first.render(4);
		expect(textures.length).toBe(before);
	});
});
