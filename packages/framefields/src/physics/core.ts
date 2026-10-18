import {
	type AnimatableProp,
	type KeyframeTuple,
	LayerAnimation,
} from "@framefields/compositions/program";
import { type FrameContext, type FrameSignal, Signal } from "@framefields/core";
import type { SimBody, SimWorld } from "./backend.js";

/**
 * A value read every simulated frame: a number, a signal (sampled at the
 * composition frame, like `.signal()` tracks), or `(frame) => value` where
 * `frame` is the composition frame.
 */
export type PhysicsDriver =
	| number
	| ((frame: number) => number)
	| { get(ctx?: FrameContext): number };

export interface PhysicsWorldOptions {
	/** Composition frame rate. */
	fps: number;
	/** How many frames to simulate. Signals hold the last frame afterwards. */
	frames: number;
	/**
	 * Composition frame the simulation's frame 0 lands on (default 0). Set it
	 * to a scene's start so a world inside that scene starts with it.
	 */
	startFrame?: number;
	/** Pixels per physics meter (default 100). Only changes how stiff and heavy things feel. */
	pixelsPerMeter?: number;
	/** Solver steps per frame (default 4). Raise for fast, thin or stacked bodies. */
	substeps?: number;
	/** Frames an impact envelope takes to fall to ~37% (default 8). */
	impactDecay?: number;
	/** Velocity change, px/s, that reads as impact 1 (default 1500). */
	impactReference?: number;
}

export interface BodyCommonOptions {
	/** `"dynamic"` (default) falls and collides; `"fixed"` never moves; `"kinematic"` follows `follow` and pushes others. */
	type?: "dynamic" | "fixed" | "kinematic";
	/** Bounciness, 0–1 (default 0.3). */
	restitution?: number;
	/** Default 0.6. */
	friction?: number;
	/** Mass per area/volume (default 1). Heavier bodies push lighter ones. */
	density?: number;
	/** Velocity damping per second (default 0). */
	linearDamping?: number;
	/** Spin damping per second (default 0). */
	angularDamping?: number;
	/** Multiplies world gravity for this body (default 1; 0 floats). */
	gravityScale?: number;
	/** Never rotates. */
	lockRotation?: boolean;
	/** Continuous collision detection for very fast bodies (default false). */
	ccd?: boolean;
	/** Collides with nothing; still moves, still reports contacts (triggers). */
	sensor?: boolean;
	/** Simulation frame the body wakes up; it holds its place before (default 0). */
	startFrame?: number;
	/**
	 * How the result reaches the layer: `"signals"` (default) binds the
	 * body's signals, `"keyframes"` writes plain keyframes, `"none"` leaves
	 * the layer alone (read the signals yourself).
	 */
	output?: "signals" | "keyframes" | "none";
}

/** What `world.live()` needs from a composition. */
export interface LiveHost {
	onPrepareFrame(
		callback: (ctx: { frame: number }) => Promise<void> | void,
	): unknown;
	prepareVision?(frame: number): Promise<void>;
}

interface Stepper<B, V, R> {
	/** Last simulated frame, relative to the world's start. */
	current: number;
	freed: boolean;
	bySim: Map<SimBody<V, R>, B>;
	kinematicFrom: Map<B, { position: V; rotation: R }>;
	/** Impact envelope level per body after `current`. */
	level: Map<B, number>;
}

export interface PhysicsCollision<B> {
	/** Composition frame of first contact. */
	frame: number;
	/** The other body. */
	with: B;
	/** Velocity change of the harder-hit body, px/s. */
	speed: number;
}

export interface PhysicsBakeOptions {
	/** Largest error a dropped keyframe may leave, px (default 0.25). Degrees use a fifth of it. */
	tolerance?: number;
}

const CHANNEL_TOLERANCE_SCALE: Record<string, number> = {
	rotation: 0.2,
	rotateX: 0.2,
	rotateY: 0.2,
	rotateZ: 0.2,
};

export function sampleDriver(
	driver: PhysicsDriver,
	frame: number,
	fps: number,
): number {
	if (typeof driver === "number") return driver;
	if (typeof driver === "function") return driver(frame);
	const time = frame / fps;
	return driver.get({
		frame,
		fps,
		time,
		duration: 0,
		durationMs: 0,
		progress: 0,
		deltaTime: 1 / fps,
	});
}

