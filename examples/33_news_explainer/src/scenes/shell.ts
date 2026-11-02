/**
 * What every scene shares: the desk it is laid on, a stage that drifts in
 * slowly for the scene's whole length, and the tokens the registry
 * components (Annotate, Counter, TextReveal) draw with.
 */
import { Layer, type LayoutNode } from "framefields";
import type { ThemeInput } from "framefields/components";
import { desk, drift } from "../paper.js";
import {
	DISPLAY,
	FPS,
	H,
	HAND,
	INK,
	INK_SOFT,
	MONO,
	PAPER,
	RED,
	SANS,
	SHADOW,
	SHEET,
	W,
	YELLOW,
} from "../theme.js";
import type { SceneTiming } from "../timeline.js";

export const FILM_THEME: ThemeInput = {
	mode: "light",
	color: {
		bg: PAPER,
		surface: SHEET,
		ink: INK,
		muted: INK_SOFT,
		accent: RED,
		highlight: YELLOW,
		shadow: SHADOW,
	},
	font: { display: DISPLAY, body: SANS, mono: MONO, hand: HAND },
};

/** Props every component in the film takes. */
export const kit = { theme: FILM_THEME, fps: FPS } as const;

/**
 * A scene: the desk, then a stage pushing in by `push` over the scene's
 * length, then anything that must stay put above the drift.
 */
export function sceneRoot(
	t: SceneTiming,
	o: {
		stage: LayoutNode[];
		fixed?: LayoutNode[];
		push?: number;
		background?: LayoutNode;
	},
): LayoutNode {
	return Layer.box({
		id: t.id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		overflow: "hidden",
		children: [
			o.background ?? desk(`${t.id}-desk`),
			Layer.box({
				id: `${t.id}-stage`,
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				children: o.stage,
			}).animate(drift(t.duration, o.push ?? 1.04)),
			...(o.fixed ?? []),
		],
	});
}
