/**
 * The inbox: the message list and the reading pane. The new request lands
 * in the first row; selecting it opens the message with "Create task".
 */
import {
	FontManager,
	Layer,
	LayerAnimation,
	type LayoutNode,
} from "framefields";
import {
	ACCENT,
	ACCENT_TINT,
	APP,
	EDGE,
	INK,
	LINE,
	MUTED,
	SANS,
	SEMIBOLD,
	SOFT,
	sec,
	space,
} from "../theme.js";
import { BODY, MESSAGES, type Message, REQUEST } from "./data.js";
import { avatar, dot, fade, icon, press, rise, rule, text } from "./kit.js";
import {
	CH,
	CREATE_BUTTON,
	LIST_TOP,
	LIST_W,
	LIST_X,
	PANE_W,
	PANE_X,
	REPLY_BUTTON,
	ROW_H,
} from "./layout.js";
import { boardIn, type Timeline } from "./timeline.js";

/**
 * A message row's content, in row px (LIST_W × ROW_H). Unread rows carry
 * the accent dot until `readAt`.
 */
export function messageRow(
	m: Message,
	unread: boolean,
	readAt?: number,
): LayoutNode[] {
	const nameWidth = FontManager.measure(m.from.name, {
		fontFamily: SANS,
		fontSize: 15,
		fontWeight: SEMIBOLD,
	}).width;
	const nodes: LayoutNode[] = [
		avatar(m.from, { x: space(3), y: 18, size: 36 }),
		text(m.from.name, { x: 72, y: 18, size: 15, strong: true }),
		text(m.client, {
			x: 72 + nameWidth + space(1),
			y: 18,
			size: 15,
			color: MUTED,
		}),
		text(m.time, {
			x: LIST_W - space(3) - 120,
			y: 20,
			width: 120,
			align: "end",
			size: 13,
			color: MUTED,
		}),
		text(m.preview, {
			x: 72,
			y: 48,
			size: 15,
			color: unread ? INK : SOFT,
		}),
		rule(space(3), ROW_H - 1, LIST_W - space(6), { color: LINE }),
	];
	if (unread) {
		const mark = dot({ x: 9, y: 32, size: 8, color: ACCENT });
		if (readAt !== undefined) mark.animate(fade(readAt, 6, 1, 0));
		nodes.push(mark);
	}
	return nodes;
}

export const REQUEST_MESSAGE: Message = {
	from: REQUEST.from,
	client: REQUEST.client,
	time: REQUEST.time,
	preview: REQUEST.question,
};

function list(t: Timeline): LayoutNode {
	// Older mail moves down a row to make room as the request flies in.
	const shiftFrom = t.landed - sec(0.6);
	const older = Layer.box({
		position: "absolute",
		x: 0,
		y: LIST_TOP,
		width: LIST_W,
		height: MESSAGES.length * ROW_H,
		children: MESSAGES.map((m, i) =>
			Layer.box({
				position: "absolute",
				x: 0,
				y: i * ROW_H,
				width: LIST_W,
				height: ROW_H,
				children: messageRow(m, false),
			}),
		),
	}).animate(
		LayerAnimation.keys("y", [
			[0, LIST_TOP],
			[shiftFrom, LIST_TOP, "hold"],
			[shiftFrom + sec(0.5), LIST_TOP + ROW_H, "expo.out"],
		]),
	);

	const selected = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: LIST_W,
		height: ROW_H,
		background: ACCENT_TINT,
		children: [
			Layer.box({
				position: "absolute",
				x: 0,
				y: 0,
				width: 3,
				height: ROW_H,
				background: ACCENT,
			}),
		],
	}).animate(fade(t.select.at, 4));
	const request = Layer.box({
		id: "request-row",
		position: "absolute",
		x: 0,
		y: LIST_TOP,
		width: LIST_W,
		height: ROW_H,
		background: APP,
		children: [selected, ...messageRow(REQUEST_MESSAGE, true, t.select.at)],
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[t.landed - 1, 0, "hold"],
			[t.landed, 1],
		]),
	);

	return Layer.box({
		position: "absolute",
		x: LIST_X,
		y: 0,
		width: LIST_W,
		height: CH,
		background: APP,
		overflow: "hidden",
		children: [
			older,
			request,
			Layer.box({
				position: "absolute",
				x: 0,
				y: 0,
				width: LIST_W,
				height: LIST_TOP,
				background: APP,
				children: [
					text("Inbox", { x: space(3), y: 22, size: 22, strong: true }),
					text("All clients", {
						x: LIST_W - space(3) - 160,
						y: 28,
						width: 160,
						align: "end",
						size: 14,
						color: MUTED,
					}),
					rule(0, LIST_TOP - 1, LIST_W, { color: LINE }),
				],
			}),
			rule(LIST_W - 1, 0, CH, { vertical: true, color: LINE }),
		],
	});
}

