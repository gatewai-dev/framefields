/**
 * CardStack: cards in a depth stack that shuffle. In `cycle` the front card
 * leaves (flies, drops, zooms or flips away) and returns to the back while
 * the rest step forward; in `deal` cards land one at a time on top of the
 * pile; in `fan` the stack spreads into a hand and gathers again.
 *
 * Draw order is fixed by the tree (the renderer has no animated z-order), so
 * in `cycle` every card sits in a clip that shows only the strip peeking out
 * above the card in front of it: whichever card is drawn later, a card
 * behind can never paint over one in front. The leaving card flies sideways,
 * clear of the stack, before it slots in at the back. The card coming to the
 * front shows whole at once: everything drawn after it is either the card
 * leaving (in front of it anyway) or a card already clipped at the back.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { themeFrames } from "../core/theme.js";

export interface CardStackCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** A move starts; `index` is the card coming to the front. */
	changes: ReadonlyArray<{ frame: number; index: number }>;
}

const SIMPLE = z
	.object({
		title: z.string(),
		body: z.string().optional(),
		image: z.string().optional(),
		accent: z.string().optional(),
	})
	.strict();
type SimpleCard = z.infer<typeof SIMPLE>;

/** Slot geometry: card k behind the front is this much smaller and higher. */
export const SHRINK = 0.06;

