import { attachInlineSignal, resolveSignalArg } from "./inline-signals.js";
import type {
	AnimatableProp,
	AnimationTrack,
	EaseRef,
	LayerAnimationSpec,
	TrackSource,
} from "./schema.js";

/**
 * One keyframe as a tuple: `[frame, value]` or `[frame, value, ease]`. The
 * ease shapes the motion arriving at this keyframe from the one before.
 */
export type KeyframeTuple = readonly [
	frame: number,
	value: number | string | boolean,
	ease?: string | EaseRef,
];

export interface FromToOptions {
	from?: number;
	to?: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	durationFrames?: number;
	ease?: string | EaseRef;
}

export interface Tilt3DOptions {
	from?: {
		rotateX?: number;
		rotateY?: number;
		rotateZ?: number;
		translateZ?: number;
		perspective?: number;
	};
	to: {
		rotateX?: number;
		rotateY?: number;
		rotateZ?: number;
		translateZ?: number;
		perspective?: number;
	};
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	ease?: string | EaseRef;
}

export interface SignalTrackOptions {
	multiplier?: number;
	offset?: number;
	smoothing?: number;
	channel?: string;
	mode?: "continuous" | "accumulate";
	threshold?: number;
	debounceFrames?: number;
}

export interface ColorSignalOptions {
	colorA: string;
	colorB: string;
	colorMode?: "interpolate" | "hueRotate" | "threshold";
	threshold?: number;
	smoothing?: number;
}

export interface WiggleOptions {
	frequency?: number;
	amplitude?: number;
	octaves?: number;
	seed?: number;
}

export interface SpringOptions {
	damping?: number;
	stiffness?: number;
	mass?: number;
}

export interface PathLike3D {
	getPointAt(u: number): {
		position: [number, number, number];
		tangent?: [number, number, number];
	};
	getFrameAt?(u: number): {
		position: [number, number, number];
		tangent: [number, number, number];
		normal?: [number, number, number];
		binormal?: [number, number, number];
		rotation?: [number, number, number];
	};
	totalLength?: number;
}

export interface FollowPathOptions {
	fromDistance?: number;
	toDistance?: number;
	fromProgress?: number;
	toProgress?: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	autoOrient?: boolean;
	banking?: number;
	pitchOffset?: number;
	yawOffset?: number;
	rollOffset?: number;
	samples?: number;
	ease?: string | EaseRef;
}

export interface CameraFollowPathOptions {
	fromProgress?: number;
	toProgress?: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	mode?: "orientAlongPath" | "lookAtTarget" | "leadTarget";
	target?: [number, number, number];
	lookAhead?: number;
	samples?: number;
	ease?: string | EaseRef;
}

function evaluateEasingProgress(
	ease: string | EaseRef | undefined,
	t: number,
): number {
	if (!ease) return t;
	const ref = parseEase(ease);
	if (!ref || ref.name === "none") return t;

	const { name, dir, params } = ref;
	const s = Math.max(0, Math.min(1, t));

	const applyDir = (fn: (x: number) => number): number => {
		if (dir === "in") return fn(s);
		if (dir === "out") return 1 - fn(1 - s);
		return s < 0.5 ? fn(s * 2) / 2 : 1 - fn((1 - s) * 2) / 2;
	};

	switch (name) {
		case "power1":
			return applyDir((x) => x * x);
		case "power2":
			return applyDir((x) => x * x * x);
		case "power3":
			return applyDir((x) => x * x * x * x);
		case "sine":
			return applyDir((x) => 1 - Math.cos((x * Math.PI) / 2));
		case "circ":
			return applyDir((x) => 1 - Math.sqrt(Math.max(0, 1 - x * x)));
		case "expo":
			return applyDir((x) => (x === 0 ? 0 : 2 ** (10 * (x - 1))));
		case "back": {
			const c1 = params?.[0] ?? 1.70158;
			const c3 = c1 + 1;
			return applyDir((x) => c3 * x * x * x - c1 * x * x);
		}
		case "bounce": {
			const bounceOut = (x: number): number => {
				const n1 = 7.5625;
				const d1 = 2.75;
				if (x < 1 / d1) return n1 * x * x;
				if (x < 2 / d1) {
					const x2 = x - 1.5 / d1;
					return n1 * x2 * x2 + 0.75;
				}
				if (x < 2.5 / d1) {
					const x2 = x - 2.25 / d1;
					return n1 * x2 * x2 + 0.9375;
				}
				const x2 = x - 2.625 / d1;
				return n1 * x2 * x2 + 0.984375;
			};
			if (dir === "out") return bounceOut(s);
			if (dir === "in") return 1 - bounceOut(1 - s);
			return s < 0.5
				? (1 - bounceOut(1 - 2 * s)) / 2
				: (1 + bounceOut(2 * s - 1)) / 2;
		}
		default:
			return s;
	}
}

