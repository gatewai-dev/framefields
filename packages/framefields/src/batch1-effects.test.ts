import { signal } from "@framefields/core";
import { describe, expect, it } from "vitest";
import {
	ApplyLUT,
	Curves,
	GradientMap,
	HalftoneScreen,
	HighPass,
	Media,
	SelectiveColor,
	ShadowsHighlights,
	TileOffset,
	UnsharpMask,
} from "./index.js";

describe("Batch 1: Core Tonal, Color & Filter Effects", () => {
	it("1. Curves: instantiation, proxy mutation and defaults", () => {
		const curves = new Curves();
		expect(curves.op).toBe("Curves");
		expect(curves.curveType).toBe("rgb");
		expect(curves.master).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		]);

		// Custom points & proxy mutation
		curves.master = [
			{ x: 0, y: 0.1 },
			{ x: 0.5, y: 0.6 },
			{ x: 1, y: 0.9 },
		];
		expect(curves.master.length).toBe(3);
		expect(curves.signals.master!.value![1]!.y).toBe(0.6);

		const op = curves.toOperation();
		expect(op.op).toBe("Curves");
		expect(op.curveType).toBe("rgb");
	});

	it("2. SelectiveColor: instantiation, ranges and reactivity", () => {
		const sel = new SelectiveColor({
			method: "Absolute",
			reds: { cyan: -20, magenta: 15 },
			neutrals: { black: 10 },
		});

		expect(sel.op).toBe("SelectiveColor");
		expect(sel.method).toBe("Absolute");
		expect(sel.reds.cyan).toBe(-20);
		expect(sel.reds.magenta).toBe(15);
		expect(sel.reds.yellow).toBe(0);
		expect(sel.neutrals.black).toBe(10);

		// Proxy mutation
		sel.method = "Relative";
		expect(sel.method).toBe("Relative");
		expect(sel.signals.method!.value).toBe("Relative");

		const op = sel.toOperation();
		expect(op.op).toBe("SelectiveColor");
		expect(op.method).toBe("Relative");
	});

	it("3. GradientMap: instantiation, stop manipulation and opacity", () => {
		const grad = new GradientMap({
			stops: [
				{ position: 0.0, color: "#1b0d00" },
				{ position: 0.5, color: "#6e441a" },
				{ position: 1.0, color: "#f0d8a8" },
			],
			opacity: 0.8,
			smooth: true,
		});

		expect(grad.op).toBe("GradientMap");
		expect(grad.stops.length).toBe(3);
		expect(grad.opacity).toBe(0.8);
		expect(grad.smooth).toBe(true);

		grad.opacity = 0.5;
		expect(grad.opacity).toBe(0.5);
		expect(grad.signals.opacity!.value).toBe(0.5);
	});

	it("4. ShadowsHighlights: recovery controls", () => {
		const sh = new ShadowsHighlights({
			shadowAmount: 35,
			highlightAmount: 40,
			shadowRadius: 25,
			highlightRadius: 25,
			colorCorrection: 10,
		});

		expect(sh.op).toBe("ShadowsHighlights");
		expect(sh.shadowAmount).toBe(35);
		expect(sh.highlightAmount).toBe(40);
		expect(sh.shadowRadius).toBe(25);
		expect(sh.highlightRadius).toBe(25);
		expect(sh.colorCorrection).toBe(10);

		sh.shadowAmount = 50;
		expect(sh.shadowAmount).toBe(50);
		expect(sh.signals.shadowAmount!.value).toBe(50);
	});

	it("5. ApplyLUT: LUT path and intensity", () => {
		const lut = new ApplyLUT({
			lutUrl: "https://example.com/cinematic.cube",
			intensity: 0.85,
		});

		expect(lut.op).toBe("ApplyLUT");
		expect(lut.lutUrl).toBe("https://example.com/cinematic.cube");
		expect(lut.intensity).toBe(0.85);

		lut.intensity = 1.0;
		expect(lut.intensity).toBe(1.0);
		expect(lut.signals.intensity!.value).toBe(1.0);
	});

	it("6. UnsharpMask: sharpening controls", () => {
		const unsharp = new UnsharpMask({
			amount: 150,
			radius: 2.0,
			threshold: 5,
		});

		expect(unsharp.op).toBe("UnsharpMask");
		expect(unsharp.amount).toBe(150);
		expect(unsharp.radius).toBe(2.0);
		expect(unsharp.threshold).toBe(5);

		unsharp.amount = 200;
		expect(unsharp.amount).toBe(200);
		expect(unsharp.signals.amount!.value).toBe(200);
	});

	it("7. HighPass: frequency cutoff and contrast boost", () => {
		const hp = new HighPass({
			radius: 4.5,
			contrastBoost: 2.0,
			monochrome: true,
		});

		expect(hp.op).toBe("HighPass");
		expect(hp.radius).toBe(4.5);
		expect(hp.contrastBoost).toBe(2.0);
		expect(hp.monochrome).toBe(true);

		hp.radius = 6.0;
		expect(hp.radius).toBe(6.0);
		expect(hp.signals.radius!.value).toBe(6.0);
	});

	it("8. HalftoneScreen: dot raster configuration and aliases", () => {
		const halftone = new HalftoneScreen({
			mode: "CMYK",
			dotShape: "Diamond",
			frequency: 45,
			angle: 30,
			contrast: 1.2,
		});

		expect(halftone.op).toBe("HalftoneScreen");
		expect(halftone.mode).toBe("CMYK");
		expect(halftone.dotShape).toBe("Diamond");
		expect(halftone.frequency).toBe(45);
		expect(halftone.angle).toBe(30);
		expect(halftone.contrast).toBe(1.2);

		halftone.frequency = 60;
		expect(halftone.frequency).toBe(60);
		expect(halftone.signals.frequency!.value).toBe(60);
	});

	it("9. TileOffset: pixel shift and wrap edge modes", () => {
		const tile = new TileOffset({
			offsetX: 120,
			offsetY: -50,
			edgeMode: "mirror",
		});

		expect(tile.op).toBe("TileOffset");
		expect(tile.offsetX).toBe(120);
		expect(tile.offsetY).toBe(-50);
		expect(tile.edgeMode).toBe("mirror");

		tile.offsetX += 10;
		expect(tile.offsetX).toBe(130);
		expect(tile.signals.offsetX!.value).toBe(130);
	});

	it("10. Game-engine lifecycle hooks onRequestFrame on Batch 1 effects", () => {
		const tile = new TileOffset({ offsetX: 0, offsetY: 0 });
		tile.onRequestFrame(({ frame }) => {
			tile.offsetX = frame * 4;
		});

		tile.notifyFrame({
			frame: 15,
			fps: 30,
			time: 0.5,
			duration: 2,
			durationMs: 2000,
			progress: 0.25,
			deltaTime: 1 / 30,
		});

		expect(tile.offsetX).toBe(60);
	});

	it("11. Signal binding and Media.apply pipeline integration", () => {
		const dynamicAmount = signal(120);
		const unsharp = new UnsharpMask({
			amount: dynamicAmount as unknown as number,
		});

		const curves = new Curves();
		const media = Media.video("clip.mp4").apply(curves).apply(unsharp);

		const vm = media.toVirtualMedia();
		expect(vm.operation.op).toBe("UnsharpMask");
		expect((vm.children?.[0]?.operation as { op: string }).op).toBe("Curves");
		expect(unsharp.amount).toBe(120);

		dynamicAmount.value = 250;
		expect(unsharp.amount).toBe(250);
	});
});
