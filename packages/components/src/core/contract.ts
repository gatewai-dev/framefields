/**
 * The component contract: props in (validated), a layer tree out, plus the
 * moments it produced (`cues`), its window (`span`) and named parts.
 *
 * Every component is a root box (placement, window) holding a `stage` box
 * (enter / exit motion) holding the component's own content.
 */
import type {
	BoxNode,
	KeyframeTuple,
	LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import type { Animatable, Host } from "./host.js";
import type { CanvasSize } from "./layout.js";
import {
	enterAnimation,
	exitAnimation,
	MOTION_PRESETS,
	type MotionPreset,
	resolveMotion,
} from "./motion.js";
import { hashRng, type Rng } from "./rng.js";
import { defineTheme, type Theme, type ThemeInput } from "./theme.js";

// ── Cues ──────────────────────────────────────────────────────────────

/** A moment a component produced, as an integer frame (plus data). */
export type Cue<D extends object = object> = { frame: number } & D;

/** A component's cues by name. */
export type Cues = Record<string, readonly Cue[]>;

/** Shift every cue's `frame` (and `end`, when present) by `offset`. */
export function offsetCues<C extends Cues>(cues: C, offset: number): C {
	const out: Record<string, Cue[]> = {};
	for (const [name, list] of Object.entries(cues)) {
		out[name] = list.map((c) => {
			const shifted: Record<string, unknown> = {
				...c,
				frame: c.frame + offset,
			};
			if (typeof (c as { end?: unknown }).end === "number") {
				shifted.end = (c as unknown as { end: number }).end + offset;
			}
			return shifted as Cue;
		});
	}
	return out as unknown as C;
}

export interface PulseOptions {
	/** Value between pulses. Default 0. */
	rest?: number;
	/** Value at the cue frame. Default 1. */
	peak?: number;
	/** Frames before the cue the rise starts. Default 0 (instant). */
	attack?: number;
	/** Frames after the cue to fall back to rest. Default 8. */
	release?: number;
	ease?: string;
}

/**
 * Keyframes that pulse at each cue: rest → peak on the cue → rest. Use them
 * on any prop: `LayerAnimation.keys("scale", pulseKeys(pointer.cues.clicks, { rest: 1, peak: 1.1 }))`.
 * Frames are as given, so cues from a sibling component line up when both
 * share a parent.
 */
export function pulseKeys(
	cues: readonly (Cue | number)[],
	{
		rest = 0,
		peak = 1,
		attack = 0,
		release = 8,
		ease = "power2.out",
	}: PulseOptions = {},
): KeyframeTuple[] {
	const frames = cues
		.map((c) => (typeof c === "number" ? c : c.frame))
		.sort((a, b) => a - b);
	const keys = new Map<number, KeyframeTuple>();
	for (const f of frames) {
		const from = Math.max(0, f - attack);
		if (!keys.has(from)) keys.set(from, [from, rest]);
		keys.set(f, [f, peak]);
		keys.set(f + release, [f + release, rest, ease]);
	}
	return [...keys.values()].sort((a, b) => a[0] - b[0]);
}

// ── Props ─────────────────────────────────────────────────────────────

const fn = <T>() =>
	z.custom<T>((v) => typeof v === "function", {
		message: "Expected a function",
	});

function motionPresetSchema() {
	return z.union([
		z.enum(MOTION_PRESETS as [string, ...string[]]),
		z.object({
			preset: z.enum(MOTION_PRESETS as [string, ...string[]]),
			duration: z.number().int().positive().optional(),
			ease: z.string().optional(),
			distance: z.number().optional(),
			delay: z.number().int().min(0).optional(),
			blur: z.union([z.boolean(), z.number().min(0).max(360)]).optional(),
		}),
	]);
}

let baseProps: ReturnType<typeof buildBaseProps> | undefined;

/** Props every component accepts (built on first use). */
export function basePropsSchema() {
	baseProps ??= buildBaseProps();
	return baseProps;
}

function buildBaseProps() {
	return z.object({
		id: z.string().min(1).optional(),
		at: z.number().int().min(0).optional(),
		duration: z.number().int().positive().optional(),
		hold: z.number().int().min(0).optional(),
		enter: z.union([motionPresetSchema(), z.literal(false)]).optional(),
		exit: z.union([motionPresetSchema(), z.literal(false)]).optional(),
		x: z.number().optional(),
		y: z.number().optional(),
		width: z.number().positive().optional(),
		height: z.number().positive().optional(),
		position: z.enum(["absolute", "relative"]).optional(),
		theme: z
			.custom<ThemeInput>((v) => typeof v === "object" && v !== null)
			.optional(),
		seed: z.number().int().optional(),
		fps: z.number().positive().optional(),
		canvas: z
			.object({ width: z.number().positive(), height: z.number().positive() })
			.strict()
			.optional(),
		customize:
			fn<(parts: Record<string, Animatable<LayoutNode>>) => void>().optional(),
	});
}

export interface BaseProps {
	/** Root id; parts get `<id>-<part>`. */
	id?: string;
	/** Start frame in the parent's timeline. Default 0. */
	at?: number;
	/** Whole window in frames. Default: natural length + hold (+ exit). */
	duration?: number;
	/** Frames the finished state holds before the exit. */
	hold?: number;
	/** Entrance of the whole component, or `false`. */
	enter?: MotionPreset | false;
	/** Exit of the whole component, or `false`. */
	exit?: MotionPreset | false;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	position?: "absolute" | "relative";
	/** Tokens; partial themes merge over the default. */
	theme?: ThemeInput | Theme;
	/** Every random choice derives from it. Default 1. */
	seed?: number;
	/** Composition frame rate: theme speeds and real-time inputs scale by it. Default 30. */
	fps?: number;
	/**
	 * Composition size, for components that cover the frame (captions,
	 * backdrops, spotlights …). Default 1920 × 1080 × `theme.scale`.
	 */
	canvas?: CanvasSize;
	/** Receives every built part before the component returns. */
	customize?: (parts: Record<string, Animatable<LayoutNode>>) => void;
}

// ── Definition ────────────────────────────────────────────────────────

export interface BuildContext {
	host: Host;
	theme: Theme;
	fps: number;
	seed: number;
	/** The component's root id. */
	id: string;
	/** `<id>-<part>`. */
	partId(part: string): string;
	/** A seeded stream for `key`, stable across unrelated prop changes. */
	rng(key: string | number): Rng;
	/** What the user asked for: size, window and `at`. */
	requested: {
		width?: number;
		height?: number;
		duration?: number;
		at: number;
	};
	/** Frames the finished state holds (base `hold`, or the component's default). */
	hold: number;
	/** The composition size (base `canvas`, or 1920 × 1080 × theme scale). */
	canvas: CanvasSize;
}

/** Where the root ended up: what a component's `api` can rely on. */
export interface Placement {
	/** The root's x / y in its parent (0, 0 when it sits in flow). */
	x: number;
	y: number;
	width: number;
	height: number;
	/** True when x / y are real parent coordinates (absolute placement). */
	absolute: boolean;
	/** The component's first frame in the parent's timeline. */
	start: number;
}

export interface BuildResult<C extends Cues, E extends object = object> {
	/** The component's content, laid out inside a box of `width` × `height`. */
	children: LayoutNode[];
	width: number;
	height: number;
	/**
	 * Natural length in frames: when the content's own animation settles.
	 * `null` = open-ended (containers): the component lasts as long as its
	 * parent unless `duration` is given.
	 */
	duration: number | null;
	/**
	 * Stay on screen after `duration` (like `duration: null`) unless an exit
	 * or a `duration` is asked for; then `duration` is the natural length.
	 * For things that settle and should remain: text, numbers, marks.
	 */
	openEnded?: boolean;
	/**
	 * Frames the component plays itself after `duration + hold` (its own
	 * exit, e.g. text leaving unit by unit). Added to the window.
	 */
	afterHold?: number;
	/** Cues in the component's local frames (0 = component start). */
	cues: C;
	/** Named sub-nodes, exposed to `customize` and `part()`. */
	parts?: Record<string, Animatable<LayoutNode>>;
	/**
	 * Absolute position the root takes when the user gives neither `x` / `y`
	 * nor `position` (components that work in their parent's coordinates,
	 * like a pointer or a camera, sit at 0, 0).
	 */
	origin?: [x: number, y: number];
	/** Extra methods and values added (non-enumerable) to the returned node. */
	api?: (placement: Placement) => E;
}

export interface ComponentDefaults {
	enter?: MotionPreset | false;
	exit?: MotionPreset | false;
	hold?: number;
}

export interface ComponentDefinition<
	S extends z.ZodRawShape,
	C extends Cues,
	E extends object = object,
> {
	/** PascalCase name, as exported. */
	name: string;
	/**
	 * Zod shape of the component's own props (base props are added). A
	 * factory, called on first use, so importing a component builds nothing.
	 */
	props: () => S;
	defaults?: ComponentDefaults;
	build(ctx: BuildContext, props: z.output<z.ZodObject<S>>): BuildResult<C, E>;
}

export function defineComponent<
	S extends z.ZodRawShape,
	C extends Cues,
	E extends object = object,
>(definition: ComponentDefinition<S, C, E>): ComponentDefinition<S, C, E> {
	return definition;
}

/** Props a component accepts: its own (input types) plus the base props. */
export type PropsOf<D> =
	D extends ComponentDefinition<infer S, Cues>
		? z.input<z.ZodObject<S>> & BaseProps
		: never;

export type CuesOf<D> =
	D extends ComponentDefinition<z.ZodRawShape, infer C, object> ? C : never;

/** What every component adds to its root node. */
export interface ComponentExtras<C extends Cues> {
	/** Moments the component produced, in the parent's timeline. */
	readonly cues: C;
	/** The component's window in the parent's timeline (`end` is Infinity when open-ended). */
	readonly span: { start: number; end: number; duration: number };
	/** A named part (`root`, `stage`, and the component's own). */
	part(name: string): Animatable<LayoutNode> | undefined;
	/** Every name `part()` and `customize` answer to. */
	readonly partNames: readonly string[];
}

export type ComponentNode<C extends Cues> = Animatable<BoxNode> &
	ComponentExtras<C>;

/** Base props a project usually sets once: see {@link withDefaults}. */
export type ProjectDefaults = Pick<BaseProps, "fps" | "canvas" | "seed"> & {
	theme?: ThemeInput | Theme;
};

/**
 * Wrap component factories so every call starts from the project's frame
 * rate, canvas, theme and seed. Props given at the call win; a call's
 * partial `theme` merges over the default theme, not over `graphite`.
 *
 * ```ts
 * const ui = withDefaults({ fps: 60, canvas: { width: 1080, height: 1920 }, theme: themes.paper });
 * const Captions = ui(CaptionsBase);
 * ```
 */
export function withDefaults(defaults: ProjectDefaults) {
	const base = defaults.theme ? defineTheme(defaults.theme) : undefined;
	return <P extends BaseProps, R>(factory: (props: P) => R) =>
		(props: P): R =>
			factory({
				...defaults,
				...props,
				theme:
					props.theme && base
						? defineTheme(props.theme, base)
						: (props.theme ?? base),
			});
}

/**
 * The frame `gap` frames after `node` ends: `at: after(title, 6)`. Throws
 * for open-ended components, which have no end until given a `duration`.
 */
export function after(
	node: { readonly span: { end: number } },
	gap = 0,
): number {
	if (!Number.isFinite(node.span.end)) {
		throw new Error(
			"after(): this component is open-ended (it stays until its parent ends). Give it a `duration`, or use its cues.",
		);
	}
	return node.span.end + gap;
}

const kebab = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Bind a definition to a host, producing the user-facing factory. framefields
 * calls this once per component behind a PURE annotation, so bundlers drop
 * the ones nobody imports.
 */
export function bind<
	S extends z.ZodRawShape,
	C extends Cues,
	E extends object = object,
>(
	host: Host,
	definition: ComponentDefinition<S, C, E>,
): (props: z.input<z.ZodObject<S>> & BaseProps) => ComponentNode<C> & E {
	let schema: z.ZodObject | undefined;
	return (input) => {
		schema ??= basePropsSchema().extend(definition.props()).strict();
		const parsed = schema.safeParse(input ?? {});
		if (!parsed.success) {
			const known = Object.keys(schema.shape);
			const issues = parsed.error.issues
				.map((i) => {
					const where = i.path.join(".") || "(props)";
					const hint =
						i.code === "unrecognized_keys" && i.path.length === 0
							? suggest(i.keys, known)
							: "";
					return `  - ${where}: ${i.message}${hint}`;
				})
				.join("\n");
			const who =
				typeof input?.id === "string"
					? `${definition.name}#${input.id}`
					: definition.name;
			throw new Error(`${who}: invalid props\n${issues}`);
		}
		return assemble(
			host,
			definition,
			parsed.data as BaseProps & z.output<z.ZodObject<S>>,
		);
	};
}

/** ` (did you mean "label"?)` for keys one or two edits from a known prop. */
function suggest(keys: readonly string[], known: readonly string[]): string {
	const hints = keys.flatMap((key) => {
		let best: string | undefined;
		let bestD = 3;
		for (const k of known) {
			const d = editDistance(key.toLowerCase(), k.toLowerCase());
			if (d < bestD) [best, bestD] = [k, d];
		}
		return best ? [`"${key}" → "${best}"`] : [];
	});
	return hints.length > 0 ? ` (did you mean ${hints.join(", ")}?)` : "";
}

function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++)
			row[j] = Math.min(
				(prev[j] as number) + 1,
				(row[j - 1] as number) + 1,
				(prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		prev = row;
	}
	return prev[b.length] as number;
}

