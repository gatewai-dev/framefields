import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	type GeometryOutlineOptions,
	Layer,
	Layer3D,
} from "./index.js";
import {
	computeMse,
	type DecodedImage,
	decodePngPixels,
	getPixel,
} from "./test-utils/pixels.js";

function stage(
	outlines: boolean | GeometryOutlineOptions = true,
	size = 256,
): Composition {
	const comp = new Composition({
		width: size,
		height: size,
		fps: 30,
		durationMs: 1000,
		backgroundColor: "#c5d8ed",
	});
	comp.add(
		Layer.environment("neutral", {
			intensity: 0,
			toneMapping: "none",
			outlines,
		}),
	);
	return comp;
}

async function render(comp: Composition): Promise<DecodedImage> {
	return decodePngPixels(await comp.renderFrame({ frame: 0 }));
}

function darkPixels(image: DecodedImage): number {
	let count = 0;
	for (let i = 0; i < image.pixels.length; i += 4) {
		if (
			image.pixels[i] < 50 &&
			image.pixels[i + 1] < 50 &&
			image.pixels[i + 2] < 50
		)
			count++;
	}
	return count;
}

describe("geometry outlines and art-directed lighting", () => {
	it("preserves MSAA coverage where two outlined surfaces meet", async () => {
		const draw = (antialias3d: boolean) => {
			const comp = stage({
				width: 2,
				referenceHeight: 256,
				color: "#000000",
				creaseAngle: 180,
			});
			comp.antialias3d = antialias3d;
			comp.add(
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					z: 100,
					width: 256,
					height: 256,
					is3D: true,
					background: "#ffffff",
					material: "unlit",
				}),
			);
			comp.add(
				Layer3D.sphere({
					x: 128.35,
					y: 128.35,
					radius: 61,
					segments: 128,
					color: "#ffffff",
					material: "unlit",
				}),
			);
			return render(comp);
		};
		const countCoverage = (image: DecodedImage) => {
			let count = 0;
			for (let y = 40; y < 216; y++)
				for (let x = 40; x < 216; x++) {
					const r = image.pixels[(y * image.width + x) * 4];
					if (r > 8 && r < 247) count++;
				}
			return count;
		};
		const hard = countCoverage(await draw(false));
		const smooth = countCoverage(await draw(true));
		expect(smooth).toBeGreaterThan(hard + 40);
	});
	it("inherits cube surface settings on custom artwork and preserves face overrides", () => {
		const front = Layer.box({ width: 80, height: 120, background: "#ffffff" });
		const back = Layer.box({
			width: 80,
			height: 120,
			outline: true,
			toon: { shadowColor: "#996655" },
		});
		const cube = Layer3D.cube({
			size: [80, 120, 60],
			material: "toon",
			toon: { shadowColor: "#778899", diffuse: 0.6 },
			outline: false,
			castShadow: true,
			faces: { front, back },
		});
		expect(cube.faces?.[0]).toMatchObject({
			toon: { shadowColor: "#778899", diffuse: 0.6 },
			outline: false,
			castShadow: true,
		});
		expect(cube.faces?.[1]).toMatchObject({
			toon: { shadowColor: "#996655" },
			outline: true,
		});
	});
	it("never makes diffuse toon light darker than its shadow floor", async () => {
		const draw = async (angle: number) => {
			const comp = new Composition({
				width: 128,
				height: 128,
				fps: 30,
				durationMs: 1000,
			});
			const radians = (angle * Math.PI) / 180;
			comp.add(
				Layer.directionalLight({
					x: 64 + Math.sin(radians) * 400,
					y: 64,
					z: -Math.cos(radians) * 400,
					targetX: 64,
					targetY: 64,
					targetZ: 0,
					color: "#ffffff",
					intensity: 1,
				}),
			);
			comp.add(
				Layer.box({
					position: "absolute",
					x: 32,
					y: 32,
					width: 64,
					height: 64,
					is3D: true,
					background: "#ffffff",
					material: "toon",
					toon: {
						shadowColor: "#cccccc",
						threshold: 0,
						softness: 0.25,
						diffuse: 1,
					},
				}),
			);
			return getPixel(await render(comp), 64, 64).r;
		};
		const shadow = await draw(120);
		const grazing = await draw(80);
		const angled = await draw(60);
		const front = await draw(0);
		expect(grazing).toBeGreaterThanOrEqual(shadow);
		expect(angled).toBeGreaterThanOrEqual(grazing);
		expect(front).toBeGreaterThanOrEqual(angled);
	});
	it("keeps an authored 3D pivot fixed and leaves identity placement unchanged", async () => {
		const draw = (anchorY: number, scale = 1) => {
			const comp = stage(false);
			comp.add(
				Layer.box({
					position: "absolute",
					is3D: true,
					x: 80,
					y: 60,
					width: 96,
					height: 96,
					anchorY,
					scale,
					background: "#ff3300",
					material: "unlit",
				}),
			);
			return render(comp);
		};
		const centered = await draw(0.5);
		const bottom = await draw(1);
		expect(computeMse(centered.pixels, bottom.pixels)).toBeLessThan(0.01);
		const scaled = await draw(1, 2);
		expect(getPixel(scaled, 128, 150).g).toBeLessThan(60);
		expect(getPixel(scaled, 128, 165).g).toBeGreaterThan(150);
	});
	it("round-trips the public material and scene options and rejects invalid settings", () => {
		const comp = stage({ width: 3, creaseAngle: 55, referenceHeight: 256 });
		comp.add(
			Layer3D.sphere({
				radius: 50,
				material: "toon",
				toon: { shadowColor: "#433966", softness: 0.1 },
				outline: false,
			}),
		);
		const parsed = CompositorProgramSchema.parse(comp.toSpec());
		expect(parsed.layout.find((node) => node.kind === "light")).toMatchObject({
			outlines: { width: 3, creaseAngle: 55, referenceHeight: 256 },
		});
		expect(parsed.layout.find((node) => node.kind === "model3d")).toMatchObject(
			{ outline: false, toon: { shadowColor: "#433966", softness: 0.1 } },
		);
		const invalid = comp.toSpec();
		const environment = invalid.layout.find((node) => node.kind === "light");
		if (environment?.kind !== "light") throw new Error("Missing environment");
		environment.outlines = { width: -1 };
		expect(CompositorProgramSchema.safeParse(invalid).success).toBe(false);
	});

	it("keeps off-center pivots stable inside preserve-3d containers", async () => {
		const draw = (anchorY: number) => {
			const comp = stage(false);
			comp.add(
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					width: 256,
					height: 256,
					is3D: true,
					transformStyle: "preserve-3d",
					children: [
						Layer.box({
							position: "absolute",
							x: 0,
							y: 0,
							width: 96,
							height: 96,
							is3D: true,
							anchorY,
							background: "#ff3300",
							material: "unlit",
						}),
					],
				}),
			);
			return render(comp);
		};
		const centered = await draw(0.5);
		const bottom = await draw(1);
		let painted = 0;
		for (let i = 0; i < centered.pixels.length; i += 4) {
			if (centered.pixels[i] > 240 && centered.pixels[i + 1] < 90) painted++;
		}
		expect(painted).toBeGreaterThan(500);
		expect(computeMse(centered.pixels, bottom.pixels)).toBeLessThan(0.01);
	});

	it("finds silhouettes and normal creases between identically colored faces", async () => {
		const draw = (creaseAngle: number, enabled: boolean) => {
			const comp = stage(
				enabled && { width: 2, referenceHeight: 256, creaseAngle },
			);
			comp.add(
				Layer3D.roundedBox({
					width: 110,
					height: 110,
					depth: 110,
					radius: 0,
					x: 128,
					y: 128,
					rotateY: 30,
					rotateX: 15,
					color: "#ffffff",
					material: "unlit",
				}),
			);
			return render(comp);
		};
		const plain = await draw(45, false);
		const silhouettes = await draw(180, true);
		const creases = await draw(45, true);
		expect(darkPixels(plain)).toBe(0);
		expect(darkPixels(silhouettes)).toBeGreaterThan(200);
		expect(darkPixels(creases)).toBeGreaterThan(darkPixels(silhouettes) + 60);
	});

	it("ignores artwork edges on a plane and preserves excluded foreground occlusion", async () => {
		const draw = (enabled: boolean) => {
			const comp = stage(enabled && { width: 3, referenceHeight: 256 });
			comp.add(
				Layer3D.roundedBox({
					width: 130,
					height: 130,
					depth: 100,
					radius: 0,
					x: 128,
					y: 128,
					rotateY: 30,
					color: "#ffffff",
					material: "unlit",
				}),
			);
			comp.add(
				Layer.box({
					position: "absolute",
					x: 85,
					y: 80,
					z: -120,
					width: 86,
					height: 96,
					is3D: true,
					material: "unlit",
					outline: false,
					background: "#f7e8ca",
					children: [
						Layer.box({
							position: "absolute",
							x: 40,
							y: 0,
							width: 5,
							height: 96,
							background: "#ee3311",
						}),
					],
				}),
			);
			return render(comp);
		};
		const plain = await draw(false);
		const ink = await draw(true);
		for (let y = 90; y <= 165; y += 5) {
			for (let x = 100; x <= 155; x += 5)
				expect(getPixel(ink, x, y)).toEqual(getPixel(plain, x, y));
		}
		expect(darkPixels(ink)).toBeGreaterThan(100);
	});

	it("scales line width with export resolution without inking texture seams", async () => {
		const line = async (scale: number) => {
			const comp = stage({ width: 3, referenceHeight: 256 }, 256 * scale);
			comp.add(
				Layer.box({
					position: "absolute",
					is3D: true,
					x: 64 * scale,
					y: 64 * scale,
					width: 128 * scale,
					height: 128 * scale,
					background: "#ffffff",
					material: "unlit",
					children: [
						Layer.box({
							position: "absolute",
							x: 60 * scale,
							y: 0,
							width: 8 * scale,
							height: 128 * scale,
							background: "#ff4422",
						}),
					],
				}),
			);
			const image = await render(comp);
			let width = 0;
			for (let x = 60 * scale; x < 80 * scale; x++)
				if (getPixel(image, x, 128 * scale).r < 50) width++;
			expect(getPixel(image, 123 * scale, 128 * scale).r).toBeGreaterThan(240);
			return width;
		};
		const small = await line(1);
		const large = await line(2);
		expect(small).toBeGreaterThanOrEqual(2);
		expect(large).toBeGreaterThanOrEqual(small * 2 - 1);
		expect(large).toBeLessThanOrEqual(small * 2 + 1);
	});

	it("does not draw false contours on a grazing plane", async () => {
		const comp = stage({
			width: 3,
			referenceHeight: 256,
			depthThreshold: 0.01,
		});
		comp.add(
			Layer.box({
				position: "absolute",
				is3D: true,
				x: -250,
				y: -250,
				width: 750,
				height: 750,
				background: "#ffffff",
				material: "unlit",
				rotateY: 55,
			}),
		);
		const image = await render(comp);
		for (let y = 90; y < 170; y += 10)
			for (let x = 90; x < 170; x += 10)
				expect(getPixel(image, x, y).r).toBeGreaterThan(240);
	});

	it("renders geometry ink without MSAA and makes zero-width outlines a no-op", async () => {
		const draw = (
			outlines: boolean | GeometryOutlineOptions,
			antialias3d: boolean,
		) => {
			const comp = stage(outlines);
			comp.antialias3d = antialias3d;
			comp.add(
				Layer3D.sphere({
					x: 128,
					y: 128,
					radius: 65,
					color: "#ffffff",
					material: "unlit",
				}),
			);
			return render(comp);
		};
		const plain = await draw(false, true);
		const zero = await draw({ width: 0 }, true);
		expect(computeMse(plain.pixels, zero.pixels)).toBeLessThan(0.01);
		const ink = await draw({ width: 3, referenceHeight: 256 }, false);
		expect(darkPixels(ink)).toBeGreaterThan(200);
	});

	it("applies point-light falloff and spot cones to toon surfaces", async () => {
		const draw = (spot: boolean) => {
			const comp = new Composition({
				width: 256,
				height: 256,
				fps: 30,
				durationMs: 1000,
			});
			const light = {
				x: 128,
				y: 128,
				z: -80,
				targetX: 128,
				targetY: 128,
				targetZ: 0,
				intensity: 1,
				radius: 250,
				decay: 1,
				color: "#ffffff",
				angle: 20,
				penumbra: 0.1,
			};
			comp.add(spot ? Layer.spotLight(light) : Layer.pointLight(light));
			comp.add(
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					width: 256,
					height: 256,
					is3D: true,
					background: "#ffffff",
					material: "toon",
					toon: { shadowColor: "#202040" },
				}),
			);
			return render(comp);
		};
		const point = await draw(false);
		const spot = await draw(true);
		expect(getPixel(point, 128, 128).r).toBeGreaterThan(
			getPixel(point, 220, 128).r + 20,
		);
		expect(getPixel(spot, 220, 128).r).toBeLessThan(
			getPixel(point, 220, 128).r - 50,
		);
		expect(getPixel(spot, 128, 128).r).toBeGreaterThan(150);
	});

	it("lights toon cards with colored direct lights beyond the eighth", async () => {
		const comp = new Composition({
			width: 256,
			height: 256,
			fps: 30,
			durationMs: 1000,
		});
		for (let i = 0; i < 9; i++)
			comp.add(
				Layer.directionalLight({
					x: 128,
					y: 128,
					z: -400,
					targetX: 128,
					targetY: 128,
					targetZ: 0,
					intensity: i === 8 ? 1 : 0,
					color: "#ff2200",
				}),
			);
		comp.add(
			Layer.box({
				position: "absolute",
				is3D: true,
				x: 64,
				y: 64,
				width: 128,
				height: 128,
				background: "#ffffff",
				material: "toon",
			}),
		);
		const pixel = getPixel(await render(comp), 128, 128);
		expect(pixel.r).toBeGreaterThan(230);
		expect(pixel.g).toBeLessThan(50);
		expect(pixel.b).toBeLessThan(10);
	});

	it("receives real cast shadows on toon cards with a controlled shadow tint", async () => {
		const draw = (castShadow: boolean) => {
			const comp = stage(false);
			comp.add(
				Layer.directionalLight({
					x: -150,
					y: -150,
					z: -450,
					targetX: 128,
					targetY: 128,
					targetZ: 0,
					intensity: 1,
					castShadow,
					shadowSoftness: 0,
					shadowMapSize: 1024,
				}),
			);
			comp.add(
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					z: 100,
					width: 256,
					height: 256,
					is3D: true,
					background: "#ffffff",
					material: "toon",
					toon: { shadowColor: "#303060" },
				}),
			);
			comp.add(
				Layer3D.roundedBox({
					x: 100,
					y: 100,
					z: 0,
					width: 55,
					height: 55,
					depth: 30,
					radius: 0,
					color: "#ff5555",
					material: "toon",
				}),
			);
			return render(comp);
		};
		const plain = await draw(false);
		const shadow = await draw(true);
		expect(computeMse(plain.pixels, shadow.pixels)).toBeGreaterThan(100);
		let tinted = 0;
		for (let i = 0; i < plain.pixels.length; i += 4)
			if (
				plain.pixels[i] > 240 &&
				shadow.pixels[i] < 160 &&
				shadow.pixels[i + 2] > shadow.pixels[i] * 1.5
			)
				tinted++;
		expect(tinted).toBeGreaterThan(100);
	});

	it("fogs toon materials and their outlines into the same environment", async () => {
		const comp = new Composition({
			width: 256,
			height: 256,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#b9cdea",
		});
		comp.add(
			Layer.environment("neutral", {
				intensity: 0,
				toneMapping: "none",
				outlines: { width: 3, referenceHeight: 256 },
				fog: { color: "#b9cdea", start: 0, end: 100 },
			}),
		);
		comp.add(
			Layer.directionalLight({
				x: 128,
				y: 128,
				z: -500,
				targetX: 128,
				targetY: 128,
			}),
		);
		comp.add(
			Layer3D.roundedBox({
				width: 100,
				height: 100,
				depth: 50,
				radius: 0,
				x: 128,
				y: 128,
				color: "#ff0000",
				material: "toon",
			}),
		);
		const image = await render(comp);
		expect(darkPixels(image)).toBe(0);
		const pixel = getPixel(image, 128, 128);
		expect(pixel.r).toBeCloseTo(185, -1);
		expect(pixel.b).toBeCloseTo(234, -1);
	});

	it("blends outline fog in the same linear-light space as surface fog", async () => {
		const draw = (outlines: boolean) => {
			const comp = new Composition({
				width: 256,
				height: 256,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#c8daf0",
			});
			comp.add(
				Layer.environment("neutral", {
					intensity: 0,
					toneMapping: "none",
					outlines: outlines && {
						color: "#1c438c",
						width: 3,
						referenceHeight: 256,
					},
					fog: { color: "#c8daf0", start: 100, end: 1000 },
				}),
			);
			comp.add(
				Layer.box({
					position: "absolute",
					x: 64,
					y: 64,
					width: 128,
					height: 128,
					is3D: true,
					material: "unlit",
					background: "#1c438c",
				}),
			);
			return render(comp);
		};
		const plain = await draw(false);
		const ink = await draw(true);
		// With ink the same color as the surface, fog must not reveal a seam.
		expect(computeMse(plain.pixels, ink.pixels)).toBeLessThan(0.1);
	});
});
