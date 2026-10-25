/**
 * ChatThread: a messaging conversation. Bubbles arrive from either side
 * with a spring, the other side types first (three bouncing dots), and the
 * thread scrolls to keep the newest message in view. Names, avatars,
 * timestamps, reactions and images included.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { springKeys } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { rangeRects } from "../core/text.js";

export interface ChatThreadCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Each message as it lands. */
	messages: ReadonlyArray<{ frame: number; index: number; from: string }>;
	/** Each typing indicator, shown to removed. */
	typing: ReadonlyArray<{ frame: number; end: number; from: string }>;
}

function messageSchema() {
	return z
		.object({
			from: z.string(),
			text: z.string().optional(),
			/** An image (path or URL) instead of, or above, text. */
			image: z.string().optional(),
			/** Image width / height. */
			aspect: z
				.number()
				.positive()
				.default(4 / 3),
			/** Frame it lands. Default: after the previous one has been read. */
			at: z.number().int().min(0).optional(),
			/** A reaction pinned to the bubble (an emoji or short text). */
			reaction: z.string().optional(),
			/** A small timestamp under the bubble. */
			time: z.string().optional(),
		})
		.strict()
		.refine((m) => m.text !== undefined || m.image !== undefined, {
			message: "A message needs `text` or `image`.",
		});
}

const SPRING = { stiffness: 260, damping: 20 };
/** Livelier, for reactions. */
const POP = { stiffness: 320, damping: 14 };

