/**
 * A horned guardian bust sculpted in code with `Layer3D.clay`, and the film
 * that shows it being made: each stage of the sculpt is the same op list cut
 * shorter (the horns grow along their strokes with `progress`), shown for a
 * few frames in turn as the camera turns around the plinth, then the
 * finished bust holds.
 */
import {
	type ClayOp,
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
} from "framefields";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
/** Frames each sculpting stage is on screen. */
const STAGE_FRAMES = 6;
/** The finished bust, after the last stage. */
const HOLD_FRAMES = 66;
const FLOOR = 840;
const PLINTH_TOP = 560;
const CLAY = "#cdbba6";

/** Blockout, from the plinth up: the masses, joined smoothly. `symmetry: "x"` mirrors what lies at positive x. */
const blockout: ClayOp[] = [
	{
		type: "stroke",
		path: [
			[-105, 88, 18],
			[0, 70, 6],
			[105, 88, 18],
		],
		radius: 48,
		smoothness: 28,
	},
	// A flat base to stand on.
	{ type: "box", center: [0, 150, 0], size: [400, 60, 400], mode: "carve" },
	{
		type: "stroke",
		path: [
			[0, -10, 12],
			[0, 50, 18],
		],
		radius: 44,
		smoothness: 22,
	},
	{ type: "sphere", center: [0, -70, 0], radius: 72, smoothness: 22 },
	{ type: "sphere", center: [0, -88, 28], radius: 64, smoothness: 24 },
	{
		type: "stroke",
		path: [
			[0, -48, -48],
			[0, -38, -100],
		],
		radius: 34,
		smoothness: 20,
	},
	{
		type: "stroke",
		path: [
			[-44, -96, -52],
			[0, -102, -66],
			[44, -96, -52],
		],
		radius: 15,
		smoothness: 14,
	},
];

/** A horn: a tapering stroke curling up and back, drawn as far as `progress`. */
const horn = (progress: number): ClayOp => ({
	type: "stroke",
	path: [
		[40, -122, 10],
		[72, -160, 30],
		[86, -200, 72],
		[72, -228, 110, 4],
	],
	radius: 16,
	smoothness: 12,
	progress,
});

/** Features cut and added, then the brushes, then the stone. */
const finishing: ClayOp[] = [
	{ type: "sphere", center: [30, -74, -66], radius: 15, mode: "carve" },
	{ type: "sphere", center: [30, -74, -60], radius: 10 },
	{ type: "sphere", center: [11, -40, -132], radius: 7, mode: "carve" },
	{
		type: "stroke",
		path: [
			[-24, -14, -114],
			[0, -10, -122],
			[24, -14, -114],
		],
		radius: 4,
		mode: "carve",
	},
	{ type: "grab", center: [0, -14, -104], radius: 26, delta: [0, 16, -6] },
	{ type: "inflate", center: [44, -50, -48], radius: 32, amount: 7 },
];

const detail = (amplitude: number): ClayOp => ({
	type: "detail",
	amplitude,
	scale: 22,
	octaves: 4,
	ridged: true,
	seed: 7,
});

/** Every stage of the sculpt, in order; the last is the finished bust. */
export function stages(): ClayOp[][] {
	const out: ClayOp[][] = [];
	for (let i = 1; i <= blockout.length; i++) out.push(blockout.slice(0, i));
	for (let k = 1; k <= 6; k++) out.push([...blockout, horn(k / 6)]);
	const sculpted = [...blockout, horn(1)];
	for (let i = 1; i <= finishing.length; i++)
		out.push([...sculpted, ...finishing.slice(0, i)]);
	const finished = [...sculpted, ...finishing];
	out.push([...finished, detail(1.1)], [...finished, detail(2.2)]);
	return out;
}

export function durationFrames(): number {
	return (stages().length - 1) * STAGE_FRAMES + HOLD_FRAMES;
}

/** The bust at each stage, each on screen for its few frames. */
function sculpture(scale: number, resolution: number): LayoutNode[] {
	const all = stages();
	return all.map((ops, i) => {
		const last = i === all.length - 1;
		return Layer3D.clay({
			id: `bust-${i}`,
			x: W / 2,
			// The flat base (local y 120) rests on the plinth.
			y: PLINTH_TOP - 120 * scale,
			scale,
			ops,
			symmetry: "x",
			color: CLAY,
			roughness: 0.6,
			castShadow: true,
			// The finished bust's mesh: what an export writes (the film draws the field).
			...(last && { resolution }),
			startFrame: i * STAGE_FRAMES,
			durationFrames: last ? HOLD_FRAMES : STAGE_FRAMES,
		}) as LayoutNode;
	});
}

/**
 * `modelResolution`: lattice cells along the finished bust's longest side
 * in its mesh, which only an export reads. Finer keeps more of the stone.
 */
export function sculptureFilm({ modelResolution = 192 } = {}): Composition {
	const frames = durationFrames();
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: frames,
		backgroundColor: "#0d0e11",
	});
	const scale = 1.55;
	const target = { x: W / 2, y: PLINTH_TOP - 240, z: 0 };
	const orbit = (deg: number) => {
		const a = (deg * Math.PI) / 180;
		return { x: target.x + 1250 * Math.sin(a), z: -1250 * Math.cos(a) };
	};
	const from = orbit(-32);
	const to = orbit(22);
	comp.add([
		Layer.camera({
			x: from.x,
			y: target.y - 160,
			z: from.z,
			targetX: target.x,
			targetY: target.y,
			targetZ: target.z,
			fov: 32,
		}).animate(
			LayerAnimation.create()
				.keys("x", [
					[0, from.x],
					[frames - 1, to.x, "sine.inOut"],
				])
				.keys("z", [
					[0, from.z],
					[frames - 1, to.z, "sine.inOut"],
				]),
		),
		Layer.environment("studio", {
			intensity: 0.7,
			floor: {
				y: FLOOR,
				color: "#2a2c31",
				reflectivity: 0.12,
				roughness: 0.6,
			},
		}),
		Layer.directionalLight({
			x: W / 2 - 900,
			y: -400,
			z: -900,
			targetX: W / 2,
			targetY: PLINTH_TOP,
			targetZ: 0,
			intensity: 1.6,
			castShadow: true,
			shadowSoftness: 3,
		}),
		Layer.rectLight({
			x: W / 2 + 900,
			y: 100,
			z: 500,
			targetX: W / 2,
			targetY: PLINTH_TOP - 200,
			targetZ: 0,
			width: 600,
			height: 600,
			intensity: 1.2,
			radius: 4000,
		}),
		Layer3D.roundedBox({
			id: "plinth",
			x: W / 2,
			y: (PLINTH_TOP + FLOOR) / 2,
			width: 380,
			height: FLOOR - PLINTH_TOP,
			depth: 380,
			radius: 6,
			color: "#3b3f47",
			roughness: 0.45,
			castShadow: true,
		}),
		...sculpture(scale, modelResolution),
	] as LayoutNode[]);
	return comp;
}
