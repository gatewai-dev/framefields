/**
 * The "New task" modal, drafted from the request: title and source filled
 * in, then an owner, a due date and a checklist, and Create task.
 */
import {
	type AnimatableNode,
	Layer,
	LayerAnimation,
	type LayoutNode,
} from "framefields";
import {
	ACCENT,
	APP,
	EDGE,
	INK,
	LINE,
	MUTED,
	SOFT,
	SUBTLE,
	sec,
	space,
} from "../theme.js";
import { CHECKLIST, DUE_OPTIONS, FRIDAY, MAYA, REQUEST, TEAM } from "./data.js";
import { MODAL_RADIUS } from "./handoffs.js";
import {
	avatar,
	dot,
	during,
	fade,
	type IconName,
	icon,
	press,
	type Rect,
	raise,
	rise,
	rule,
	shown,
	text,
} from "./kit.js";
import {
	ADD_CHECKLIST,
	ASSIGNEE_FIELD,
	CANCEL_BUTTON,
	CH,
	CHECK_ROW,
	CHECKLIST_Y,
	CW,
	DUE_FIELD,
	FOOTER_Y,
	MODAL,
	menuUnder,
	optionIn,
	PROJECT_FIELD,
	propertyY,
	SAVE_BUTTON,
	STATUS_FIELD,
} from "./layout.js";
import {
	checklistItemAt,
	handOff,
	modalIn,
	modalOpen,
	modalOut,
	type Timeline,
} from "./timeline.js";

const PAD = space(4);

/** A field box; `focus` rings it in the accent while its menu is open. */
function field(
	r: Rect,
	content: LayoutNode[],
	focus?: { from: number; to: number },
): LayoutNode[] {
	const nodes: LayoutNode[] = [
		Layer.box({
			overflow: "hidden",
			position: "absolute",
			...r,
			borderRadius: space(1),
			background: APP,
			borderColor: EDGE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: content,
		}),
	];
	if (focus)
		nodes.push(
			Layer.box({
				position: "absolute",
				...r,
				borderRadius: space(1),
				borderColor: ACCENT,
				borderWidth: 2,
				strokeAlign: "inside",
			}).animate(shown(focus.from, focus.to, 3)),
		);
	return nodes;
}

/** Field content that swaps from `before` to `after` at `at`. */
function swap(before: LayoutNode[], after: LayoutNode[], at: number) {
	const group = (children: LayoutNode[]) =>
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: 280,
			height: 40,
			children,
		});
	return [
		group(before).animate(fade(at, 4, 1, 0)),
		group(after).animate(fade(at, 6)),
	];
}

function property(i: number, label: string, glyph: IconName): LayoutNode[] {
	const y = propertyY(i);
	return [
		icon(glyph, { x: PAD, y: y + 11, size: 18 }),
		text(label, { x: PAD + 28, y: y + 10, size: 15, color: SOFT }),
	];
}

function properties(t: Timeline): LayoutNode[] {
	const chosen = t.maya.at + 2;
	const dated = t.friday.at + 2;
	const friday = DUE_OPTIONS[FRIDAY]?.date ?? "";
	return [
		...property(0, "Assignee", "user"),
		...field(
			ASSIGNEE_FIELD,
			swap(
				[
					icon("user", { x: 12, y: 11, size: 18 }),
					text("Unassigned", { x: 40, y: 10, size: 15, color: MUTED }),
					icon("chevron", { x: 280 - 30, y: 12, size: 16 }),
				],
				[
					avatar(MAYA, { x: 10, y: 8, size: 24 }),
					text(MAYA.name, { x: 42, y: 10, size: 15 }),
				],
				chosen,
			),
			{ from: t.assignee.at, to: chosen },
		),
		...property(1, "Due date", "calendar"),
		...field(
			DUE_FIELD,
			swap(
				[
					icon("calendar", { x: 12, y: 11, size: 18 }),
					text("No due date", { x: 40, y: 10, size: 15, color: MUTED }),
					icon("chevron", { x: 280 - 30, y: 12, size: 16 }),
				],
				[
					icon("calendar", { x: 12, y: 11, size: 18, color: INK }),
					text(friday, { x: 40, y: 10, size: 15 }),
				],
				dated,
			),
			{ from: t.due.at, to: dated },
		),
		...property(2, "Project", "folder"),
		...field(PROJECT_FIELD, [
			icon("folder", { x: 12, y: 11, size: 18 }),
			text("Brightline website", { x: 40, y: 10, size: 15 }),
		]),
		...property(3, "Status", "status"),
		...field(STATUS_FIELD, [
			dot({ x: 16, y: 16, size: 8, color: ACCENT }),
			text("Ready", { x: 40, y: 10, size: 15 }),
		]),
	];
}

