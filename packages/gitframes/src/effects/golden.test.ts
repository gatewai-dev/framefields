import { isSignal, signal } from "@gitframes/core";
import { describe, expect, it } from "vitest";
import {
	Blur,
	ColorBalance,
	type Effect,
	Layer,
	type ObjectTrackSignals,
	Vignette,
	YoloNode,
} from "../index.js";

/**
 * Golden snapshots of what each effect class hands the renderer.
 *
 * The snapshots were recorded against the hand-written classes before they
 * were replaced by generated ones (spec/sync-node.md, Phase 1). They pin the
 * op, the prop set, the per-frame uniform values and whether each payload
 * entry is a signal or a scalar, so a migration cannot change behavior
 * unnoticed. Update a snapshot only for an intentional, documented change.
 */
const round = (value: unknown): unknown => {
	if (typeof value === "number") return Number(value.toFixed(6));
	if (Array.isArray(value)) return value.map(round);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, round(v)]),
		);
	}
	return value;
};

function describeEffect(effect: Effect<object>) {
	const payload = effect.toOperation();
	const keys = Object.keys(effect.config).sort();
	const uniforms = effect.resolveUniforms({ frame: 0, fps: 24 } as never);
	return {
		op: payload.op,
		props: keys,
		uniforms: round(uniforms),
		payload: Object.fromEntries(
			keys.map((key) => [
				key,
				isSignal(payload[key]) ? "signal" : typeof payload[key],
			]),
		),
	};
}

function syntheticTrack(): ObjectTrackSignals {
	const video = Layer.video("test.mp4");
	const vision = YoloNode.attach(video, {
		enableDetection: true,
		classes: ["person"],
	});
	vision.setObjectResult(0, [
		{
			trackId: 1,
			category: "person",
			score: 0.95,
			boundingBox: {
				originX: 400,
				originY: 300,
				width: 200,
				height: 500,
				normalizedX: 400 / 1920,
				normalizedY: 300 / 1080,
				normalizedWidth: 200 / 1920,
				normalizedHeight: 500 / 1080,
			},
			centerX: 500,
			centerY: 550,
			normalizedCenterX: 500 / 1920,
			normalizedCenterY: 550 / 1080,
			velocity: { vx: 0, vy: 0 },
			speed: 0,
			age: 1,
			hits: 1,
			active: true,
			isCoasting: false,
		},
	]);
	return vision.objects.byCategory("person");
}

describe("effect golden snapshots", () => {
	it("Vignette: defaults", () => {
		expect(describeEffect(new Vignette())).toMatchSnapshot();
	});

	it("Vignette: custom values and a signal", () => {
		expect(
			describeEffect(
				new Vignette({ strength: 80, radius: signal(0.7), centerX: 0.25 }),
			),
		).toMatchSnapshot();
	});

	it("Blur: defaults", () => {
		expect(describeEffect(new Blur())).toMatchSnapshot();
	});

	it("Blur: custom values", () => {
		expect(
			describeEffect(
				new Blur({
					strength: 12,
					blurType: "Motion",
					angle: 45,
					partialBlur: true,
					shape: "rect",
					radius: 0.4,
					radiusY: 0.2,
				}),
			),
		).toMatchSnapshot();
	});

	it("Blur: driven by a track", () => {
		expect(
			describeEffect(new Blur({ track: syntheticTrack() })),
		).toMatchSnapshot();
	});

	it("Blur: track with overrides", () => {
		expect(
			describeEffect(
				new Blur({ track: syntheticTrack(), strength: 25, shape: "ellipse" }),
			),
		).toMatchSnapshot();
	});

	it("ColorBalance: defaults", () => {
		expect(describeEffect(new ColorBalance())).toMatchSnapshot();
	});

	it("ColorBalance: partial nested values", () => {
		expect(
			describeEffect(
				new ColorBalance({
					shadows: { cyanRed: 10 },
					highlights: { yellowBlue: -20, magentaGreen: 5 },
					preserveLuminosity: false,
				}),
			),
		).toMatchSnapshot();
	});
});