export const chatThread = /* @__PURE__ */ defineComponent({
	name: "ChatThread",
	props: () => ({
		messages: z.array(messageSchema()).min(1),
		/** Who is "me" (right side, accent bubbles). Default the first sender. */
		me: z.string().optional(),
		/** Display names and bubble colours per sender. */
		participants: z
			.record(
				z.string(),
				z
					.object({
						name: z.string().optional(),
						color: z.string().optional(),
						/** A picture (path or URL); without one the avatar shows initials. */
						avatar: z.string().optional(),
					})
					.strict(),
			)
			.default({}),
		/**
		 * Avatars beside each run of bubbles, at its newest one. Default:
		 * `"others"` when any participant has an `avatar`, else `"none"`.
		 */
		avatars: z.enum(["others", "everyone", "none"]).optional(),
		/** Names above the first bubble of each run (default: when more than two people talk). */
		names: z.boolean().optional(),
		/** Others type before they send. */
		typing: z.boolean().default(true),
		/** Reading speed between messages, characters a second. */
		readCps: z.number().positive().default(28),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 720 * s;
		const H = ctx.requested.height ?? 960 * s;
		const fs = props.fontSize ?? 30 * s;
		const fontFamily = props.fontFamily ?? theme.font.body;
		const me = props.me ?? props.messages[0]?.from ?? "me";
		const senders = [...new Set(props.messages.map((m) => m.from))];
		const showNames = props.names ?? senders.length > 2;
		const avatars =
			props.avatars ??
			(Object.values(props.participants).some((p) => p.avatar)
				? "others"
				: "none");
		const hasAvatar = (from: string) =>
			avatars === "everyone" || (avatars === "others" && from !== me);
		const pad = fs * 0.8;
		const padX = fs * 0.62;
		const padY = fs * 0.42;
		const avatarSize = fs * 1.5;
		// Bubbles on a side with avatars move in by this much.
		const inset = (from: string) =>
			hasAvatar(from) ? avatarSize + fs * 0.3 : 0;
		const maxW = Math.min(
			W * 0.74,
			W - pad * 2 - Math.max(...senders.map(inset)),
		);
		const radius = fs * 0.9;
		const smallFs = fs * 0.62;

		// ── Timing ────────────────────────────────────────────────────────
		const landed: number[] = [];
		const typingWindows: Array<{
			frame: number;
			end: number;
			from: string;
			index: number;
		}> = [];
		let t = Math.round(fps * 0.2);
		props.messages.forEach((m, i) => {
			const prev = props.messages[i - 1];
			if (prev && m.at === undefined) {
				const read = ((prev.text?.length ?? 12) / props.readCps) * fps;
				t += Math.round(Math.min(fps * 2.5, Math.max(fps * 0.5, read)));
			}
			let at = m.at ?? t;
			if (props.typing && m.from !== me && m.at === undefined) {
				const typingFor = Math.round(
					Math.min(2.2, Math.max(0.7, (m.text?.length ?? 10) / 14)) * fps,
				);
				typingWindows.push({
					frame: at,
					end: at + typingFor,
					from: m.from,
					index: i,
				});
				at += typingFor;
			}
			landed.push(at);
			t = at;
		});

		// ── Layout (top to bottom) ────────────────────────────────────────
		const measure = (text: string, size: number, width?: number) =>
			host.measure(text, {
				fontFamily,
				fontSize: size,
				...(width !== undefined && { width }),
			});
		interface Slot {
			index: number;
			y: number;
			width: number;
			height: number;
			right: boolean;
			nameY?: number;
			timeY?: number;
			textH: number;
			imageH: number;
		}
		const slots: Slot[] = [];
		let y = pad;
		props.messages.forEach((m, i) => {
			const prev = props.messages[i - 1];
			const right = m.from === me;
			const newRun = !prev || prev.from !== m.from;
			if (prev) y += newRun ? fs * 0.75 : fs * 0.22;
			// A reaction sits on the bubble's top corner; leave it room.
			if (prev && m.reaction) y += fs * 0.5;
			let nameY: number | undefined;
			if (showNames && newRun && !right) {
				nameY = y;
				y += measure("Ag", smallFs).height + fs * 0.12;
			}
			const inner = maxW - padX * 2;
			let textW = 0;
			let textH = 0;
			if (m.text) {
				const one = measure(m.text, fs);
				if (one.width <= inner) {
					textW = one.width;
					textH = one.height;
				} else {
					const wrapped = measure(m.text, fs, inner);
					textW = Math.max(
						...rangeRects(wrapped, 0, m.text.length, {
							fontFamily,
							fontSize: fs,
							width: inner,
						}).map((r) => r.width),
					);
					textH = wrapped.height;
				}
			}
			const imageW = m.image ? maxW : 0;
			const imageH = m.image ? imageW / m.aspect : 0;
			const width = m.image ? maxW : textW + padX * 2;
			const height = imageH + (m.text ? textH + padY * 2 : 0);
			slots.push({ index: i, y, width, height, right, nameY, textH, imageH });
			y += height;
			if (m.time) {
				(slots[slots.length - 1] as Slot).timeY = y + fs * 0.12;
				y += measure(m.time, smallFs * 0.9).height + fs * 0.12;
			}
		});

		// ── Nodes ─────────────────────────────────────────────────────────
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const content: LayoutNode[] = [];
		const colorOf = (from: string) =>
			props.participants[from]?.color ??
			(from === me ? theme.color.accent : theme.color.raised);
		const ink = (from: string) =>
			from === me && !props.participants[from]?.color
				? "#ffffff"
				: theme.color.ink;
		const fade = Math.max(2, Math.round(fps * 0.12));
		// The typing bubble: three dots in a pill, where the message will land.
		const dot = fs * 0.24;
		const typingW = dot * 3 + dot * 1.1 * 2 + padX * 2;
		const typingH = Math.max(fs + padY * 2 - fs * 0.3, dot + padY * 2);
		const typingOf = (index: number) =>
			typingWindows.find((w) => w.index === index);

		slots.forEach((slot) => {
			const m = props.messages[slot.index] as (typeof props.messages)[number];
			const at = landed[slot.index] as number;
			const x = slot.right
				? W - pad - inset(m.from) - slot.width
				: pad + inset(m.from);
			const children: LayoutNode[] = [];
			if (m.image) {
				children.push(
					host.box({
						id: ctx.partId(`image-${slot.index}`),
						position: "absolute",
						x: 0,
						y: 0,
						width: slot.width,
						height: slot.imageH,
						overflow: "hidden",
						borderRadius: radius,
						children: [
							host.media(m.image, {
								id: ctx.partId(`media-${slot.index}`),
								position: "absolute",
								x: 0,
								y: 0,
								width: slot.width,
								height: slot.imageH,
								fit: "cover",
							}),
						],
					}),
				);
			}
			const typed = typingOf(slot.index);
			// A typed text reply grows out of its typing bubble: same place,
			// same colour, so the dots become the message.
			const morph = typed !== undefined && !m.image;
			if (m.text) {
				const ty = slot.imageH + padY;
				const text = host.text(m.text, {
					id: ctx.partId(`text-${slot.index}`),
					position: "absolute",
					x: padX,
					y: ty,
					width: slot.width - padX * 2 + 1,
					fontFamily,
					fontSize: fs,
					fill: ink(m.from),
				});
				// The words settle in just after their bubble opens.
				const t0 = at + (morph ? Math.round(fps * 0.12) : 1);
				text.animate(
					LayerAnimation.create()
						.keys("opacity", [
							[0, 0],
							[t0, 0],
							[t0 + fade, 1, "power2.out"],
						])
						.keys("y", [
							[0, ty + fs * 0.2],
							[t0, ty + fs * 0.2],
							[t0 + Math.round(fps * 0.3), ty, "power3.out"],
						]),
				);
				children.push(text);
			}
			const bubble = host.box({
				id: ctx.partId(`bubble-${slot.index}`),
				position: "absolute",
				x,
				y: slot.y,
				width: slot.width,
				height: slot.height,
				background: m.image && !m.text ? "rgba(0,0,0,0)" : colorOf(m.from),
				borderRadius: radius,
				// Springs grow from the corner the bubble comes from.
				anchorX: slot.right ? 1 : 0,
				anchorY: 1,
				children,
			});
			if (morph)
				bubble.animate(
					LayerAnimation.create()
						.keys("width", springKeys(at, typingW, slot.width, fps, SPRING))
						.keys("height", springKeys(at, typingH, slot.height, fps, SPRING))
						.keys(
							"borderRadius",
							springKeys(at, typingH / 2, radius, fps, SPRING),
						)
						.keys("opacity", [
							[0, 0],
							[at, 1, "hold"],
						]),
				);
			else {
				// Sent bubbles rise from below, as if from the compose field;
				// received ones pop from their corner.
				const [scale, lift] = slot.right ? [0.86, fs * 1.1] : [0.6, fs * 0.5];
				bubble.animate(
					LayerAnimation.create()
						.keys("scale", springKeys(at, scale, 1, fps, SPRING))
						.keys("y", springKeys(at, slot.y + lift, slot.y, fps, SPRING))
						.keys("opacity", [
							[at, 0],
							[at + fade, 1, "power2.out"],
						]),
				);
			}
			content.push(bubble);
			parts[`bubble-${slot.index}`] = bubble;

			const small = (
				id: string,
				text: string,
				size: number,
				tx: number,
				ty: number,
				from = at,
			) => {
				const node = host.text(text, {
					id: ctx.partId(id),
					position: "absolute",
					x: tx,
					y: ty,
					fontFamily,
					fontSize: size,
					fill: theme.color.muted,
				});
				node.animate(
					LayerAnimation.keys("opacity", [
						[0, 0],
						[from, 0],
						[from + Math.round(fps * 0.25), 1, "power2.out"],
					]),
				);
				content.push(node);
			};
			if (slot.nameY !== undefined)
				small(
					`name-${slot.index}`,
					props.participants[m.from]?.name ?? m.from,
					smallFs,
					x + padX * 0.5,
					slot.nameY,
					// With the run's typing dots, when it starts with them.
					typed?.frame ?? at,
				);
			if (slot.timeY !== undefined && m.time) {
				const tw = measure(m.time, smallFs * 0.9).width;
				small(
					`time-${slot.index}`,
					m.time,
					smallFs * 0.9,
					slot.right ? x + slot.width - tw - padX * 0.3 : x + padX * 0.3,
					slot.timeY,
				);
			}
			if (m.reaction) {
				// Hearts are drawn, so they show without an emoji font; anything
				// else is text (emoji need one registered).
				const heart = /^(❤️?|♥️?|heart)$/u.test(m.reaction.trim());
				const rfs = fs * 0.9;
				const rm = measure(m.reaction, rfs);
				const rh = fs * 1.5;
				const rw = heart ? rh : Math.max(rh, rm.width + fs * 0.6);
				const rAt = at + Math.round(fps * 0.6);
				const border = Math.max(2, fs * 0.1);
				const hs = rh * 0.46;
				// On the outer top corner, like a tapback.
				const pill = host.box({
					id: ctx.partId(`reaction-${slot.index}`),
					position: "absolute",
					x: slot.right ? x - rw * 0.45 : x + slot.width - rw * 0.55,
					y: slot.y - rh * 0.6,
					width: rw,
					height: rh,
					background: theme.color.raised,
					borderRadius: rh / 2,
					borderColor: theme.color.bg,
					borderWidth: border,
					anchorX: 0.5,
					anchorY: 1,
					children: [
						heart
							? host.shape("path", {
									id: ctx.partId(`reaction-${slot.index}-heart`),
									position: "absolute",
									x: (rw - hs) / 2,
									y: (rh - hs * 0.92) / 2 + hs * 0.04,
									width: hs,
									height: hs * 0.92,
									d: heartPath(hs),
									fillType: "solid",
									fillColor: theme.color.negative,
								})
							: host.text(m.reaction, {
									id: ctx.partId(`reaction-${slot.index}-text`),
									position: "absolute",
									x: (rw - rm.width) / 2,
									y: (rh - rm.height) / 2,
									fontFamily,
									fontSize: rfs,
									fill: theme.color.ink,
								}),
					],
				});
				pill.animate(
					LayerAnimation.create()
						.keys("scale", springKeys(rAt, 0, 1, fps, POP))
						.keys("rotation", springKeys(rAt, -24, 0, fps, POP))
						.keys("opacity", [
							[0, 0],
							[rAt, 1, "hold"],
						]),
				);
				content.push(pill);
			}
		});

		// Typing indicators sit where the message will land.
		typingWindows.forEach((w, k) => {
			const slot = slots[w.index] as Slot;
			const bw = typingW;
			const bh = typingH;
			const dots: LayoutNode[] = [0, 1, 2].map((d) => {
				const node = host.box({
					id: ctx.partId(`typing-${k}-dot-${d}`),
					position: "absolute",
					x: padX + d * dot * 2.1,
					y: (bh - dot) / 2,
					width: dot,
					height: dot,
					background: theme.color.muted,
					borderRadius: dot / 2,
				});
				// A wave through the dots, one bounce every 0.6 s.
				const period = Math.round(fps * 0.6);
				const keys: KeyframeTuple[] = [[0, (bh - dot) / 2]];
				const glow: KeyframeTuple[] = [[0, 0.45]];
				for (
					let f = w.frame + d * Math.round(period / 5);
					f < w.end;
					f += period
				) {
					keys.push(
						[f, (bh - dot) / 2],
						[
							f + Math.round(period / 4),
							(bh - dot) / 2 - dot * 0.7,
							"sine.out",
						],
						[f + Math.round(period / 2), (bh - dot) / 2, "sine.in"],
					);
					// Each dot brightens at the top of its bounce.
					glow.push(
						[f, 0.45],
						[f + Math.round(period / 4), 1, "sine.out"],
						[f + Math.round(period / 2), 0.45, "sine.in"],
					);
				}
				node.animate(
					LayerAnimation.create()
						.keys("y", ascending(keys))
						.keys("opacity", ascending(glow)),
				);
				return node;
			});
			const bubble = host.box({
				id: ctx.partId(`typing-${k}`),
				position: "absolute",
				x: pad + inset(w.from),
				y: slot.y,
				width: bw,
				height: bh,
				background: colorOf(w.from),
				borderRadius: bh / 2,
				anchorX: 0,
				anchorY: 1,
				children: dots,
			});
			bubble.animate(
				LayerAnimation.create()
					.keys("scale", springKeys(w.frame, 0.5, 1, fps, SPRING))
					.keys("opacity", [
						[0, 0],
						[w.frame, 1, "hold"],
						[w.end, 0, "hold"],
					]),
			);
			content.push(bubble);
		});

		const avatar = (
			from: string,
			id: string,
			x: number,
			y: number,
		): Animatable<LayoutNode> => {
			const p = props.participants[from];
			const size = avatarSize;
			const base = {
				id: ctx.partId(id),
				position: "absolute" as const,
				x,
				y,
				width: size,
				height: size,
				borderRadius: size / 2,
				anchorX: 0.5,
				anchorY: 1,
			};
			if (p?.avatar)
				return host.box({
					...base,
					overflow: "hidden",
					background: theme.color.raised,
					children: [
						host.media(p.avatar, {
							id: ctx.partId(`${id}-image`),
							position: "absolute",
							x: 0,
							y: 0,
							width: size,
							height: size,
							fit: "cover",
						}),
					],
				});
			const letters = initials(p?.name ?? from);
			const ifs = size * (letters.length > 1 ? 0.38 : 0.44);
			const m = host.measure(letters, {
				fontFamily,
				fontSize: ifs,
				fontWeight: 600,
			});
			return host.box({
				...base,
				background: colorOf(from),
				children: [
					host.text(letters, {
						id: ctx.partId(`${id}-initials`),
						position: "absolute",
						x: (size - m.width) / 2,
						y: (size - m.height) / 2,
						fontFamily,
						fontSize: ifs,
						fontWeight: 600,
						fill: ink(from),
					}),
				],
			});
		};

		// One avatar per run of bubbles: it arrives with the run's typing dots
		// or first bubble and moves down to each newer bubble, iMessage style.
		const runs: number[][] = [];
		props.messages.forEach((m, i) => {
			const run = runs[runs.length - 1];
			if (run && props.messages[run[0] as number]?.from === m.from) run.push(i);
			else runs.push([i]);
		});
		runs.forEach((run) => {
			const from = props.messages[run[0] as number]?.from ?? "";
			if (!hasAvatar(from)) return;
			const r = run[0] as number;
			const stops: Array<[number, number]> = [];
			for (const i of run) {
				const slot = slots[i] as Slot;
				const w = typingWindows.find((tw) => tw.index === i);
				if (w) stops.push([w.frame, slot.y + typingH - avatarSize]);
				stops.push([landed[i] as number, slot.y + slot.height - avatarSize]);
			}
			const [start, startY] = stops[0] as [number, number];
			// Same spring as the bubbles, so it stays level with their bottoms.
			const y: KeyframeTuple[] = [[0, startY]];
			let current = startY;
			for (const [f, to] of stops.slice(1)) {
				if (to === current) continue;
				y.push(...springKeys(f, current, to, fps, SPRING));
				current = to;
			}
			const node = avatar(
				from,
				`avatar-${r}`,
				from === me ? W - pad - avatarSize : pad,
				startY,
			);
			node.animate(
				LayerAnimation.create()
					.keys("y", ascending(y))
					.keys("scale", springKeys(start, 0.4, 1, fps, SPRING))
					.keys("opacity", [
						[0, 0],
						[start, 0],
						[start + Math.max(2, Math.round(fps * 0.12)), 1, "power2.out"],
					]),
			);
			content.push(node);
			parts[`avatar-${r}`] = node;
		});

		// ── Scroll: keep the newest bubble (or typing dots) in view ───────
		const events = [
			...slots.map((sl) => ({
				frame: landed[sl.index] as number,
				bottom: sl.y + sl.height + (sl.timeY !== undefined ? fs : 0),
			})),
			...typingWindows.map((w) => ({
				frame: w.frame,
				bottom: (slots[w.index] as Slot).y + fs * 1.6,
			})),
		].sort((a, b) => a.frame - b.frame);
		const scroll: KeyframeTuple[] = [[0, 0]];
		let top = 0;
		const glide = Math.round(fps * 0.35);
		for (const e of events) {
			const want = Math.min(0, H - pad - e.bottom);
			if (want >= top) continue;
			const last = scroll[scroll.length - 1] as KeyframeTuple;
			if (e.frame > last[0]) scroll.push([e.frame, top]);
			scroll.push([Math.max(e.frame, last[0]) + glide, want, "power3.out"]);
			top = want;
		}
		const column = host.box({
			id: ctx.partId("column"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: Math.max(H, y + pad),
			children: content,
		});
		column.animate(LayerAnimation.keys("y", ascending(scroll)));
		const viewport = host.box({
			id: ctx.partId("viewport"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			overflow: "hidden",
			children: [column],
		});
		parts.column = column;
		parts.viewport = viewport;

		const lastAt = Math.max(...landed);
		return {
			children: [viewport],
			width: W,
			height: H,
			duration: lastAt + Math.round(fps * 0.8),
			openEnded: true,
			cues: {
				messages: landed.map((frame, index) => ({
					frame,
					index,
					from: props.messages[index]?.from ?? "",
				})),
				typing: typingWindows.map(({ frame, end, from }) => ({
					frame,
					end,
					from,
				})),
			} as ChatThreadCues,
			parts,
		};
	},
});

/** "Ana Lima" → "AL", "kai" → "K". */
function initials(name: string): string {
	const words = name.trim().split(/\s+/u).filter(Boolean);
	const first = (w: string | undefined) => [...(w ?? "")][0] ?? "";
	return (
		first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")
	).toUpperCase();
}

/** A heart `size` wide, top-left at 0, 0 (two lobes and a point). */
function heartPath(size: number): string {
	const w = size;
	const h = size * 0.92;
	return [
		`M${w / 2} ${h}`,
		`C${w * 0.18} ${h * 0.72} 0 ${h * 0.5} 0 ${h * 0.28}`,
		`C0 ${h * 0.1} ${w * 0.14} 0 ${w * 0.28} 0`,
		`C${w * 0.39} 0 ${w * 0.47} ${h * 0.07} ${w / 2} ${h * 0.16}`,
		`C${w * 0.53} ${h * 0.07} ${w * 0.61} 0 ${w * 0.72} 0`,
		`C${w * 0.86} 0 ${w} ${h * 0.1} ${w} ${h * 0.28}`,
		`C${w} ${h * 0.5} ${w * 0.82} ${h * 0.72} ${w / 2} ${h} Z`,
	].join(" ");
}

function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const out: KeyframeTuple[] = [];
	for (const k of [...keys].sort((a, b) => a[0] - b[0])) {
		while (out.length > 0 && (out[out.length - 1] as KeyframeTuple)[0] >= k[0])
			out.pop();
		out.push(k);
	}
	return out;
}
