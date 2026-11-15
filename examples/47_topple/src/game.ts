/**
 * Topple: towers of blocks stand on a round platform; throw balls at them
 * and score a point for every block knocked off. A Steel world stepped live
 * (`world.live`), played with the composition's input: click (or tap) where
 * to throw, A/D or the arrow keys (or a gamepad's left stick) to circle the
 * platform, Space (or the gamepad's A) to throw at the middle of the view.
 * The score, the balls left and the verdict are live text drawn by the engine.
 */
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Physics,
	Signal,
	type SteelSceneBuilder,
	type SteelShape,
	type SteelShapeStyle,
	type SteelWorld,
} from "framefields";

export const FPS = 60;
/** Ten minutes; R starts over. */
export const FRAMES = FPS * 60 * 10;
export const WIDTH = 1280;
export const HEIGHT = 720;
/** Scene px per meter: Steel (x, y, z) is scene (x, -z, y) × 1000. */
const PPM = 1000;

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// The level.
// ---------------------------------------------------------------------------

const PLATFORM = { radius: 0.34, top: 0.3 };
const BLOCK: Vec3 = [0.035, 0.035, 0.05];
const BALL = 0.045;
export const BALLS = 12;
/** Three towers of five, in a triangle on the platform. */
const TOWERS: Array<[number, number]> = [
	[0.12, 0],
	[-0.06, 0.104],
	[-0.06, -0.104],
];
const STOREYS = 5;
const COLORS = ["#e5533d", "#f2a33a", "#2f9c95", "#ece4d4", "#3c7be0"];
/** Where the unthrown balls wait: a row on the floor behind the platform. */
const rackAt = (i: number): Vec3 => [-0.75, -0.44 + i * 0.08, BALL];