function parseEase(ease?: string | EaseRef): EaseRef | undefined {
	if (!ease) return undefined;
	if (typeof ease === "object" && "name" in ease && "dir" in ease) return ease;
	if (typeof ease === "string") {
		const trimmed = ease.trim();
		const match = trimmed.match(
			/^([a-zA-Z0-9]+)(?:\.([a-zA-Z]+))?(?:\(([^)]+)\))?$/,
		);
		if (match) {
			const rawName = match[1].toLowerCase();
			const name = (rawName === "linear" ? "none" : rawName) as EaseRef["name"];
			const rawDir = (match[2] || "out").toLowerCase();
			let dir: EaseRef["dir"] = "out";
			if (rawDir === "in") dir = "in";
			else if (rawDir === "out") dir = "out";
			else if (rawDir === "inout") dir = "inOut";

			let params: number[] | undefined;
			if (match[3]) {
				params = match[3]
					.split(",")
					.map((s) => Number.parseFloat(s.trim()))
					.filter((n) => !Number.isNaN(n));
			}
			return { name, dir, ...(params && params.length > 0 ? { params } : {}) };
		}
		const dotIdx = trimmed.indexOf(".");
		if (dotIdx === -1) {
			const raw = trimmed.toLowerCase();
			const name = (raw === "linear" ? "none" : raw) as EaseRef["name"];
			return { name, dir: "out" };
		}
		const rawName = trimmed.slice(0, dotIdx).toLowerCase();
		const name = (rawName === "linear" ? "none" : rawName) as EaseRef["name"];
		const rawDir = trimmed.slice(dotIdx + 1).toLowerCase();
		let dir: EaseRef["dir"] = "out";
		if (rawDir === "in") dir = "in";
		else if (rawDir === "out") dir = "out";
		else if (rawDir === "inout") dir = "inOut";
		return { name, dir };
	}
	return undefined;
}

/**
 * Fluent builder and runtime representation for layer animations.
 * Supports chainable keyframes, reactive signal binding, Perlin wiggles, and springs.
 */
export class LayerAnimation implements LayerAnimationSpec {
	public tracks: AnimationTrack[] = [];

	constructor(tracks: AnimationTrack[] = []) {
		this.tracks = [...tracks];
	}

	public static create(): LayerAnimation {
		return new LayerAnimation();
	}

	public static fromTo(
		prop: AnimatableProp,
		fromValue: number | string | boolean,
		toValue: number | string | boolean,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo(prop, fromValue, toValue, options);
	}

	/** A track from a list of `[frame, value, ease?]` keyframes; see {@link LayerAnimation.keys}. */
	public static keys(
		prop: AnimatableProp,
		keyframes: readonly KeyframeTuple[],
	): LayerAnimation {
		return new LayerAnimation().keys(prop, keyframes);
	}

	public static signal(
		prop: AnimatableProp,
		signalOrHandleId: unknown,
		options: SignalTrackOptions = {},
	): LayerAnimation {
		return new LayerAnimation().signal(prop, signalOrHandleId, options);
	}

