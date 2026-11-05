/**
 * Character animation for the compositor: poses a model from its clip
 * layers, look-at and IK constraints (targets in scene coordinates) and
 * spring bones (replayed from frame 0 and cached, so frames render the
 * same in any order); and the per-instance records of skinned crowds.
 */
import {
	type AimConstraint,
	type CrowdConfig,
	type JointPose,
	type LookAtConstraint,
	type Model3DNode,
	numberAt,
	type TrackClock,
	type TwoBoneIkConstraint,
	type Vec3Track,
	vec3At,
} from "@framefields/compositions/program";
import {
	type AnimationClip3D,
	applyConstraints,
	bakeCrowdPalette,
	blendClipLayers,
	type CrowdBake,
	createRandom,
	type Mat4,
	Matrix4Math,
	type Model3DData,
	poseNodes,
	type Quat,
	type RigClipLayer,
	type RigConstraints,
	type RigJointPose,
	type RigPose,
	resolveClips,
	SpringBones,
	type Vec3,
} from "@framefields/webgpu-renderers";

const transformPoint = (m: Mat4, p: Vec3): Vec3 => [
	m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
	m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
	m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const transformDir = (m: Mat4, v: Vec3): Vec3 => [
	m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
	m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
	m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

type CharacterNode = Pick<
	Model3DNode,
	"animationLayers" | "ik" | "lookAt" | "springBones" | "loop" | "pose" | "aim"
>;

/** Whether a node needs the rig evaluator (anything beyond one plain clip). */
export function hasRig(n: CharacterNode): boolean {
	return Boolean(
		n.animationLayers?.length ||
			n.ik?.length ||
			n.lookAt?.length ||
			n.springBones?.length ||
			(n.pose && Object.keys(n.pose).length) ||
			n.aim?.length,
	);
}

/** Local rotation for Euler degrees, applied Z, then Y, then X (R = Rz · Ry · Rx), like layers. */
function eulerQuat(rx: number, ry: number, rz: number): Quat {
	const h = (d: number) => (d * Math.PI) / 360;
	const [sx, cx] = [Math.sin(h(rx)), Math.cos(h(rx))];
	const [sy, cy] = [Math.sin(h(ry)), Math.cos(h(ry))];
	const [sz, cz] = [Math.sin(h(rz)), Math.cos(h(rz))];
	// qz · qy · qx
	return [
		cz * cy * sx - sz * sy * cx,
		cz * sy * cx + sz * cy * sx,
		sz * cy * cx - cz * sy * sx,
		cz * cy * cx + sz * sy * sx,
	];
}

function jointPoses(p: PoseInput, clock: TrackClock): RigJointPose[] {
	return Object.entries(p.node.pose ?? {}).map(
		([joint, j]: [string, JointPose]) => ({
			joint,
			rotation: eulerQuat(
				numberAt(j.rotateX, clock, 0),
				numberAt(j.rotateY, clock, 0),
				numberAt(j.rotateZ, clock, 0),
			),
			offset: [
				numberAt(j.x, clock, 0),
				numberAt(j.y, clock, 0),
				numberAt(j.z, clock, 0),
			] as Vec3,
			weight: numberAt(j.weight, clock, 1),
			mode: j.mode ?? "additive",
		}),
	);
}

export interface PoseInput {
	model: Model3DData;
	node: CharacterNode;
	/** The layer's own frame. */
	frame: number;
	fps: number;
	/** The single clip and its time when there are no `animationLayers`. */
	clip: AnimationClip3D | undefined;
	clipSec: number;
	/** Scene ← model (the model's world transform, root transform included). */
	sceneRoot: Mat4;
	/** Identifies the node across frames (spring state). */
	key: string;
}

function clipLayers(p: PoseInput, frame: number): RigClipLayer[] {
	const layers = p.node.animationLayers;
	if (!layers?.length) {
		return p.clip ? [{ clip: p.clip, time: p.clipSec, weight: 1 }] : [];
	}
	const out: RigClipLayer[] = [];
	for (const l of layers) {
		const [clip] = resolveClips(p.model, [l.clip]);
		if (!clip) continue;
		let time = (l.timeOffset ?? 0) + (frame / p.fps) * (l.speed ?? 1);
		if (clip.duration > 0) {
			time =
				(l.loop ?? true)
					? ((time % clip.duration) + clip.duration) % clip.duration
					: Math.min(Math.max(time, 0), clip.duration);
		}
		out.push({
			clip,
			time,
			weight: numberAt(l.weight, { frame, fps: p.fps }, 1),
			mask: l.mask,
		});
	}
	return out;
}

function constraintsAt(
	p: PoseInput,
	frame: number,
	toModel: Mat4,
): RigConstraints {
	const clock: TrackClock = { frame, fps: p.fps };
	const point = (t: Vec3Track) => transformPoint(toModel, vec3At(t, clock));
	const direction = (t: Vec3Track) => transformDir(toModel, vec3At(t, clock));
	return {
		pose: jointPoses(p, clock),
		aim: (p.node.aim ?? []).map((a: AimConstraint) => ({
			joint: a.joint,
			direction: direction(a.direction),
			weight: numberAt(a.weight, clock, 1),
			...(a.axis && { axis: a.axis }),
		})),
		ik: (p.node.ik ?? []).map((c: TwoBoneIkConstraint) => ({
			chain: c.chain,
			target: point(c.target),
			pole: c.poleTarget ? point(c.poleTarget) : undefined,
			weight: numberAt(c.weight, clock, 1),
		})),
		lookAt: (p.node.lookAt ?? []).map((c: LookAtConstraint) => ({
			joint: c.joint,
			target: point(c.target),
			weight: numberAt(c.weight, clock, 1),
			maxAngleDeg: c.maxAngleDeg ?? 70,
			axis: c.axis ?? [0, 0, 1],
		})),
	};
}

/** The pose before springs: blended clips, then constraints. */
function basePose(p: PoseInput, frame: number, toModel: Mat4): RigPose {
	const rig = blendClipLayers(p.model, clipLayers(p, frame));
	applyConstraints(rig, constraintsAt(p, frame, toModel));
	return rig;
}

interface SpringState {
	model: Model3DData;
	config: string;
	springs: SpringBones;
	/** Last frame stepped. */
	frame: number;
}

const springStates = new Map<string, SpringState>();

function springsAt(
	p: PoseInput,
	toModel: Mat4,
	rig: RigPose,
): SpringBones | undefined {
	const chains = p.node.springBones;
	if (!chains?.length) return undefined;
	const config = JSON.stringify([
		chains,
		p.node.animationLayers,
		p.node.pose,
		p.node.aim,
		p.fps,
	]);
	let s = springStates.get(p.key);
	const frame = Math.max(0, Math.floor(p.frame));
	if (!s || s.model !== p.model || s.config !== config || s.frame > frame) {
		const gravityModel = (g: Vec3 | undefined): Vec3 =>
			transformDir(toModel, g ?? [0, 0, 0]);
		s = {
			model: p.model,
			config,
			springs: new SpringBones(
				rig,
				chains.map((c) => ({ ...c, gravity: gravityModel(c.gravity) })),
			),
			frame: -1,
		};
		if (springStates.size > 256) springStates.clear();
		springStates.set(p.key, s);
	}
	for (let f = s.frame + 1; f <= frame; f++) {
		s.springs.step(basePose(p, f, toModel), 1 / p.fps);
		s.frame = f;
	}
	return s.springs;
}

/** Model-space node matrices for this frame. */
export function poseCharacter(p: PoseInput): Mat4[] {
	if (!hasRig(p.node)) return poseNodes(p.model, p.clip, p.clipSec);
	const toModel = Matrix4Math.invert(p.sceneRoot) ?? Matrix4Math.identity();
	const rig = basePose(p, p.frame, toModel);
	springsAt(p, toModel, rig)?.apply(rig);
	return rig.world();
}

// --- Crowds -------------------------------------------------------------------

const bakes = new WeakMap<Model3DData, Map<string, CrowdBake>>();
const palettes = new WeakMap<Float32Array, GPUBuffer>();

/** A baked palette on the GPU, uploaded once. */
export function paletteBuffer(
	device: GPUDevice,
	palette: Float32Array,
): GPUBuffer {
	let buffer = palettes.get(palette);
	if (!buffer) {
		buffer = device.createBuffer({
			label: "CrowdPalette",
			size: Math.max(64, palette.byteLength),
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(buffer, 0, palette);
		palettes.set(palette, buffer);
	}
	return buffer;
}

/** The model's crowd palette for these clips, baked once. */
export function crowdBake(
	model: Model3DData,
	crowd: CrowdConfig,
): CrowdBake | undefined {
	const key = JSON.stringify([crowd.clips, crowd.fps ?? 30]);
	let byKey = bakes.get(model);
	if (!byKey) {
		byKey = new Map();
		bakes.set(model, byKey);
	}
	let bake = byKey.get(key);
	if (!bake) {
		const clips = resolveClips(model, crowd.clips);
		if (!clips.length) return undefined;
		bake = bakeCrowdPalette(model, clips, crowd.fps ?? 30);
		byKey.set(key, bake);
	}
	return bake;
}

export interface CrowdInstanceAnim {
	clip?: number;
	animOffset?: number;
	animSpeed?: number;
}

/**
 * Instance `i`'s second record: (first baked frame, frames per loop, phase
 * in frames, frames per second of playback). Unset fields come from the seed: clip i % n, a random
 * phase, a speed within `speedRange`.
 */
export function crowdRecord(
	bake: CrowdBake,
	crowd: CrowdConfig,
	i: number,
	anim: CrowdInstanceAnim,
): [number, number, number, number] {
	const rand = createRandom((crowd.seed ?? 1) * 7919 + i * 104729);
	const pick = rand();
	const speedDraw = rand();
	const clipIndex = (anim.clip ?? i) % bake.clips.length;
	const range = bake.clips[Math.max(0, clipIndex)]!;
	const [s0, s1] = crowd.speedRange ?? [1, 1];
	const offset =
		anim.animOffset ??
		((crowd.phase ?? "random") === "random" ? pick * range.duration : 0);
	// Baked samples per second of this clip's time.
	const rate = range.duration > 0 ? range.count / range.duration : bake.fps;
	return [
		range.base,
		range.count,
		offset * rate,
		(anim.animSpeed ?? s0 + (s1 - s0) * speedDraw) * rate,
	];
}