const rgb = (hex: string): Vec3 => [
	Number.parseInt(hex.slice(1, 3), 16) / 255,
	Number.parseInt(hex.slice(3, 5), 16) / 255,
	Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const blockName = (t: number, s: number) => `block${t}_${s}`;
const ballName = (i: number) => `ball${i}`;
const BLOCKS = TOWERS.flatMap((_, t) =>
	Array.from({ length: STOREYS }, (_, s) => blockName(t, s)),
);

function build(scene: SteelSceneBuilder): void {
	scene.addGroundPlane({ mu: 0.8 });
	scene.addShapeCylinder(-1, {
		radius: PLATFORM.radius,
		halfHeight: PLATFORM.top / 2,
		xform: [0, 0, PLATFORM.top / 2, 0, 0, 0, 1],
		color: rgb("#3a3f4a"),
		mu: 0.8,
	});
	TOWERS.forEach(([x, y], t) => {
		for (let s = 0; s < STOREYS; s++) {
			// Each storey turned a little, so the towers read as stacked blocks.
			const yaw = (s % 2 ? 0.25 : -0.25) + t;
			const body = scene.addBody({
				xform: [
					x,
					y,
					PLATFORM.top + BLOCK[2] * (2 * s + 1),
					0,
					0,
					Math.sin(yaw / 2),
					Math.cos(yaw / 2),
				],
				label: blockName(t, s),
			});
			scene.addShapeBox(body, {
				hx: BLOCK[0],
				hy: BLOCK[1],
				hz: BLOCK[2],
				color: rgb(COLORS[(t * 2 + s) % COLORS.length]),
				mu: 0.7,
				density: 500,
				gap: 0.02,
			});
		}
	});
	for (let i = 0; i < BALLS; i++) {
		const body = scene.addBody({
			xform: [...rackAt(i), 0, 0, 0, 1],
			label: ballName(i),
		});
		scene.addShapeSphere(body, {
			radius: BALL,
			color: rgb("#f2f2f0"),
			density: 2500,
			mu: 0.6,
			// Waiting balls stay put on the rack.
			muRolling: 0.05,
			gap: 0.02,
		});
	}
}

// ---------------------------------------------------------------------------
// The game's state, read by the layers' signals.
// ---------------------------------------------------------------------------

export const game = {
	thrown: 0,
	score: 0,
	/** The camera's circle around the platform. */
	yaw: -30,
	pitch: 20,
	distance: 2300,
};

/** Throws waiting for the next step: where each ball should go (Steel m). */
const throws: Vec3[] = [];

/** Blocks off the platform: fallen below its top, or past its edge. */
function knockedOff(world: SteelWorld, frame: number): number {
	return BLOCKS.filter((name) => {
		const [x, y, z] = world.body(name, frame).position;
		return z < PLATFORM.top - 0.02 || Math.hypot(x, y) > PLATFORM.radius + 0.01;
	}).length;
}

// ---------------------------------------------------------------------------
// The camera.
// ---------------------------------------------------------------------------

const TARGET: Vec3 = [0, -300, 0];

/** The camera's eye in the scene (px), from the game's yaw, pitch and distance. */
function eye(): Vec3 {
	const yaw = (game.yaw * Math.PI) / 180;
	const pitch = (game.pitch * Math.PI) / 180;
	return [
		TARGET[0] + Math.sin(yaw) * Math.cos(pitch) * game.distance,
		TARGET[1] - Math.sin(pitch) * game.distance,
		TARGET[2] - Math.cos(yaw) * Math.cos(pitch) * game.distance,
	];
}

const live = (fn: () => number) =>
	Signal.builder({ type: "custom", fn: () => fn() });

function camera(): LayoutNode {
	const node = Layer.camera({
		id: "camera",
		targetX: TARGET[0],
		targetY: TARGET[1],
		targetZ: TARGET[2],
		fov: 40,
	});
	(node as unknown as { animate(a: LayerAnimation): unknown }).animate(
		LayerAnimation.create()
			.signal(
				"x",
				live(() => eye()[0]),
			)
			.signal(
				"y",
				live(() => eye()[1]),
			)
			.signal(
				"z",
				live(() => eye()[2]),
			),
	);
	return node as LayoutNode;
}

// ---------------------------------------------------------------------------
// The HUD: live text, read from the game each frame it is drawn.
// ---------------------------------------------------------------------------

function number(
	text: () => string,
	x: number,
	y: number,
	align: "start" | "end",
): LayoutNode {
	return Layer.text(text, {
		position: "absolute",
		x,
		y,
		width: 200,
		fontSize: 44,
		fontWeight: 700,
		fill: "#ffffff",
		align,
	}) as LayoutNode;
}

/** What the round has come to, under the score. */
function verdict(): string {
	if (game.score === BLOCKS.length) return "All down!";
	if (game.thrown >= BALLS) return `Out of balls · R to play again`;
	return "";
}

function caption(text: string, x: number, y: number): LayoutNode {
	return Layer.text(text, {
		position: "absolute",
		x,
		y,
		fontSize: 15,
		fontWeight: 600,
		letterSpacing: 2,
		fill: "#9aa0aa",
	}) as LayoutNode;
}

function hud(): LayoutNode[] {
	return [
		caption("SCORE", 40, 32),
		number(() => `${game.score} / ${BLOCKS.length}`, 40, 52, "start"),
		caption("BALLS", WIDTH - 110, 32),
		number(() => String(BALLS - game.thrown), WIDTH - 240, 52, "end"),
		Layer.text(verdict, {
			position: "absolute",
			x: 0,
			y: 120,
			width: WIDTH,
			fontSize: 28,
			fontWeight: 700,
			fill: "#ffd166",
			align: "center",
		}) as LayoutNode,
		Layer.text(
			"Click to throw · A / D to circle · Space throws at the middle · R starts over",
			{
				position: "absolute",
				x: 0,
				y: HEIGHT - 44,
				width: WIDTH,
				fontSize: 15,
				fill: "#7d838e",
				align: "center",
			},
		) as LayoutNode,
	];
}

// ---------------------------------------------------------------------------
// Looks.
// ---------------------------------------------------------------------------

function look(shape: SteelShape): SteelShapeStyle | false {
	if (shape.type === "plane") return false;
	const castShadow = true;
	if (shape.body?.startsWith("ball"))
		return { castShadow, roughness: 0.25, clearcoat: 0.8 };
	if (!shape.body) return { castShadow, roughness: 0.6 };
	return { castShadow, roughness: 0.45, clearcoat: 0.3 };
}

const CHECKER = `
fn shade(uv: vec2<f32>) -> vec4<f32> {
	let cell = floor(uv * 2.0);
	let odd = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
	return vec4<f32>(mix(vec3<f32>(0.11, 0.115, 0.125), vec3<f32>(0.15, 0.155, 0.17), odd), 1.0);
}`;

function floor(): LayoutNode {
	return Layer3D.roundedBox({
		id: "floor",
		y: 2,
		width: 12 * PPM,
		height: 4,
		depth: 12 * PPM,
		radius: 0,
		texture: Layer.shader({ width: WIDTH, height: HEIGHT, fragment: CHECKER }),
		triplanar: true,
		triplanarScale: 256 / (0.5 * PPM),
		roughness: 0.6,
		castShadow: false,
	}) as LayoutNode;
}

// ---------------------------------------------------------------------------
// The composition.
// ---------------------------------------------------------------------------

/** Launch speed, m/s; the arc is solved to land on the aimed point. */
const SPEED = 7;
const GRAVITY = 9.81;

/** The twist (linear, then angular) that carries a ball from `from` onto `to`. */
function lob(from: Vec3, to: Vec3): number[] {
	const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
	const t = Math.hypot(...d) / SPEED;
	return [d[0] / t, d[1] / t, d[2] / t + 0.5 * GRAVITY * t, 0, 0, 0];
}

export let world: SteelWorld | undefined;

export default async function topple(): Promise<Composition> {
	const comp = new Composition({
		width: WIDTH,
		height: HEIGHT,
		fps: FPS,
		durationFrames: FRAMES,
		backgroundColor: "#121316",
	});
	const { input } = comp;
	const steel = await Physics.steel({
		fps: FPS,
		frames: FRAMES,
		pixelsPerMeter: PPM,
		build,
		control(frame, s) {
			const w = world;
			if (!w) return;
			game.score = knockedOff(w, frame);
			// Each throw takes the next ball off the rack, a little in front of the eye.
			for (const target of throws.splice(0)) {
				if (game.thrown >= BALLS) break;
				const from = w.toSteel(eye());
				const d = [
					target[0] - from[0],
					target[1] - from[1],
					target[2] - from[2],
				];
				const l = Math.hypot(d[0], d[1], d[2]);
				const start: Vec3 = [
					from[0] + (d[0] / l) * 0.4,
					from[1] + (d[1] / l) * 0.4,
					from[2] + (d[2] / l) * 0.4 - 0.1,
				];
				const ball = ballName(game.thrown++);
				s.setBodyPose(ball, start, [0, 0, 0, 1]);
				s.setBodyTwist(ball, lob(start, target));
			}
		},
	});
	world = steel.live(comp);

	// Aim where the pointer presses: the surface under it, or 3 m out.
	input.on("pointerdown", async (e) => {
		if (e.button !== 0 || game.thrown + throws.length >= BALLS) return;
		const pick = await e.pick();
		const ray = pick.ray(e.x, e.y);
		const at: Vec3 | null =
			pick.hit?.point ??
			(ray && [
				ray.origin[0] + ray.direction[0] * 3 * PPM,
				ray.origin[1] + ray.direction[1] * 3 * PPM,
				ray.origin[2] + ray.direction[2] * 3 * PPM,
			]);
		if (at) throws.push(steel.toSteel(at));
	});
	// Keys and the gamepad, read once per frame.
	let padWasDown = false;
	comp.onRequestFrame(() => {
		const pad = input.gamepads[0];
		const stick = pad
			? Math.abs(pad.axes[0] ?? 0) > 0.15
				? pad.axes[0]
				: 0
			: 0;
		game.yaw +=
			(input.axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]) + stick) * 1.2;
		game.pitch = Math.max(
			5,
			Math.min(
				60,
				game.pitch +
					input.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]) * 0.6,
			),
		);
		game.distance = Math.max(
			1200,
			Math.min(4000, game.distance * Math.exp(input.wheel * 0.001)),
		);
		// The gamepad's A throws once per press.
		const padA = (pad?.buttons[0] ?? 0) > 0.5;
		const throwMiddle = input.pressed("Space") || (padA && !padWasDown);
		padWasDown = padA;
		if (throwMiddle && game.thrown + throws.length < BALLS)
			throws.push([0, 0, PLATFORM.top + 0.15]);
	});

	comp.add([
		Layer.box({
			id: "scene",
			position: "absolute",
			width: WIDTH,
			height: HEIGHT,
			children: [
				camera(),
				Layer.environment("studio", {
					top: "#3a3d44",
					horizon: "#1c1e22",
					bottom: "#0f1012",
					softboxes: 3,
					intensity: 0.55,
				}),
				Layer.directionalLight({
					x: -700,
					y: -2800,
					z: -1200,
					targetX: 0,
					targetY: 0,
					targetZ: 0,
					intensity: 2.2,
					color: "#fff6ea",
					castShadow: true,
					shadowSoftness: 5,
				}),
				Layer.rectLight({
					x: 1800,
					y: -1300,
					z: -800,
					targetX: 0,
					targetY: -300,
					targetZ: 0,
					width: 1400,
					height: 900,
					intensity: 0.6,
					color: "#dfe8ff",
					radius: 6000,
				}),
				floor(),
				...steel.layers({ style: look }),
			] as LayoutNode[],
		}) as LayoutNode,
		...hud(),
	]);
	return comp;
}