function checklist(t: Timeline): LayoutNode[] {
	const first = checklistItemAt(t, 0);
	const items = CHECKLIST.map((label, i) => {
		const y = ADD_CHECKLIST.y + i * CHECK_ROW;
		return Layer.box({
			position: "absolute",
			x: PAD,
			y,
			width: MODAL.width - 2 * PAD,
			height: 40,
			children: [
				Layer.box({
					position: "absolute",
					x: 0,
					y: 11,
					width: 18,
					height: 18,
					borderRadius: 5,
					borderColor: EDGE,
					borderWidth: 1.5,
					strokeAlign: "inside",
				}),
				text(label, { x: 30, y: 10, size: 15 }),
			],
		}).animate(rise(y, checklistItemAt(t, i), 8, sec(0.35)));
	});
	const add = Layer.box({
		overflow: "hidden",
		position: "absolute",
		...ADD_CHECKLIST,
		borderRadius: space(1),
		borderColor: EDGE,
		borderWidth: 1,
		strokeAlign: "inside",
		background: APP,
		children: [
			icon("plus", { x: 12, y: 11, size: 18, color: SOFT }),
			text("Add checklist", { x: 38, y: 10, size: 15, color: SOFT }),
		],
	})
		.animate(press(t.checklist.down, t.checklist.up))
		.animate(fade(t.checklist.up, 4, 1, 0));
	return [
		text("Checklist", { x: PAD, y: CHECKLIST_Y, size: 15, strong: true }),
		text(`0 of ${CHECKLIST.length}`, {
			x: MODAL.width - PAD - 120,
			y: CHECKLIST_Y + 1,
			width: 120,
			align: "end",
			size: 14,
			color: MUTED,
		}).animate(fade(first, 8)),
		add,
		...items,
	];
}

function footer(t: Timeline): LayoutNode[] {
	return [
		rule(0, FOOTER_Y, MODAL.width, { color: LINE }),
		Layer.box({
			overflow: "hidden",
			position: "absolute",
			...CANCEL_BUTTON,
			borderRadius: space(1),
			borderColor: EDGE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: [
				text("Cancel", {
					x: 0,
					y: 10,
					width: CANCEL_BUTTON.width,
					align: "center",
					size: 15,
				}),
			],
		}),
		Layer.box({
			overflow: "hidden",
			position: "absolute",
			...SAVE_BUTTON,
			borderRadius: space(1),
			background: ACCENT,
			children: [
				text("Create task", {
					x: 0,
					y: 10,
					width: SAVE_BUTTON.width,
					align: "center",
					size: 15,
					strong: true,
					color: "#ffffff",
				}),
			],
		}).animate(press(t.save.down, t.save.up)),
	];
}

/** A menu of options under a field, open from `open` until `close`. */
function menu(
	r: Rect,
	rows: Array<(o: Rect) => LayoutNode[]>,
	hover: { index: number; from: number },
	open: number,
	close: number,
): AnimatableNode {
	const local = (o: Rect): Rect => ({ ...o, x: o.x - r.x, y: o.y - r.y });
	const highlight = local(optionIn(r, hover.index));
	return raise(
		Layer.box({
			overflow: "hidden",
			position: "absolute",
			...r,
			anchorY: 0,
			borderRadius: 10,
			background: APP,
			borderColor: LINE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: [
				Layer.box({
					position: "absolute",
					...highlight,
					borderRadius: 6,
					background: SUBTLE,
				}).animate(fade(hover.from, 4)),
				...rows.flatMap((row, i) => row(local(optionIn(r, i)))),
			],
		}),
		"popover",
	).animate(
		shown(open, close, 4),
		// Unfolds from under its field.
		LayerAnimation.create()
			.keys("y", [
				[0, r.y - 6],
				[open, r.y - 6, "hold"],
				[open + sec(0.25), r.y, "expo.out"],
			])
			.keys("scale", [
				[0, 0.94],
				[open, 0.94, "hold"],
				[open + sec(0.3), 1, "expo.out"],
			]),
	);
}