/** Shortest-path angle continuation so rotation never jumps by 360. */
export function unwrapDegrees(previous: number, next: number): number {
	let d = next - previous;
	d -= Math.round(d / 360) * 360;
	return previous + d;
}

/**
 * Ramer–Douglas–Peucker over one channel: the fewest linear keyframes that
 * stay within `tolerance` of every simulated frame.
 */
export function simplifyKeys(
	values: ArrayLike<number>,
	tolerance: number,
): KeyframeTuple[] {
	const n = values.length;
	if (n === 0) return [];
	const keep = new Uint8Array(n);
	keep[0] = 1;
	keep[n - 1] = 1;
	const stack: Array<[number, number]> = [[0, n - 1]];
	while (stack.length > 0) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let worstErr = tolerance;
		for (let i = a + 1; i < b; i++) {
			const t = (i - a) / (b - a);
			const lerp = values[a] + (values[b] - values[a]) * t;
			const err = Math.abs(values[i] - lerp);
			if (err > worstErr) {
				worstErr = err;
				worst = i;
			}
		}
		if (worst >= 0) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}
	const keys: KeyframeTuple[] = [];
	for (let i = 0; i < n; i++) {
		if (keep[i]) keys.push([i, round4(values[i]), "none"]);
	}
	// A constant channel needs a single key.
	if (keys.length === 2 && keys[0][1] === keys[1][1]) keys.pop();
	return keys;
}

function round4(v: number): number {
	return Math.round(v * 1e4) / 1e4;
}

/**
 * Per-frame recordings of one body, indexed by composition frame. Arrays are
 * filled when the world simulates; reading a signal before that simulates.
 */
export class Recording {
	readonly channels = new Map<string, Float32Array>();
	private readonly signals = new Map<string, FrameSignal<number>>();

	constructor(
		readonly length: number,
		private readonly fps: number,
		private readonly ensure: () => void,
	) {}

	channel(name: string): Float32Array {
		let arr = this.channels.get(name);
		if (!arr) {
			arr = new Float32Array(this.length);
			this.channels.set(name, arr);
		}
		return arr;
	}

	signal(name: string): FrameSignal<number> {
		this.ensure();
		let sig = this.signals.get(name);
		if (!sig) {
			sig = Signal.fromArray(this.channel(name), this.fps);
			this.signals.set(name, sig);
		}
		return sig;
	}
}

/** What the shared stepping loop needs from a 2D or 3D body. */
export interface CoreBody<V extends number[], R> {
	readonly sim: SimBody<V, R>;
	readonly type: "dynamic" | "fixed" | "kinematic";
	readonly startFrame: number;
	readonly gravityScale: number;
	/** Unset: signals, or keyframes under `bakeKeyframes()`. */
	readonly output?: "signals" | "keyframes" | "none";
	readonly recording: Recording;
	readonly collisions: PhysicsCollision<unknown>[];
	readonly layer?: Record<string, unknown>;
	/** Kinematic pose (backend units) at a composition frame, if it follows drivers. */
	kinematicTarget?(frame: number): { position: V; rotation: R } | undefined;
	/** Writes the body's state for one composition frame into its recording. */
	record(index: number, previousIndex: number): void;
	/** Props bound to the layer, with the recording channel each one reads. */
	boundChannels(): Array<[AnimatableProp, string]>;
}

interface ForceEntry<V> {
	body: CoreBody<number[], unknown>;
	accel: (frame: number) => V;
}

interface ImpulseEntry<V> {
	body: CoreBody<number[], unknown>;
	frame: number;
	dv: V;
}

/**
 * Stepping, recording, impacts and output shared by `PhysicsWorld2D` and
 * `PhysicsWorld3D`. V is a vector in backend units (meters).
 */
export abstract class WorldCore<
	V extends number[],
	R,
	B extends CoreBody<V, R>,
