import { describe, expect, it } from "vitest";
import {
	CameraAnimation,
	type CameraNode,
	Composition,
	Layer,
	Layer3D,
} from "./index.js";
import { computeMse, decodePngPixels, getPixel } from "./test-utils/pixels.js";

const EYE = { x: 400, y: 300, z: 0 } as const;
const DISTANCE = 800;

/** Unlit markers in the six axis directions around the eye. */
const MARKERS = [
	{ id: "front", dir: [0, 0, 1], color: "#ff0000" },
	{ id: "back", dir: [0, 0, -1], color: "#00ffff" },
	{ id: "right", dir: [1, 0, 0], color: "#00ff00" },
	{ id: "left", dir: [-1, 0, 0], color: "#0000ff" },
	{ id: "up", dir: [0, -1, 0], color: "#ffff00" },
	{ id: "down", dir: [0, 1, 0], color: "#ff00ff" },
] as const;

function scene(
	width: number,
	height: number,
	camera: Partial<CameraNode>,
	markers: readonly (typeof MARKERS)[number][] = MARKERS,
) {
	const comp = new Composition({
		width,
		height,
		fps: 30,
		durationMs: 1000,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: EYE.x,
			y: EYE.y,
			z: EYE.z,
			targetX: EYE.x,
			targetY: EYE.y,
			targetZ: EYE.z + 1000,
			...camera,
		}),
		Layer.ambientLight("#ffffff", 1),
		...markers.map((m) =>
			Layer3D.sphere({
				id: m.id,
				radius: 150,
				x: EYE.x + m.dir[0] * DISTANCE,
				y: EYE.y + m.dir[1] * DISTANCE,
				z: EYE.z + m.dir[2] * DISTANCE,
				color: m.color,
				material: "unlit",
			}),
		),
	]);
	return comp;
}

const near = (
	p: { r: number; g: number; b: number },
	hex: string,
	tolerance = 40,
) => {
	const v = Number.parseInt(hex.slice(1), 16);
	return (
		Math.abs(p.r - ((v >> 16) & 255)) <= tolerance &&
		Math.abs(p.g - ((v >> 8) & 255)) <= tolerance &&
		Math.abs(p.b - (v & 255)) <= tolerance
	);
};

/** Mean x of the pixels close to `hex`. */
function centroidX(
	img: Awaited<ReturnType<typeof decodePngPixels>>,
	hex: string,
): number {
	let sum = 0;
	let count = 0;
	for (let y = 0; y < img.height; y += 2) {
		for (let x = 0; x < img.width; x += 2) {
			if (near(getPixel(img, x, y), hex)) {
				sum += x;
				count++;
			}
		}
	}
	return count ? sum / count : Number.NaN;
}

