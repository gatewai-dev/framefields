/**
 * ChatThread: a messaging conversation. Bubbles arrive from either side
 * with a spring, the other side types first (three bouncing dots), and the
 * thread scrolls to keep the newest message in view. Names, timestamps,
 * reactions and images included.
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
					.object({ name: z.string().optional(), color: z.string().optional() })
					.strict(),
			)
			.default({}),
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
		const pad = fs * 0.8;
		const padX = fs * 0.62;
		const padY = fs * 0.42;
		const maxW = W * 0.74;
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
		const entry = (node: Animatable<LayoutNode>, at: number, baseY: number) =>
			node.animate(
				LayerAnimation.create()
					.keys("scale", springKeys(at, 0.6, 1, fps, SPRING))
					.keys("y", springKeys(at, baseY + fs * 0.5, baseY, fps, SPRING))
					.keys("opacity", [
						[at, 0],
						[at + Math.max(2, Math.round(fps * 0.12)), 1, "power2.out"],
					]),
			);

		slots.forEach((slot) => {
			const m = props.messages[slot.index] as (typeof props.messages)[number];
			const at = landed[slot.index] as number;
			const x = slot.right ? W - pad - slot.width : pad;
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
			if (m.text)
				children.push(
					host.text(m.text, {
						id: ctx.partId(`text-${slot.index}`),
						position: "absolute",
						x: padX,
						y: slot.imageH + padY,
						width: slot.width - padX * 2 + 1,
						fontFamily,
						fontSize: fs,
						fill: ink(m.from),
					}),
				);
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
			entry(bubble, at, slot.y);
			content.push(bubble);
			parts[`bubble-${slot.index}`] = bubble;

			const small = (
				id: string,
				text: string,
				size: number,
				tx: number,
				ty: number,
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
						[at, 0],
						[at + Math.round(fps * 0.25), 1, "power2.out"],
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
				// Hearts are drawn (most fonts have no emoji); anything else is text.
				const heart = /^(❤️?|♥️?|heart)$/u.test(m.reaction.trim());
				const rm = measure(heart ? "M" : m.reaction, fs * 0.7);
				const rh = rm.height + fs * 0.16;
				const rw = heart ? rh * 1.3 : rm.width + fs * 0.5;
				const rAt = at + Math.round(fps * 0.6);
				const pill = host.box({
					id: ctx.partId(`reaction-${slot.index}`),
					position: "absolute",
					x: slot.right ? x - rw * 0.35 : x + slot.width - rw * 0.65,
					y: slot.y + slot.height - rh * 0.45,
					width: rw,
					height: rh,
					background: theme.color.surface,
					borderRadius: rh / 2,
					borderColor: theme.color.bg,
					borderWidth: Math.max(2, fs * 0.08),
					children: [
						heart
							? host.shape("path", {
									id: ctx.partId(`reaction-${slot.index}-heart`),
									position: "absolute",
									x: (rw - rh * 0.56) / 2,
									y: rh * 0.24,
									width: rh * 0.56,
									height: rh * 0.52,
									d: heartPath(rh * 0.56),
									fillType: "solid",
									fillColor: theme.color.negative,
								})
							: host.text(m.reaction, {
									id: ctx.partId(`reaction-${slot.index}-text`),
									position: "absolute",
									x: fs * 0.25,
									y: fs * 0.08,
									fontFamily,
									fontSize: fs * 0.7,
									fill: theme.color.ink,
								}),
					],
				});
				pill.animate(
					LayerAnimation.create()
						.keys(
							"scale",
							springKeys(rAt, 0, 1, fps, { stiffness: 320, damping: 14 }),
						)
						.keys("opacity", [
							[0, 0],
							[rAt, 1, "hold"],
						]),
				);
				content.push(pill);
			}
		});

		// Typing indicators sit where the message will land.
		const dot = fs * 0.24;
		typingWindows.forEach((w, k) => {
			const slot = slots[w.index] as Slot;
			const bw = dot * 3 + dot * 1.1 * 2 + padX * 2;
			const bh = Math.max(fs + padY * 2 - fs * 0.3, dot + padY * 2);
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
				for (
					let f = w.frame + d * Math.round(period / 5);
					f < w.end;
					f += period
				)
					keys.push(
						[f, (bh - dot) / 2],
						[
							f + Math.round(period / 4),
							(bh - dot) / 2 - dot * 0.7,
							"sine.out",
						],
						[f + Math.round(period / 2), (bh - dot) / 2, "sine.in"],
					);
				node.animate(LayerAnimation.keys("y", ascending(keys)));
				return node;
			});
			const bubble = host.box({
				id: ctx.partId(`typing-${k}`),
				position: "absolute",
				x: pad,
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
