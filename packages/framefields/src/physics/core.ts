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
	/**
	 * Keep the simulation's state at these simulation frames (or `true`: at
	 * every frame) so `world.state(frame)` can branch a new run from it.
	 * About 2 KB per body per kept frame.
	 */
	keepStates?: boolean | number[];
	/**
	 * Continue from `world.state(frame)` of a world built the same way (the
	 * same bodies, joints and forces, added in the same order): frames up to
	 * that one replay the original run, later ones are simulated here, with
	 * this world's own interventions.
	 */
	from?: PhysicsState;
}

/**
 * A simulation's state at one frame, from `world.state(frame)`: pass it as
 * `from` to a world built the same way to branch a new run there.
 */
export interface PhysicsState {
	/** Simulation frame it was taken at. */
	readonly frame: number;
	/** @internal */ readonly snapshot: Uint8Array;
	/** @internal Each body's channels up to `frame`, and impact level. */
	readonly bodies: ReadonlyArray<{
		channels: Record<string, Float32Array>;
		level: number;
	}>;
	/** @internal */ readonly impact: Float32Array;
	/** @internal First contacts up to `frame`, by body index. */
	readonly collisions: ReadonlyArray<{
		body: number;
		with: number;
		frame: number;
		speed: number;
	}>;
	/** @internal Gravity (m/s²) in effect, after interventions. */
	readonly gravity: readonly number[];
	/** @internal */ readonly fps: number;
	/** @internal */ readonly startFrame: number;
}

