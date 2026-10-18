/**
 * A dancer in a field of physics: word cards drop onto her raised hands and
 * head, and a cloud of particles flows around her as the dress sweeps through.
 *
 * - Her arms and head are kinematic colliders that follow the tracked pose.
 * - Her silhouette (dress included) is a force field that pushes everything out,
 *   hardest where it is sweeping in.
 * - A vision cutout of the same clip sits above the particles, so they pass behind her.
 */
import {
	Composition,
	FontManager,
	Layer,
	LayerAnimation,
	type PersonTrack,
	Physics,
	type PhysicsBody2D,
	type PhysicsWorld2D,
	type PoseKeypointName,
	Signal,
} from "framefields";
import { performer } from "./performer.js";
import {
	CREAM,
	DANCER,
	DURATION,
	EMBER,
	FLOOR,
	FONT_FILE,
	FPS,
	GOLD,
	H,
	HOT,
	INK,
	RUST,
	registerFonts,
	VIOLET,
	W,
} from "./theme.js";

const WORDS = [
	{ text: "PHYSICS", bg: EMBER, fg: INK, at: 30 },
	{ text: "MEETS", bg: INK, fg: CREAM, at: 46 },
	{ text: "VISION", bg: CREAM, fg: INK, at: 62 },
	{ text: "IN", bg: GOLD, fg: INK, at: 78 },
	{ text: "FRAMEFIELDS", bg: VIOLET, fg: CREAM, at: 94 },
];
const CARD_FONT_SIZE = 64;
const PARTICLE_COLORS = [INK, RUST, EMBER, GOLD];

/** Balls along a limb (u = 0 at `a`, 1 at `b`, beyond 1 past `b`) that follow the pose. */
function limb(
	world: PhysicsWorld2D,
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
			{ x: x - r, y: y - r, width: 2 * r, height: 2 * r },
			{
				type: "kinematic",
				shape: "circle",
				friction: 0.9,
				follow: { x: (f) => at(f)[0] - r, y: (f) => at(f)[1] - r },
			},
		);
	}
}

/** Word cards sized to their text, dropped over whichever hand is highest. */
function cards(world: PhysicsWorld2D, person: PersonTrack) {
	return WORDS.map((w, i) => {
		const m = FontManager.measure(w.text, {
			fontFamily: "Syne",
			fontSize: CARD_FONT_SIZE,
		});
		const width = Math.ceil(m.width + 72);
		const height = Math.ceil(m.height + 40);
		const hand = (["leftWrist", "rightWrist"] as const)
			.map((k) => person.point(k, w.at + 12))
			.reduce((p, q) => (p.y < q.y ? p : q));
		const layer = Layer.box({
			id: `card-${i}`,
			position: "absolute",
			x: hand.x - width / 2 + (i % 2 ? 30 : -30),
			y: -height - 200,
			width,
			height,
			rotation: (i % 2 ? 1 : -1) * (6 + i * 2),
			borderRadius: 18,
			background: w.bg,
			children: [
				Layer.text(w.text, {
					fontFamily: "Syne",
					fontSize: CARD_FONT_SIZE,
					fill: w.fg,
					width,
					height,
					align: "center",
					verticalAlign: "middle",
				}),
			],
		});
		const body = world.body(layer, {
			restitution: 0.25,
			friction: 0.7,
			density: 1.5,
			angularDamping: 1.2,
			startFrame: w.at,
		});
		return { layer, body };
	});
}

/** A loose cloud of small particles around her, avoiding where she stands. */
function particles(world: PhysicsWorld2D, person: PersonTrack) {
	let seed = 7;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const out: Array<{
		layer: ReturnType<typeof Layer.shape>;
		body: PhysicsBody2D;
		color: string;
		home: [number, number];
	}> = [];
	for (let y = 430; y < FLOOR - 10; y += 24) {
		for (let x = 20; x < W - 20; x += 24) {
			const px = x + (rand() - 0.5) * 12;
			const py = y + (rand() - 0.5) * 12;
			if (person.sample(0, px, py).alpha > 0.15 || rand() > 0.5) continue;
			const r = 6 + rand() * 6;
			const color =
				PARTICLE_COLORS[Math.floor(rand() * PARTICLE_COLORS.length)];
			const layer = Layer.shape("circle", {
				position: "absolute",
				x: px - r,
				y: py - r,
				width: 2 * r,
				height: 2 * r,
				fill: color,
			});
			const body = world.body(layer, {
				restitution: 0.05,
				friction: 0.02,
				density: 0.25,
				linearDamping: 2.2,
				gravityScale: 0.06,
				lockRotation: true,
			});
			out.push({ layer, body, color, home: [px, py] });
		}
	}
	return out;
}