	public static colorSignal(
		prop: AnimatableProp,
		signalOrHandleId: unknown,
		options: ColorSignalOptions,
	): LayerAnimation {
		return new LayerAnimation().colorSignal(prop, signalOrHandleId, options);
	}

	public static kineticSweep(
		fromOffset = -1,
		toOffset = 1,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): LayerAnimation {
		return new LayerAnimation().kineticSweep(
			fromOffset,
			toOffset,
			startFrame,
			endFrame,
			ease,
		);
	}

	public static typewriter(
		startFrame = 0,
		endFrame = 30,
		ease: string | EaseRef = "linear",
	): LayerAnimation {
		return new LayerAnimation().typewriter(startFrame, endFrame, ease);
	}

	public static letterSpacing(
		fromSpacing: number,
		toSpacing: number,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): LayerAnimation {
		return new LayerAnimation().letterSpacing(
			fromSpacing,
			toSpacing,
			startFrame,
			endFrame,
			ease,
		);
	}

	public static wiggle(
		prop: AnimatableProp,
		options: WiggleOptions = {},
	): LayerAnimation {
		return new LayerAnimation().wiggle(prop, options);
	}

	public static spring(
		prop: AnimatableProp,
		options: SpringOptions = {},
	): LayerAnimation {
		return new LayerAnimation().spring(prop, options);
	}

	public static firstMargin(
		fromMargin: number,
		toMargin: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().firstMargin(fromMargin, toMargin, options);
	}

	public static strokeWidth(
		fromWidth: number,
		toWidth: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo(
			"strokeWidth",
			fromWidth,
			toWidth,
			options,
		);
	}

	public static rotateX(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo("rotateX", fromAngle, toAngle, options);
	}

	public static rotateY(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo("rotateY", fromAngle, toAngle, options);
	}

	public static rotateZ(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo("rotateZ", fromAngle, toAngle, options);
	}

	public static rotation(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): LayerAnimation {
		return new LayerAnimation().fromTo("rotation", fromAngle, toAngle, options);
	}

	public addTrack(track: AnimationTrack): this {
		this.tracks.push(track);
		return this;
	}

	/**
	 * Creates a keyframed track animating from fromValue to toValue.
	 */
	public fromTo(
		prop: AnimatableProp,
		fromValue: number | string | boolean,
		toValue: number | string | boolean,
		options: FromToOptions = {},
	): this {
		const start = options.from ?? options.start ?? options.fromFrame ?? 0;
		const end =
			options.to ??
			options.end ??
			options.toFrame ??
			(options.durationFrames !== undefined
				? start + options.durationFrames
				: start + 24);
		const ease = parseEase(options.ease);

		let track = this.tracks.find(
			(t) => t.prop === prop && (!t.source || t.source.type === "keyframe"),
		);
		if (!track) {
			track = {
				id: `${prop}_fromTo_${this.tracks.length}`,
				prop,
				keyframes: [],
			};
			this.tracks.push(track);
		}

		const id = track.id;

		// If this is the initial keyframe on the track and start > 0, hold fromValue from frame 0
		// so that the layer does not flash its un-animated base value before the animation starts.
		if (track.keyframes.length === 0 && start > 0) {
			track.keyframes.push({
				id: `${id}_k0`,
				frame: 0,
				value: fromValue,
			});
		}

		// Anchor the start of this transition
		if (
			track.keyframes.length === 0 ||
			track.keyframes[track.keyframes.length - 1].frame < start
		) {
			track.keyframes.push({
				id: `${id}_k_${start}`,
				frame: start,
				value: fromValue,
			});
		}

		// Destination keyframe at end with easing
		track.keyframes.push({
			id: `${id}_k_${end}`,
			frame: end,
			value: toValue,
			...(ease && { ease }),
		});

		track.keyframes.sort((a, b) => a.frame - b.frame);
		return this;
	}

