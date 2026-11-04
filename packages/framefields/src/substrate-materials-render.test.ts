import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeHdr, parseExr } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	Signal,
} from "./index.js";
import type { Surface3DOptions } from "./shapes3d.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 200;
const H = 160;
const CX = W / 2;
const CY = H / 2;
const R = 56;

type SphereOptions = Surface3DOptions & {
	color?: string;
	roughness?: number;
	metallic?: number;
};

interface SceneOptions {
	sphere: SphereOptions;
	/** Key light direction, from the light toward the sphere (y down). */
	keyFrom?: [number, number, number];
	environment?: Parameters<typeof Layer.environment>;
}

async function render(o: SceneOptions): Promise<Uint8ClampedArray> {
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	const [lx, ly, lz] = o.keyFrom ?? [-0.6, -1, -0.8];
	comp.add([
		Layer.camera({
			x: CX,
			y: CY,
			z: -500,
			targetX: CX,
			targetY: CY,
			targetZ: 0,
		}),
		Layer.environment(...(o.environment ?? ["night", { intensity: 0.15 }])),
		Layer.directionalLight({
			x: CX + lx * 1000,
			y: CY + ly * 1000,
			z: lz * 1000,
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			intensity: 2.2,
			color: "#ffffff",
		}),
		Layer3D.sphere({
			x: CX,
			y: CY,
			z: 0,
			radius: R,
			segments: 64,
			...o.sphere,
		}),
	]);
	return (await decodePngPixels(await comp.renderFrame({ frame: 0 }))).pixels;
}

function sumDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	let total = 0;
	for (let i = 0; i < a.length; i++)
		total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
	return total;
}

interface Disc {
	cx: number;
	cy: number;
	r: number;
}

/** The sphere's on-screen disc: bounding box of every non-background pixel in `images`. */
function silhouette(...images: Uint8ClampedArray[]): Disc {
	let x0 = W;
	let y0 = H;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			const lit = images.some(
				(px) => (px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0) > 6,
			);
			if (!lit) continue;
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x);
			y1 = Math.max(y1, y);
		}
	}
	expect(x1).toBeGreaterThan(x0);
	return { cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, r: (x1 - x0 + 1) / 2 };
}

/** Mean RGB over pixels whose distance from the disc center lies in [r0, r1) * radius. */
function ringMean(
	px: Uint8ClampedArray,
	disc: Disc,
	r0: number,
	r1: number,
	filter: (dx: number, dy: number) => boolean = () => true,
): [number, number, number] {
	const sum = [0, 0, 0];
	let n = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x + 0.5 - disc.cx;
			const dy = y + 0.5 - disc.cy;
			const d = Math.hypot(dx, dy) / disc.r;
			if (d < r0 || d >= r1 || !filter(dx, dy)) continue;
			const i = (y * W + x) * 4;
			sum[0] += px[i] ?? 0;
			sum[1] += px[i + 1] ?? 0;
			sum[2] += px[i + 2] ?? 0;
			n++;
		}
	}
	expect(n).toBeGreaterThan(20);
	return [sum[0] / n, sum[1] / n, sum[2] / n];
}

function maxLuma(px: Uint8ClampedArray): number {
	let m = 0;
	for (let i = 0; i < px.length; i += 4) {
		m = Math.max(
			m,
			0.2126 * (px[i] ?? 0) +
				0.7152 * (px[i + 1] ?? 0) +
				0.0722 * (px[i + 2] ?? 0),
		);
	}
	return m;
}

const luma = ([r, g, b]: [number, number, number]) =>
	0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Equirectangular panorama: `sky` above the horizon, `ground` below. */
function splitPanorama(
	sky: [number, number, number],
	ground: [number, number, number],
) {
	const w = 64;
	const h = 32;
	const px = new Float32Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		const c = y < h / 2 ? sky : ground;
		for (let x = 0; x < w; x++) px.set([...c, 1], (y * w + x) * 4);
	}
	return encodeHdr(w, h, px);
}