function menus(t: Timeline): LayoutNode[] {
	const assignees = menuUnder(ASSIGNEE_FIELD, TEAM.length);
	const dates = menuUnder(DUE_FIELD, DUE_OPTIONS.length);
	return [
		menu(
			assignees,
			TEAM.map(({ person, role }) => (o: Rect) => [
				avatar(person, { x: o.x + 10, y: o.y + 8, size: 28 }),
				text(person.name, { x: o.x + 48, y: o.y + 12, size: 15 }),
				text(role, {
					x: o.x + o.width - 12 - 110,
					y: o.y + 13,
					width: 110,
					align: "end",
					size: 13,
					color: MUTED,
				}),
			]),
			{ index: 0, from: t.mayaHover },
			t.assignee.at + 1,
			t.maya.at + 4,
		),
		menu(
			dates,
			DUE_OPTIONS.map(({ label, date }) => (o: Rect) => [
				text(label, { x: o.x + 12, y: o.y + 12, size: 15 }),
				text(date, {
					x: o.x + o.width - 12 - 120,
					y: o.y + 13,
					width: 120,
					align: "end",
					size: 13,
					color: MUTED,
				}),
			]),
			{ index: FRIDAY, from: t.fridayHover },
			t.due.at + 1,
			t.friday.at + 4,
		),
	];
}

/**
 * The scrim over the app and the modal on top, both in content px. The
 * modal's shell is handed to it by Create task and handed on to the board
 * (handoffs.ts); its contents fade in once it has grown and out once saved.
 */
export function taskModal(t: Timeline): LayoutNode[] {
	const open = modalIn(t);
	const close = modalOut(t);
	const scrim = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: CW,
		height: CH,
		background: "#18181b",
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[open, 0, "hold"],
			[open + sec(0.3), 0.24, "power2.out"],
			[close, 0.24, "hold"],
			[close + sec(0.4), 0, "power2.inOut"],
		]),
	);
	const grown = modalOpen(t);
	const contents = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: MODAL.width,
		height: MODAL.height,
		children: [
			text("New task", { x: PAD, y: 25, size: 20, strong: true }),
			icon("close", { x: MODAL.width - PAD - 20, y: 26, size: 20 }),
			rule(0, 72, MODAL.width, { color: LINE }),
			text(REQUEST.subject, { x: PAD, y: 92, size: 26, strong: true }),
			Layer.box({
				overflow: "hidden",
				position: "absolute",
				x: PAD,
				y: 136,
				width: MODAL.width - 2 * PAD,
				height: 52,
				borderRadius: 10,
				background: SUBTLE,
				children: [
					icon("quote", { x: 16, y: 16, size: 20 }),
					text(`${REQUEST.from.name.split(" ")[0]}: “${REQUEST.question}”`, {
						x: 48,
						y: 16,
						size: 15,
						color: SOFT,
					}),
				],
			}),
			...properties(t),
			...checklist(t),
			...footer(t),
			...menus(t),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[grown - 2, 0, "hold"],
				[grown + 6, 1, "power2.out"],
				[close, 1, "hold"],
				[close + 4, 0, "power2.in"],
			])
			.keys("y", [
				[0, 10],
				[grown - 2, 10, "hold"],
				[grown + sec(0.4), 0, "expo.out"],
			]),
	);
	const modal = raise(
		Layer.box({
			overflow: "hidden",
			id: "task-modal",
			position: "absolute",
			...MODAL,
			borderRadius: MODAL_RADIUS,
			background: APP,
			borderColor: LINE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: [contents],
		}),
		"modal",
	).animate(during(grown, handOff(t)));
	return [scrim, modal];
}