export const cardStack = /* @__PURE__ */ defineComponent({
	name: "CardStack",
	props: () => ({
		cards: z
			.array(
				z.union([
					SIMPLE,
					z.custom<LayoutNode>(
						(v) => typeof v === "object" && v !== null && "kind" in v,
						{ message: "Expected a layer or { title, body?, image? }" },
					),
				]),
			)
			.min(2),
		mode: z.enum(["cycle", "deal", "fan"]).default("cycle"),
		/** Frames between moves. Default 1.5 seconds. */
		every: z.number().int().positive().optional(),
		cycles: z.number().int().positive().default(1),
		/** Cards shown behind the front one. */
		visible: z.number().int().min(0).max(8).default(3),
		/** How the front card leaves in `cycle`. */
		leave: z.enum(["fly", "drop", "zoom", "flip"]).default("fly"),
		/** Where `fly` sends the card, and which way `drop` tips it. */
		flyTo: z.enum(["up", "left", "right"]).default("left"),
		/** Degrees between neighbouring cards in `fan`. */
		fanAngle: z.number().min(0).max(30).default(8),
		cardWidth: z.number().positive().optional(),
		cardHeight: z.number().positive().optional(),
		tilt: z
			.union([
				z.literal(false),
				z
					.object({
						rotateX: z.number().default(12),
						rotateY: z.number().default(0),
					})
					.strict(),
			])
			.default({ rotateX: 12, rotateY: 0 }),
	}),
	defaults: { enter: false, exit: false, hold: 30 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const cw = props.cardWidth ?? 640 * s;
		const ch = props.cardHeight ?? 400 * s;
		const n = props.cards.length;
		const every = props.every ?? Math.round(fps * 1.5);
		const base = themeFrames(theme, "base", fps);
		const tr = Math.min(every - 1, Math.round(base * 1.8));
		const ease = theme.motion.ease.move;
		const step = 26 * s;
		const depth = Math.min(props.visible, n - 1);
		const fan = props.mode === "fan";
		// In a fan, cards shrink a little and overlap by this much of their width.
		const fanScale = 0.82;
		const fanStep = cw * fanScale * 0.42;
		const W =
			ctx.requested.width ??
			(fan
				? Math.max(cw * 1.5, cw * fanScale + fanStep * (n - 1) + cw * 0.3)
				: cw * 1.5);
		const H = ctx.requested.height ?? ch + step * depth + ch * 0.4;
		const front = { x: (W - cw) / 2, y: H - ch - ch * 0.2 };
		const pose = (k: number) => {
			const shown = Math.min(k, depth);
			return {
				y: front.y - shown * step,
				scale: 1 - SHRINK * shown,
				opacity: k <= depth ? 1 : 0,
				dim: Math.min(0.6, 0.14 * shown),
				// Local height of the strip that peeks above the card in front.
				clip: k === 0 ? ch : step / (1 - SHRINK * shown),
			};
		};

		// ── Timeline: each card's slot at each move ──────────────────────
		const cycle = props.mode === "cycle";
		const deal = props.mode === "deal";
		// A fan spreads and gathers once per cycle.
		const moves = cycle ? n * props.cycles : fan ? 2 * props.cycles : n - 1;
		const changes = Array.from({ length: moves }, (_, m) => ({
			frame: (m + 1) * every,
			index: cycle ? (m + 1) % n : fan ? 0 : m + 1,
		}));
		const side = props.flyTo === "right" ? 1 : -1;
		// Where the leaving card ends (relative to the front slot), how, and
		// how much of the move it takes.
		const leave: {
			to: Partial<Record<"x" | "y" | "rotation" | "rotateX" | "scale", number>>;
			ease: string;
			share: number;
			/** Share of its exit it stays opaque, so the next card doesn't ghost through. */
			solid: number;
		} = {
			fly: {
				to:
					props.flyTo === "up"
						? { y: -ch * 1.3, rotation: -4 }
						: { x: side * cw * 1.1, y: -ch * 0.15, rotation: side * 10 },
				ease: "power2.in",
				share: 0.55,
				solid: 0.5,
			},
			// Falls out of the bottom, tipping toward `flyTo`.
			drop: {
				to: { x: side * cw * 0.12, y: ch * 1.1, rotation: side * 14 },
				ease: "power2.in",
				share: 0.6,
				solid: 0.55,
			},
			// Toward the viewer, fading as it passes.
			zoom: {
				to: { y: ch * 0.06, scale: 1.22 },
				ease: "power2.out",
				share: 0.45,
				solid: 0,
			},
			// Folds back over its top edge.
			flip: {
				to: { y: -ch * 0.04, rotateX: 90, scale: 0.96 },
				ease: "sine.in",
				share: 0.55,
				solid: 0.9,
			},
		}[props.leave];
		// The fan: an arc, centred, outer cards turned and lowered.
		const fanPose = (c: number) => {
			const off = c - (n - 1) / 2;
			return {
				x: front.x + off * fanStep,
				y: front.y + ch * 0.06 + Math.abs(off) ** 2 * ch * 0.02,
				rotation: off * props.fanAngle,
				scale: fanScale,
				dim: 0,
				opacity: 1,
			};
		};

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const nodes: LayoutNode[] = [];
		props.cards.forEach((card, c) => {
			const tracks = {
				x: [] as KeyframeTuple[],
				y: [] as KeyframeTuple[],
				scale: [] as KeyframeTuple[],
				rotation: [] as KeyframeTuple[],
				rotateX: [] as KeyframeTuple[],
				opacity: [] as KeyframeTuple[],
				dim: [] as KeyframeTuple[],
				clip: [] as KeyframeTuple[],
			};
			const put = (
				f: number,
				k: number,
				e?: string,
				also?: Partial<Record<keyof typeof tracks, number>>,
			) => {
				const p = pose(k);
				const v = {
					x: front.x,
					y: p.y,
					scale: p.scale,
					rotation: 0,
					rotateX: 0,
					opacity: p.opacity,
					dim: p.dim,
					clip: p.clip,
					...also,
				};
				for (const key of Object.keys(tracks) as Array<keyof typeof tracks>)
					tracks[key].push(e ? [f, round(v[key]), e] : [f, round(v[key])]);
			};
			if (cycle) {
				put(0, c);
				changes.forEach(({ frame: t }, m) => {
					const k = (((c - m) % n) + n) % n;
					if (k === 0) {
						// Leaves, then slots in at the back unseen and fades up.
						const away = t + Math.round(tr * leave.share);
						const to = leave.to;
						put(t, 0);
						const solid = t + Math.round((away - t) * leave.solid);
						if (solid > t) tracks.opacity.push([solid, 1]);
						put(away, 0, leave.ease, {
							x: front.x + (to.x ?? 0),
							y: front.y + (to.y ?? 0),
							rotation: to.rotation ?? 0,
							rotateX: to.rotateX ?? 0,
							scale: to.scale ?? 1,
							opacity: 0,
						});
						put(away + 1, n - 1, "hold", { opacity: 0 });
						put(t + tr, n - 1, "power2.out");
					} else {
						// Steps forward once the leaving card is under way. Coming to
						// the front, it shows whole from the start.
						const whole = k === 1 ? { clip: ch } : undefined;
						put(t, k);
						if (whole) tracks.clip.push([t + 1, ch, "hold"]);
						put(t + Math.round(tr * 0.25), k, undefined, whole);
						put(t + tr, k - 1, ease);
					}
				});
			} else if (fan) {
				put(0, c);
				changes.forEach(({ frame: t }, m) => {
					// Spreads on even moves, gathers on odd ones, the front card first.
					const at = t + c * Math.round(fps * 0.04);
					const spread = m % 2 === 0;
					put(at, c, undefined, spread ? undefined : fanPose(c));
					if (spread) put(at + tr, c, theme.motion.ease.snap, fanPose(c));
					else put(at + tr, c, ease);
				});
			} else {
				// Deal: card c lands on top at move c (card 0 is already down).
				const landAt = c === 0 ? 0 : (changes[c - 1]?.frame as number);
				if (c > 0) {
					put(0, 0, undefined, {
						y: front.y - ch * 1.4,
						rotation: 9,
						opacity: 0,
					});
					put(landAt, 0, "hold", {
						y: front.y - ch * 1.4,
						rotation: 9,
						opacity: 0,
					});
					put(landAt + tr, 0, theme.motion.ease.enter);
				} else put(0, 0);
				// Pushed back one slot by every later card.
				changes.slice(c).forEach(({ frame: t }, j) => {
					put(t, j);
					put(t + tr, j + 1, ease);
				});
			}

			const content = isSimple(card) ? simpleCard(ctx, card, c, cw, ch) : card;
			const dim = host.box({
				id: ctx.partId(`card-${c}-dim`),
				position: "absolute",
				x: 0,
				y: 0,
				width: cw,
				height: ch,
				background: "#000000",
				borderRadius: theme.radius.lg,
				opacity: 0,
			});
			dim.animate(LayerAnimation.keys("opacity", ascending(tracks.dim)));
			const clip = host.box({
				id: ctx.partId(`card-${c}-clip`),
				position: "absolute",
				x: 0,
				y: 0,
				width: cw,
				height: ch,
				overflow: "hidden",
				borderRadius: theme.radius.lg,
				children: [content, dim],
			});
			if (cycle)
				clip.animate(LayerAnimation.keys("height", ascending(tracks.clip)));
			const node = host.box({
				id: ctx.partId(`card-${c}`),
				position: "absolute",
				x: front.x,
				y: pose(c).y,
				width: cw,
				height: ch,
				anchorX: 0.5,
				anchorY: 0,
				children: [clip],
			});
			const anim = LayerAnimation.create()
				.keys("y", ascending(tracks.y))
				.keys("scale", ascending(tracks.scale))
				.keys("opacity", ascending(tracks.opacity));
			if (tracks.x.some((k) => k[1] !== front.x))
				anim.keys("x", ascending(tracks.x));
			if (tracks.rotation.some((k) => k[1] !== 0))
				anim.keys("rotation", ascending(tracks.rotation));
			if (tracks.rotateX.some((k) => k[1] !== 0))
				anim.keys("rotateX", ascending(tracks.rotateX));
			node.animate(anim);
			host.style(node, {
				dropShadow: {
					color: "#000000",
					opacity: 0.35,
					angle: 90,
					distance: 12 * s,
					size: 34 * s,
				},
			});
			parts[`card-${c}`] = node;
			parts[`card-${c}-clip`] = clip;
			nodes.push(node);
		});
		// Front-most last: cycle and fan start with card 0 in front, deal ends
		// with the last on top.
		const ordered = deal ? nodes : [...nodes].reverse();
		const children = props.tilt
			? [
					host.box({
						id: ctx.partId("tilt"),
						position: "absolute",
						x: 0,
						y: 0,
						width: W,
						height: H,
						perspective: 1600 * s,
						rotateX: props.tilt.rotateX,
						rotateY: props.tilt.rotateY,
						children: ordered,
					}),
				]
			: ordered;
		if (props.tilt) parts.tilt = children[0] as Animatable<LayoutNode>;

		return {
			children,
			width: W,
			height: H,
			duration: (changes.at(-1)?.frame ?? 0) + tr,
			openEnded: true,
			cues: { changes } as CardStackCues,
			parts,
		};
	},
});

