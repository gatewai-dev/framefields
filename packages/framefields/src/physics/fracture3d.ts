/**
 * Voronoi destruction: a mesh layer stays whole (a fixed collider of its
 * own shape) until its fracture frame, or until a body hits it, then its
 * pieces wake as rigid bodies and fly apart. The pieces' recorded poses go
 * into the node (`fracture3d.track`), where the renderer turns them into
 * the joints of one rigidly skinned mesh.
 */
import type {
	Fracture3DSpec,
	LayoutNode,
} from "@framefields/compositions/program";
import {
	createRandom,
	fractureModel,
	type Mat4,
	Matrix4Math,
	type Model3DData,
} from "@framefields/webgpu-renderers";
import type { Vec3 } from "./backend.js";
import type { LayerLike, PhysicsBody3D, PhysicsWorld3D } from "./world3d.js";

export interface Fracture3DOptions {
	/** Voronoi pieces (2..256). Default 48. */
	cells?: number;
	/** Same seed, same pieces. Default 1. */
	seed?: number;
	/** Scene point (px) the pieces crowd around and fly from. */
	impactPoint?: [number, number, number];
	/**
	 * Composition frame the layer breaks at, or `"onImpact"` (default): the
	 * first frame a body hits it.
	 */
	fractureFrame?: number | "onImpact";
	/** Color of the faces the break exposes. Default "#d8d2c4". */
	interiorColor?: string;
	/** Roughness of the exposed faces. Default 0.9. */
	interiorRoughness?: number;
	/** Outward speed at the impact point, px/s, fading with distance. Default 0. */
	explosionSpeed?: number;
	/** Random tumble, degrees per second. Default a third of `explosionSpeed`. */
	spin?: number;
	/** Share of the hitting body's velocity the nearest pieces take. Default 0.35. */
	momentumTransfer?: number;
	density?: number;
	friction?: number;
	restitution?: number;
}

/** A fractured layer: its pieces, and the collider that stands in for it while whole. */
export class Fracture3D {
	/** @internal */ brokeAt?: number;

	/** @internal */
	constructor(
		readonly node: LayoutNode,
		readonly pieces: readonly PhysicsBody3D[],
		readonly intact: PhysicsBody3D,
		private readonly world: PhysicsWorld3D,
	) {}

	/** Composition frame it broke at (after simulating); undefined if it never did. */
	get frame(): number | undefined {
		return this.brokeAt === undefined
			? undefined
			: this.world.startFrame + this.brokeAt;
	}
}

const NEVER = Number.MAX_SAFE_INTEGER;
const num = (v: unknown, fallback: number) =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback;

interface NodePose {
	position: Vec3;
	rotation: Vec3;
	scale: Vec3;
	matrix: Mat4;
}

/** The node's placement as the renderer builds it: T · Rz · Ry · Rx · S. */
function nodePose(t: LayerLike): NodePose {
	const position: Vec3 = [num(t.x, 0), num(t.y, 0), num(t.z, 0)];
	const rotation: Vec3 = [
		num(t.rotateX, 0),
		num(t.rotateY, 0),
		num(t.rotateZ, num(t.rotation, 0)),
	];
	const s = num(t.scale, 1);
	const scale: Vec3 = [
		s * num(t.scaleX, 1),
		s * num(t.scaleY, 1),
		s * num(t.scaleZ, 1),
	];
	const rad = (d: number) => (d * Math.PI) / 180;
	let m = Matrix4Math.translate(...position);
	m = Matrix4Math.multiply(m, Matrix4Math.rotateZ(rad(rotation[2])));
	m = Matrix4Math.multiply(m, Matrix4Math.rotateY(rad(rotation[1])));
	m = Matrix4Math.multiply(m, Matrix4Math.rotateX(rad(rotation[0])));
	m = Matrix4Math.multiply(m, Matrix4Math.scale(...scale));
	return { position, rotation, scale, matrix: m };
}

