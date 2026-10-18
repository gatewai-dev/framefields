/**
 * Glass word cards are thrown in from both sides onto a dancer's raised hands while she sweeps a cloud
 * of embers aside.
 *
 * Nothing is analysed up front: `comp.vision` reads each frame of the clip
 * just before it renders, and the live 3D physics world steps to that frame
 * right after, so the preview starts at once and fills in as it plays.
 *
 * - Each card is a 3D glass slab (Rapier rigid body) that refracts
 *   everything behind it, with its word in solid blue welded in front.
 * - Her arms and head are kinematic colliders that follow the tracked pose;
 *   her silhouette (dress included) pushes the embers out of the way.
 * - A vision cutout of the clip sits above the embers, so they pass behind her.
 */
import fs from "node:fs";
import {
	Composition,
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
	type PersonTrack,
	Physics,
	type PhysicsBody3D,
	type PhysicsWorld3D,
	type PoseKeypointName,
} from "framefields";
import {
	DANCER,
	DURATION,
	EMBER,
	FLOOR,
	FONT_FILE,
	FPS,
	GOLD,
	H,
	HOT,
	RUST,
	registerFonts,
	W,
} from "./theme.js";

export { DURATION as DURATION_FRAMES } from "./theme.js";

/** Spheres along a limb (u = 0 at `a`, 1 at `b`, beyond 1 past it) that follow the pose, in the z = 0 plane. */
function limb(
	world: PhysicsWorld3D,
	person: PersonTrack,
	a: PoseKeypointName,
	b: PoseKeypointName,
	us: number[],
	r: number,
): void {
	for (const u of us) {
		const at = (frame: number) => {
			const p = person.point(a, frame);
			const q = person.point(b, frame);
			return [p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u] as const;
		};
		const [x, y] = at(0);
		world.body(
			{ x, y, z: 0, width: 2 * r, height: 2 * r, depth: 2 * r },
			{
				type: "kinematic",
				shape: "sphere",
				friction: 0.8,
				follow: { x: (f) => at(f)[0], y: (f) => at(f)[1], z: 0 },
			},
		);
	}
}

/** The framefields blues. */
const BLUE = "#3B82F6";
const BLUE_DEEP = "#1D4ED8";
const NAVY = "#0B1E4D";

const CARDS = [
	// `from`: the side it is thrown in from; `dx`: where on her it is aimed, from her head.
	{ text: "PHYSICS", color: BLUE, at: 24, from: "left", dx: -30 },
	{ text: "MEETS", color: NAVY, at: 38, from: "right", dx: 50 },
	{ text: "VISION", color: BLUE, at: 52, from: "left", dx: 10 },
	{ text: "IN", color: BLUE_DEEP, at: 66, from: "right", dx: -20 },
	// The finale drops straight down onto her, slower to read.
	{ text: "FRAMEFIELDS", color: BLUE_DEEP, at: 82, from: "top", dx: 0 },
];
const CARD_FONT = 76;
const CARD_DEPTH = 34;
const GRAVITY = 2600;
/** Seconds from the edge of the frame to her. */
const FLIGHT = 0.7;

/**
 * Word cards: a 3D glass slab (the rigid body) with its word in solid blue
 * riding just in front of it. Cards keep their slight tilt and never turn,
 * so the words stay upright and readable while the cards bounce off her.
 */
function glassCards(world: PhysicsWorld3D, person: PersonTrack) {
	const head = person.point("nose", 0);
	return CARDS.map((card, i) => {
		const m = FontManager.measure(card.text, {
			fontFamily: "Syne",
			fontSize: CARD_FONT,
		});
		const width = Math.ceil(m.width + 84);
		const height = Math.ceil(m.height + 52);
		// Thrown in from the side on an arc that crosses her head and raised
		// arms: launch velocity solved from gravity and the flight time.
		const target = { x: head.x + card.dx, y: head.y + 40 };
		const fromTop = card.from === "top";
		const x = fromTop
			? target.x
			: card.from === "left"
				? -width / 2 - 40
				: W + width / 2 + 40;
		const y = fromTop ? -height - 60 : 430 - (i % 2) * 50;
		const velocity: [number, number, number] = fromTop
			? [0, 0, 0]
			: [
					(target.x - x) / FLIGHT,
					(target.y - y - 0.5 * GRAVITY * FLIGHT * FLIGHT) / FLIGHT,
					0,
				];
		const tilt = (i % 2 ? 1 : -1) * (4 + i * 2);
		const slab = Layer3D.roundedBox({
			id: `card-${i}`,
			width,
			height,
			depth: CARD_DEPTH,
			radius: 18,
			x,
			y,
			z: 0,
			rotateZ: tilt,
			color: "#eef5ff",
			material: "glass",
			roughness: 0.03,
		});
		const body = world.body(slab, {
			restitution: fromTop ? 0.1 : 0.3,
			friction: fromTop ? 0.9 : 0.5,
			// The finale falls slower, so it reads on the way down.
			gravityScale: fromTop ? 0.45 : 1,
			density: 1.2,
			startFrame: card.at,
			velocity,
			lockRotation: true,
		});
		const words = Layer3D.extrudedText({
			id: `card-${i}-text`,
			text: card.text,
			fontFamily: "Syne",
			fontSize: CARD_FONT,
			depth: 3,
			align: "center",
			verticalAlign: "middle",
			fill: card.color,
			material: "unlit",
			x,
			y,
			z: -CARD_DEPTH / 2 - 2,
			rotateZ: tilt,
		}).animate(
			LayerAnimation.create()
				.signal("x", body.x)
				.signal("y", body.y)
				.signal("z", body.z, { offset: -CARD_DEPTH / 2 - 2 }),
		);
		return { layer: slab, words, body };
	});
}