const round = (v: number) => Math.round(v * 1000) / 1000;

const isSimple = (card: unknown): card is SimpleCard =>
	typeof card === "object" &&
	card !== null &&
	"title" in card &&
	!("kind" in card);

/** Later keys on a shared frame win; frames ascend. */
function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const byFrame = new Map<number, KeyframeTuple>();
	for (const k of keys) byFrame.set(k[0] as number, k);
	return [...byFrame.values()].sort(
		(a, b) => (a[0] as number) - (b[0] as number),
	);
}

/** A card drawn from the theme: optional image on top, title, body, accent bar. */
function simpleCard(
	ctx: Parameters<(typeof cardStack)["build"]>[0],
	card: SimpleCard,
	c: number,
	w: number,
	h: number,
): LayoutNode {
	const { host, theme } = ctx;
	const s = theme.scale;
	const pad = 36 * s;
	const imageH = card.image ? h * 0.48 : 0;
	const kids: LayoutNode[] = [];
	if (card.image)
		kids.push(
			host.media(card.image, {
				id: ctx.partId(`card-${c}-image`),
				position: "absolute",
				x: 0,
				y: 0,
				width: w,
				height: imageH,
				fit: "cover",
			}),
		);
	kids.push(
		host.box({
			id: ctx.partId(`card-${c}-accent`),
			position: "absolute",
			x: pad,
			y: imageH + pad,
			width: 44 * s,
			height: 5 * s,
			background: card.accent ?? theme.color.accent,
			borderRadius: 3 * s,
		}),
		host.text(card.title, {
			id: ctx.partId(`card-${c}-title`),
			position: "absolute",
			x: pad,
			y: imageH + pad + 22 * s,
			width: w - pad * 2,
			fontFamily: theme.font.display,
			fontSize: 40 * s,
			fontWeight: 700,
			fill: theme.color.ink,
		}),
	);
	if (card.body)
		kids.push(
			host.text(card.body, {
				id: ctx.partId(`card-${c}-body`),
				position: "absolute",
				x: pad,
				y: imageH + pad + 80 * s,
				width: w - pad * 2,
				fontFamily: theme.font.body,
				fontSize: 24 * s,
				fill: theme.color.muted,
			}),
		);
	return host.box({
		id: ctx.partId(`card-${c}-face`),
		position: "absolute",
		x: 0,
		y: 0,
		width: w,
		height: h,
		background: theme.color.raised,
		borderRadius: theme.radius.lg,
		borderColor: theme.color.line,
		borderWidth: Math.max(1, s),
		strokeAlign: "inside",
		children: kids,
	});
}
