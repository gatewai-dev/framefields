/**
 * Captions: word-timed captions for talking-head and social video, in the
 * styles people publish, with exact word highlighting. Each phrase is one
 * text node; per-word colour, pops and markers are GPU glyph animators and
 * keyed plates, timed to the word's own frame.
 *
 * Coordinates are the frame's: the root covers the video (default
 * 1920 × 1080 × theme scale, or the given width / height) from 0, 0.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
	type TextNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Rect } from "../core/draw.js";
import {
	constantExpression,
	type GlyphAnimator,
	glyphAnimator,
	rendererChars,
	scheduleExpression,
	stepExpression,
	windowExpression,
} from "../core/glyphs.js";
import type { Animatable } from "../core/host.js";
import { type MeasureOptions, rangeRects } from "../core/text.js";
import { contrastRatio, themeFrames } from "../core/theme.js";
import { parseTranscript, type Word } from "./parse.js";
import { buildPhrases, type GroupOptions, type Phrase } from "./phrases.js";

export type { Word } from "./parse.js";

export const CAPTION_STYLES = [
	"clean",
	"karaoke",
	"highlight",
	"pop",
	"bold",
	"outline",
	"pill",
	"gradient",
] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export interface CaptionsCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Each word, from its first frame to its last. */
	words: ReadonlyArray<{
		frame: number;
		end: number;
		index: number;
		text: string;
		emphasised: boolean;
	}>;
	/** Each phrase on screen. */
	phrases: ReadonlyArray<{ frame: number; end: number; text: string }>;
}

/** Per-style grouping and placement defaults. */
const GROUP: Record<CaptionStyle, Partial<GroupOptions>> = {
	clean: { maxChars: 36, maxLines: 2 },
	karaoke: {},
	highlight: {},
	pop: { maxChars: 22 },
	bold: { maxChars: 14, maxWords: 2, maxLines: 1 },
	outline: { maxChars: 22 },
	pill: { maxChars: 24, maxLines: 1 },
	gradient: {},
};

const BASE_GROUP: GroupOptions = {
	maxChars: 28,
	maxWords: 12,
	maxLines: 2,
	breakOnPunctuation: true,
	minGap: 0.6,
};

/** The area captions stay inside: clear of edges and, in portrait, platform overlays. */
function safeArea(
	W: number,
	H: number,
	area: "portrait" | "landscape" | Rect | undefined,
): Rect {
	if (area && typeof area === "object") return area;
	const portrait = area ? area === "portrait" : H > W;
	return portrait
		? { x: W * 0.08, y: H * 0.12, width: W * 0.84, height: H * 0.66 }
		: { x: W * 0.1, y: H * 0.08, width: W * 0.8, height: H * 0.82 };
}