/** A change to the simulation at a frame: what physics-violation datasets label. */
export type PhysicsIntervention =
	| { kind: "teleport"; frame: number; layer?: string; position: number[] }
	| { kind: "velocity"; frame: number; layer?: string; velocity: number[] }
	| { kind: "vanish"; frame: number; layer?: string }
	| { kind: "passThrough"; frame: number; layer?: string; until?: number }
	| { kind: "mass"; frame: number; layer?: string; scale: number }
	| { kind: "gravity"; frame: number; gravity: number[] };

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
	/**
	 * For very fast bodies (default false): contacts are kept from 1 m away, so a
	 * body moving up to 1 m per solver step never passes through a thin wall.
	 * A bounce (restitution) starts in the step the body would reach the wall,
	 * so up to one step's travel before it.
	 */
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
	/** Gravity in effect (m/s²): the world's, until an intervention changes it. */
	gravity: number[];
	/** Bodies hidden by `vanish`. */
	hidden: Set<B>;
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

	/**
	 * A per-frame signal over a channel. Creating it does nothing; the first
	 * value read runs the simulation (offline worlds), so signals can be bound
	 * while bodies are still being added.
	 */
	signal(name: string): FrameSignal<number> {
		let sig = this.signals.get(name);
		if (!sig) {
			const arr = this.channel(name);
			const fps = this.fps;
			sig = Signal.builder({
				type: "custom",
				fn: (ctx: { frame: number; fps?: number }) => {
					this.ensure();
					const f =
						ctx.fps && ctx.fps !== fps
							? (ctx.frame / ctx.fps) * fps
							: ctx.frame;
					const i = Math.max(0, Math.min(arr.length - 1, Math.round(f)));
					return arr[i];
				},
			}) as unknown as FrameSignal<number>;
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
	/** Run after each simulated frame with the pairs that started touching in it. */
	protected readonly stepHooks: Array<
		(frame: number, pairs: Array<[B, B]>) => void
	> = [];
	/** Run once the whole simulation has finished (not in live worlds). */
	protected readonly simulatedHooks: Array<() => void> = [];
	private readonly worldRecording: Recording;
	private readonly allCollisions: Array<PhysicsCollision<B> & { body: B }> = [];
	private readonly planned: PlannedIntervention<V, B>[] = [];
	private readonly states = new Map<number, PhysicsState>();
	private readonly keepStates: boolean | Set<number>;
	private readonly from?: PhysicsState;
	/** No more bodies, joints or forces: the world has started (or finished). */
	private locked = false;
	private liveMode = false;
	private stepper?: Stepper<B, V, R>;
	private chain: Promise<void> = Promise.resolve();
	/** The offline run, once started. */
	private running?: Promise<void>;
	private simulated = false;

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
		this.keepStates = Array.isArray(options.keepStates)
			? new Set(options.keepStates.map((f) => Math.round(f)))
			: (options.keepStates ?? false);
		this.from = options.from;
		if (this.from) this.checkFrom(this.from);
	}

	/**
	 * Interventions at simulation frame `frame`: they take effect as that
	 * frame is stepped. Chain them:
	 *
	 * ```ts
	 * world.at(30).teleport(ball, [400, 100, 0]).gravity([0, -2400, 0]);
	 * ```
	 */
	at(frame: number): PhysicsInterventions<V, B> {
		const f = Math.round(frame);
		this.assertPlannable(f, `Physics.at(${frame})`);
		if (!(f >= 1 && f < this.frames))
			throw new Error(
				`Physics.at(${frame}): interventions go at simulation frames 1 to ${this.frames - 1}.`,
			);
		if (this.from && f <= this.from.frame)
			throw new Error(
				`Physics.at(${frame}): this world continues from frame ${this.from.frame}; intervene after it.`,
			);
		return new PhysicsInterventions<V, B>(f, (entry) =>
			this.planned.push(entry),
		);
	}

	/** Every intervention, in frame order, with its body's layer id. */
	get interventions(): PhysicsIntervention[] {
		return [...this.planned]
			.sort((a, b) => a.frame - b.frame)
			.flatMap((p) => describe(p));
	}

	/**
	 * The state at simulation frame `frame`, to branch a new run from (pass
	 * it as `from`). The world keeps states it was asked to (`keepStates`).
	 */
	state(frame: number): PhysicsState {
		const f = Math.round(frame);
		if (
			this.keepStates === false ||
			(this.keepStates !== true && !this.keepStates.has(f))
		)
			throw new Error(
				`Physics: frame ${f}'s state was not kept; pass \`keepStates: [${f}]\` (or \`true\` for every frame) to the world.`,
			);
		this.assertSimulated();
		const state = this.states.get(f);
		if (!state)
			throw new Error(
				`Physics: frame ${f} is outside this run (0 to ${this.frames - 1}).`,
			);
		return state;
	}

	private checkFrom(from: PhysicsState): void {
		if (from.fps !== this.fps || from.startFrame !== this.startFrame)
			throw new Error(
				"Physics: `from` comes from a world with another fps or startFrame; build the branch the same way.",
			);
		if (!(from.frame >= 0 && from.frame < this.frames))
			throw new Error(
				`Physics: \`from\` is frame ${from.frame}; this run has ${this.frames} frames.`,
			);
	}

	/** First contacts so far (all of them once simulated), in frame order. */
	get collisions(): ReadonlyArray<PhysicsCollision<B> & { body: B }> {
		this.assertSimulated();
		return this.allCollisions;
	}

	/** Loudest impact envelope of any body each frame: camera shake, flashes, hit sounds. */
	get impact(): FrameSignal<number> {
		return this.worldRecording.signal("impact");
	}

	/**
	 * Runs the whole simulation (once) and binds every body's layer per its
	 * `output`. Await it before rendering or reading the run.
	 */
	async simulate(): Promise<this> {
		if (this.liveMode)
			throw new Error(
				"Physics: this world is live; it steps as frames render.",
			);
		await this.run();
		return this;
	}

	/** Like {@link simulate}, but writes keyframes for every body whose `output` was left at its default. */
	async bakeKeyframes(options: PhysicsBakeOptions = {}): Promise<this> {
		if (this.locked) {
			throw new Error(
				"Physics: bakeKeyframes() must come before simulate() or live().",
			);
		}
		this.bakeDefault = options;
		await this.run();
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
		if (this.simulatedHooks.length) {
			throw new Error(
				"Physics: fracture() needs the whole run up front; use simulate() instead of live().",
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
				this.stepper = await this.begin();
			}
			const st = this.stepper;
			while (st.current < target) {
				const next = st.current + 1;
				await this.prepareInputs?.(this.startFrame + next);
				await this.stepFrame(st, next);
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
			this.assertSimulated(),
		);
	}

	/**
	 * Impulses and interventions go in before the world starts; a live world
	 * also takes them for frames it has not stepped yet, so an agent can act
	 * frame by frame.
	 */
	private assertPlannable(frame: number, what: string): void {
		if (!this.locked) return;
		if (!this.liveMode) this.assertOpen();
		const stepped = this.stepper?.current ?? 0;
		if (frame <= stepped)
			throw new Error(
				`${what}: this live world has stepped to frame ${stepped}; act on a later frame.`,
			);
	}

	/** The last simulation frame a live world has stepped (0 before it starts). */
	get steppedFrame(): number {
		return this.stepper?.current ?? 0;
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
		this.assertPlannable(
			Math.round(frame),
			`Physics: an impulse at frame ${frame}`,
		);
		this.impulses.push({
			body: body as unknown as CoreBody<number[], unknown>,
			frame: Math.round(frame),
			dv,
		});
	}

	/** The offline run, once: every frame, then the layers bound and the hooks run. */
	private run(): Promise<void> {
		if (this.running) return this.running;
		this.assertOpen();
		this.locked = true;
		this.running = (async () => {
			const st = await this.begin();
			for (let f = st.current + 1; f < this.frames; f++)
				await this.stepFrame(st, f);
			st.freed = true;
			this.sim.free();
			for (const body of this.bodies) this.bind(body);
			for (const hook of this.simulatedHooks) hook();
			this.simulated = true;
		})();
		return this.running;
	}

	/** Reading an offline run needs it simulated; a live world's frames fill in as it steps. */
	protected assertSimulated(): void {
		if (this.liveMode || this.simulated) return;
		throw new Error(
			"Physics: `await world.simulate()` before rendering or reading the run (or make the world live).",
		);
	}

	/** Records frame 0 and sets every channel to it, so frames not simulated yet hold the start pose. */
	private async begin(): Promise<Stepper<B, V, R>> {
		await this.sim.start(1 / (this.fps * this.substeps));
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
		const st: Stepper<B, V, R> = {
			current: 0,
			freed: false,
			bySim,
			kinematicFrom,
			level: new Map(bodies.map((b) => [b, 0])),
			gravity: [...this.gravity],
			hidden: new Set(),
		};
		for (const b of this.vanishing()) b.recording.channel("visible").fill(1);
		if (this.from) await this.restore(st, this.from);
		else await this.keepState(st, 0);
		return st;
	}

	/** Bodies some intervention hides. */
	private vanishing(): Set<B> {
		return new Set(
			this.planned
				.filter((p) => p.apply.kind === "vanish" && p.body)
				.map((p) => p.body as B),
		);
	}

	/** Puts the stepper where `from` was: the simulation, history, impacts, contacts. */
	private async restore(
		st: Stepper<B, V, R>,
		from: PhysicsState,
	): Promise<void> {
		const bodies = this.bodies;
		if (from.bodies.length !== bodies.length)
			throw new Error(
				`Physics: \`from\` has ${from.bodies.length} bodies, this world ${bodies.length} (grounds and walls count); add the same bodies in the same order.`,
			);
		if (this.stepHooks.length || this.simulatedHooks.length)
			throw new Error(
				"Physics: a world with fracture() cannot continue `from` a state yet.",
			);
		await this.sim.restore(from.snapshot);
		const end = this.startFrame + from.frame;
		bodies.forEach((b, i) => {
			const saved = from.bodies[i];
			for (const [name, values] of Object.entries(saved.channels)) {
				const arr = b.recording.channel(name);
				arr.set(values.subarray(0, end + 1));
				arr.fill(values[end], end + 1);
			}
			st.level.set(b, saved.level);
		});
		const impact = this.worldRecording.channel("impact");
		impact.set(from.impact.subarray(0, end + 1));
		impact.fill(from.impact[end], end + 1);
		for (const c of from.collisions) {
			const body = bodies[c.body];
			const other = bodies[c.with];
			const entry = { frame: c.frame, with: other, speed: c.speed };
			body.collisions.push(entry as never);
			if (c.body < c.with) this.allCollisions.push({ ...entry, body });
		}
		st.gravity = [...from.gravity];
		this.sim.setGravity(st.gravity as V);
		st.kinematicFrom = new Map();
		for (const b of bodies) {
			const t = b.kinematicTarget?.(end);
			if (t) st.kinematicFrom.set(b, t);
		}
		st.current = from.frame;
	}

	/** Keeps the state after simulation frame `f`, when asked to. */
	private async keepState(st: Stepper<B, V, R>, f: number): Promise<void> {
		const keep = this.keepStates;
		if (keep === false || (keep !== true && !keep.has(f))) return;
		const end = this.startFrame + f;
		const index = new Map(this.bodies.map((b, i) => [b, i]));
		this.states.set(f, {
			frame: f,
			snapshot: await this.sim.snapshot(),
			bodies: this.bodies.map((b) => ({
				channels: Object.fromEntries(
					[...b.recording.channels].map(([k, v]) => [k, v.slice(0, end + 1)]),
				),
				level: st.level.get(b) ?? 0,
			})),
			impact: this.worldRecording.channel("impact").slice(0, end + 1),
			collisions: this.bodies.flatMap((b) =>
				b.collisions.map((c) => ({
					body: index.get(b) ?? -1,
					with: index.get(c.with as unknown as B) ?? -1,
					frame: c.frame,
					speed: c.speed,
				})),
			),
			gravity: [...st.gravity],
			fps: this.fps,
			startFrame: this.startFrame,
		});
	}

	private async stepFrame(st: Stepper<B, V, R>, f: number): Promise<void> {
		const { fps, startFrame, substeps } = this;
		const dt = 1 / (fps * substeps);
		const bodies = this.bodies;
		const frame = startFrame + f;
		const dims = this.gravity.length;
		// Rule changes (gravity, vanish, pass-through, mass) act as the frame steps.
		for (const p of this.planned) {
			if (p.frame === f && !SETS_STATE.has(p.apply.kind))
				this.intervene(st, p.apply, p.body);
		}
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
				st.gravity.map((g) => (isActive(b) ? (g * b.gravityScale) / fps : 0)),
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
			await this.sim.step(dt);
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
		// State sets (teleport, velocity) hold at the frame itself.
		for (const p of this.planned) {
			if (p.frame === f && SETS_STATE.has(p.apply.kind))
				this.intervene(st, p.apply, p.body);
		}

		for (const b of bodies) {
			b.record(frame, frame - 1);
			if (st.hidden.size || this.planned.length) {
				const visible = b.recording.channels.get("visible");
				if (visible) visible[frame] = st.hidden.has(b) ? 0 : 1;
			}
		}

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
		for (const hook of this.stepHooks) hook(f, pairs);
		st.current = f;
		await this.keepState(st, f);
	}

	/** Applies one intervention as its frame starts. */
	private intervene(
		st: Stepper<B, V, R>,
		apply: Intervention<V>,
		body: B | undefined,
	): void {
		const ppm = this.pixelsPerMeter;
		switch (apply.kind) {
			case "gravity":
				st.gravity = apply.gravity.map((g) => g / ppm);
				this.sim.setGravity(st.gravity as V);
				return;
			case "teleport":
				body?.sim.setPose(
					apply.position.map((v) => v / ppm) as V,
					body.sim.rotation(),
				);
				return;
			case "velocity":
				body?.sim.setVelocity(
					apply.velocity.map((v) => v / ppm) as V,
					body.sim.angularVelocity(),
				);
				return;
			case "vanish":
				if (!body) return;
				body.sim.setEnabled(false);
				st.hidden.add(body);
				return;
			case "passThrough":
				body?.sim.setCollisions(false);
				return;
			case "collide":
				body?.sim.setCollisions(true);
				return;
			case "mass":
				body?.sim.setMass(body.sim.mass() * apply.scale);
				return;
		}
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
		if (body.recording.channels.has("visible"))
			channels.push(["opacity", "visible"]);
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

/** Interventions that set a body's state: it holds at their frame. */
const SETS_STATE = new Set(["teleport", "velocity"]);

/** An intervention as the world applies it (px units; `collide` ends a pass-through). */
type Intervention<V> =
	| { kind: "teleport"; position: V }
	| { kind: "velocity"; velocity: V }
	| { kind: "vanish" }
	| { kind: "passThrough"; until?: number }
	| { kind: "collide" }
	| { kind: "mass"; scale: number }
	| { kind: "gravity"; gravity: V };

interface PlannedIntervention<V, B> {
	frame: number;
	body?: B;
	apply: Intervention<V>;
}

function layerId(
	body: { layer?: Record<string, unknown> } | undefined,
): string | undefined {
	const id = body?.layer?.id;
	return typeof id === "string" ? id : undefined;
}

/** How an intervention reads in labels (none for the end of a pass-through). */
function describe<
	V extends number[],
	B extends { layer?: Record<string, unknown> },
>(p: PlannedIntervention<V, B>): PhysicsIntervention[] {
	const { frame, apply } = p;
	const layer = layerId(p.body);
	const on = layer === undefined ? {} : { layer };
	switch (apply.kind) {
		case "teleport":
			return [
				{ kind: "teleport", frame, ...on, position: [...apply.position] },
			];
		case "velocity":
			return [
				{ kind: "velocity", frame, ...on, velocity: [...apply.velocity] },
			];
		case "vanish":
			return [{ kind: "vanish", frame, ...on }];
		case "passThrough":
			return [
				{
					kind: "passThrough",
					frame,
					...on,
					...(apply.until !== undefined && { until: apply.until }),
				},
			];
		case "mass":
			return [{ kind: "mass", frame, ...on, scale: apply.scale }];
		case "gravity":
			return [{ kind: "gravity", frame, gravity: [...apply.gravity] }];
		case "collide":
			return [];
	}
}

/**
 * What can happen to a world at one simulation frame (`world.at(frame)`):
 * the changes physics-violation datasets are made of. `teleport` and
 * `velocity` hold at the frame itself; gravity, `vanish`, `passThrough` and
 * `mass` change how the world steps from it. Positions, velocities and
 * gravity are in scene px (y down); each call returns the builder.
 */
export class PhysicsInterventions<V extends number[], B> {
	/** @internal */
	constructor(
		readonly frame: number,
		private readonly plan: (entry: PlannedIntervention<V, B>) => void,
	) {}

	/** Puts the body at `position`, px, at this frame (its velocity and rotation stay). */
	teleport(body: B, position: V): this {
		this.plan({
			frame: this.frame,
			body,
			apply: { kind: "teleport", position },
		});
		return this;
	}

	/** Gives the body this velocity, px/s, at this frame. */
	velocity(body: B, velocity: V): this {
		this.plan({
			frame: this.frame,
			body,
			apply: { kind: "velocity", velocity },
		});
		return this;
	}

	/** Removes the body: it stops, touches nothing and its layer disappears. */
	vanish(body: B): this {
		this.plan({ frame: this.frame, body, apply: { kind: "vanish" } });
		return this;
	}

	/** The body passes through everything, until frame `until` if given. */
	passThrough(body: B, options: { until?: number } = {}): this {
		const until =
			options.until === undefined ? undefined : Math.round(options.until);
		if (until !== undefined && !(until > this.frame))
			throw new Error(
				`passThrough: \`until\` (${until}) comes after frame ${this.frame}.`,
			);
		this.plan({
			frame: this.frame,
			body,
			apply: { kind: "passThrough", until },
		});
		if (until !== undefined)
			this.plan({ frame: until, body, apply: { kind: "collide" } });
		return this;
	}

	/** Multiplies the body's mass by `scale`. */
	mass(body: B, scale: number): this {
		if (!(scale > 0)) throw new Error("mass: `scale` must be > 0.");
		this.plan({ frame: this.frame, body, apply: { kind: "mass", scale } });
		return this;
	}

	/** Changes the world's gravity, px/s². */
	gravity(gravity: V): this {
		this.plan({ frame: this.frame, apply: { kind: "gravity", gravity } });
		return this;
	}
}