/** Out of the silhouette: `strength` where she is, plus `sweep` where she is arriving. */
function silhouettePush(person: PersonTrack, strength: number, sweep: number) {
	return (s: {
		x: number;
		y: number;
		frame: number;
	}): [number, number] | null => {
		const now = person.sample(s.frame, s.x, s.y);
		if (now.alpha < 0.02) return null;
		const before = person.sample(s.frame - 1, s.x, s.y);
		const g = Math.hypot(now.gx, now.gy) || 1;
		const k =
			now.alpha * strength + Math.max(0, now.alpha - before.alpha) * sweep;
		return [(-now.gx / g) * k, (-now.gy / g) * k];
	};
}

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: DURATION,
		backgroundColor: "#E9D3B4",
		fonts: [FONT_FILE],
	});
	const person = await performer(comp);

	const world = await Physics.world2d({
		fps: FPS,
		frames: DURATION,
		gravity: 2600,
		substeps: 6,
		impactDecay: 5,
	});
	world.walls({ width: W, height: FLOOR });

	for (const side of ["left", "right"] as const) {
		limb(world, person, `${side}Shoulder`, `${side}Elbow`, [0, 0.5, 1], 26);
		limb(
			world,
			person,
			`${side}Elbow`,
			`${side}Wrist`,
			[0.33, 0.66, 1, 1.25],
			24,
		);
	}
	limb(world, person, "leftShoulder", "rightShoulder", [0.5], 40);
	limb(world, person, "nose", "nose", [0], 52);

	const words = cards(world, person);
	const cloud = particles(world, person);
	const cloudBodies = cloud.map((p) => p.body);
	const home = new Map(cloud.map((p) => [p.body, p.home]));

	world.field(silhouettePush(person, 11000, 140000), { bodies: cloudBodies });
	world.field(silhouettePush(person, 16000, 60000), {
		bodies: words.map((w) => w.body),
	});
	// A slow swirling current keeps the cloud alive; a soft pull home keeps it on stage.
	world.field(
		(s) => {
			const t = s.frame / FPS;
			const [hx, hy] = home.get(s.body) ?? [s.x, s.y];
			return [
				140 * Math.sin(s.y * 0.009 + t * 1.7) + (hx - s.x) * 0.35,
				110 * Math.cos(s.x * 0.007 - t * 1.3) + (hy - s.y) * 0.6,
			];
		},
		{ bodies: cloudBodies },
	);
	world.simulate();

	// Particles glow as they speed up.
	for (const p of cloud) {
		const heat = Array.from({ length: DURATION }, (_, f) =>
			Math.min(1, p.body.speed.get({ frame: f, fps: FPS } as never) / 900),
		);
		p.layer.animate(
			LayerAnimation.create().colorSignal(
				"fillColor",
				Signal.fromArray(heat, FPS),
				{
					colorA: p.color,
					colorB: HOT,
				},
			),
		);
	}

	comp.add(
		Layer.box({
			id: "stage",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			children: [
				Layer.video(DANCER, {
					id: "plate",
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					fit: "cover",
				}),
				...cloud.map((p) => p.layer),
				Layer.video(DANCER, {
					id: "cutout",
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					fit: "cover",
					muted: true,
				}).withVision({ mode: "matte" }),
				...words.map((w) => w.layer),
			],
		}).animate(
			LayerAnimation.create().signal("y", world.impact, { multiplier: 10 }),
		),
	);

	for (const w of words) {
		const hit = w.body.collisions[0];
		console.log(
			`${w.layer.id}: first contact at frame ${hit?.frame ?? "-"} (${hit?.with.type ?? "none"})`,
		);
	}
	return comp;
}