describe("Phase 2: Substrate multi-lobe materials", () => {
	const roughRed: SphereOptions = {
		color: "#8a1020",
		roughness: 0.85,
		metallic: 0,
	};

	it("clearcoat adds a sharp varnish highlight over a rough base", async () => {
		const base = await render({ sphere: roughRed });
		const coated = await render({
			sphere: { ...roughRed, clearcoat: 1, clearcoatRoughness: 0.04 },
		});
		expect(maxLuma(coated)).toBeGreaterThan(maxLuma(base) + 40);
		expect(sumDiff(base, coated)).toBeGreaterThan(2000);
	});

	it("anisotropy stretches the highlight along a rotatable brush direction", async () => {
		const metal: SphereOptions = {
			color: "#c8ccd4",
			roughness: 0.35,
			metallic: 1,
		};
		const iso = await render({ sphere: metal });
		const brushed = await render({ sphere: { ...metal, anisotropy: 0.9 } });
		const turned = await render({
			sphere: { ...metal, anisotropy: 0.9, anisotropyRotation: 90 },
		});
		expect(sumDiff(iso, brushed)).toBeGreaterThan(15000);
		expect(sumDiff(brushed, turned)).toBeGreaterThan(15000);
	});

	it("subsurface bleeds tinted light past the terminator of a back-lit sphere", async () => {
		const wax: SphereOptions = { color: "#e8e0d0", roughness: 0.6 };
		const keyFrom: [number, number, number] = [0.9, -0.3, 1];
		const opaque = await render({ sphere: wax, keyFrom });
		const sss = await render({
			sphere: { ...wax, subsurface: 1, subsurfaceColor: "#ff5030" },
			keyFrom,
		});
		// The side facing the camera, away from the light.
		const shadowSide = (dx: number) => dx < 0;
		const disc = silhouette(opaque, sss);
		const before = ringMean(opaque, disc, 0, 0.95, shadowSide);
		const after = ringMean(sss, disc, 0, 0.95, shadowSide);
		expect(luma(after)).toBeGreaterThan(luma(before) + 4);
		// The bleed carries the subsurface tint: red rises more than blue.
		expect(after[0] - before[0]).toBeGreaterThan(after[2] - before[2]);
	});

	it("sheen lifts grazing angles more than the center (velvet rim)", async () => {
		const velvet: SphereOptions = { color: "#2a0a3a", roughness: 0.9 };
		const plain = await render({ sphere: velvet });
		const sheen = await render({
			sphere: {
				...velvet,
				sheen: 1,
				sheenColor: "#ffd0ff",
				sheenRoughness: 0.4,
			},
		});
		const disc = silhouette(plain, sheen);
		const rimGain =
			luma(ringMean(sheen, disc, 0.75, 0.97)) -
			luma(ringMean(plain, disc, 0.75, 0.97));
		const coreGain =
			luma(ringMean(sheen, disc, 0, 0.4)) - luma(ringMean(plain, disc, 0, 0.4));
		expect(rimGain).toBeGreaterThan(3);
		expect(rimGain).toBeGreaterThan(coreGain);
	});

	it("iridescence shifts reflected color with film thickness", async () => {
		const pearl: SphereOptions = {
			color: "#202020",
			roughness: 0.15,
			metallic: 0.2,
		};
		const env: SceneOptions["environment"] = ["studio", { intensity: 1 }];
		const plain = await render({ sphere: pearl, environment: env });
		const thin = await render({
			sphere: { ...pearl, iridescence: { intensity: 1, thickness: 300 } },
			environment: env,
		});
		const thick = await render({
			sphere: { ...pearl, iridescence: 1, iridescenceThickness: 700 },
			environment: env,
		});
		expect(sumDiff(plain, thin)).toBeGreaterThan(15000);
		const disc = silhouette(thin, thick);
		const a = ringMean(thin, disc, 0, 0.95);
		const b = ringMean(thick, disc, 0, 0.95);
		// Different film thickness: different interference color, not just brightness.
		const hueShift =
			Math.abs(a[0] - a[2] - (b[0] - b[2])) +
			Math.abs(a[1] - a[2] - (b[1] - b[2]));
		expect(hueShift).toBeGreaterThan(3);
	});

	it("primitives forward every lobe to the node and the spec stays schema-valid", () => {
		const clearcoat = Signal.fromArray([0, 1]);
		const sphere = Layer3D.sphere({
			radius: 40,
			clearcoat,
			clearcoatRoughness: 0.1,
			anisotropy: 0.5,
			anisotropyRotation: 30,
			subsurface: 0.4,
			subsurfaceColor: "#ff8060",
			sheen: 0.3,
			sheenColor: "#ffffff",
			sheenRoughness: 0.6,
			iridescence: { intensity: 0.8, thickness: 420, ior: 1.4 },
			triplanar: { scale: 2, sharpness: 6 },
		});
		expect(sphere).toMatchObject({
			clearcoat: 0,
			clearcoatRoughness: 0.1,
			anisotropy: 0.5,
			anisotropyRotation: 30,
			subsurface: 0.4,
			subsurfaceColor: "#ff8060",
			sheen: 0.3,
			sheenColor: "#ffffff",
			sheenRoughness: 0.6,
			iridescence: { intensity: 0.8, thickness: 420, ior: 1.4 },
			triplanar: { scale: 2, sharpness: 6 },
		});
		// The Signal became a track; the node keeps the static fallback.
		expect(sphere.animation?.tracks.map((t) => t.prop)).toContain("clearcoat");

		const comp = new Composition({
			width: 64,
			height: 64,
			fps: 30,
			durationFrames: 2,
		});
		comp.add([Layer.environment("studio"), sphere]);
		expect(CompositorProgramSchema.safeParse(comp.toSpec()).success).toBe(true);
	});
});

