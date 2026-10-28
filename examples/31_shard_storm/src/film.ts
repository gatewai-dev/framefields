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

interface ShardCandidate {
	bx: number;
	by: number;
	sideZ: number;
	rx: number;
	ry: number;
	rz: number;
	baseScale: number;
	colorSeed: number;
	phase: number;
}

interface KeypointMotion {
	x: number;
	y: number;
	vx: number;
	vy: number;
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

/**
 * Precomputes staggered 3D shard candidate sites covering the dancer's motion envelope.
 */
function buildCandidateLattice(): ShardCandidate[] {
	const cols = 90;
	const rows = 76;
	const minX = -430;
	const maxX = 490;
	const minY = -690;
	const maxY = FLOOR_Y - 4;
	const stepX = (maxX - minX) / (cols - 1);
	const stepY = (maxY - minY) / (rows - 1);
	const candidates: ShardCandidate[] = [];

	let idx = 0;
	for (let r = 0; r < rows; r++) {
		const rowOffset = (r & 1) * (stepX * 0.5);
		for (let c = 0; c < cols; c++) {
			const h1 = hash01(idx * 3 + 1);
			const h2 = hash01(idx * 3 + 2);
			const h3 = hash01(idx * 3 + 3);
			const uZ = h3 * 2 - 1;
			// Bias depth toward front and back shells of the 3D volume
			const sideZ = (uZ >= 0 ? 1 : -1) * Math.abs(uZ) ** 0.62;
			candidates.push({
				bx: minX + c * stepX + rowOffset + (h1 - 0.5) * stepX * 0.85,
				by: minY + r * stepY + (h2 - 0.5) * stepY * 0.85,
				sideZ,
				rx: hash01(idx * 7 + 11) * 360,
				ry: hash01(idx * 7 + 13) * 360,
				rz: hash01(idx * 7 + 17) * 360,
				baseScale: 0.48 + hash01(idx * 5 + 19) * 0.46,
				colorSeed: hash01(idx * 11 + 23),
				phase: hash01(idx * 13 + 29) * Math.PI * 2,
			});
			idx++;
		}
	}
	return candidates;
}

/**
 * Samples the tracked pose keypoints and their frame-to-frame velocities once per frame.
 */
function computeJointMotion(
	person: PersonTrack,
	frame: number,
): KeypointMotion[] {
	const prev = Math.max(0, frame - 1);
	return TRACKED_JOINTS.map((name) => {
		const now = person.point(name, frame);
		const before = person.point(name, prev);
		return {
			x: now.x,
			y: now.y,
			vx: now.x - before.x,
			vy: now.y - before.y,
		};
	});
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
		const d2 = dx * dx + dy * dy + 1600;
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
	const energy = Math.min(1, rim * 0.55 + motion * 0.65);
	const palettePos = Math.min(
		BODY_PALETTE.length - 1,
		Math.floor(
			Math.min(0.999, core * 0.38 + energy * 0.48 + colorSeed * 0.25) *
				BODY_PALETTE.length,
		),
	);
	const color = energy > 0.88 ? BLUE_GLOW : (BODY_PALETTE[palettePos] ?? BLUE);
	const emissive = energy > 0.75 ? BLUE_SKY : energy > 0.4 ? BLUE : BLUE_DEEP;
	const emissiveIntensity = 0.06 + energy ** 2.0 * 0.42;
	return { color, emissive, emissiveIntensity };
}

/**
 * Evaluates a single candidate shard on the segmented dancer at `frame`.
 */
function evaluateDancerShard(
	cand: ShardCandidate,
	person: PersonTrack,
	joints: readonly KeypointMotion[],
	frame: number,
): InstanceTransform3D | undefined {
	const s = person.sample(frame, cand.bx, cand.by);
	if (s.alpha < 0.14) return undefined;

	const sPrev = person.sample(Math.max(0, frame - 1), cand.bx, cand.by);
	const dAlpha = Math.abs(s.alpha - sPrev.alpha);

	// Pull boundary shards inward along the silhouette gradient so they hug the contour
	const gMag = Math.hypot(s.gx, s.gy);
	const contourPull =
		s.alpha < 0.65 && gMag > 1e-5 ? ((0.65 - s.alpha) / 0.65) * 11 : 0;
	const nx = gMag > 1e-5 ? s.gx / gMag : 0;
	const ny = gMag > 1e-5 ? s.gy / gMag : 0;

	const vel = sampleLocalVelocity(joints, cand.bx, cand.by);
	const core = Math.min(1, Math.max(0, (s.alpha - 0.14) / 0.82));
	const dome = Math.sqrt(core);

	const x = cand.bx + nx * contourPull + vel.vx * 0.35;
	const y = Math.min(FLOOR_Y - 8, cand.by + ny * contourPull + vel.vy * 0.35);
	const z =
		cand.sideZ * dome * 78 +
		Math.sin(frame * 0.14 + cand.phase) * (2.5 + vel.speed * 0.15);

	const motion = Math.min(1, dAlpha * 3.8 + vel.speed * 0.045);
	const edgeScale = 0.58 + 0.48 * core ** 0.35;
	const scale = cand.baseScale * edgeScale * (1 + motion * 0.18);

	const spin = frame * (1.2 + cand.colorSeed * 1.4) + motion * 55;
	const rotX = cand.rx - ny * 42 + spin * 0.7;
	const rotY = cand.ry + nx * 42 + spin;
	const rotZ = cand.rz + vel.vx * 2.2 + spin * 0.5;

	const shaded = shadeDancerShard(core, motion, cand.colorSeed);
	return {
		x,
		y,
		z,
		scale,
		rotation: [rotX, rotY, rotZ],
		color: shaded.color,
		emissive: shaded.emissive,
		emissiveIntensity: shaded.emissiveIntensity,
	};
}

/**
 * Reconstructs the segmented dancer silhouette as a volumetric 3D sculpture of
 * faceted Framefields-blue shards (`Layer3D.instances`).
 */
function dancerShardBody(
	person: PersonTrack,
	variants: ReturnType<typeof createShardVariants>,
) {
	const candidates = buildCandidateLattice();
	let cachedFrame = -1;
	let cachedJoints: KeypointMotion[] = [];

	return Layer3D.instances({
		id: "dancer-shard-body",
		mesh: variants,
		count: candidates.length,
		material: "lit",
		roughness: 0.32,
		metallic: 0.28,
		specularIntensity: 0.85,
		ambientIntensity: 0.95,
		instanceAt: (i, frame) => {
			const f = Math.max(0, Math.min(DURATION - 1, Math.round(frame)));
			if (f !== cachedFrame) {
				cachedFrame = f;
				cachedJoints = computeJointMotion(person, f);
			}
			const cand = candidates[i];
			if (!cand) return undefined;
			return evaluateDancerShard(cand, person, cachedJoints, f);
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
	await dancer.ready(0);
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
