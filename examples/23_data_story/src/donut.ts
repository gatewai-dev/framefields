/**
 * A donut whose shares change over time. Each slice is the same full circle,
 * stroked and trimmed to its share: `trimStart`/`trimEnd` are animatable where
 * a path's `d` isn't, so slices can grow, shrink and slide around the ring.
 * Round caps with a gap of one stroke width between slices keep the joins clean.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";

export interface DonutSlice {
	label: string;
	color: string;
}

export interface DonutOptions {
	id: string;
	/** Centre in scene coordinates. */
	cx: number;
	cy: number;
	radius: number;
	thickness: number;
	slices: readonly DonutSlice[];
	/** Shares per state (any scale; each row is normalised), and when each state starts. */
	states: readonly { at: number; values: readonly number[] }[];
	/** Frames the first sweep takes; later changes take `change`. */
	reveal?: number;
	change?: number;
}

export function liveDonut(o: DonutOptions): LayoutNode {
	const r = o.radius;
	const t = o.thickness;
	const m = t / 2 + 4;
	const size = 2 * (r + m);
	const c = r + m;
	// One full circle from 12 o'clock, clockwise.
	const d = `M${c},${c - r} A${r},${r} 0 1 1 ${c},${c + r} A${r},${r} 0 1 1 ${c},${c - r}`;
	const gap = t / (2 * Math.PI * r) + 0.004;
	const reveal = o.reveal ?? 30;
	const change = o.change ?? 24;

	const spans = o.states.map(({ values }) => {
		const total = values.reduce((a, b) => a + b, 0) || 1;
		let cum = 0;
		return values.map((v) => {
			const start = cum / total;
			cum += v;
			return {
				start: start + gap / 2,
				end: Math.max(start + gap / 2 + 0.001, cum / total - gap / 2),
			};
		});
	});

	const slices = o.slices.map((slice, i) => {
		const first = spans[0][i];
		const at = o.states[0].at + i * 4;
		const anim = LayerAnimation.create()
			.keys("trimStart", [
				[at, first.start],
				...o.states
					.slice(1)
					.flatMap((s, k) => [
						[s.at, spans[k][i].start] as const,
						[s.at + change, spans[k + 1][i].start, "power3.inOut"] as const,
					]),
			])
			.keys("trimEnd", [
				[at, first.start],
				[at + reveal, first.end, "expo.out"],
				...o.states
					.slice(1)
					.flatMap((s, k) => [
						[s.at, spans[k][i].end] as const,
						[s.at + change, spans[k + 1][i].end, "power3.inOut"] as const,
					]),
			]);
		return Layer.shape("path", {
			id: `${o.id}-slice-${i}`,
			position: "absolute",
			x: 0,
			y: 0,
			width: size,
			height: size,
			d,
			fillType: "none",
			strokeColor: slice.color,
			strokeWidth: t,
			strokeLineCap: "round",
			trimStart: first.start,
			trimEnd: first.start,
		}).animate(anim);
	});

	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.cx - c,
		y: o.cy - c,
		width: size,
		height: size,
		children: slices,
	});
}
