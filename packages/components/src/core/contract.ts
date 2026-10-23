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

const MotionPresetSchema = z.union([
	z.enum(MOTION_PRESETS as [string, ...string[]]),
	z.object({
		preset: z.enum(MOTION_PRESETS as [string, ...string[]]),
		duration: z.number().int().positive().optional(),
		ease: z.string().optional(),
		distance: z.number().optional(),
		delay: z.number().int().min(0).optional(),
	}),
]);

/** Props every component accepts. */
export const BasePropsSchema = z.object({
	id: z.string().min(1).optional(),
	at: z.number().int().min(0).optional(),
	duration: z.number().int().positive().optional(),
	hold: z.number().int().min(0).optional(),
	enter: z.union([MotionPresetSchema, z.literal(false)]).optional(),
	exit: z.union([MotionPresetSchema, z.literal(false)]).optional(),
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
	customize:
		fn<(parts: Record<string, Animatable<LayoutNode>>) => void>().optional(),
});

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
}

export interface BuildResult<C extends Cues> {
	/** The component's content, laid out inside a box of `width` × `height`. */
	children: LayoutNode[];
	width: number;
	height: number;
	/** Natural length in frames: when the content's own animation settles. */
	duration: number;
	/** Cues in the component's local frames (0 = component start). */
	cues: C;
	/** Named sub-nodes, exposed to `customize` and `part()`. */
	parts?: Record<string, Animatable<LayoutNode>>;
}

export interface ComponentDefaults {
	enter?: MotionPreset | false;
	exit?: MotionPreset | false;
	hold?: number;
}

export interface ComponentDefinition<S extends z.ZodRawShape, C extends Cues> {
	/** PascalCase name, as exported. */
	name: string;
	/** Zod shape of the component's own props (base props are added). */
	props: S;
	defaults?: ComponentDefaults;
	build(ctx: BuildContext, props: z.output<z.ZodObject<S>>): BuildResult<C>;
}

export function defineComponent<S extends z.ZodRawShape, C extends Cues>(
	definition: ComponentDefinition<S, C>,
): ComponentDefinition<S, C> {
	return definition;
}

/** Props a component accepts: its own (input types) plus the base props. */
export type PropsOf<D> =
	D extends ComponentDefinition<infer S, Cues>
		? z.input<z.ZodObject<S>> & BaseProps
		: never;

export type CuesOf<D> =
	D extends ComponentDefinition<z.ZodRawShape, infer C> ? C : never;

/** What every component adds to its root node. */
export interface ComponentExtras<C extends Cues> {
	/** Moments the component produced, in the parent's timeline. */
	readonly cues: C;
	/** The component's window in the parent's timeline. */
	readonly span: { start: number; end: number; duration: number };
	/** A named part (`root`, `stage`, and the component's own). */
	part(name: string): Animatable<LayoutNode> | undefined;
}

export type ComponentNode<C extends Cues> = Animatable<BoxNode> &
	ComponentExtras<C>;

const kebab = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Bind a definition to a host, producing the user-facing factory. framefields
 * calls this once per component behind a PURE annotation, so bundlers drop
 * the ones nobody imports.
 */
export function bind<S extends z.ZodRawShape, C extends Cues>(
	host: Host,
	definition: ComponentDefinition<S, C>,
): (props: z.input<z.ZodObject<S>> & BaseProps) => ComponentNode<C> {
	let schema: z.ZodObject | undefined;
	return (input) => {
		schema ??= BasePropsSchema.extend(definition.props).strict();
		const parsed = schema.safeParse(input ?? {});
		if (!parsed.success) {
			const issues = parsed.error.issues
				.map((i) => `  - ${i.path.join(".") || "(props)"}: ${i.message}`)
				.join("\n");
			throw new Error(`${definition.name}: invalid props\n${issues}`);
		}
		return assemble(
			host,
			definition,
			parsed.data as BaseProps & z.output<z.ZodObject<S>>,
		);
	};
}

function assemble<S extends z.ZodRawShape, C extends Cues>(
	host: Host,
	definition: ComponentDefinition<S, C>,
	props: BaseProps & z.output<z.ZodObject<S>>,
): ComponentNode<C> {
	const theme = defineTheme(props.theme ?? {});
	const fps = props.fps ?? 30;
	const seed = props.seed ?? 1;
	const id = props.id ?? host.autoId(kebab(definition.name));
	const ctx: BuildContext = {
		host,
		theme,
		fps,
		seed,
		id,
		partId: (part) => `${id}-${part}`,
		rng: (key) => hashRng(seed, key),
	};

	const built = definition.build(ctx, props);
	const defaults = definition.defaults ?? {};
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
	const hold = props.hold ?? defaults.hold ?? 0;
	const duration =
		props.duration ??
		Math.max(
			1,
			built.duration + hold + (exit ? exit.duration + exit.delay : 0),
		);
	const width = props.width ?? built.width;
	const height = props.height ?? built.height;

	const stage = host.box({
		id: ctx.partId("stage"),
		position: "absolute",
		x: 0,
		y: 0,
		width,
		height,
		children: built.children,
	});
	if (enter) stage.animate(enterAnimation(enter, 0));
	if (exit) stage.animate(exitAnimation(exit, duration));

	const absolute = props.x !== undefined || props.y !== undefined;
	const root = host.box({
		id,
		...(absolute
			? { position: "absolute" as const, x: props.x ?? 0, y: props.y ?? 0 }
			: props.position
				? { position: props.position }
				: {}),
		width,
		height,
		startFrame: props.at ?? 0,
		durationFrames: duration,
		children: [stage],
	});

	const parts: Record<string, Animatable<LayoutNode>> = {
		...built.parts,
		root,
		stage,
	};
	props.customize?.(parts);

	const start = props.at ?? 0;
	const cues = offsetCues(built.cues, start);
	Object.defineProperties(root, {
		cues: { value: cues, enumerable: false },
		span: {
			value: { start, end: start + duration, duration },
			enumerable: false,
		},
		part: { value: (name: string) => parts[name], enumerable: false },
	});
	return root as ComponentNode<C>;
}
