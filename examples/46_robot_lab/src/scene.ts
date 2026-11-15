/**
 * The gallery scene as the engine draws it: the Steel world stepped live
 * (each frame the player draws advances it, with the joint targets the page
 * or the demo sets), the arm and the scenario's objects drawn from it, on a
 * dark checker floor under a studio key light, seen from an orbiting camera
 * the page steers.
 */
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Physics,
	Signal,
	type SteelDrag,
	type SteelShape,
	type SteelShapeStyle,
	type SteelWorld,
} from "framefields";
import { addArm, driveArm, FINGERS, HOME } from "./arm.js";
import { Demo } from "./demo.js";
import { scenarioFor } from "./scenarios.js";

export const FPS = 30;
/** Ten minutes of simulation; Reset starts over. */
export const FRAMES = FPS * 60 * 10;
export const WIDTH = 1280;
export const HEIGHT = 720;
/** Scene px per meter: Steel (x, y, z) is scene (x, -z, y) × 1000. */
const PPM = 1000;

/** The scenario the page's `?scene=` names. */
export const scenario = scenarioFor(globalThis.location?.search ?? "");

/** What the page controls: joint targets, the demo and the camera. */
export const controls = {
	/** Joint targets in `JOINTS` order (the gripper drives both fingers). */
	targets: [...HOME],
	/** Run the scenario's demo. */
	demo: true,
	camera: { yaw: -38, pitch: 24, distance: 1900 },
};

/** The live world, once the composition is built (the page reads it). */
export let world: SteelWorld | undefined;
/** The pointer's hold on the world's loose objects (the page orbits when it holds nothing). */
export let drag: SteelDrag | undefined;

let demo: Demo | undefined;

/** Starts the demo over from wherever the arm is. */
export function restartDemo(): void {
	demo = undefined;
	controls.demo = true;
}

// ---------------------------------------------------------------------------
// Looks.
// ---------------------------------------------------------------------------

const ARM_BODIES = new Set(["turret", "upper", "fore", "wrist", "hand"]);

/** Gloss white arm, satin graphite fingers, matte gravel, satin objects. */
function look(shape: SteelShape): SteelShapeStyle | false {
	// The floor draws its own checker.
	if (shape.type === "plane") return false;
	const castShadow = true;
	if (shape.body && ARM_BODIES.has(shape.body))
		return {
			castShadow,
			roughness: 0.3,
			clearcoat: 0.6,
			clearcoatRoughness: 0.2,
		};
	if (shape.body && (FINGERS as readonly string[]).includes(shape.body))
		return { castShadow, roughness: 0.45, metallic: 0.3 };
	if (shape.body?.startsWith("pebble")) return { castShadow, roughness: 0.85 };
	// The arm's base, pedestals and rims: furniture on the floor.
	if (!shape.body) return { castShadow, roughness: 0.55, metallic: 0.1 };
	return { castShadow, roughness: 0.4, clearcoat: 0.3 };
}

/** One tile of the floor's checker: two squares by two. */
const CHECKER = `
fn shade(uv: vec2<f32>) -> vec4<f32> {
	let cell = floor(uv * 2.0);
	let odd = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
	let c = mix(vec3<f32>(0.115, 0.12, 0.13), vec3<f32>(0.16, 0.165, 0.18), odd);
	return vec4<f32>(c, 1.0);
}`;

function floor(): LayoutNode {
	return Layer3D.roundedBox({
		id: "floor",
		// Its top at the ground plane.
		y: 2,
		width: 10 * PPM,
		height: 4,
		depth: 10 * PPM,
		radius: 0,
		// Projected in world space, a tile every 50 cm: 25 cm squares.
		texture: Layer.shader({ width: WIDTH, height: HEIGHT, fragment: CHECKER }),
		triplanar: true,
		triplanarScale: 256 / (0.5 * PPM),
		roughness: 0.55,
		castShadow: false,
	}) as LayoutNode;
}

// ---------------------------------------------------------------------------
// The camera.
// ---------------------------------------------------------------------------

const rad = (deg: number) => (deg * Math.PI) / 180;
/** A camera signal read from the page's orbit each frame. */
const orbit = (fn: () => number) =>
	Signal.builder({ type: "custom", fn: () => fn() });

/** What the camera circles: just in front of the arm. */
const TARGET = { x: 330, y: -180, z: 0 };

function orbitCamera(): LayoutNode {
	const { camera } = controls;
	const at = () => {
		const yaw = rad(camera.yaw);
		const pitch = rad(camera.pitch);
		return {
			x: TARGET.x + Math.sin(yaw) * Math.cos(pitch) * camera.distance,
			y: TARGET.y - Math.sin(pitch) * camera.distance,
			z: TARGET.z - Math.cos(yaw) * Math.cos(pitch) * camera.distance,
		};
	};
	const node = Layer.camera({
		id: "orbit",
		targetX: TARGET.x,
		targetY: TARGET.y,
		targetZ: TARGET.z,
		fov: 38,
	});
	const anim = LayerAnimation.create()
		.signal(
			"x",
			orbit(() => at().x),
		)
		.signal(
			"y",
			orbit(() => at().y),
		)
		.signal(
			"z",
			orbit(() => at().z),
		);
	(node as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
	return node as LayoutNode;
}

// ---------------------------------------------------------------------------
// The composition.
// ---------------------------------------------------------------------------

/** The page's background. */
export const BACKGROUND = "#141518";

export default async function robotLab(): Promise<Composition> {
	const comp = new Composition({
		width: WIDTH,
		height: HEIGHT,
		fps: FPS,
		durationFrames: FRAMES,
		backgroundColor: BACKGROUND,
	});
	const lab = await Physics.steel({
		fps: FPS,
		frames: FRAMES,
		pixelsPerMeter: PPM,
		solver: scenario.solver,
		build(scene) {
			scene.addGroundPlane({ mu: 0.9 });
			addArm(scene);
			scenario.build(scene);
		},
		control(frame, state) {
			if (controls.demo && world) {
				demo ??= new Demo(scenario.demo(), controls.targets);
				if (demo.done) controls.demo = false;
				else controls.targets = demo.targets(world, frame);
			}
			driveArm(controls.targets, state.setJointTarget);
		},
	});
	world = lab.live(comp);

	comp.add([
		orbitCamera(),
		Layer.environment("studio", {
			// What the gloss reflects: a dim studio with soft panels.
			top: "#3a3d44",
			horizon: "#1d1f23",
			bottom: "#101113",
			softboxes: 3,
			intensity: 0.55,
		}),
		// A high key light laying soft shadows, and a cool fill from the side.
		Layer.directionalLight({
			x: -600,
			y: -2600,
			z: -1400,
			targetX: TARGET.x,
			targetY: 0,
			targetZ: 0,
			intensity: 2.2,
			color: "#fff6ea",
			castShadow: true,
			shadowSoftness: 5,
		}),
		Layer.rectLight({
			x: 1800,
			y: -1200,
			z: -900,
			targetX: TARGET.x,
			targetY: -150,
			targetZ: 0,
			width: 1400,
			height: 900,
			intensity: 0.6,
			color: "#dfe8ff",
			radius: 6000,
		}),
		floor(),
		...lab.layers({ style: look }),
	] as LayoutNode[]);
	// Press on a block, a peg or a pebble and pull it around on Steel's spring.
	drag = lab.draggable(comp.input);
	return comp;
}