export const captions = /* @__PURE__ */ defineComponent({
	name: "Captions",
	props: () => ({
		/** `{ text, start, end }` in seconds. Or `transcript`. */
		words: z
			.array(
				z
					.object({
						text: z.string(),
						start: z.number().min(0),
						end: z.number().min(0),
					})
					.strict(),
			)
			.optional(),
		/** SRT, WebVTT, or word-level JSON (`[{ word | text, start, end }]`). */
		transcript: z.string().optional(),
		style: z.enum(CAPTION_STYLES).default("karaoke"),
		group: z
			.object({
				maxChars: z.number().int().positive().optional(),
				maxWords: z.number().int().positive().optional(),
				maxLines: z.number().int().positive().optional(),
				breakOnPunctuation: z.boolean().optional(),
				minGap: z.number().min(0).optional(),
			})
			.strict()
			.default({}),
		/** Words or patterns in the accent colour, or a test per word. */
		emphasis: z
			.union([
				z.array(z.union([z.string(), z.instanceof(RegExp)])),
				z.custom<(word: string, index: number) => boolean>(
					(v) => typeof v === "function",
				),
			])
			.default([]),
		case: z.enum(["as-is", "upper", "lower"]).optional(),
		placement: z
			.object({
				anchor: z.enum(["bottom", "center", "top"]).optional(),
				safeArea: z
					.union([
						z.enum(["portrait", "landscape"]),
						z.object({
							x: z.number(),
							y: z.number(),
							width: z.number(),
							height: z.number(),
						}),
					])
					.optional(),
				/** Extra px from the anchor edge, toward the centre. */
				offset: z.number().default(0),
			})
			.strict()
			.default({ offset: 0 }),
		/** A clip whose person / subject is cut out and drawn over the captions. */
		behind: z
			.object({
				video: z.string(),
				mode: z.enum(["person", "subject"]).default("person"),
			})
			.strict()
			.optional(),
		/** A backing plate behind each phrase (`clean`, `karaoke`). */
		plate: z.boolean().default(false),
		fontFamily: z.string().optional(),
		/** Default: fits `group.maxChars` across the safe area. */
		fontSize: z.number().positive().optional(),
		fontWeight: z.union([z.number(), z.string()]).optional(),
		fill: z.string().optional(),
		accent: z.string().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const W = ctx.requested.width ?? 1920 * theme.scale;
		const H = ctx.requested.height ?? 1080 * theme.scale;
		const style = props.style;

		// ── Words ─────────────────────────────────────────────────────────
		let words: Word[];
		if (props.words) words = props.words.map((w) => ({ ...w }));
		else if (props.transcript) words = parseTranscript(props.transcript);
		else throw new Error("Captions: give `words` or a `transcript`.");
		const casing = props.case ?? (style === "bold" ? "upper" : "as-is");
		if (casing !== "as-is")
			words = words.map((w) => ({
				...w,
				text: casing === "upper" ? w.text.toUpperCase() : w.text.toLowerCase(),
			}));
		const emphasised = words.map((w, i) =>
			typeof props.emphasis === "function"
				? props.emphasis(w.text, i)
				: props.emphasis.some((p) =>
						typeof p === "string"
							? w.text.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "") ===
								p.toLowerCase()
							: new RegExp(p.source, p.flags.replace("g", "")).test(w.text),
					),
		);

		// ── Layout ────────────────────────────────────────────────────────
		const group: GroupOptions = {
			...BASE_GROUP,
			...GROUP[style],
			...stripUndefined(props.group),
		};
		const safe = safeArea(W, H, props.placement.safeArea);
		const fontFamily = props.fontFamily ?? theme.font.display;
		const weight = props.fontWeight ?? (style === "clean" ? undefined : 800);
		const measureAt = (text: string, size: number, width?: number) =>
			host.measure(text, {
				fontFamily,
				fontSize: size,
				fontWeight: weight,
				...(width !== undefined && { width, align: "center" as const }),
			} satisfies MeasureOptions);
		// Auto size: a line of `maxChars` average glyphs spans the safe width.
		const sample = "nonsense words".repeat(4).slice(0, group.maxChars);
		const fs =
			props.fontSize ??
			Math.min(
				(safe.width / Math.max(1, measureAt(sample, 100).width)) * 100 * 0.94,
				safe.height / (group.maxLines * 1.6),
			);
		const fits = (line: string) => measureAt(line, fs).width <= safe.width;
		const phrases = buildPhrases(words, group, fits);

		const ink = props.fill ?? theme.color.ink;
		const accent = props.accent ?? theme.color.accent;
		const anchor =
			props.placement.anchor ?? (style === "bold" ? "center" : "bottom");
		const frameOf = (seconds: number) => Math.round(seconds * fps);
		const fast = themeFrames(theme, "fast", fps);
		const children: LayoutNode[] = [];
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const wordCues: Array<CaptionsCues["words"][number]> = [];
		const phraseCues: Array<CaptionsCues["phrases"][number]> = [];

		phrases.forEach((phrase, p) => {
			const layout = phraseLayout(phrase, words);
			const m = measureAt(layout.text, fs, safe.width);
			const options: MeasureOptions = {
				fontFamily,
				fontSize: fs,
				fontWeight: weight,
				width: safe.width,
				align: "center",
			};
			const y =
				anchor === "bottom"
					? safe.y + safe.height - m.height - props.placement.offset
					: anchor === "top"
						? safe.y + props.placement.offset
						: safe.y + (safe.height - m.height) / 2;
			const start = frameOf(phrase.start);
			const end = Math.max(start + 1, frameOf(phrase.end));
			// Word windows, local to the phrase (its box starts at `start`).
			const wStart = layout.words.map(
				(w) => frameOf((words[w.index] as Word).start) - start,
			);
			const wEnd = layout.words.map((w, k) =>
				k + 1 < layout.words.length
					? (wStart[k + 1] as number)
					: Math.max(
							(wStart[k] as number) + 1,
							frameOf((words[w.index] as Word).end) - start,
						),
			);
			const rects = layout.words.map(
				(w) => rangeRects(m, w.from, w.to, options)[0] as Rect,
			);
			const animators: GlyphAnimator[] = [];

			const emphasisWeights = layout.words.map((w) =>
				emphasised[w.index] ? 1 : 0,
			);
			if (emphasisWeights.some(Boolean))
				animators.push(
					glyphAnimator(
						"emphasis",
						constantExpression("word", emphasisWeights),
						{ fillColor: accent },
					),
				);

			const node: Partial<TextNode> = {
				id: ctx.partId(`phrase-${p}`),
				position: "absolute",
				x: 0,
				y: 0,
				width: safe.width,
				align: "center",
				fontFamily,
				fontSize: fs,
				fill: ink,
				...(weight !== undefined && { fontWeight: weight }),
			};
			const plates: LayoutNode[] = [];
			const box = (
				id: string,
				r: Rect,
				pad: number,
				background: string,
				radius: number,
				extra = {},
			) =>
				host.box({
					id: ctx.partId(`phrase-${p}-${id}`),
					position: "absolute",
					x: r.x - pad,
					y: r.y - pad * 0.5,
					width: r.width + pad * 2,
					height: r.height + pad,
					background,
					borderRadius: radius,
					...extra,
				});
			const blockRect: Rect = {
				x: Math.min(...rects.map((r) => r.x)),
				y: 0,
				width:
					Math.max(...rects.map((r) => r.x + r.width)) -
					Math.min(...rects.map((r) => r.x)),
				height: m.height,
			};

			switch (style) {
				case "clean":
					break;
				case "karaoke":
					// Spoken words turn from muted to ink on their exact frame.
					animators.push(
						glyphAnimator("spoken", stepExpression("word", wStart), {
							fillColor: theme.color.muted,
						}),
					);
					break;
				case "highlight":
				case "pill": {
					const pad = fs * (style === "pill" ? 0.22 : 0.16);
					const glide = Math.max(2, Math.round(fast * 0.4));
					if (style === "pill")
						plates.push(
							box(
								"plate",
								blockRect,
								fs * 0.5,
								theme.color.surface,
								theme.radius.pill,
								{ opacity: 0.92 },
							),
						);
					const marker = box(
						"marker",
						rects[0] as Rect,
						pad,
						accent,
						style === "pill" ? theme.radius.pill : theme.radius.md,
					);
					marker.animate(markerKeys(rects, wStart, pad, glide));
					plates.push(marker);
					// Text on the marker reads in the background colour when ink wouldn't.
					if ((contrastRatio(ink, accent) ?? 21) < 3)
						animators.push(
							glyphAnimator(
								"on-marker",
								// Switch as the marker lands under the word.
								windowExpression(
									"word",
									wStart.map((f) => f + Math.ceil(glide / 2)),
									wEnd.map((f) => f + Math.ceil(glide / 2)),
								),
								{ fillColor: theme.color.bg },
							),
						);
					break;
				}
				case "pop":
					animators.push(
						glyphAnimator(
							"pop",
							scheduleExpression(
								"word",
								{
									starts: wStart,
									duration: Math.max(3, Math.round(fast * 0.9)),
									ease: "back.out(2.2)",
								},
								"enter",
							),
							{ opacity: 0, scale: 0.72, y: fs * 0.12 },
						),
					);
					break;
				case "bold":
				case "outline":
					animators.push(
						glyphAnimator("active", windowExpression("word", wStart, wEnd), {
							fillColor: accent,
						}),
					);
					break;
				case "gradient": {
					// Active word: accent → accent2 across its letters.
					const chars = layout.text.length;
					const starts = new Array<number>(chars).fill(-1);
					const ends = new Array<number>(chars).fill(-1);
					const along = new Array<number>(chars).fill(0);
					layout.words.forEach((w, k) => {
						for (let c = w.from; c < w.to; c++) {
							starts[c] = wStart[k] as number;
							ends[c] = wEnd[k] as number;
							along[c] =
								w.to - w.from > 1 ? (c - w.from) / (w.to - w.from - 1) : 0;
						}
					});
					animators.push(
						glyphAnimator(
							"active",
							windowExpression(
								"char",
								rendererChars(layout.text, starts),
								rendererChars(layout.text, ends),
							),
							{
								fillColor: accent,
							},
						),
						glyphAnimator(
							"active-end",
							windowExpression(
								"char",
								rendererChars(layout.text, starts),
								rendererChars(layout.text, ends),
								rendererChars(layout.text, along),
							),
							{ fillColor: theme.color.accent2 },
						),
					);
					break;
				}
			}
			if (props.plate && (style === "clean" || style === "karaoke"))
				plates.unshift(
					box(
						"plate",
						blockRect,
						fs * 0.35,
						"rgba(0,0,0,0.55)",
						theme.radius.md,
					),
				);

			if (animators.length > 0) node.animators = animators as never;
			const text = host.text(layout.text, node);
			// A heavy outline around the glyphs, never over them.
			if (style === "outline")
				host.style(text, {
					stroke: { size: fs * 0.08, position: "outside", color: "#000000" },
				});
			const holder = host.box({
				id: ctx.partId(`phrase-${p}-box`),
				position: "absolute",
				x: safe.x,
				y,
				width: safe.width,
				height: m.height,
				startFrame: start,
				durationFrames: end - start,
				children: [...plates, text],
			});
			holder.animate(
				phraseMotion(style, p, end - start, fs, fast, { x: safe.x, y }),
			);
			parts[`phrase-${p}`] = holder;
			children.push(holder);

			phraseCues.push({
				frame: start,
				end,
				text: layout.text.replace(/\n/g, " "),
			});
			layout.words.forEach((w, k) => {
				wordCues.push({
					frame: start + (wStart[k] as number),
					end: start + (wEnd[k] as number),
					index: w.index,
					text: (words[w.index] as Word).text,
					emphasised: emphasised[w.index] ?? false,
				});
			});
		});

		if (props.behind) {
			const cut = host.cutout(props.behind.video, {
				id: ctx.partId("behind"),
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				fit: "cover",
				mode: props.behind.mode,
			});
			parts.behind = cut;
			children.push(cut);
		}

		const last = phraseCues[phraseCues.length - 1]?.end ?? 1;
		return {
			children,
			width: W,
			height: H,
			duration: last,
			origin: [0, 0],
			cues: { words: wordCues, phrases: phraseCues } as CaptionsCues,
			parts,
		};
	},
});