function assemble<S extends z.ZodRawShape, C extends Cues, E extends object>(
	host: Host,
	definition: ComponentDefinition<S, C, E>,
	props: BaseProps & z.output<z.ZodObject<S>>,
): ComponentNode<C> & E {
	const theme = defineTheme(props.theme ?? {});
	const fps = props.fps ?? 30;
	const seed = props.seed ?? 1;
	const id = props.id ?? host.autoId(kebab(definition.name));
	const defaults = definition.defaults ?? {};
	const hold = props.hold ?? defaults.hold ?? 0;
	const ctx: BuildContext = {
		host,
		theme,
		fps,
		seed,
		id,
		partId: (part) => `${id}-${part}`,
		rng: (key) => hashRng(seed, key),
		requested: {
			width: props.width,
			height: props.height,
			duration: props.duration,
			at: props.at ?? 0,
		},
		hold,
		canvas: props.canvas ?? {
			width: 1920 * theme.scale,
			height: 1080 * theme.scale,
		},
	};

	const built = definition.build(ctx, props);
	const enter = resolveMotion(
		props.enter === undefined ? defaults.enter : props.enter,
		"enter",
		theme,
		fps,
	);
	const exit = resolveMotion(
		props.exit === undefined ? defaults.exit : props.exit,
		"exit",
		theme,
		fps,
	);
	const openEnded =
		built.duration === null ||
		(built.openEnded === true && !exit && !built.afterHold);
	const duration =
		props.duration ??
		(openEnded || built.duration === null
			? null
			: Math.max(
					1,
					built.duration +
						hold +
						(built.afterHold ?? 0) +
						(exit ? exit.duration + exit.delay : 0),
				));
	if (duration === null && exit) {
		throw new Error(
			`${definition.name}: an exit needs a known end. Give \`duration\`, or drop \`exit\`.`,
		);
	}
	const width = props.width ?? built.width;
	const height = props.height ?? built.height;

	const blur = Math.max(enter?.blur ?? 0, exit?.blur ?? 0);
	const stage = host.box({
		id: ctx.partId("stage"),
		position: "absolute",
		x: 0,
		y: 0,
		width,
		height,
		...(blur > 0 && { motionBlurShutter: blur }),
		children: built.children,
	});
	const size = { width, height };
	if (enter) stage.animate(enterAnimation(enter, 0, size));
	if (exit && duration !== null)
		stage.animate(exitAnimation(exit, duration, size));

	const origin =
		props.x === undefined && props.y === undefined && !props.position
			? built.origin
			: undefined;
	const absolute =
		props.x !== undefined || props.y !== undefined || origin !== undefined;
	const rootX = props.x ?? origin?.[0] ?? 0;
	const rootY = props.y ?? origin?.[1] ?? 0;
	const root = host.box({
		id,
		...(absolute
			? { position: "absolute" as const, x: rootX, y: rootY }
			: props.position
				? { position: props.position }
				: {}),
		width,
		height,
		// Mask presets slide the stage through the root's own box.
		...((enter?.preset.startsWith("mask-") ||
			exit?.preset.startsWith("mask-")) && { overflow: "hidden" as const }),
		startFrame: props.at ?? 0,
		...(duration !== null && { durationFrames: duration }),
		children: [stage],
	});

	const parts: Record<string, Animatable<LayoutNode>> = {
		...built.parts,
		root,
		stage,
	};
	props.customize?.(parts);
	holdFirstKeys(root);

	const start = props.at ?? 0;
	const cues = offsetCues(built.cues, start);
	Object.defineProperties(root, {
		cues: { value: cues, enumerable: false },
		span: {
			value: {
				start,
				end: duration === null ? Number.POSITIVE_INFINITY : start + duration,
				duration: duration ?? Number.POSITIVE_INFINITY,
			},
			enumerable: false,
		},
		part: { value: (name: string) => parts[name], enumerable: false },
		partNames: { value: Object.keys(parts), enumerable: false },
	});
	if (built.api) {
		const api = built.api({
			x: absolute ? rootX : 0,
			y: absolute ? rootY : 0,
			width,
			height,
			absolute,
			start,
		});
		for (const [key, value] of Object.entries(api)) {
			Object.defineProperty(root, key, { value, enumerable: false });
		}
	}
	return root as ComponentNode<C> & E;
}

interface KeyedNode {
	animation?: {
		tracks?: Array<{
			repeat?: number;
			keyframes?: Array<{ id: string; frame: number; value: unknown }>;
		}>;
	};
	children?: unknown[];
	matte?: { node?: unknown };
}

/**
 * Before a track's first keyframe the renderer shows the node's base value,
 * not the first key's. Components always mean "hold the first key" (a
 * bubble invisible until it lands, a stroke undrawn until it starts), so
 * every track in the tree gets its first value pinned at frame 0.
 */
export function holdFirstKeys(node: unknown): void {
	const n = node as KeyedNode;
	for (const track of n.animation?.tracks ?? []) {
		const first = track.keyframes?.[0];
		if (!first || first.frame <= 0 || track.repeat) continue;
		track.keyframes?.unshift({
			id: `${first.id}-hold`,
			frame: 0,
			value: first.value,
		});
	}
	for (const child of n.children ?? []) holdFirstKeys(child);
	if (n.matte?.node) holdFirstKeys(n.matte.node);
}