describe("Phase 2: HDRI environments", () => {
	const chrome: SphereOptions = {
		color: "#ffffff",
		roughness: 0.05,
		metallic: 1,
	};
	const top = (dx: number, dy: number) => dy < -Math.abs(dx) * 0.5;

	it("reflects the panorama: swapping sky and ground swaps the sphere's colors", async () => {
		const red: [number, number, number] = [2, 0.05, 0.05];
		const blue: [number, number, number] = [0.05, 0.05, 2];
		const redSky = await render({
			sphere: chrome,
			environment: [{ hdri: splitPanorama(red, blue), intensity: 1 }],
		});
		const blueSky = await render({
			sphere: chrome,
			environment: [{ hdri: splitPanorama(blue, red), intensity: 1 }],
		});
		const disc = silhouette(redSky, blueSky);
		const a = ringMean(redSky, disc, 0.1, 0.9, top);
		const b = ringMean(blueSky, disc, 0.1, 0.9, top);
		expect(a[0] - a[2]).toBeGreaterThan(40);
		expect(b[2] - b[0]).toBeGreaterThan(40);
	});

	it("takes a .hdr path in place of a preset name, intensity included", async () => {
		const dir = mkdtempSync(join(tmpdir(), "framefields-hdri-"));
		const file = join(dir, "warm.hdr") as `${string}.hdr`;
		writeFileSync(file, splitPanorama([1.6, 1.0, 0.4], [0.3, 0.2, 0.1]));

		const node = Layer.environment(file, { intensity: 1.5 });
		expect(node).toMatchObject({
			lightType: "environment",
			hdri: file,
			intensity: 1.5,
		});

		const preset = await render({ sphere: chrome, environment: ["studio"] });
		const fromPath = await render({ sphere: chrome, environment: [file] });
		const brighter = await render({
			sphere: chrome,
			environment: [file, { intensity: 2 }],
		});
		expect(sumDiff(preset, fromPath)).toBeGreaterThan(20000);
		const disc = silhouette(fromPath, brighter);
		expect(luma(ringMean(brighter, disc, 0, 0.9))).toBeGreaterThan(
			luma(ringMean(fromPath, disc, 0, 0.9)) + 5,
		);
	});

	it("lights from an OpenEXR panorama exactly as from the same pixels in .hdr", async () => {
		// A ZIP-compressed half-float EXR written by the reference OpenEXR library.
		const exr = join(
			import.meta.dirname,
			"../../webgpu-renderers/src/loaders/__fixtures__/exr/zip-half.exr",
		) as `${string}.exr`;
		const image = parseExr(new Uint8Array(readFileSync(exr)));
		const hdr = join(
			mkdtempSync(join(tmpdir(), "framefields-exr-")),
			"same.hdr",
		) as `${string}.hdr`;
		writeFileSync(hdr, encodeHdr(image.width, image.height, image.data));

		const fromExr = await render({ sphere: chrome, environment: [exr] });
		const fromHdr = await render({ sphere: chrome, environment: [hdr] });
		const preset = await render({ sphere: chrome, environment: ["studio"] });
		const disc = silhouette(fromExr, fromHdr);
		const a = ringMean(fromExr, disc, 0, 0.9);
		const b = ringMean(fromHdr, disc, 0, 0.9);
		// RGBE keeps 8 mantissa bits: the two agree to within a level or two.
		for (let c = 0; c < 3; c++)
			expect(Math.abs((a[c] ?? 0) - (b[c] ?? 0))).toBeLessThan(2);
		expect(sumDiff(fromExr, preset)).toBeGreaterThan(
			20 * sumDiff(fromExr, fromHdr),
		);
	});
});