describe("cube cameras", () => {
	it("draws the whole sphere around the eye as an equirectangular panorama", async () => {
		const img = await decodePngPixels(
			await scene(1024, 512, {
				lens: { projection: "equirectangular" },
			}).renderFrame({ frame: 0 }),
		);
		// Forward in the middle, right and left a quarter turn either side,
		// behind at both edges, up at the top and down at the bottom.
		expect(near(getPixel(img, 512, 256), "#ff0000")).toBe(true);
		expect(near(getPixel(img, 768, 256), "#00ff00")).toBe(true);
		expect(near(getPixel(img, 256, 256), "#0000ff")).toBe(true);
		expect(near(getPixel(img, 3, 256), "#00ffff")).toBe(true);
		expect(near(getPixel(img, 1020, 256), "#00ffff")).toBe(true);
		expect(near(getPixel(img, 512, 6), "#ffff00")).toBe(true);
		expect(near(getPixel(img, 512, 505), "#ff00ff")).toBe(true);
		// Between markers: empty sky.
		expect(near(getPixel(img, 640, 256), "#000000", 10)).toBe(true);
	});

	it("matches the ordinary camera at rest", async () => {
		const plain = scene(640, 360, { lens: { fov: 60 } }, [MARKERS[0]]);
		const cube = scene(
			640,
			360,
			{ lens: { fov: 60 }, relativity: { speed: 0 } },
			[MARKERS[0]],
		);
		const a = await decodePngPixels(await plain.renderFrame({ frame: 0 }));
		const b = await decodePngPixels(await cube.renderFrame({ frame: 0 }));
		expect(near(getPixel(b, 320, 180), "#ff0000")).toBe(true);
		// Resampling softens the sphere's edge by a pixel at most.
		expect(computeMse(a.pixels, b.pixels)).toBeLessThan(40);
	});

	it("aberrates the view towards the direction of motion", async () => {
		// A marker 70° to the right: at rest, outside a 100° view even counting
		// its 10.8° angular radius.
		const angle = (70 * Math.PI) / 180;
		const side = {
			id: "side",
			dir: [Math.sin(angle), 0, Math.cos(angle)],
			color: "#00ff00",
		} as unknown as (typeof MARKERS)[number];
		const render = (speed: number) =>
			scene(
				600,
				600,
				{
					lens: { fov: 100 },
					relativity: { speed, doppler: false, beaming: false },
				},
				[side],
			).renderFrame({ frame: 0 });
		const rest = await decodePngPixels(await render(0));
		expect(Number.isNaN(centroidX(rest, "#00ff00"))).toBe(true);
		// At β = 0.8 it is seen at cos θ' = (cos θ + β) / (1 + β cos θ) ≈ 26.3°.
		const beta = 0.8;
		const seen = Math.acos(
			(Math.cos(angle) + beta) / (1 + beta * Math.cos(angle)),
		);
		const fast = await decodePngPixels(await render(beta));
		const expected =
			300 + (300 * Math.tan(seen)) / Math.tan((50 * Math.PI) / 180);
		expect(centroidX(fast, "#00ff00")).toBeCloseTo(expected, -1);
	});

	it("shifts light blue ahead and red behind", async () => {
		const grey = [
			{ id: "ahead", dir: [0, 0, 1], color: "#808080" },
			{ id: "behind", dir: [0, 0, -1], color: "#808080" },
		] as unknown as (typeof MARKERS)[number][];
		const render = (relativity: CameraNode["relativity"]) =>
			scene(
				1024,
				512,
				{ lens: { projection: "equirectangular" }, relativity },
				grey,
			).renderFrame({ frame: 0 });
		const sum = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b;
		const hue = await decodePngPixels(
			await render({ speed: 0.3, beaming: false, exposure: 0 }),
		);
		const ahead = getPixel(hue, 512, 256);
		const behind = getPixel(hue, 2, 256);
		expect(ahead.b).toBeGreaterThan(ahead.r + 20);
		expect(behind.r).toBeGreaterThan(behind.b + 20);
		// True brightness: beaming brightens ahead and dims behind.
		const beamed = await decodePngPixels(
			await render({ speed: 0.3, exposure: 0 }),
		);
		expect(sum(getPixel(beamed, 512, 256))).toBeGreaterThan(sum(ahead));
		expect(sum(getPixel(beamed, 2, 256))).toBeLessThan(sum(behind));
		// Auto exposure meters the centre: ahead keeps its brightness at rest.
		const metered = await decodePngPixels(await render({ speed: 0.3 }));
		const luma = (p: { r: number; g: number; b: number }) =>
			0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
		expect(luma(getPixel(metered, 512, 256))).toBeCloseTo(128, -1.3);
	});

	it("animates the speed with relativitySpeed", async () => {
		const angle = (70 * Math.PI) / 180;
		const side = {
			id: "side",
			dir: [Math.sin(angle), 0, Math.cos(angle)],
			color: "#00ff00",
		} as unknown as (typeof MARKERS)[number];
		const comp = scene(
			600,
			600,
			{
				lens: { fov: 100 },
				relativity: { doppler: false, beaming: false },
				animation: CameraAnimation.camera().fromTo("relativitySpeed", 0, 0.8, {
					start: 0,
					end: 10,
					ease: "none",
				}),
			},
			[side],
		);
		const rest = await decodePngPixels(await comp.renderFrame({ frame: 0 }));
		const fast = await decodePngPixels(await comp.renderFrame({ frame: 10 }));
		expect(Number.isNaN(centroidX(rest, "#00ff00"))).toBe(true);
		expect(centroidX(fast, "#00ff00")).toBeGreaterThan(300);
	});

	it("sees behind the camera with a 360° fisheye", async () => {
		const img = await decodePngPixels(
			await scene(600, 600, {
				lens: { projection: "fisheye", fov: 360 },
			}).renderFrame({ frame: 0 }),
		);
		expect(near(getPixel(img, 300, 300), "#ff0000")).toBe(true);
		// Behind the eye is the rim of the circle; outside it, nothing.
		expect(near(getPixel(img, 300, 4), "#00ffff")).toBe(true);
		expect(near(getPixel(img, 300, 596), "#00ffff")).toBe(true);
		expect(getPixel(img, 10, 10).a).toBe(255);
		expect(near(getPixel(img, 10, 10), "#000000", 10)).toBe(true);
		// Right, at 90°, is halfway out.
		expect(near(getPixel(img, 450, 300), "#00ff00")).toBe(true);
	});

	it("draws volumetric fog on every face", async () => {
		const foggy = (fog: boolean) => {
			const comp = scene(
				800,
				400,
				{ lens: { projection: "equirectangular" } },
				[],
			);
			comp.add([
				// Something to draw, off every sampled direction: an empty batch has no 3D pass.
				Layer3D.sphere({
					radius: 20,
					x: EYE.x + 500,
					y: EYE.y + 500,
					z: EYE.z + 500,
					color: "#ffffff",
				}),
				Layer.environment("neutral", {
					...(fog && {
						volumetricFog: {
							density: 0.05,
							ambientIntensity: 0.6,
							maxDistance: 3000,
						},
					}),
				}),
				Layer.directionalLight({
					x: 0,
					y: -2000,
					z: -1000,
					targetX: EYE.x,
					targetY: EYE.y,
					targetZ: EYE.z,
				}),
			]);
			return comp;
		};
		const clear = await decodePngPixels(
			await foggy(false).renderFrame({ frame: 0 }),
		);
		const fogged = await decodePngPixels(
			await foggy(true).renderFrame({ frame: 0 }),
		);
		const lum = (img: typeof clear, x: number, y: number) => {
			const p = getPixel(img, x, y);
			return p.r + p.g + p.b;
		};
		// Ahead, behind, left, right, above and below: each face is in the fog.
		for (const [x, y] of [
			[400, 200],
			[10, 200],
			[200, 200],
			[600, 200],
			[400, 20],
			[400, 380],
		] as const) {
			expect(lum(clear, x, y), `${x},${y}`).toBeLessThan(10);
			expect(lum(fogged, x, y), `${x},${y}`).toBeGreaterThan(30);
		}
	});

	it("refuses motion blur, which needs one perspective view", async () => {
		await expect(
			scene(400, 200, {
				lens: { projection: "equirectangular" },
				motionBlur: true,
			}).renderFrame({ frame: 3 }),
		).rejects.toThrow(/motion blur/);
	});

	it("draws glass on its faces, refracting the 3D scene", async () => {
		const withGlass = (glass: boolean) => {
			const comp = scene(800, 400, { lens: { projection: "equirectangular" } });
			if (glass)
				comp.add(
					Layer3D.sphere({
						radius: 160,
						x: EYE.x,
						y: EYE.y,
						z: EYE.z + 400,
						material: "glass",
					}),
				);
			return comp;
		};
		const plain = await decodePngPixels(
			await withGlass(false).renderFrame({ frame: 0 }),
		);
		const glassy = await decodePngPixels(
			await withGlass(true).renderFrame({ frame: 0 }),
		);
		expect(computeMse(plain.pixels, glassy.pixels)).toBeGreaterThan(5);
	});
});