const apply = (m: Mat4, p: Vec3): Vec3 => [
	m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
	m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
	m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** @internal */
export function createFracture(
	world: PhysicsWorld3D,
	target: LayoutNode,
	options: Fracture3DOptions,
): Fracture3D {
	const node = target as unknown as LayerLike;
	const model = node.modelData as Model3DData | undefined;
	if (!model?.meshes?.length) {
		const id = typeof node.id === "string" ? ` "${node.id}"` : "";
		throw new Error(
			`Physics.fracture: layer${id} has no mesh. Fracture a Layer3D primitive, extruded text, or a model node that carries modelData.`,
		);
	}
	const pose = nodePose(node);
	const toObject = Matrix4Math.invert(pose.matrix) ?? Matrix4Math.identity();
	const spec: Fracture3DSpec = {
		cells: Math.max(2, Math.min(256, Math.round(options.cells ?? 48))),
		seed: options.seed ?? 1,
		...(options.impactPoint && {
			impactPoint: apply(toObject, options.impactPoint),
		}),
		...(options.interiorColor && { interiorColor: options.interiorColor }),
		...(options.interiorRoughness !== undefined && {
			interiorRoughness: options.interiorRoughness,
		}),
	};
	const { cells } = fractureModel(model, spec);
	node.fracture3d = spec;

	const intact = world.body(target, { type: "fixed", output: "none" });
	const pieces = cells.map((cell) =>
		world.shapedBody(
			undefined,
			apply(pose.matrix, cell.centroid),
			pose.rotation,
			{
				kind: "hull",
				// A hair smaller than the piece, so neighbors start apart.
				points: cell.hull.map((v, i) => v * pose.scale[i % 3]! * 0.97),
			},
			{
				type: "dynamic",
				startFrame: NEVER,
				output: "none",
				density: options.density,
				friction: options.friction,
				restitution: options.restitution ?? 0.2,
			},
		),
	);
	const fracture = new Fracture3D(target, pieces, intact, world);
	const radius = model.bounds.boundingSphereRadius * Math.max(...pose.scale);

	world.onStep((f, pairs) => {
		if (fracture.brokeAt !== undefined) return;
		const ff = options.fractureFrame ?? "onImpact";
		const hit = pairs.find(
			([a, b]) =>
				(a === intact && b.type === "dynamic") ||
				(b === intact && a.type === "dynamic"),
		);
		const hitter = hit ? (hit[0] === intact ? hit[1] : hit[0]) : undefined;
		const due =
			ff === "onImpact" ? Boolean(hitter) : f >= ff - world.startFrame;
		if (!due) return;
		fracture.brokeAt = f;
		intact.sim.setEnabled(false);
		breakApart(world, pieces, options, radius, pose.position, hitter, f);
	});
	world.onSimulated(() => {
		spec.track = recordTrack(pieces, world.startFrame + world.frames);
	});
	return fracture;
}

/** Wakes every piece: outward from the impact, plus some of the hitter's momentum. */
function breakApart(
	world: PhysicsWorld3D,
	pieces: readonly PhysicsBody3D[],
	options: Fracture3DOptions,
	radius: number,
	center: Vec3,
	hitter: PhysicsBody3D | undefined,
	frame: number,
): void {
	const ppm = world.pixelsPerMeter;
	const hitAt = hitter?.sim.position().map((v) => v * ppm) as Vec3 | undefined;
	const transfer = options.momentumTransfer ?? 0.35;
	// The stand-in collider just bounced the hitter; it should have gone on
	// through, handing some of its momentum to the pieces.
	const hitVel: Vec3 = [0, 0, 0];
	if (hitter) {
		const at = world.startFrame + frame - 1;
		const rec = hitter.recording;
		hitVel[0] = rec.channel("vx")[at] ?? 0;
		hitVel[1] = rec.channel("vy")[at] ?? 0;
		hitVel[2] = rec.channel("vz")[at] ?? 0;
		hitter.sim.setVelocity(
			hitVel.map((v) => (v * (1 - transfer)) / ppm) as Vec3,
			hitter.sim.angularVelocity(),
		);
	}
	const impact = options.impactPoint ?? hitAt ?? center;
	const speed = options.explosionSpeed ?? 0;
	const spin = options.spin ?? speed / 3;
	const rand = createRandom((options.seed ?? 1) * 7717 + 3);
	for (const piece of pieces) {
		const p = piece.center();
		const d: Vec3 = [p[0] - impact[0], p[1] - impact[1], p[2] - impact[2]];
		const dist = Math.hypot(...d) || 1;
		const falloff = 1 / (1 + (dist / Math.max(1, radius)) ** 2);
		const v = d.map(
			(x, i) => (x / dist) * speed * falloff + hitVel[i]! * transfer * falloff,
		) as Vec3;
		const axis = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
		const len = Math.hypot(...axis) || 1;
		const w = axis.map((a) => (a / len) * spin * (0.5 + rand())) as Vec3;
		piece.wake(frame, v, w);
	}
}

/** Every piece's pose per composition frame: [x, y, z, qx, qy, qz, qw] each. */
function recordTrack(
	pieces: readonly PhysicsBody3D[],
	frames: number,
): number[] {
	const channels = pieces.map((b) =>
		["x", "y", "z", "qx", "qy", "qz", "qw"].map((c) => b.recording.channel(c)),
	);
	const out: number[] = new Array(frames * pieces.length * 7);
	let k = 0;
	for (let f = 0; f < frames; f++) {
		for (const ch of channels) {
			for (let c = 0; c < 7; c++) {
				const v = ch[c]![f] ?? 0;
				// 1e-5 px and 1e-7 per quaternion component: compact JSON, and
				// pieces resting side by side stay sealed (no sub-pixel cracks).
				out[k++] =
					c < 3 ? Math.round(v * 1e5) / 1e5 : Math.round(v * 1e7) / 1e7;
			}
		}
	}
	return out;
}