/** A phrase's text and each word's character range in it. */
function phraseLayout(phrase: Phrase, words: readonly Word[]) {
	const out: Array<{ index: number; from: number; to: number }> = [];
	let text = "";
	phrase.lines.forEach((line, l) => {
		if (l > 0) text += "\n";
		line.forEach((index, k) => {
			if (k > 0) text += " ";
			const from = text.length;
			text += (words[index] as Word).text;
			out.push({ index, from, to: text.length });
		});
	});
	return { text, words: out };
}

/** A marker that glides onto each word, arriving on the frame it is spoken. */
function markerKeys(
	rects: readonly Rect[],
	starts: readonly number[],
	pad: number,
	glide: number,
): LayerAnimation {
	const keyed = (value: (r: Rect) => number) => {
		const keys: KeyframeTuple[] = [[0, value(rects[0] as Rect)]];
		rects.forEach((r, k) => {
			const prev = rects[k - 1];
			if (!prev) return;
			const at = starts[k] as number;
			const last = (keys[keys.length - 1] as KeyframeTuple)[0];
			// Leave on the word's first frame and land a few frames in: the
			// marker never runs ahead of the voice.
			keys.push([Math.max(last + 1, at), value(prev)]);
			keys.push([Math.max(last + 2, at + glide), value(r), "power3.out"]);
		});
		return keys;
	};
	return LayerAnimation.create()
		.keys(
			"x",
			keyed((r) => r.x - pad),
		)
		.keys(
			"y",
			keyed((r) => r.y - pad * 0.5),
		)
		.keys(
			"width",
			keyed((r) => r.width + pad * 2),
		)
		.keys(
			"height",
			keyed((r) => r.height + pad),
		)
		.keys("opacity", [
			[0, 0],
			[starts[0] ?? 0, 1, "hold"],
		]);
}

/** How a phrase arrives and leaves. `bold` alternates sides; the rest fade up. */
function phraseMotion(
	style: CaptionStyle,
	index: number,
	length: number,
	fs: number,
	fast: number,
	at: { x: number; y: number },
): LayerAnimation {
	const anim = LayerAnimation.create();
	const inF = Math.min(
		Math.max(2, Math.round(fast * 0.6)),
		Math.floor(length / 2),
	);
	const out = Math.min(
		Math.max(2, Math.round(fast * 0.5)),
		Math.floor(length / 3),
	);
	anim.keys("opacity", [
		[0, 0],
		[inF, 1, "power2.out"],
		[length - out, 1],
		[length, 0, "power2.in"],
	]);
	if (style === "bold") {
		const side = index % 2 === 0 ? -1 : 1;
		anim.keys("x", [
			[0, at.x + side * fs * 0.6],
			[inF + 2, at.x, "back.out(1.8)"],
		]);
		anim.keys("scale", [
			[0, 0.86],
			[inF + 2, 1, "back.out(1.8)"],
		]);
	} else if (style !== "pop") {
		anim.keys("y", [
			[0, at.y + fs * 0.14],
			[inF, at.y, "power3.out"],
		]);
	}
	return anim;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(o).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}
