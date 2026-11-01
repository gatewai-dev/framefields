/**
 * The sidebar: workspace, search, the three places you work from, and the
 * client projects. The highlight walks from Inbox to the project when the
 * task is saved.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import {
	ACCENT,
	APP,
	EDGE,
	INK,
	LINE,
	MUTED,
	SIDEBAR,
	SOFT,
	sec,
	space,
} from "../theme.js";
import { relayMark } from "./brand.js";
import { PROJECTS, SAM } from "./data.js";
import { avatar, type IconName, icon, rule, text } from "./kit.js";
import { CH, NAV_ROW, NAV_Y, PROJECTS_Y, SIDEBAR_W } from "./layout.js";
import { boardIn, type Timeline } from "./timeline.js";

const NAV: Array<{ label: string; icon: IconName }> = [
	{ label: "Inbox", icon: "inbox" },
	{ label: "My tasks", icon: "tasks" },
	{ label: "Calendar", icon: "calendar" },
];

const ROW_X = space(1);
const ROW_W = SIDEBAR_W - space(2);
const ROW_H = 36;
const HIGHLIGHT = "#ebe8e1";

/** Label color: active (ink) between `from` and `to`, soft otherwise. */
function activeFill(from: number | null, to: number | null) {
	const keys: Array<[number, string, string?]> = [[0, from === 0 ? INK : SOFT]];
	if (from !== null && from > 0) {
		keys.push([from, SOFT, "hold"], [from + 8, INK, "power2.out"]);
	}
	if (to !== null) {
		keys.push([to, INK, "hold"], [to + 8, SOFT, "power2.out"]);
	}
	return LayerAnimation.keys("fill", keys);
}

function row(
	label: string,
	y: number,
	glyph: LayoutNode,
	fill: LayerAnimation,
): LayoutNode[] {
	return [
		glyph,
		text(label, { x: space(6), y: y + 9, size: 15, color: SOFT }).animate(fill),
	];
}

/** The unread badge: one new request when it lands, cleared once it's read. */
function unreadBadge(t: Timeline): LayoutNode {
	const size = 20;
	return Layer.box({
		position: "absolute",
		x: ROW_X + ROW_W - space(1.5) - size,
		y: NAV_Y + (ROW_H - size) / 2,
		width: size,
		height: size,
		borderRadius: size / 2,
		background: ACCENT,
		children: [
			text("1", {
				x: 0,
				y: 2,
				width: size,
				align: "center",
				size: 12,
				strong: true,
				color: "#ffffff",
			}),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[t.landed, 0, "hold"],
				[t.landed + 4, 1, "power2.out"],
				[t.select.at, 1, "hold"],
				[t.select.at + 6, 0, "power2.in"],
			])
			.keys("scale", [
				[0, 0.6],
				[t.landed, 0.6, "hold"],
				[t.landed + sec(0.35), 1, "back.out(2.4)"],
			]),
	);
}

export function sidebar(t: Timeline): LayoutNode {
	const switchAt = boardIn(t);
	const projectY = PROJECTS_Y;
	const children: LayoutNode[] = [
		Layer.box({
			position: "absolute",
			x: ROW_X,
			y: NAV_Y,
			width: ROW_W,
			height: ROW_H,
			borderRadius: space(1),
			background: HIGHLIGHT,
		}).animate(
			LayerAnimation.keys("y", [
				[0, NAV_Y],
				[switchAt, NAV_Y, "hold"],
				[switchAt + sec(0.45), projectY, "expo.inOut"],
			]),
		),
		relayMark({ x: space(2.5), y: space(2.5), size: 28 }),
		text("Fieldwork", { x: 60, y: 25, size: 15, strong: true }),
		icon("chevron", { x: 140, y: 27, size: 16 }),
		Layer.box({
			position: "absolute",
			x: space(2),
			y: 64,
			width: SIDEBAR_W - space(4),
			height: 36,
			borderRadius: space(1),
			background: APP,
			borderColor: LINE,
			borderWidth: 1,
			strokeAlign: "inside",
			children: [
				icon("search", { x: 12, y: 10, size: 16 }),
				text("Search", { x: 36, y: 9, size: 14, color: MUTED }),
				text("⌘K", {
					x: SIDEBAR_W - space(4) - 12 - 40,
					y: 10,
					width: 40,
					align: "end",
					size: 13,
					color: MUTED,
				}),
			],
		}),
	];

	NAV.forEach((item, i) => {
		const y = NAV_Y + i * NAV_ROW;
		children.push(
			...row(
				item.label,
				y,
				icon(item.icon, { x: space(2.5), y: y + 9, size: 18 }),
				activeFill(i === 0 ? 0 : null, i === 0 ? switchAt : null),
			),
		);
	});
	children.push(unreadBadge(t));

	children.push(
		text("Projects", {
			x: space(2.5),
			y: PROJECTS_Y - 32,
			size: 13,
			strong: true,
			color: MUTED,
		}),
	);
	PROJECTS.forEach((name, i) => {
		const y = PROJECTS_Y + i * NAV_ROW;
		children.push(
			...row(
				name,
				y,
				Layer.box({
					position: "absolute",
					x: space(2.5) + 3,
					y: y + 12,
					width: 12,
					height: 12,
					borderRadius: 4,
					borderColor: EDGE,
					borderWidth: 1.5,
					strokeAlign: "inside",
				}),
				activeFill(i === 0 ? switchAt : null, null),
			),
		);
	});

	children.push(
		avatar(SAM, { x: space(2), y: CH - 56, size: 32 }),
		text(SAM.name, { x: 60, y: CH - 56, size: 14, strong: true }),
		text("Account lead", { x: 60, y: CH - 36, size: 13, color: MUTED }),
		rule(SIDEBAR_W - 1, 0, CH, { vertical: true, color: LINE }),
	);

	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: SIDEBAR_W,
		height: CH,
		background: SIDEBAR,
		children,
	});
}
