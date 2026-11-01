/**
 * The project board: four columns of cards. The new task lands at the top
 * of Ready, the cards under it make room, and the column count ticks over.
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
	LINE,
	MUTED,
	SANS,
	SEMIBOLD,
	SOFT,
	SUBTLE,
	sec,
	space,
} from "../theme.js";
import { AVA, type Card, COLUMNS, LEO, MAYA, NEW_CARD } from "./data.js";
import { CARD_RADIUS } from "./handoffs.js";
import { avatar, during, fade, icon, raise, rise, rule, text } from "./kit.js";
import {
	BOARD_X,
	CARD_H,
	CARD_W,
	CH,
	COLUMN_W,
	COLUMNS_Y,
	CW,
	cardSlot,
	columnX,
	READY,
	SIDEBAR_W,
} from "./layout.js";
import { boardIn, cardLands, type Timeline } from "./timeline.js";

/** A card; `contents` animates what is on it, apart from the card itself. */
function card(c: Card, x: number, y: number, contents?: LayerAnimation) {
	const children: LayoutNode[] = [
		text(c.title, { x: space(2), y: space(2), size: 15, strong: true }),
		avatar(c.owner, { x: space(2), y: 56, size: 24 }),
		icon("calendar", { x: 50, y: 61, size: 15 }),
		text(c.due, { x: 70, y: 60, size: 13, color: SOFT }),
		icon("checklist", { x: CARD_W - space(2) - 48, y: 61, size: 15 }),
		text(`${c.done}/${c.total}`, {
			x: CARD_W - space(2) - 28,
			y: 60,
			width: 28,
			align: "end",
			size: 13,
			color: SOFT,
		}),
	];
	return raise(
		Layer.box({
			position: "absolute",
			x,
			y,
			width: CARD_W,
			height: CARD_H,
			borderRadius: CARD_RADIUS,
			background: APP,
			borderColor: LINE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: contents
				? [
						Layer.box({
							position: "absolute",
							x: 0,
							y: 0,
							width: CARD_W,
							height: CARD_H,
							children,
						}).animate(contents),
					]
				: children,
		}),
		"card",
	);
}

function header(): LayoutNode[] {
	const tabs = ["Board", "List", "Timeline"];
	const nodes: LayoutNode[] = [
		text("Brightline website", { x: BOARD_X, y: 22, size: 22, strong: true }),
	];
	[MAYA, LEO, AVA].forEach((p, i) => {
		nodes.push(
			Layer.box({
				position: "absolute",
				x: CW - space(4) - 28 - (2 - i) * 22 - 2,
				y: 22,
				width: 32,
				height: 32,
				borderRadius: 16,
				background: APP,
				children: [avatar(p, { x: 2, y: 2, size: 28 })],
			}),
		);
	});
	let x = BOARD_X;
	tabs.forEach((label, i) => {
		const width = FontManager.measure(label, {
			fontFamily: SANS,
			fontSize: 15,
			fontWeight: SEMIBOLD,
		}).width;
		nodes.push(
			text(label, {
				x,
				y: 76,
				size: 15,
				strong: i === 0,
				color: i === 0 ? undefined : MUTED,
			}),
		);
		if (i === 0)
			nodes.push(
				Layer.box({
					position: "absolute",
					x,
					y: 102,
					width,
					height: 2,
					background: ACCENT,
				}),
			);
		x += width + space(3);
	});
	nodes.push(rule(SIDEBAR_W, 104, CW - SIDEBAR_W, { color: LINE }));
	return nodes;
}

/** A column's header count; Ready's ticks over when the new card lands. */
function count(column: number, x: number, t: Timeline): LayoutNode[] {
	const n = COLUMNS[column]?.cards.length ?? 0;
	const label = (v: number) =>
		text(String(v), { x, y: COLUMNS_Y + 15, size: 14, color: MUTED });
	if (column !== READY) return [label(n)];
	return [
		label(n).animate(fade(cardLands(t) - 4, 4, 1, 0)),
		label(n + 1).animate(fade(cardLands(t), 6)),
	];
}

function columns(t: Timeline): LayoutNode[] {
	const nodes: LayoutNode[] = [];
	const makeRoom = cardLands(t) - sec(0.35);
	COLUMNS.forEach((col, i) => {
		const x = columnX(i);
		const nameWidth = FontManager.measure(col.name, {
			fontFamily: SANS,
			fontSize: 14,
			fontWeight: SEMIBOLD,
		}).width;
		nodes.push(
			Layer.box({
				position: "absolute",
				x,
				y: COLUMNS_Y,
				width: COLUMN_W,
				height: CH - COLUMNS_Y - space(3),
				borderRadius: 12,
				background: SUBTLE,
			}),
			text(col.name, {
				x: x + space(2),
				y: COLUMNS_Y + 15,
				size: 14,
				strong: true,
			}),
			...count(i, x + space(2) + nameWidth + space(1), t),
		);
		col.cards.forEach((c, j) => {
			const slot = cardSlot(i, j);
			const node = card(c, slot.x, slot.y);
			if (i === READY) {
				const below = cardSlot(i, j + 1).y;
				node.animate(
					LayerAnimation.keys("y", [
						[0, slot.y],
						[makeRoom + j * 2, slot.y, "hold"],
						[makeRoom + j * 2 + sec(0.45), below, "expo.out"],
					]),
				);
			}
			nodes.push(node);
		});
	});
	return nodes;
}

/**
 * The new task: the modal's shell lands in Ready's first slot and becomes
 * this card, ringed in the accent for a moment. It empties again when it
 * leaves for the end card.
 */
function newCard(t: Timeline): LayoutNode[] {
	const slot = cardSlot(READY, 0);
	const at = cardLands(t);
	const ring = Layer.box({
		position: "absolute",
		x: slot.x - 3,
		y: slot.y - 3,
		width: slot.width + 6,
		height: slot.height + 6,
		borderRadius: CARD_RADIUS + 3,
		background: ACCENT_TINT,
		borderColor: ACCENT,
		borderWidth: 2,
		strokeAlign: "inside",
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[at, 0, "hold"],
			[at + 6, 1, "power2.out"],
			[at + sec(2.4), 1, "hold"],
			[at + sec(3.2), 0, "power2.inOut"],
		]),
	);
	const contents = LayerAnimation.keys("opacity", [
		[0, 0],
		[at, 0, "hold"],
		[at + 8, 1, "power2.out"],
		[t.sceneOut - 8, 1, "hold"],
		[t.sceneOut - 2, 0, "power2.in"],
	]);
	const node = card(NEW_CARD, slot.x, slot.y, contents).animate(
		during(at, t.sceneOut),
	);
	return [ring, node];
}

/** The board view, arriving as the modal closes. */
export function board(t: Timeline): LayoutNode {
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: CW,
		height: CH,
		children: [...header(), ...columns(t), ...newCard(t)],
	}).animate(rise(0, boardIn(t), 10, sec(0.5)));
}