function button(
	label: string,
	r: { x: number; y: number; width: number; height: number },
	primary: boolean,
	glyph: "plus" | "reply",
) {
	return Layer.box({
		overflow: "hidden",
		position: "absolute",
		...r,
		borderRadius: space(1),
		background: primary ? ACCENT : APP,
		...(!primary && {
			borderColor: EDGE,
			borderWidth: 1,
			strokeAlign: "inside" as const,
		}),
		children: [
			icon(glyph, {
				x: space(2),
				y: 11,
				size: 18,
				color: primary ? "#ffffff" : SOFT,
				weight: 2,
			}),
			text(label, {
				x: space(5),
				y: 10,
				size: 15,
				strong: primary,
				color: primary ? "#ffffff" : INK,
			}),
		],
	});
}

function message(t: Timeline): LayoutNode {
	const at = t.select.at + 2;
	const x = space(5);
	const lines = BODY.map((line, i) =>
		text(line, {
			x,
			y: 232 + i * 30,
			size: 17,
			color: line === REQUEST.question ? INK : SOFT,
		}),
	);
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: PANE_W,
		height: CH,
		children: [
			text(`${REQUEST.client} · Website`, {
				x,
				y: 26,
				size: 14,
				color: MUTED,
			}),
			button(
				"Reply",
				{ ...REPLY_BUTTON, x: REPLY_BUTTON.x - PANE_X },
				false,
				"reply",
			),
			button(
				"Create task",
				{ ...CREATE_BUTTON, x: CREATE_BUTTON.x - PANE_X },
				true,
				"plus",
			).animate(press(t.create.down, t.create.up)),
			rule(0, 72, PANE_W, { color: LINE }),
			avatar(REQUEST.from, { x, y: 104, size: 44 }),
			text(REQUEST.from.name, { x: x + 60, y: 105, size: 17, strong: true }),
			text(REQUEST.email, { x: x + 60, y: 129, size: 14, color: MUTED }),
			text(REQUEST.time, {
				x: PANE_W - space(5) - 120,
				y: 108,
				width: 120,
				align: "end",
				size: 14,
				color: MUTED,
			}),
			text(REQUEST.subject, { x, y: 176, size: 28, strong: true }),
			...lines,
		],
	}).animate(rise(0, at, 10, sec(0.4)));
}

function readingPane(t: Timeline): LayoutNode {
	const empty = Layer.box({
		position: "absolute",
		x: 0,
		y: CH / 2 - 48,
		width: PANE_W,
		height: 96,
		children: [
			icon("inbox", { x: PANE_W / 2 - 16, y: 0, size: 32, color: EDGE }),
			text("Select a message to read it", {
				x: 0,
				y: 52,
				width: PANE_W,
				align: "center",
				size: 15,
				color: MUTED,
			}),
		],
	}).animate(fade(t.select.at, 4, 1, 0));
	return Layer.box({
		position: "absolute",
		x: PANE_X,
		y: 0,
		width: PANE_W,
		height: CH,
		background: APP,
		children: [empty, message(t)],
	});
}

/** List and reading pane; they make way for the board when the task is saved. */
export function inbox(t: Timeline): LayoutNode {
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: PANE_X + PANE_W,
		height: CH,
		children: [list(t), readingPane(t)],
	}).animate(fade(boardIn(t) - 4, 10, 1, 0));
}
