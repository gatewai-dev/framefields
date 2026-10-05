import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	LayerAnimation,
} from "./index.js";

/**
 * Every Layer.* builder must emit a spec its own schema accepts, so schema
 * validation stays usable as a test gate in user projects.
 */
const builders = {
	video: () => Layer.video("clip.mp4"),
	image: () => Layer.image("still.png"),
	svg: () => Layer.svg("logo.svg"),
	audio: () => Layer.audio("track.mp3"),
	text: () => Layer.text("Hello", { align: "start" }),
	richText: () => Layer.text(["Hello ", { text: "world", fontWeight: 700 }]),
	shape: () => Layer.shape("circle", { width: 100, height: 100 }),
	flex: () => Layer.flex({ children: [Layer.text("a")] }),
	box: () => Layer.box({ width: 100, height: 100 }),
	camera: () => Layer.camera({ z: -800 }),
	ambientLight: () => Layer.ambientLight(),
	pointLight: () => Layer.pointLight({ x: 0, y: 0, z: -200 }),
	cube: () => Layer.cube({ size: 10 }),
	cubeWithFaces: () =>
		Layer3D.cube({
			size: 100,
			faces: { front: "#f00", top: { background: "#0f0" } },
		}),
	carousel3d: () =>
		Layer.carousel3d({ radius: 200, items: [Layer.box(), Layer.box()] }),
	plane3d: () => Layer.plane3d({ width: 100, height: 50 }),
	prism3d: () => Layer.prism3d({ sides: 6, radius: 50, height: 100 }),
	barChart: () =>
		Layer.chart({
			type: "bar",
			categories: ["a", "b"],
			series: [{ data: [1, -2] }, { data: [3, 4] }],
			valueLabels: true,
		}),
	stackedArea: () =>
		Layer.chart({
			type: "area",
			stacked: true,
			series: [{ data: [1, 2, 3] }, { data: [2, 1, 2] }],
		}),
	lineChart: () =>
		Layer.chart({
			data: [
				[0, 1],
				[1, 3],
				[2, 2],
			],
		}),
	scatterChart: () => Layer.chart({ type: "scatter", data: [1, 4, 2] }),
	candlestickChart: () =>
		Layer.chart({
			type: "candlestick",
			data: [{ x: "d1", open: 1, high: 3, low: 0, close: 2 }],
		}),
	donutChart: () =>
		Layer.chart({
			type: "donut",
			data: [
				{ label: "a", value: 1 },
				{ label: "b", value: 2 },
			],
			valueLabels: true,
		}),
	animatedCube: () =>
		Layer.cube({ size: 10 }).animate(
			LayerAnimation.create().fromTo("scale", 0, 1, { start: 0, end: 24 }),
		),
};

describe("Layer builders conform to CompositorProgramSchema", () => {
	for (const [name, build] of Object.entries(builders)) {
		it(name, () => {
			const comp = new Composition({
				width: 320,
				height: 240,
				fps: 24,
				durationMs: 1000,
			});
			comp.add(build());
			const result = CompositorProgramSchema.safeParse(comp.toSpec());
			expect(result.success ? [] : result.error.issues).toEqual([]);
		});
	}

	it("keeps 3D container handles usable but out of the spec", () => {
		const cube = Layer3D.cube({ size: 10 });
		expect(cube.faces).toHaveLength(6);
		expect([...cube]).toHaveLength(6);
		expect(Object.keys(cube)).not.toContain("faces");
		expect(JSON.parse(JSON.stringify(cube)).faces).toBeUndefined();
	});
});
