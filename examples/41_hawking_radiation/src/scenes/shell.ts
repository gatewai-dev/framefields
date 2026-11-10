/**
 * What every scene shares: a full frame of empty space to stand on, and the
 * three shader layers (black hole, zoom, vacuum) with their uniforms keyed
 * on the scene's own frames.
 */
import { Layer, type LayoutNode } from "framefields";
import { type Key, uniforms } from "../motion.js";
import { BLACK_HOLE, BLACK_HOLE_UNIFORMS } from "../shaders/blackhole.js";
import { JOURNEY, JOURNEY_UNIFORMS } from "../shaders/journey.js";
import { QUANTUM, QUANTUM_UNIFORMS } from "../shaders/quantum.js";
import { H, VOID, W } from "../theme.js";
import type { SceneTiming } from "../timeline.js";

type Tracks<T> = Partial<Record<keyof T, Key[] | number>>;

interface Frame {
	x?: number;
	width?: number;
}

export function sceneRoot(t: SceneTiming, children: LayoutNode[]): LayoutNode {
	return Layer.box({
		id: `scene-${t.id}`,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: VOID,
		overflow: "hidden",
		children,
	});
}

const shader = (
	t: SceneTiming,
	id: string,
	fragment: string,
	values: ReturnType<typeof uniforms>,
	frame: Frame,
) =>
	Layer.shader({
		id: `${t.id}-${id}`,
		x: frame.x ?? 0,
		y: 0,
		width: frame.width ?? W,
		height: H,
		fragment,
		uniforms: values,
	});

/** The ray-traced black hole, filling the frame or a column of it. */
export const blackHole = (
	t: SceneTiming,
	tracks: Tracks<typeof BLACK_HOLE_UNIFORMS>,
	frame: Frame & { id?: string } = {},
) =>
	shader(
		t,
		frame.id ?? "hole",
		BLACK_HOLE,
		uniforms(t, BLACK_HOLE_UNIFORMS, tracks),
		frame,
	);

/** The dive through the atom. */
export const journey = (
	t: SceneTiming,
	tracks: Tracks<typeof JOURNEY_UNIFORMS>,
) => shader(t, "journey", JOURNEY, uniforms(t, JOURNEY_UNIFORMS, tracks), {});

/** The vacuum and its particle pairs. */
export const quantum = (
	t: SceneTiming,
	tracks: Tracks<typeof QUANTUM_UNIFORMS>,
) => shader(t, "vacuum", QUANTUM, uniforms(t, QUANTUM_UNIFORMS, tracks), {});

/** Frame heights from the center (y up), as the shaders count, to pixels. */
export const toPixels = (x: number, y: number): [number, number] => [
	W / 2 + x * H,
	H / 2 - y * H,
];