> {
	readonly fps: number;
	readonly frames: number;
	readonly startFrame: number;
	readonly pixelsPerMeter: number;
	protected readonly substeps: number;
	protected readonly impactDecay: number;
	protected readonly impactReference: number;
	protected readonly bodies: B[] = [];
	protected readonly forces: ForceEntry<V>[] = [];
	protected readonly impulses: ImpulseEntry<V>[] = [];
	protected readonly fields: Array<{
		targets?: Set<B>;
		accel: (body: B, frame: number) => V | null | undefined;
	}> = [];
	private readonly worldRecording: Recording;
	private readonly allCollisions: Array<PhysicsCollision<B> & { body: B }> = [];
	/** No more bodies, joints or forces: the world has started (or finished). */
	private locked = false;
	private liveMode = false;
	private stepper?: Stepper<B, V, R>;
	private chain: Promise<void> = Promise.resolve();

	protected constructor(
		protected readonly sim: SimWorld<V, SimBody<V, R>, unknown>,
		protected readonly gravity: V,
		options: PhysicsWorldOptions,
	) {
		if (!(options.fps > 0)) throw new Error("Physics: `fps` must be > 0.");
		if (!(options.frames >= 1) || !Number.isInteger(options.frames)) {
			throw new Error("Physics: `frames` must be a positive integer.");
		}
		this.fps = options.fps;
		this.frames = options.frames;
		this.startFrame = Math.max(0, Math.round(options.startFrame ?? 0));
		this.pixelsPerMeter = options.pixelsPerMeter ?? 100;
		this.substeps = Math.max(1, Math.round(options.substeps ?? 4));
		this.impactDecay = Math.max(0.5, options.impactDecay ?? 8);
		this.impactReference = options.impactReference ?? 1500;
		this.worldRecording = this.newRecording();
	}

	/** First contacts so far (all of them once simulated), in frame order. */
	get collisions(): ReadonlyArray<PhysicsCollision<B> & { body: B }> {
		this.ensureSimulated();
		return this.allCollisions;
	}

	/** Loudest impact envelope of any body each frame: camera shake, flashes, hit sounds. */
	get impact(): FrameSignal<number> {
		return this.worldRecording.signal("impact");
	}

	/** Runs the whole simulation now (once) and binds every body's layer per its `output`. */
	simulate(): this {
		if (this.liveMode)
			throw new Error(
				"Physics: this world is live; it steps as frames render.",
			);
		this.ensureSimulated();
		return this;
	}

	/** Like {@link simulate}, but writes keyframes for every body whose `output` was left at its default. */
	bakeKeyframes(options: PhysicsBakeOptions = {}): this {
		if (this.locked) {
			throw new Error(
				"Physics: bakeKeyframes() must come before simulate(), live() or reading any body signal.",
			);
		}
		this.bakeDefault = options;
		this.ensureSimulated();
		return this;
	}

	/**
	 * Steps the world as the composition renders instead of all at once: before
	 * each frame draws, the world advances to it, after the composition's
	 * vision clips (`comp.vision`) and any `inputs` have that frame ready. Use
	 * it when bodies follow a performer, so nothing is analysed up front and a
	 * preview starts at once. Frames already simulated are kept, so scrubbing
	 * back costs nothing; jumping ahead simulates the frames in between.
	 * Signals only; `bakeKeyframes()` needs the whole run up front.
	 */
	live(
		comp: LiveHost,
		options: {
			inputs?: ReadonlyArray<{ ready(frame: number): Promise<void> }>;
		} = {},
	): this {
		if (this.locked) {
			throw new Error(
				"Physics: live() must come before simulate() or reading any body signal.",
			);
		}
		this.locked = true;
		this.liveMode = true;
		const prepare = async (frame: number) => {
			await comp.prepareVision?.(frame);
			for (const input of options.inputs ?? []) await input.ready(frame);
		};
		this.prepareInputs = prepare;
		for (const body of this.bodies) this.bind(body);
		comp.onPrepareFrame((ctx) => this.advanceTo(ctx.frame));
		return this;
	}

	/**
	 * Live worlds: simulates up to composition frame `frame` (no-op when it
	 * already has). Calls queue, so frames are stepped once, in order.
	 */
	advanceTo(frame: number): Promise<void> {
		this.chain = this.chain.then(async () => {
			const target = Math.min(
				this.frames - 1,
				Math.round(frame) - this.startFrame,
			);
			if (!this.stepper) {
				await this.prepareInputs?.(this.startFrame);
				this.stepper = this.begin();
			}
			const st = this.stepper;
			while (st.current < target) {
				const next = st.current + 1;
				await this.prepareInputs?.(this.startFrame + next);
				this.stepFrame(st, next);
			}
			if (st.current === this.frames - 1 && !st.freed) {
				st.freed = true;
				this.sim.free();
			}
		});
		return this.chain;
	}

	private prepareInputs?: (frame: number) => Promise<void>;
	private bakeDefault?: PhysicsBakeOptions;

	protected newRecording(): Recording {
		return new Recording(this.startFrame + this.frames, this.fps, () =>
			this.ensureSimulated(),
		);
	}

	protected assertOpen(): void {
		if (this.locked) {
			throw new Error(
				"Physics: the world has already started; add every body, joint and force before simulate(), live() or reading signals.",
			);
		}
	}

	protected addBody(body: B): B {
		this.assertOpen();
		this.bodies.push(body);
		return body;
	}

	protected addForce(body: B, accel: (frame: number) => V): void {
		this.assertOpen();
		this.forces.push({
			body: body as unknown as CoreBody<number[], unknown>,
			accel,
		});
	}

	protected addField(
		accel: (body: B, frame: number) => V | null | undefined,
		targets?: readonly B[],
	): void {
		this.assertOpen();
		this.fields.push({ accel, ...(targets && { targets: new Set(targets) }) });
	}

	protected addImpulse(body: B, frame: number, dv: V): void {
		this.assertOpen();
		this.impulses.push({
			body: body as unknown as CoreBody<number[], unknown>,
			frame: Math.round(frame),
			dv,
		});
	}

	protected ensureSimulated(): void {
		if (this.locked) return;
		this.locked = true;
		const st = this.begin();
		for (let f = 1; f < this.frames; f++) this.stepFrame(st, f);
		st.freed = true;
		this.sim.free();
		for (const body of this.bodies) this.bind(body);
	}

	/** Records frame 0 and sets every channel to it, so frames not simulated yet hold the start pose. */
	private begin(): Stepper<B, V, R> {
		const { startFrame } = this;
		const bodies = this.bodies;
		const bySim = new Map<SimBody<V, R>, B>();
		for (const b of bodies) bySim.set(b.sim, b);
		for (const b of bodies) if (b.startFrame > 0) b.sim.setEnabled(false);
		const kinematicFrom = new Map<B, { position: V; rotation: R }>();
		for (const b of bodies) {
			b.record(startFrame, -1);
			b.recording.channel("impact");
			const t = b.kinematicTarget?.(startFrame);
			if (t) kinematicFrom.set(b, t);
		}
		this.worldRecording.channel("impact");
		for (const rec of [
			...bodies.map((b) => b.recording),
			this.worldRecording,
		]) {
			for (const arr of rec.channels.values()) arr.fill(arr[startFrame]);
		}
		return {
			current: 0,
			freed: false,
			bySim,
			kinematicFrom,
			level: new Map(bodies.map((b) => [b, 0])),
		};
	}

	private stepFrame(st: Stepper<B, V, R>, f: number): void {
		const { fps, startFrame, substeps } = this;
		const dt = 1 / (fps * substeps);
		const bodies = this.bodies;
		const frame = startFrame + f;
		const dims = this.gravity.length;
		const prevVel = new Map<B, number[]>();
		for (const b of bodies) {
			// A body sits at its start pose on its start frame and moves after.
			if (b.startFrame > 0 && f === b.startFrame + 1) b.sim.setEnabled(true);
			prevVel.set(b, b.sim.velocity() as number[]);
		}
		const isActive = (b: B) => b.type === "dynamic" && f > b.startFrame;
		// Velocity each body is expected to gain this frame from gravity,
		// forces, fields and impulses: anything beyond it came from a contact.
		const expected = new Map<B, number[]>();
		for (const b of bodies) {
			expected.set(
				b,
				this.gravity.map((g) => (isActive(b) ? (g * b.gravityScale) / fps : 0)),
			);
		}
		for (const imp of this.impulses) {
			if (imp.frame !== f) continue;
			const body = imp.body as unknown as B;
			if (!isActive(body)) continue;
			const m = body.sim.mass();
			body.sim.applyImpulse(imp.dv.map((v) => v * m) as V);
			const e = expected.get(body) as number[];
			for (let i = 0; i < dims; i++) e[i] += imp.dv[i];
		}
		const frameForces = this.forces
			.filter((fe) => isActive(fe.body as unknown as B))
			.map((fe) => {
				const body = fe.body as unknown as B;
				const a = fe.accel(frame);
				const e = expected.get(body) as number[];
				for (let i = 0; i < dims; i++) e[i] += a[i] / fps;
				return { body, a };
			});
		const kinematicTo = new Map<B, { position: V; rotation: R }>();
		for (const b of bodies) {
			const t = b.kinematicTarget?.(frame);
			if (t) kinematicTo.set(b, t);
		}

		const started = new Set<string>();
		const pairs: Array<[B, B]> = [];
		for (let s = 1; s <= substeps; s++) {
			for (const { body, a } of frameForces) {
				const m = body.sim.mass();
				body.sim.applyImpulse(a.map((v) => v * m * dt) as V);
			}
			for (const field of this.fields) {
				for (const b of bodies) {
					if (!isActive(b) || (field.targets && !field.targets.has(b)))
						continue;
					const a = field.accel(b, frame);
					if (!a) continue;
					const m = b.sim.mass();
					b.sim.applyImpulse(a.map((v) => v * m * dt) as V);
					const e = expected.get(b) as number[];
					for (let i = 0; i < dims; i++) e[i] += a[i] * dt;
				}
			}
			for (const [b, to] of kinematicTo) {
				const from = st.kinematicFrom.get(b) ?? to;
				const k = s / substeps;
				b.sim.setKinematicTarget(
					lerpVec(from.position, to.position, k),
					this.lerpRotation(from.rotation, to.rotation, k),
				);
			}
			this.sim.step(dt);
			for (const [sa, sb] of this.sim.drainCollisionStarts()) {
				const a = st.bySim.get(sa);
				const b = st.bySim.get(sb);
				if (!a || !b) continue;
				const key = `${bodies.indexOf(a)}:${bodies.indexOf(b)}`;
				if (started.has(key)) continue;
				started.add(key);
				pairs.push([a, b]);
			}
		}
		st.kinematicFrom = kinematicTo;

		for (const b of bodies) b.record(frame, frame - 1);

		const raw = new Map<B, number>();
		if (pairs.length > 0) {
			const ppm = this.pixelsPerMeter;
			const hit = (b: B): number => {
				if (b.type !== "dynamic") return 0;
				const v = b.sim.velocity() as number[];
				const v0 = prevVel.get(b) as number[];
				const e = expected.get(b) as number[];
				let sq = 0;
				for (let i = 0; i < dims; i++) {
					const d = v[i] - (v0[i] + e[i]);
					sq += d * d;
				}
				return Math.sqrt(sq) * ppm;
			};
			for (const [a, b] of pairs) {
				const speed = Math.max(hit(a), hit(b));
				for (const [self, other] of [
					[a, b],
					[b, a],
				] as const) {
					raw.set(self, Math.max(raw.get(self) ?? 0, speed));
					const c = { frame, with: other, speed };
					self.collisions.push(c as never);
					if (self === a) this.allCollisions.push({ ...c, body: a });
				}
			}
		}

		// Impact envelopes: instant attack, exponential release.
		const decay = Math.exp(-1 / this.impactDecay);
		let loudest = 0;
		for (const b of bodies) {
			const level = Math.max(
				(raw.get(b) ?? 0) / this.impactReference,
				(st.level.get(b) ?? 0) * decay,
			);
			st.level.set(b, level);
			b.recording.channel("impact")[frame] = level;
			if (level > loudest) loudest = level;
		}
		this.worldRecording.channel("impact")[frame] = loudest;
		st.current = f;
	}

	protected abstract lerpRotation(a: R, b: R, t: number): R;

	private bind(body: B): void {
		const layer = body.layer as
			| { animate?: (...a: LayerAnimation[]) => unknown }
			| undefined;
		const output = body.output ?? (this.bakeDefault ? "keyframes" : "signals");
		if (typeof layer?.animate !== "function" || output === "none") return;
		if (body.type === "fixed") return;
		const channels = body.boundChannels();
		if (output === "keyframes" && this.liveMode) {
			throw new Error(
				'Physics: live worlds bind signals; drop `output: "keyframes"` or use simulate().',
			);
		}
		if (output === "signals") {
			const anim = LayerAnimation.create();
			for (const [prop, channel] of channels) {
				anim.signal(prop, body.recording.signal(channel));
			}
			layer.animate(anim);
			return;
		}
		const tolerance = this.bakeDefault?.tolerance ?? 0.25;
		const anim = LayerAnimation.create();
		for (const [prop, channel] of channels) {
			const arr = body.recording.channel(channel);
			const local = arr.subarray(this.startFrame);
			const scale = CHANNEL_TOLERANCE_SCALE[prop] ?? 1;
			anim.keys(prop, simplifyKeys(local, tolerance * scale));
		}
		layer.animate(anim);
	}
}

function lerpVec<V extends number[]>(a: V, b: V, t: number): V {
	return a.map((v, i) => v + (b[i] - v) * t) as V;
}