/** Embers in the lower half: her silhouette pushes them, a slow current keeps them drifting. */
function embers(person: PersonTrack) {
	return Layer.particles({
		id: "embers",
		width: W,
		height: H,
		max: 24000,
		seed: 7,
		emitter: {
			shape: "rect",
			x: 0,
			y: 380,
			width: W,
			height: FLOOR - 390,
			rate: 3600,
		},
		lifetime: [4, 6.5],
		speed: [0, 25],
		drag: 2.2,
		gravity: -6,
		noise: { strength: 240, scale: 170, speed: 0.25 },
		push: { person, strength: 9000, sweep: 120000 },
		floor: FLOOR,
		bounce: 0.1,
		size: [11, 8],
		sizeJitter: 0.6,
		fade: [0.15, 0.3],
		color: [RUST, EMBER, GOLD, HOT],
		colorBySpeed: 500,
		prewarm: 4,
	});
}

/** Keeps letters near the picture plane, so they stay where her arms are. */
const keepInPlane = (s: { z: number }): [number, number, number] => [
	0,
	0,
	-s.z * 6,
];

export interface Film {
	comp: Composition;
	world: PhysicsWorld3D;
	letters: Array<{ id: string; body: PhysicsBody3D }>;
}

export async function buildFilm(): Promise<Composition> {
	return (await buildScene()).comp;
}

export async function buildScene(): Promise<Film> {
	await registerFonts();
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: DURATION,
		backgroundColor: "#E9D3B4",
		fonts: [FONT_FILE],
	});
	if (!fs.existsSync(DANCER)) {
		throw new Error(
			`Missing ${DANCER}. Generate it with \`pnpm assets\` in examples/19_framefields_film.`,
		);
	}
	const dancer = comp.vision(DANCER);
	// Letters drop around her first pose: analyse just that now.
	await dancer.ready(0);
	const person = dancer.person.place({ width: W, height: H, fit: "cover" });

	// Without a camera layer the 3D world's z = 0 plane lines up 1:1 with the
	// video, so pose points are 3D positions too.
	const world = await Physics.world3d({
		fps: FPS,
		frames: DURATION,
		gravity: GRAVITY,
		substeps: 6,
	});
	// Only a floor: cards come in from beyond the frame edges.
	world.ground({ y: FLOOR });
	for (const side of ["left", "right"] as const) {
		limb(world, person, `${side}Shoulder`, `${side}Elbow`, [0, 0.5, 1], 30);
		limb(
			world,
			person,
			`${side}Elbow`,
			`${side}Wrist`,
			[0.33, 0.66, 1, 1.25],
			28,
		);
	}
	limb(world, person, "leftShoulder", "rightShoulder", [0.5], 46);
	limb(world, person, "nose", "nose", [0], 58);
	const letters = glassCards(world, person);
	world.field(keepInPlane, {
		bodies: letters.map((l) => l.body),
	});
	world.live(comp);

	const video = (id: string, muted: boolean) =>
		Layer.video(DANCER, {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fit: "cover",
			muted,
		});

	comp.add([
		video("plate", false),
		embers(person),
		video("cutout", true).withVision({ mode: "matte" }),
		...letters.flatMap((l) => [l.layer, l.words]),
	]);

	return {
		comp,
		world,
		letters: letters.map((l) => ({ id: String(l.layer.id), body: l.body })),
	};
}
