import fs from "node:fs";
import {
	CameraAnimation,
	Composition,
	FilmGrain,
	type InstanceTransform3D,
	Layer,
	Layer3D,
	LayerAnimation,
	type PersonTrack,
	type PoseKeypointName,
	Vignette,
} from "framefields";
import {
	BG,
	BLUE,
	BLUE_CORE,
	BLUE_DARK,
	BLUE_DEEP,
	BLUE_GLOW,
	BLUE_ICE,
	BLUE_ROYAL,
	BLUE_SKY,
	DANCER,
	DURATION,
	FLOOR_COLOR,
	FLOOR_Y,
	FPS,
	H,
	W,
} from "./theme.js";

export { DURATION };

interface SimShard {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	rx: number;
	ry: number;
	rz: number;
	wx: number;
	wy: number;
	wz: number;
	baseScale: number;
	colorSeed: number;
	age: number;
	maxAge: number;
}

interface SpawnSite {
	x: number;
	y: number;
	alpha: number;
}

interface KeypointMotion {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

interface FrameKinematics {
	joints: KeypointMotion[];
	axisX: number;
	hipY: number;
	spawns: SpawnSite[];
}

const TRACKED_JOINTS: readonly PoseKeypointName[] = [
	"nose",
	"leftShoulder",
	"rightShoulder",
	"leftElbow",
	"rightElbow",
	"leftWrist",
	"rightWrist",
	"leftHip",
	"rightHip",
	"leftKnee",
	"rightKnee",
	"leftAnkle",
	"rightAnkle",
];

const BODY_PALETTE = [
	BLUE_DARK,
	BLUE_ROYAL,
	BLUE_DEEP,
	BLUE_CORE,
	BLUE,
	BLUE_SKY,
	BLUE_ICE,
] as const;

/** Deterministic [0, 1) hash from integer seed. */
function hash01(n: number): number {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
	return x - Math.floor(x);
}

/**
 * 3D Camera motion:
 * Sweeping parallax orbit around the 3D shard dancer with a low grazing angle
 * above the glossy reflective floor plane.
 */
function camera() {
	const half = Math.round(DURATION * 0.5);
	const cameraAnim = CameraAnimation.camera()
		.fromTo("orbitAzimuth", -18, 20, {
			from: 0,
			to: DURATION,
			ease: "sine.inOut",
		})
		.fromTo("orbitElevation", 10, 6, {
			from: 0,
			to: half,
			ease: "power2.out",
		})
		.fromTo("orbitElevation", 6, 11, {
			from: half,
			to: DURATION,
			ease: "power2.inOut",
		})
		.fromTo("orbitRadius", 1660, 1550, {
			from: 0,
			to: half,
			ease: "power2.out",
		})
		.fromTo("orbitRadius", 1550, 1630, {
			from: half,
			to: DURATION,
			ease: "power2.in",
		});

	return Layer.camera({
		id: "main-camera",
		mode: "orbit",
		targetX: 0,
		targetY: -155,
		targetZ: 0,
		lens: {
			focalLength: 50,
			sensorWidth: 36,
			near: 1,
			far: 20000,
			zoom: 1,
			fov: 44,
		},
		animation: cameraAnim,
	});
}

/**
 * Procedural shard variations generated with Fibonacci half-space clipping.
 */
function createShardVariants() {
	return [
		Layer3D.shard({
			radius: 14,
			facets: 12,
			irregularity: 0.35,
			seed: 101,
			color: "#ffffff",
			roughness: 0.24,
			metallic: 0.36,
		}),
		Layer3D.shard({
			radius: 18,
			facets: 16,
			irregularity: 0.46,
			seed: 202,
			color: "#ffffff",
			roughness: 0.22,
			metallic: 0.4,
		}),
		Layer3D.shard({
			radius: 12,
			facets: 10,
			irregularity: 0.3,
			seed: 303,
			color: "#ffffff",
			roughness: 0.28,
			metallic: 0.32,
		}),
		Layer3D.shard({
			radius: 21,
			facets: 18,
			irregularity: 0.5,
			seed: 404,
			color: "#ffffff",
			roughness: 0.25,
			metallic: 0.38,
		}),
		Layer3D.shard({
			radius: 16,
			facets: 14,
			irregularity: 0.4,
			seed: 505,
			color: "#ffffff",
			roughness: 0.26,
			metallic: 0.35,
		}),
		Layer3D.shard({
			radius: 13,
			facets: 12,
			irregularity: 0.42,
			seed: 606,
			color: "#ffffff",
			roughness: 0.28,
			metallic: 0.3,
		}),
	];
}

const BODY_SHARD_COUNT = 1380;

/**
 * Samples interior silhouette points on `frame` for spawning and respawning shards.
 */
function sampleSilhouetteSpawns(
	person: PersonTrack,
	frame: number,
): SpawnSite[] {
	const sites: SpawnSite[] = [];
	const cols = 42;
	const rows = 38;
	const minX = -390;
	const maxX = 450;
	const minY = -650;
	const maxY = FLOOR_Y - 12;
	const stepX = (maxX - minX) / (cols - 1);
	const stepY = (maxY - minY) / (rows - 1);

	for (let r = 0; r < rows; r++) {
		const y = minY + r * stepY + (hash01(frame * 31 + r) - 0.5) * stepY * 0.6;
		for (let c = 0; c < cols; c++) {
			const x =
				minX + c * stepX + (hash01(frame * 17 + c * 7 + r) - 0.5) * stepX * 0.6;
			const s = person.sample(frame, x, y);
			if (s.alpha >= 0.24) {
				sites.push({ x, y, alpha: s.alpha });
			}
		}
	}
	if (sites.length === 0) {
		const hip = person.point("leftHip", frame);
		sites.push({ x: hip.x, y: hip.y, alpha: 1 });
	}
	return sites;
}

/**
 * Computes tracked pose velocities, spine axis, and interior spawn sites for `frame`.
 */
function computeFrameKinematics(
	person: PersonTrack,
	frame: number,
): FrameKinematics {
	const prev = Math.max(0, frame - 1);
	const joints = TRACKED_JOINTS.map((name) => {
		const now = person.point(name, frame);
		const before = person.point(name, prev);
		return {
			x: now.x,
			y: now.y,
			vx: now.x - before.x,
			vy: now.y - before.y,
		};
	});
	const lHip = person.point("leftHip", frame);
	const rHip = person.point("rightHip", frame);
	const lSho = person.point("leftShoulder", frame);
	const rSho = person.point("rightShoulder", frame);
	const axisX = (lHip.x + rHip.x + lSho.x + rSho.x) * 0.25;
	const hipY = (lHip.y + rHip.y) * 0.5;
	const spawns = sampleSilhouetteSpawns(person, frame);
	return { joints, axisX, hipY, spawns };
}

/**
 * Finds local limb velocity near `(x, y)` weighted by inverse distance to tracked joints.
 */
function sampleLocalVelocity(
	joints: readonly KeypointMotion[],
	x: number,
	y: number,
): { vx: number; vy: number; speed: number } {
	let wx = 0;
	let wy = 0;
	let wSum = 1e-5;
	for (const j of joints) {
		const dx = x - j.x;
		const dy = y - j.y;
		const d2 = dx * dx + dy * dy + 1100;
		const w = 1 / d2;
		wx += j.vx * w;
		wy += j.vy * w;
		wSum += w;
	}
	const vx = wx / wSum;
	const vy = wy / wSum;
	return { vx, vy, speed: Math.hypot(vx, vy) };
}

/**
 * Selects Framefields blue shade and emissive glow from silhouette depth and local motion.
 */
function shadeDancerShard(
	core: number,
	motion: number,
	colorSeed: number,
): { color: string; emissive: string; emissiveIntensity: number } {
	const rim = Math.max(0, 1 - core * 1.45);
	const energy = Math.min(1, rim * 0.45 + motion * 0.72);
	const palettePos = Math.min(
		BODY_PALETTE.length - 1,
		Math.floor(
			Math.min(0.999, core * 0.34 + energy * 0.52 + colorSeed * 0.24) *
				BODY_PALETTE.length,
		),
	);
	const color = energy > 0.84 ? BLUE_GLOW : (BODY_PALETTE[palettePos] ?? BLUE);
	const emissive = energy > 0.72 ? BLUE_SKY : energy > 0.36 ? BLUE : BLUE_DEEP;
	const emissiveIntensity = 0.07 + energy ** 1.85 * 0.46;
	return { color, emissive, emissiveIntensity };
}

/**
 * Spawns or respawns shard `i` inside the segmented dancer silhouette at `frame`.
 */
function respawnShard(
	i: number,
	frame: number,
	kin: FrameKinematics,
	staggerAge: boolean,
): SimShard {
	const spawns = kin.spawns;
	const pickIdx =
		Math.floor(hash01(i * 73 + frame * 131 + 19) * spawns.length) %
		spawns.length;
	const site = spawns[pickIdx] ?? { x: kin.axisX, y: kin.hipY, alpha: 1 };
	const jitterX = (hash01(i * 19 + frame * 41 + 3) - 0.5) * 14;
	const jitterY = (hash01(i * 23 + frame * 43 + 5) - 0.5) * 14;
	const x = site.x + jitterX;
	const y = Math.min(FLOOR_Y - 10, site.y + jitterY);

	const dome = Math.sqrt(Math.max(0.05, (site.alpha - 0.14) / 0.86));
	const uZ = hash01(i * 29 + frame * 53 + 7) * 2 - 1;
	const z = (uZ >= 0 ? 1 : -1) * Math.abs(uZ) ** 0.65 * dome * 78;

	const vel = sampleLocalVelocity(kin.joints, x, y);
	const maxAge = 34 + Math.floor(hash01(i * 37 + 11) * 44);
	const age = staggerAge ? Math.floor(hash01(i * 41 + 13) * (maxAge - 4)) : 0;

	return {
		x,
		y,
		z,
		vx: vel.vx,
		vy: vel.vy,
		vz: (x - kin.axisX) * 0.08,
		rx: hash01(i * 7 + 11) * 360,
		ry: hash01(i * 7 + 13) * 360,
		rz: hash01(i * 7 + 17) * 360,
		wx: (hash01(i * 11 + 19) - 0.5) * 15,
		wy: 5.5 + hash01(i * 13 + 23) * 9.5,
		wz: (hash01(i * 17 + 29) - 0.5) * 13,
		baseScale: 0.52 + hash01(i * 5 + 31) * 0.48,
		colorSeed: hash01(i * 11 + 37),
		age,
		maxAge,
	};
}

/**
 * Advances a single 3D shard by one frame inside the segmented dancer volume,
 * combining skeletal limb advection, 3D dress vortex rotation, curl turbulence,
 * and silhouette-gradient boundary sliding.
 */
function stepShard(
	shard: SimShard,
	i: number,
	frame: number,
	kin: FrameKinematics,
	person: PersonTrack,
): SimShard {
	shard.age += 1;
	if (shard.age >= shard.maxAge) {
		return respawnShard(i, frame, kin, false);
	}

	const vel = sampleLocalVelocity(kin.joints, shard.x, shard.y);

	// 3D cylindrical vortex around the dancer's spine axis (stronger in spinning skirt)
	const skirtWeight = Math.min(
		1,
		Math.max(0.35, (shard.y - (kin.hipY - 90)) / 240),
	);
	const omega = 0.075 + skirtWeight * 0.065;
	const dxAxis = shard.x - kin.axisX;
	const orbVx = -shard.z * omega * 1.45;
	const orbVz = dxAxis * omega * 0.72;

	// Helical curl wave so shards weave organically along arms and dress folds
	const phase = shard.colorSeed * Math.PI * 2 + i * 0.13;
	const curlVx = Math.sin(shard.y * 0.028 + frame * 0.22 + phase) * 3.4;
	const curlVy =
		Math.cos(shard.x * 0.028 - frame * 0.19 + phase) * 2.8 -
		(1 - skirtWeight) * 1.6;

	const targetVx = vel.vx * 1.08 + orbVx + curlVx;
	const targetVy = vel.vy * 1.08 + curlVy;
	const targetVz = orbVz + Math.sin(frame * 0.18 + phase) * 2.4;

	shard.vx = shard.vx * 0.42 + targetVx * 0.58;
	shard.vy = shard.vy * 0.42 + targetVy * 0.58;
	shard.vz = shard.vz * 0.45 + targetVz * 0.55;

	shard.x += shard.vx;
	shard.y = Math.min(FLOOR_Y - 8, shard.y + shard.vy);
	shard.z += shard.vz;

	const s = person.sample(frame, shard.x, shard.y);
	if (s.alpha < 0.12) {
		return respawnShard(i, frame, kin, false);
	}

	// Confine and slide shards along the moving silhouette contour
	if (s.alpha < 0.58) {
		const gMag = Math.hypot(s.gx, s.gy);
		if (gMag > 1e-5) {
			const nx = s.gx / gMag;
			const ny = s.gy / gMag;
			const pull = ((0.58 - s.alpha) / 0.58) * 10.5;
			shard.x += nx * pull;
			shard.y = Math.min(FLOOR_Y - 8, shard.y + ny * pull);
			const outDot = shard.vx * nx + shard.vy * ny;
			if (outDot < 0) {
				shard.vx -= outDot * nx * 1.25;
				shard.vy -= outDot * ny * 1.25;
			}
		}
	}

	// Wrap Z smoothly inside the 3D volume shell
	const dome = Math.sqrt(Math.max(0.06, (s.alpha - 0.12) / 0.88));
	const maxZ = dome * 82;
	if (Math.abs(shard.z) > maxZ) {
		shard.z *= 0.82;
		shard.vz = -shard.vz * 0.5;
	}

	// Vigorous 3D tumbling amplified by local shard speed
	const speed = Math.hypot(shard.vx, shard.vy, shard.vz * 0.6);
	const spinBoost = 1 + Math.min(2.2, speed * 0.14);
	shard.rx += shard.wx * spinBoost + shard.vy * 0.65;
	shard.ry += shard.wy * spinBoost + shard.vx * 0.85;
	shard.rz += shard.wz * spinBoost + (shard.vx - shard.vy) * 0.45;

	return shard;
}

/**
 * Converts a simulated shard state at `frame` into a rendered `InstanceTransform3D`.
 */
function shardToInstance(
	shard: SimShard,
	person: PersonTrack,
	frame: number,
): InstanceTransform3D {
	const s = person.sample(frame, shard.x, shard.y);
	const core = Math.min(1, Math.max(0, (s.alpha - 0.12) / 0.84));
	const speed = Math.hypot(shard.vx, shard.vy, shard.vz * 0.5);
	const motion = Math.min(1, speed * 0.085);

	const fadeIn = Math.min(1, (shard.age + 1) / 5);
	const fadeOut = Math.min(1, (shard.maxAge - shard.age) / 6);
	const lifeEnv = fadeIn * fadeOut;
	const edgeScale = 0.6 + 0.46 * core ** 0.35;
	const scale = shard.baseScale * edgeScale * lifeEnv * (1 + motion * 0.24);

	const shaded = shadeDancerShard(core, motion, shard.colorSeed);
	return {
		x: shard.x,
		y: shard.y,
		z: shard.z,
		scale,
		rotation: [shard.rx, shard.ry, shard.rz],
		color: shaded.color,
		emissive: shaded.emissive,
		emissiveIntensity: shaded.emissiveIntensity,
	};
}

/**
 * Pre-simulates the dynamic 3D shard trajectories across all frames of the clip.
 */
function simulateDancerShardTimeline(
	person: PersonTrack,
): InstanceTransform3D[][] {
	const timeline: InstanceTransform3D[][] = [];
	const kin0 = computeFrameKinematics(person, 0);
	const shards: SimShard[] = Array.from({ length: BODY_SHARD_COUNT }, (_, i) =>
		respawnShard(i, 0, kin0, true),
	);

	timeline.push(shards.map((sh) => shardToInstance(sh, person, 0)));

	for (let f = 1; f < DURATION; f++) {
		const kin = computeFrameKinematics(person, f);
		const frameInstances: InstanceTransform3D[] = new Array(BODY_SHARD_COUNT);
		for (let i = 0; i < BODY_SHARD_COUNT; i++) {
			const current = shards[i];
			if (!current) continue;
			const updated = stepShard(current, i, f, kin, person);
			shards[i] = updated;
			frameInstances[i] = shardToInstance(updated, person, f);
		}
		timeline.push(frameInstances);
	}
	return timeline;
}

/**
 * Reconstructs the segmented dancer silhouette as a flowing, swirling 3D volume of
 * faceted Framefields-blue shards (`Layer3D.instances`).
 */
function dancerShardBody(
	person: PersonTrack,
	variants: ReturnType<typeof createShardVariants>,
) {
	const timeline = simulateDancerShardTimeline(person);

	return Layer3D.instances({
		id: "dancer-shard-body",
		mesh: variants,
		count: BODY_SHARD_COUNT,
		material: "lit",
		roughness: 0.28,
		metallic: 0.32,
		specularIntensity: 0.92,
		ambientIntensity: 0.9,
		instanceAt: (i, frame) => {
			const f = Math.max(0, Math.min(DURATION - 1, Math.round(frame)));
			return timeline[f]?.[i];
		},
	});
}

/**
 * GPU-simulated 3D shard swarm shed from the dancer's spinning dress onto the
 * glossy studio floor, kicked and swirled by her tracked limbs.
 */
function sheddingShardSwarm(
	person: PersonTrack,
	variants: ReturnType<typeof createShardVariants>,
) {
	const hipX = (f: number) =>
		(person.point("leftHip", f).x + person.point("rightHip", f).x) * 0.5;

	return Layer3D.swarm({
		id: "dancer-shed-shards",
		max: 560,
		seed: 42,
		prewarm: 2.0,
		substeps: 4,
		mesh: variants,
		emitter: {
			shape: "sphere",
			x: hipX,
			y: FLOOR_Y - 58,
			z: 0,
			radius: 105,
			rate: 240,
			bursts: [
				{ frame: 0, count: 140 },
				{ frame: 48, count: 90 },
				{ frame: 96, count: 90 },
			],
		},
		lifetime: [1.6, 3.1],
		speed: [60, 190],
		size: [8, 17],
		sizeJitter: 0.42,
		fade: [0.1, 0.3],
		gravity: [0, 820, 0],
		drag: 1.15,
		vortex: {
			axis: [0, 1, 0],
			swirl: 380,
			radius: 220,
			pull: 95,
		},
		attractors: [
			{
				x: (f) => person.point("leftAnkle", f).x,
				y: FLOOR_Y - 14,
				z: 0,
				strength: -480,
				radius: 165,
			},
			{
				x: (f) => person.point("rightAnkle", f).x,
				y: FLOOR_Y - 14,
				z: 0,
				strength: -480,
				radius: 165,
			},
			{
				x: (f) => person.point("leftWrist", f).x,
				y: (f) => person.point("leftWrist", f).y,
				z: 20,
				strength: -380,
				radius: 150,
			},
			{
				x: (f) => person.point("rightWrist", f).x,
				y: (f) => person.point("rightWrist", f).y,
				z: -20,
				strength: -380,
				radius: 150,
			},
		],
		noise: {
			strength: 140,
			scale: 220,
			speed: 0.6,
		},
		floor: {
			y: FLOOR_Y,
			bounce: 0.2,
			friction: 0.98,
			heatGain: 1.1,
			heatDecay: 0.75,
		},
		angularSpeed: [90, 320],
		color: [BLUE_ROYAL, BLUE_DEEP, BLUE_CORE, BLUE, BLUE_SKY],
		heat: {
			source: "both",
			maxSpeed: 950,
			color: [BLUE_DEEP, BLUE, BLUE_SKY, BLUE_ICE],
			intensity: 0.85,
			curve: 1.85,
		},
		sparks: {
			max: 800,
			rate: 280,
			threshold: 0.48,
			speed: [130, 360],
			lifetime: [0.2, 0.5],
			size: [1.3, 2.5],
			stretch: 0.05,
			color: BLUE_SKY,
			intensity: 1.15,
		},
		material: "lit",
		roughness: 0.3,
		metallic: 0.3,
		specularIntensity: 0.9,
		ambientIntensity: 0.85,
	});
}

/**
 * Picture-in-Picture card in the top-right corner displaying the original dancer video.
 */
function originalVideoPip() {
	const pipW = 440;
	const pipH = 248;
	const margin = 44;

	const cardAnim = LayerAnimation.create().fromTo("y", margin - 14, margin, {
		from: 0,
		to: 16,
		ease: "power3.out",
	});

	return Layer.box({
		id: "original-video-pip",
		position: "absolute",
		x: W - pipW - margin,
		y: margin,
		width: pipW,
		height: pipH,
		borderRadius: 16,
		borderWidth: 2,
		borderColor: "rgba(59, 130, 246, 0.72)",
		background: "#050B1A",
		overflow: "hidden",
		animation: cardAnim,
		children: [
			Layer.video(DANCER, {
				id: "original-dancer-video",
				width: pipW,
				height: pipH,
				fit: "cover",
				muted: false,
				durationFrames: DURATION,
			}),
		],
	});
}

/**
 * Builds the complete Framefields-blue Vision Shard Dancer composition.
 */
export async function buildFilm(): Promise<Composition> {
	if (!fs.existsSync(DANCER)) {
		throw new Error(
			`Missing ${DANCER}. Generate it with \`pnpm assets\` in examples/19_framefields_film.`,
		);
	}

	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: DURATION,
		backgroundColor: BG,
	});

	const dancer = comp.vision(DANCER);
	await dancer.ready(0, DURATION - 1);
	const person = dancer.person.place({
		x: -912,
		y: -752,
		width: W,
		height: H,
		fit: "cover",
	});

	// 1. Camera
	comp.add(camera());

	// 2. Physically-based environment with glossy planar floor reflection
	comp.add(
		Layer.environment("night", {
			exposure: 0.48,
			rotation: 25,
			bloom: {
				intensity: 0.14,
				threshold: 2.1,
				radius: 4,
			},
			floor: {
				y: FLOOR_Y,
				color: FLOOR_COLOR,
				reflectivity: 0.92,
				roughness: 0.2,
				fadeDistance: 1350,
				opacity: 1.0,
			},
			fog: {
				color: BG,
				start: 1350,
				end: 3100,
				opacity: 0.6,
			},
		}),
	);

	// 3. 3D Lighting rig sculpted for Framefields blue facets
	comp.add([
		// Cool icy key light from top-left-front to carve polyhedron facets
		Layer.light({
			id: "key-light",
			lightType: "directional",
			color: "#e0f2fe",
			intensity: 1.85,
			direction: [0.48, 0.65, 0.58],
		}),
		// Deep Framefields blue fill light from right
		Layer.light({
			id: "fill-light",
			lightType: "directional",
			color: BLUE,
			intensity: 1.35,
			direction: [-0.72, 0.32, 0.62],
		}),
		// Bright sky-blue rim light from behind to outline the 3D shard silhouette
		Layer.light({
			id: "rim-light",
			lightType: "directional",
			color: BLUE_ICE,
			intensity: 1.45,
			direction: [0.1, 0.35, -0.93],
		}),
	]);

	// 4. Shared faceted shard geometry variants
	const variants = createShardVariants();

	// 5. Segmented dancer reconstructed as a 3D volume of Framefields-blue shards
	comp.add(dancerShardBody(person, variants));

	// 6. Shedding 3D shards & sparks cascading onto the glossy floor around her feet
	comp.add(sheddingShardSwarm(person, variants));

	// 7. Original dancer video in a top-right Picture-in-Picture card (no text)
	comp.add(originalVideoPip());

	// 8. Subtle cinematic grading
	comp.apply(new Vignette({ strength: 32, softness: 0.45 }));
	comp.apply(new FilmGrain({ strength: 3, size: 1.1 }));

	return comp;
}
