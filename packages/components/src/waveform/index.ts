/**
 * Waveform: an audiogram. Bars, mirrored bars, dots or a ring that move
 * with a track's spectrum. The audio is analysed offline into `AudioLevels`
 * (plain data); each bar is bound to its band as a signal, so a minute of
 * audio costs no keyframes and every frame seeks exactly.
 */
import {
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import {
	audioLevelsSchema,
	resampleBands,
	smoothRelease,
} from "../core/audio.js";
import { mix } from "../core/color.js";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";

export const WAVEFORM_KINDS = ["bars", "mirror", "dots", "radial"] as const;
export type WaveformKind = (typeof WAVEFORM_KINDS)[number];

export interface WaveformCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Onsets in the audio (kicks, plosives). */
	beats: ReadonlyArray<{ frame: number }>;
}

export const waveform = /* @__PURE__ */ defineComponent({
	name: "Waveform",
	props: () => ({
		/** From `analyzeAudio(source, { fps })`. */
		audio: audioLevelsSchema(),
		/** Composition frame the track starts on. Default: the component's `at`. */
		audioStart: z.number().int().min(0).optional(),
		kind: z.enum(WAVEFORM_KINDS).default("mirror"),
		/** Bars shown. Default: one per band. */
		bars: z.number().int().min(1).max(256).optional(),
		/** Space between bars, as a fraction of a bar's pitch. */
		gap: z.number().min(0).max(0.95).default(0.45),
		/** Bar corner radius. Default: round. */
		radius: z.number().min(0).optional(),
		/** Smallest bar, as a fraction of full height. */
		floor: z.number().min(0).max(1).default(0.06),
		gain: z.number().positive().default(1),
		/** Frames a bar takes to fall from a peak. */
		smoothing: z.number().int().min(0).default(2),
		/** One colour, or a pair graded across the bars. */
		color: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const audio = props.audio;
		if (Math.abs(audio.fps - fps) > 1e-6)
			throw new Error(
				`Waveform: the audio was analysed at ${audio.fps} fps but the component runs at ${fps}. Analyse with { fps: ${fps} }.`,
			);
		const kind = props.kind;
		const radial = kind === "radial";
		const W = ctx.requested.width ?? (radial ? 420 : 800) * s;
		const H = ctx.requested.height ?? (radial ? 420 : 200) * s;
		const start = props.audioStart ?? ctx.requested.at;
		const count = props.bars ?? audio.bands.length;
		const mirror = kind === "mirror";
		// Mirrored bars show each band twice, lowest in the middle.
		const bands = resampleBands(
			audio.bands,
			mirror ? Math.ceil(count / 2) : count,
		);
		const floor = props.floor;
		const level = (band: number) =>
			smoothRelease(
				(bands[band] ?? []).map((v) => Math.min(1, v * props.gain)),
				props.smoothing,
			).map((v) => Math.round((floor + (1 - floor) * v) * 1000) / 1000);
		// Signals read the composition's frame: the floor before the track and after it.
		const levels = bands.map((_, b) => [
			...new Array<number>(start).fill(floor),
			...level(b),
			floor,
		]);
		const signals = new Map<string, object>();
		/** One signal per band and mapping (`v` is the level, floor..1), shared by bars. */
		const bound = (band: number, key: string, map: (v: number) => number) => {
			const id = `${band}:${key}`;
			let signal = signals.get(id);
			if (!signal) {
				signal = host.signal(
					(levels[band] as number[]).map((v) => Math.round(map(v) * 100) / 100),
					fps,
				);
				signals.set(id, signal);
			}
			return signal;
		};
		const colorOf = (i: number) => {
			const c = props.color ?? theme.color.accent;
			return typeof c === "string"
				? c
				: mix(c[0], c[1], count > 1 ? i / (count - 1) : 0);
		};

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const pitch = (radial ? 0 : W) / count;
		const bw = Math.max(1, pitch * (1 - props.gap));
		for (let i = 0; i < count; i++) {
			const band = mirror
				? Math.min(bands.length - 1, Math.floor(Math.abs(i - (count - 1) / 2)))
				: i;
			const color = colorOf(i);
			if (radial) {
				const D = Math.min(W, H);
				const inner = D * 0.26;
				const len = D / 2 - inner;
				const thick = Math.max(
					2 * s,
					((2 * Math.PI * inner) / count) * (1 - props.gap),
				);
				// Grows outward from the ring: its bottom edge stays on the ring.
				const bottom = D / 2 - inner;
				const bar = host.box({
					id: ctx.partId(`bar-${i}`),
					position: "absolute",
					x: D / 2 - thick / 2,
					y: bottom - len * floor,
					width: thick,
					height: len * floor,
					background: color,
					borderRadius: props.radius ?? thick / 2,
				});
				bar.animate(
					LayerAnimation.create()
						.signal(
							"height",
							bound(band, "radial-h", (v) => len * v),
						)
						.signal(
							"y",
							bound(band, "radial-y", (v) => bottom - len * v),
						),
				);
				const spoke = host.box({
					id: ctx.partId(`spoke-${i}`),
					position: "absolute",
					x: (W - D) / 2,
					y: (H - D) / 2,
					width: D,
					height: D,
					rotation: (360 * i) / count,
					children: [bar],
				});
				parts[`bar-${i}`] = bar;
				parts[`spoke-${i}`] = spoke;
				children.push(spoke);
				continue;
			}
			if (kind === "dots") {
				const size = Math.min(bw, H);
				const dot = host.box({
					id: ctx.partId(`bar-${i}`),
					position: "absolute",
					x: i * pitch + (pitch - size) / 2,
					y: (H - size) / 2,
					width: size,
					height: size,
					background: color,
					borderRadius: props.radius ?? size / 2,
					scale: floor,
				});
				dot.animate(
					LayerAnimation.create().signal(
						"scale",
						bound(band, "dot", (v) => v),
					),
				);
				parts[`bar-${i}`] = dot;
				children.push(dot);
				continue;
			}
			const up = kind === "bars";
			const bar = host.box({
				id: ctx.partId(`bar-${i}`),
				position: "absolute",
				x: i * pitch + (pitch - bw) / 2,
				y: up ? H * (1 - floor) : (H * (1 - floor)) / 2,
				width: bw,
				height: H * floor,
				background: color,
				borderRadius: props.radius ?? bw / 2,
			});
			bar.animate(
				LayerAnimation.create()
					.signal(
						"height",
						bound(band, "h", (v) => H * v),
					)
					.signal(
						"y",
						bound(band, up ? "y-up" : "y-mid", (v) =>
							up ? H * (1 - v) : (H * (1 - v)) / 2,
						),
					),
			);
			parts[`bar-${i}`] = bar;
			children.push(bar);
		}

		return {
			children,
			width: W,
			height: H,
			duration: Math.max(1, audio.frames),
			cues: {
				beats: audio.beats.map((frame) => ({
					frame: frame + start - ctx.requested.at,
				})),
			} as WaveformCues,
			parts,
		};
	},
});
