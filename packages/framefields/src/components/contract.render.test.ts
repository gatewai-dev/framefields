import { defineComponent } from "@framefields/components/toolkit";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Composition, CompositorProgramSchema, Layer } from "../index.js";
import { decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { bindComponent } from "./index.js";

/**
 * Render tests for the component contract (spec §9.2–9.4) with a probe
 * component: a red plate that rises in and reports one cue at frame 10.
 */
const Probe = bindComponent(
	defineComponent({
		name: "Probe",
		props: () => ({
			color: z.string().default("#ff0000"),
			size: z.number().default(100),
		}),
		defaults: { enter: { preset: "rise", duration: 10 }, hold: 20 },
		build(ctx, props) {
			const plate = ctx.host.box({
				id: ctx.partId("plate"),
				position: "absolute",
				x: 0,
				y: 0,
				width: props.size,
				height: props.size,
				background: props.color,
			});
			return {
				children: [plate],
				width: props.size,
				height: props.size,
				duration: 10,
				cues: { landed: [{ frame: 10 }] },
				parts: { plate },
			};
		},
	}),
);

const W = 200;
const H = 200;

function scene(build: () => Parameters<Composition["add"]>[0]) {
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationMs: 2000,
		backgroundColor: "#000000",
	});
	comp.add(build());
	return comp;
}

async function frame(comp: Composition, n: number) {
	return decodePngPixels(await comp.renderFrame({ frame: n }));
}

describe("component contract (render)", () => {
	it("enters with the preset and settles at its placement", async () => {
		const comp = scene(() => Probe({ at: 0, x: 50, y: 50 }));
		const start = await frame(comp, 0);
		expect(getPixel(start, 100, 100).r).toBeLessThan(10); // opacity 0
		// expo.out at 1/10: half way, so 20 px low and half faded in.
		const mid = await frame(comp, 1);
		expect(getPixel(mid, 100, 60).r).toBeLessThan(10);
		expect(getPixel(mid, 100, 120).r).toBeGreaterThan(100);
		expect(getPixel(mid, 100, 120).r).toBeLessThan(160);
		const settled = await frame(comp, 15);
		expect(getPixel(settled, 100, 52).r).toBeGreaterThan(240);
		expect(getPixel(settled, 45, 100).r).toBeLessThan(10);
		expect(getPixel(settled, 155, 100).r).toBeLessThan(10);
	});

	it("places itself in flow when it has no x / y", async () => {
		const comp = scene(() =>
			Layer.flex({
				width: W,
				height: H,
				padding: 50,
				children: [Probe({ enter: false })],
			}),
		);
		const img = await frame(comp, 0);
		expect(getPixel(img, 52, 52).r).toBeGreaterThan(240);
		expect(getPixel(img, 48, 48).r).toBeLessThan(10);
	});

	it("reports cues a sibling can start on, frame-exactly", async () => {
		const comp = scene(() => {
			const probe = Probe({ at: 5, x: 0, y: 0, enter: false });
			const landed = probe.cues.landed[0]!.frame;
			expect(landed).toBe(15);
			return [
				probe,
				Layer.box({
					position: "absolute",
					x: 150,
					y: 150,
					width: 40,
					height: 40,
					background: "#00ff00",
					startFrame: landed,
					durationFrames: 10,
				}),
			];
		});
		expect(getPixel(await frame(comp, 14), 170, 170).g).toBeLessThan(10);
		expect(getPixel(await frame(comp, 15), 170, 170).g).toBeGreaterThan(240);
	});

	it("produces a spec that validates and lints clean", () => {
		const comp = scene(() => Probe({ x: 10, y: 10, exit: "fade" }));
		const result = CompositorProgramSchema.safeParse(comp.toSpec());
		expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
		expect(comp.lint().filter((d) => d.severity === "error")).toEqual([]);
	});

	it("renders the same pixels in any frame order", async () => {
		const frames = [0, 3, 6, 9, 12, 30];
		const comp = scene(() => Probe({ x: 50, y: 50, exit: "fade" }));
		const forward = new Map<number, Uint8ClampedArray>();
		for (const n of frames) forward.set(n, (await frame(comp, n)).pixels);
		const again = scene(() => Probe({ x: 50, y: 50, exit: "fade" }));
		for (const n of [...frames].reverse()) {
			expect(
				Buffer.from((await frame(again, n)).pixels).equals(
					Buffer.from(forward.get(n)!),
				),
			).toBe(true);
		}
	});
});
