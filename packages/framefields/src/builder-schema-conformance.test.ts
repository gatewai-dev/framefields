import { describe, expect, it } from "vitest";
import {
	CameraAnimation,
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
	lottie: () => Layer.lottie("anim.json"),
	audio: () => Layer.audio("track.mp3"),
	text: () => Layer.text("Hello", { align: "start" }),
	richText: () => Layer.text(["Hello ", { text: "world", fontWeight: 700 }]),
	shape: () => Layer.shape("circle", { width: 100, height: 100 }),
	shapeFillAlias: () =>
		Layer.shape("rect", {
			width: 100,
			height: 100,
			fill: "linear-gradient(180deg, #3ecf8e55, #3ecf8e00)",
		}),
	flex: () => Layer.flex({ children: [Layer.text("a")] }),
	box: () => Layer.box({ width: 100, height: 100 }),
	camera: () => Layer.camera({ z: -800 }),
	cameraAnimationInput: () =>
		Layer.camera({
			animation: CameraAnimation.camera().dolly({
				fromDistance: -2000,
				toDistance: -1000,
				start: 0,
				end: 30,
			}),
		}),
	ambientLight: () => Layer.ambientLight(),
	ambientLightOptions: () =>
		Layer.ambientLight({
			id: "ambient-options",
			color: "#f00",
			intensity: 0.6,
		}),
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
	roundedBox: () =>
		Layer3D.roundedBox({
			width: 100,
			height: 20,
			depth: 60,
			radius: 6,
			taper: 0.9,
		}),
	sphere: () => Layer3D.sphere({ radius: 40, color: "#f00" }),
	cylinder: () =>
		Layer3D.cylinder({ radiusTop: 10, radiusBottom: 20, height: 40 }),
	capsule: () => Layer3D.capsule({ radius: 20, height: 50, color: "#22c55e" }),
	torus: () => Layer3D.torus({ radius: 45, tubeRadius: 12, color: "#ec4899" }),
	ring: () =>
		Layer3D.ring({ innerRadius: 20, outerRadius: 45, color: "#eab308" }),
	pyramid: () => Layer3D.pyramid({ sides: 4, radius: 40, height: 70 }),
	polyhedron: () =>
		Layer3D.polyhedron({ type: "dodecahedron", radius: 35, color: "#06b6d4" }),
	icosahedron: () => Layer3D.icosahedron({ radius: 35 }),
	icosphere: () =>
		Layer3D.icosphere({ radius: 40, detail: 2, flatShaded: false }),
	extrude: () =>
		Layer3D.extrude({
			d: "M -30 -30 L 30 -30 L 30 30 L -30 30 Z",
			depth: 16,
			bevelThickness: 3,
			bevelSize: 2,
		}),
	lathe: () =>
		Layer3D.lathe({
			points: [
				[0, -40],
				[25, 0],
				[0, 40],
			],
			segments: 24,
		}),
	tube: () =>
		Layer3D.tube({
			points: [
				[-40, 0, 0],
				[0, -30, 0],
				[40, 0, 0],
			],
			radius: 10,
			innerRadius: 6,
		}),
	line3d: () =>
		Layer3D.line({
			points: [
				[0, 0, 0],
				[50, 20, -10],
			],
			dashSize: 6,
			gapSize: 4,
		}),
	points3d: () =>
		Layer3D.points({
			points: [
				[0, 0, 0],
				[20, -10, 5],
			],
			pointSize: 8,
		}),
	prismWithSideConfigs: () =>
		Layer3D.prism({
			sides: 5,
			radius: 40,
			height: 80,
			sideConfigs: ["#ff0000", { background: "#00ff00" }],
		}),
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
	it("preserves ambient options and the existing positional call form", () => {
		expect(
			Layer.ambientLight({ id: "fill", color: "#123456", intensity: 0.7 }),
		).toMatchObject({
			id: "fill",
			color: "#123456",
			intensity: 0.7,
			lightType: "ambient",
		});
		expect(Layer.ambientLight("#123456", 0.7, { id: "fill" })).toMatchObject({
			id: "fill",
			color: "#123456",
			intensity: 0.7,
			lightType: "ambient",
		});
	});
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
