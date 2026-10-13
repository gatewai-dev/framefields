import { describe, expect, it } from "vitest";
import { lintComposition } from "./lint.js";

const base = { width: 1920, height: 1080, backgroundColor: "#000000" };
const codes = (layout: unknown[], extra = {}) =>
	lintComposition({ ...base, ...extra, layout: layout as never }).map(
		(d) => d.code,
	);

describe("lintComposition", () => {
	it("flags unreadable colors and gradients", () => {
		expect(
			codes([
				{ id: "a", kind: "box", background: "lienar-gradient(red, blue)" },
			]),
		).toEqual(["invalid_gradient"]);
		expect(codes([{ id: "a", kind: "box", background: "#ff5a1" }])).toEqual([
			"unknown_color",
		]);
		expect(
			codes([
				{
					id: "a",
					kind: "box",
					background: "linear-gradient(to right, nope, blue)",
				},
			]),
		).toEqual(["invalid_gradient"]);
		expect(
			codes([{ id: "a", kind: "box", background: "oklch(0.7 0.1 200)" }]),
		).toEqual([]);
	});

	it("flags text that disappears into its backdrop", () => {
		const layout = [
			{
				id: "card",
				kind: "box",
				background: "#ffffff",
				children: [{ id: "t", kind: "text", fill: "#eeeeee" }],
			},
		];
		expect(codes(layout)).toContain("low_contrast_text");
		expect(codes([{ id: "t", kind: "text", fill: "#ffffff" }])).toEqual([]);
	});

	it("does not judge text drawn over an image or panel it cannot see", () => {
		const overImage = [
			{ id: "photo", kind: "image", src: "a.png" },
			{ id: "t", kind: "text", fill: "#ffffff" },
		];
		expect(codes(overImage, { backgroundColor: "#ffffff" })).not.toContain(
			"low_contrast_text",
		);
		const onPanel = [
			{ id: "panel", kind: "box", background: "#ffffff" },
			{ id: "t", kind: "text", fill: "#ffffff", zIndex: -1 },
		];
		// Drawn before the panel (lower z): the backdrop is still known.
		expect(codes(onPanel, { backgroundColor: "#ffffff" })).toContain(
			"low_contrast_text",
		);
	});

	it("flags static layers parked off-canvas, but not ones that move in", () => {
		const off = {
			id: "o",
			kind: "box",
			position: "absolute",
			x: 2000,
			y: 0,
			width: 100,
			height: 100,
		};
		expect(codes([off])).toContain("offscreen_layer");
		expect(
			codes([
				{
					...off,
					animation: {
						tracks: [
							{
								prop: "x",
								keyframes: [
									{ frame: 0, value: 2000 },
									{ frame: 10, value: 0 },
								],
							},
						],
					},
				},
			]),
		).not.toContain("offscreen_layer");
	});

	it("flags lights and materials that do nothing", () => {
		const c = codes([
			{ id: "p", kind: "light", lightType: "point", castShadow: true },
			{ id: "m", kind: "model3d", metallic: 1 },
		]);
		expect(c).toContain("shadow_unsupported_light");
		expect(c).toContain("pbr_without_environment");
		expect(
			codes([
				{ id: "e", kind: "light", lightType: "environment" },
				{ id: "m", kind: "model3d", metallic: 1 },
			]),
		).toEqual([]);
	});

	it("flags tracks whose keyframes never change", () => {
		expect(
			codes([
				{
					id: "s",
					kind: "box",
					animation: {
						tracks: [
							{
								prop: "opacity",
								keyframes: [
									{ frame: 0, value: 1 },
									{ frame: 9, value: 1 },
								],
							},
						],
					},
				},
			]),
		).toEqual(["static_track"]);
	});

	it("flags unsupported formats given to image layers", () => {
		expect(
			codes([
				{
					id: "img1",
					kind: "media",
					dataType: "Image",
					inputHandleId: "anim.json",
				},
			]),
		).toEqual(["unsupported_image_format"]);
		expect(
			codes([
				{
					id: "img2",
					kind: "media",
					dataType: "Image",
					inputHandleId: "anim.lottie",
				},
			]),
		).toEqual(["unsupported_image_format"]);
		expect(
			codes([
				{
					id: "img3",
					kind: "media",
					dataType: "Image",
					inputHandleId: "video.mp4",
				},
			]),
		).toEqual(["unsupported_image_format"]);
		expect(
			codes([
				{
					id: "img4",
					kind: "media",
					dataType: "Image",
					inputHandleId: "valid.png",
				},
			]),
		).toEqual([]);
	});
});