	/**
	 * Appends a keyframe to an existing track for prop, or creates a new track.
	 */
	public keyframe(
		prop: AnimatableProp,
		frame: number,
		value: number | string | boolean,
		ease?: string | EaseRef,
	): this {
		let track = this.tracks.find(
			(t) => t.prop === prop && (!t.source || t.source.type === "keyframe"),
		);
		if (!track) {
			track = {
				id: `${prop}_track_${this.tracks.length}`,
				prop,
				keyframes: [],
			};
			this.tracks.push(track);
		}

		const parsedEase = parseEase(ease);
		track.keyframes.push({
			id: `k_${track.keyframes.length}_f${frame}`,
			frame,
			value,
			...(parsedEase && { ease: parsedEase }),
		});

		track.keyframes.sort((a, b) => a.frame - b.frame);
		return this;
	}

	/**
	 * Adds several keyframes to prop's track at once:
	 * `.keys("scale", [[0, 0], [12, 1.1, "back.out"], [20, 1]])`.
	 * Frames are rounded to whole frames, so beat math can be passed straight in.
	 */
	public keys(prop: AnimatableProp, keyframes: readonly KeyframeTuple[]): this {
		for (const [frame, value, ease] of keyframes) {
			this.keyframe(prop, Math.round(frame), value, ease);
		}
		return this;
	}

	/**
	 * Animates opacity from 0 to 1 between startFrame and endFrame.
	 */
	public fadeIn(
		startFrame = 0,
		endFrame = 20,
		ease: string | EaseRef = "power2.out",
	): this {
		return this.fromTo("opacity", 0, 1, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Animates opacity from 1 to 0 between startFrame and endFrame.
	 */
	public fadeOut(
		startFrame: number,
		endFrame: number,
		ease: string | EaseRef = "power2.in",
	): this {
		return this.fromTo("opacity", 1, 0, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Slides in Y coordinate from fromY to toY.
	 */
	public slideInY(
		fromY: number,
		toY: number,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): this {
		return this.fromTo("y", fromY, toY, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Slides in X coordinate from fromX to toX.
	 */
	public slideInX(
		fromX: number,
		toX: number,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): this {
		return this.fromTo("x", fromX, toX, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Sweeps kinetic typography animator offset from fromOffset to toOffset.
	 * Cascades per-glyph or per-word transforms across the text.
	 */
	public kineticSweep(
		fromOffset = -1,
		toOffset = 1,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): this {
		return this.fromTo("offset", fromOffset, toOffset, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Progressive character write-on / typewriter text reveal.
	 */
	public typewriter(
		startFrame = 0,
		endFrame = 30,
		ease: string | EaseRef = "linear",
	): this {
		return this.fromTo("text", 0, 1, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Animates letter-spacing (tracking expansion or compression).
	 */
	public letterSpacing(
		fromSpacing: number,
		toSpacing: number,
		startFrame = 0,
		endFrame = 24,
		ease: string | EaseRef = "power2.out",
	): this {
		return this.fromTo("letterSpacing", fromSpacing, toSpacing, {
			from: startFrame,
			to: endFrame,
			ease,
		});
	}

	/**
	 * Animates text position along a path via First Margin.
	 */
	public firstMargin(
		fromMargin: number,
		toMargin: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("firstMargin", fromMargin, toMargin, options);
	}

	/**
	 * Animates Last Margin spatial limit along a path.
	 */
	public lastMargin(
		fromMargin: number,
		toMargin: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("lastMargin", fromMargin, toMargin, options);
	}

	/**
	 * Animates baseline shift perpendicular to curve tangent.
	 */
	public baselineShift(
		fromShift: number,
		toShift: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("baselineShift", fromShift, toShift, options);
	}

	/**
	 * Animate rotateX from fromAngle to toAngle.
	 */
	public rotateX(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("rotateX", fromAngle, toAngle, options);
	}

	/**
	 * Animate rotateY from fromAngle to toAngle.
	 */
	public rotateY(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("rotateY", fromAngle, toAngle, options);
	}

	/**
	 * Animate rotateZ from fromAngle to toAngle.
	 */
	public rotateZ(
		fromAngle: number,
		toAngle: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("rotateZ", fromAngle, toAngle, options);
	}

	/**
	 * Animate perspective camera distance in pixels.
	 */
	public perspective(
		fromDist: number,
		toDist: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("perspective", fromDist, toDist, options);
	}

	/**
	 * Animate depth translation (translateZ) in pixels.
	 */
	public translateZ(
		fromZ: number,
		toZ: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("translateZ", fromZ, toZ, options);
	}

	/**
	 * Composite helper to tilt a container across multiple 3D axes simultaneously.
	 */
	public tilt3D(options: Tilt3DOptions): this {
		const start = options.start ?? options.fromFrame;
		const end = options.end ?? options.toFrame;
		const ease = options.ease;
		const from = options.from ?? {};
		const to = options.to;

		const props = [
			"rotateX",
			"rotateY",
			"rotateZ",
			"translateZ",
			"perspective",
		] as const;

		for (const prop of props) {
			const toVal = to[prop];
			if (toVal !== undefined) {
				const fromVal = from[prop] ?? 0;
				this.fromTo(prop, fromVal, toVal, {
					from: start,
					to: end,
					fromFrame: start,
					toFrame: end,
					ease,
				});
			}
		}

		return this;
	}

	/**
	 * Binds an animatable property to a reactive continuous Signal (e.g. LFO, speech energy, audio pitch).
	 *
	 * `signalOrHandleId` is either a signal object (`Signal.fromArray`,
	 * `Signal.builder`, an audio channel …) — carried on the track and
	 * registered with the program automatically — or the name of a signal
	 * registered with `comp.addSignal(name, signal)`.
	 */
	public signal(
		prop: AnimatableProp,
		signalOrHandleId: unknown,
		options: SignalTrackOptions = {},
	): this {
		const { handleId, inline } = resolveSignalArg(signalOrHandleId);
		const id = `${prop}_sig_${handleId}_${this.tracks.length}`;

		const source: TrackSource = {
			type: "signal",
			inputHandleId: handleId,
			multiplier: options.multiplier ?? 1.0,
			offset: options.offset ?? 0.0,
			smoothingWindowFrames: options.smoothing ?? 0,
			signalMode: options.mode ?? "continuous",
			threshold: options.threshold ?? 0.15,
			accumulateThreshold: options.threshold ?? 0.15,
			debounceFrames: options.debounceFrames ?? 2,
			channel: options.channel ?? "primary",
		};
		if (inline) attachInlineSignal(source, inline);

		this.tracks.push({
			id,
			prop,
			source,
			keyframes: [],
		});
		return this;
	}

	/**
	 * Modulates color interpolation based on an active signal (object or
	 * registered name, as in {@link LayerAnimation.signal}).
	 */
	public colorSignal(
		prop: AnimatableProp,
		signalOrHandleId: unknown,
		options: ColorSignalOptions,
	): this {
		const { handleId, inline } = resolveSignalArg(signalOrHandleId);
		const id = `${prop}_colorSig_${handleId}_${this.tracks.length}`;

		const source: TrackSource = {
			type: "signal",
			inputHandleId: handleId,
			multiplier: 1.0,
			offset: 0.0,
			smoothingWindowFrames: options.smoothing ?? 0,
			colorMode: options.colorMode ?? "interpolate",
			colorA: options.colorA,
			colorB: options.colorB,
			colorThreshold: options.threshold,
			channel: "primary",
		};
		if (inline) attachInlineSignal(source, inline);

		this.tracks.push({
			id,
			prop,
			source,
			keyframes: [],
		});
		return this;
	}

	/**
	 * Adds organic Perlin noise wiggling to a property.
	 */
	public wiggle(prop: AnimatableProp, options: WiggleOptions = {}): this {
		const id = `${prop}_wiggle_${this.tracks.length}`;
		const source: TrackSource = {
			type: "wiggle",
			frequency: options.frequency ?? 2.0,
			amplitude: options.amplitude ?? 20.0,
			octaves: options.octaves ?? 1,
			seed: options.seed ?? 1234,
		};

		this.tracks.push({
			id,
			prop,
			source,
			keyframes: [],
		});
		return this;
	}

	/**
	 * Adds physical harmonic spring overshoot behavior to a property transition.
	 */
	public spring(prop: AnimatableProp, options: SpringOptions = {}): this {
		const id = `${prop}_spring_${this.tracks.length}`;
		const source: TrackSource = {
			type: "springOvershoot",
			damping: options.damping ?? 12,
			stiffness: options.stiffness ?? 180,
			mass: options.mass ?? 1,
		};

		this.tracks.push({
			id,
			prop,
			source,
			keyframes: [],
		});
		return this;
	}

	/**
	 * Follows a 2D or 3D path with constant arc-length velocity, automatic orientation,
	 * banking into turns, and optional easing.
	 */
	public followPath(path: PathLike3D, options: FollowPathOptions = {}): this {
		const startFrame = options.start ?? options.fromFrame ?? 0;
		const endFrame = options.end ?? options.toFrame ?? 60;
		const duration = Math.max(1, endFrame - startFrame);
		const sampleCount =
			options.samples ?? Math.max(8, Math.min(60, Math.round(duration / 2)));

		const totalLen = path.totalLength ?? 1;
		let fromProg = options.fromProgress ?? 0;
		let toProg = options.toProgress ?? 1;
		if (options.fromDistance !== undefined && totalLen > 0) {
			fromProg = options.fromDistance / totalLen;
		}
		if (options.toDistance !== undefined && totalLen > 0) {
			toProg = options.toDistance / totalLen;
		}

		const autoOrient = options.autoOrient ?? true;
		const banking = options.banking ?? 0;
		const pitchOffset = options.pitchOffset ?? 0;
		const yawOffset = options.yawOffset ?? 0;
		const rollOffset = options.rollOffset ?? 0;

		let hasZ = false;
		let hasRx = false;
		let hasRy = false;

		const samples: Array<{
			f: number;
			x: number;
			y: number;
			z: number;
			rx: number;
			ry: number;
			rz: number;
		}> = [];

		for (let i = 0; i <= sampleCount; i++) {
			const t = i / sampleCount;
			const easedT = evaluateEasingProgress(options.ease, t);
			const u = fromProg + easedT * (toProg - fromProg);
			const f = Math.round(startFrame + t * duration);

			let pos: [number, number, number] = [0, 0, 0];
			let tan: [number, number, number] = [1, 0, 0];
			let rot: [number, number, number] = [0, 0, 0];

			if (typeof path.getFrameAt === "function") {
				const frameData = path.getFrameAt(u);
				pos = frameData.position;
				tan = frameData.tangent;
				rot = frameData.rotation ?? [0, 0, 0];
			} else {
				const pt = path.getPointAt(u);
				pos = pt.position;
				if (pt.tangent) tan = pt.tangent;
				const pitch =
					Math.asin(Math.max(-1, Math.min(1, -tan[1]))) * (180 / Math.PI);
				const yaw = Math.atan2(tan[0], tan[2]) * (180 / Math.PI);
				const roll = Math.atan2(tan[1], tan[0]) * (180 / Math.PI);
				rot = [pitch, yaw, roll];
			}

			const rx = rot[0] + pitchOffset;
			const ry = rot[1] + yawOffset;
			let rz =
				(Math.abs(tan[2]) < 1e-4
					? Math.atan2(tan[1], tan[0]) * (180 / Math.PI)
					: rot[2]) + rollOffset;

			if (banking !== 0) {
				const uAhead = Math.min(1, u + 0.02);
				const uBehind = Math.max(0, u - 0.02);
				const ptAhead = path.getPointAt(uAhead);
				const ptBehind = path.getPointAt(uBehind);
				const tAhead = ptAhead.tangent ?? [1, 0, 0];
				const tBehind = ptBehind.tangent ?? [1, 0, 0];
				const yawAhead = Math.atan2(tAhead[0], tAhead[2]);
				const yawBehind = Math.atan2(tBehind[0], tBehind[2]);
				const dYaw = yawAhead - yawBehind;
				rz -= dYaw * banking * 57.2958;
			}

			if (Math.abs(pos[2]) > 1e-4) hasZ = true;
			if (Math.abs(rx) > 1e-4) hasRx = true;
			if (Math.abs(ry) > 1e-4) hasRy = true;

			samples.push({ f, x: pos[0], y: pos[1], z: pos[2], rx, ry, rz });
		}

		for (const s of samples) {
			this.keyframe("x", s.f, s.x);
			this.keyframe("y", s.f, s.y);
			if (hasZ) {
				this.keyframe("z", s.f, s.z);
			}
			if (autoOrient) {
				this.keyframe("rotateZ", s.f, s.rz);
				if (hasRx) this.keyframe("rotateX", s.f, s.rx);
				if (hasRy) this.keyframe("rotateY", s.f, s.ry);
			}
		}

		return this;
	}

	/**
	 * Attaches this animation to a target LayoutNode and returns the node.
	 */
	public applyTo<T extends { animation?: LayerAnimationSpec }>(node: T): T {
		node.animation = this.toSpec();
		return node;
	}

	/**
	 * Returns the validated LayerAnimation specification object.
	 */
	public toSpec(): LayerAnimationSpec {
		return {
			tracks: this.tracks,
		};
	}

	public toJSON(): LayerAnimationSpec {
		return this.toSpec();
	}
}

export interface DollyOptions {
	fromDistance: number;
	toDistance: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	ease?: string;
}

export interface OrbitOptions {
	radius?: { from?: number; to: number };
	azimuth?: { from?: number; to: number };
	elevation?: { from?: number; to: number };
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	ease?: string;
}

export interface RackFocusOptions {
	fromDistance: number;
	toDistance: number;
	fromFStop?: number;
	toFStop?: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
	ease?: string;
}

export interface HandheldOptions {
	translationAmplitude: number;
	rotationAmplitude: number;
	start?: number;
	end?: number;
	fromFrame?: number;
	toFrame?: number;
}

export class CameraAnimation extends LayerAnimation {
	public static camera(): CameraAnimation {
		return new CameraAnimation();
	}

	public dolly(
		fromDistanceOrOptions: number | DollyOptions,
		toDistance?: number,
		options: FromToOptions = {},
	): this {
		if (typeof fromDistanceOrOptions === "object") {
			const opts = fromDistanceOrOptions;
			const start = opts.start ?? opts.fromFrame ?? 0;
			const end = opts.end ?? opts.toFrame ?? 0;
			return this.fromTo("cameraZ", opts.fromDistance, opts.toDistance, {
				from: start,
				to: end,
				ease: opts.ease,
			});
		}
		return this.fromTo(
			"cameraZ",
			fromDistanceOrOptions,
			toDistance ?? fromDistanceOrOptions,
			options,
		);
	}

	public orbit(options: OrbitOptions): this {
		const start = options.start ?? options.fromFrame ?? 0;
		const end = options.end ?? options.toFrame ?? 0;
		if (options.azimuth) {
			this.fromTo(
				"orbitAzimuth",
				options.azimuth.from ?? 0,
				options.azimuth.to,
				{
					from: start,
					to: end,
					ease: options.ease,
				},
			);
		}
		if (options.elevation) {
			this.fromTo(
				"orbitElevation",
				options.elevation.from ?? 0,
				options.elevation.to,
				{
					from: start,
					to: end,
					ease: options.ease,
				},
			);
		}
		if (options.radius) {
			this.fromTo(
				"orbitRadius",
				options.radius.from ?? 1500,
				options.radius.to,
				{
					from: start,
					to: end,
					ease: options.ease,
				},
			);
		}
		return this;
	}

	public truck(fromX: number, toX: number, options: FromToOptions = {}): this {
		return this.fromTo("cameraX", fromX, toX, options);
	}

	public pedestal(
		fromY: number,
		toY: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("cameraY", fromY, toY, options);
	}

	public pan(
		fromAngleDeg: number,
		toAngleDeg: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("cameraYaw", fromAngleDeg, toAngleDeg, options);
	}

	public tilt(
		fromAngleDeg: number,
		toAngleDeg: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("cameraPitch", fromAngleDeg, toAngleDeg, options);
	}

	public roll(
		fromAngleDeg: number,
		toAngleDeg: number,
		options: FromToOptions = {},
	): this {
		return this.fromTo("cameraRoll", fromAngleDeg, toAngleDeg, options);
	}

	public rackFocus(options: RackFocusOptions): this {
		const start = options.start ?? options.fromFrame ?? 0;
		const end = options.end ?? options.toFrame ?? 0;
		this.fromTo("focusDistance", options.fromDistance, options.toDistance, {
			from: start,
			to: end,
			ease: options.ease ?? "power2.inOut",
		});
		if (options.toFStop !== undefined) {
			this.fromTo("fStop", options.fromFStop ?? 2.8, options.toFStop, {
				from: start,
				to: end,
				ease: options.ease ?? "power2.inOut",
			});
		}
		return this;
	}

	public handheld(options: HandheldOptions): this {
		const start = options.start ?? options.fromFrame ?? 0;
		const end = options.end ?? options.toFrame ?? 0;
		this.fromTo("shakeTranslation", 0, options.translationAmplitude, {
			from: start,
			to: end,
		});
		this.fromTo("shakeRotation", 0, options.rotationAmplitude, {
			from: start,
			to: end,
		});
		return this;
	}

	/**
	 * Animates camera eye and lookAt target along a 3D path with constant velocity,
	 * leading target look-ahead, or path tangent orientation.
	 */
	public followPath3D(
		path: PathLike3D,
		options: CameraFollowPathOptions = {},
	): this {
		const startFrame = options.start ?? options.fromFrame ?? 0;
		const endFrame = options.end ?? options.toFrame ?? 60;
		const duration = Math.max(1, endFrame - startFrame);
		const sampleCount =
			options.samples ?? Math.max(8, Math.min(60, Math.round(duration / 2)));
		const mode =
			options.mode ?? (options.target ? "lookAtTarget" : "leadTarget");
		const fromProg = options.fromProgress ?? 0;
		const toProg = options.toProgress ?? 1;
		const lookAhead = options.lookAhead ?? 0.05;

		for (let i = 0; i <= sampleCount; i++) {
			const t = i / sampleCount;
			const easedT = evaluateEasingProgress(options.ease, t);
			const u = fromProg + easedT * (toProg - fromProg);
			const f = Math.round(startFrame + t * duration);

			let pos: [number, number, number] = [0, 0, 0];
			let rot: [number, number, number] = [0, 0, 0];

			if (typeof path.getFrameAt === "function") {
				const frameData = path.getFrameAt(u);
				pos = frameData.position;
				rot = frameData.rotation ?? [0, 0, 0];
			} else {
				const pt = path.getPointAt(u);
				pos = pt.position;
			}

			this.keyframe("cameraX", f, pos[0]);
			this.keyframe("cameraY", f, pos[1]);
			this.keyframe("cameraZ", f, pos[2]);

			if (mode === "lookAtTarget") {
				const tgt = options.target ?? [pos[0], pos[1], 0];
				this.keyframe("targetX", f, tgt[0]);
				this.keyframe("targetY", f, tgt[1]);
				this.keyframe("targetZ", f, tgt[2]);
			} else if (mode === "leadTarget") {
				const leadU = Math.min(1, u + lookAhead);
				const leadPt = path.getPointAt(leadU);
				this.keyframe("targetX", f, leadPt.position[0]);
				this.keyframe("targetY", f, leadPt.position[1]);
				this.keyframe("targetZ", f, leadPt.position[2]);
			} else if (mode === "orientAlongPath") {
				this.keyframe("cameraPitch", f, rot[0]);
				this.keyframe("cameraYaw", f, rot[1]);
				this.keyframe("cameraRoll", f, rot[2]);
			}
		}

		return this;
	}
}
