/**
 * The mock app inside the browser: a deploys dashboard built from plain
 * framefields layers. Geometry is exported so the pointer can aim at it; the
 * moments it reacts to (clicks, presses) come from the pointer's cues.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import {
	ACCENT,
	ACCENT_DEEP,
	AMBER,
	CARD,
	EDGE,
	FPS,
	FRAME,
	GREEN,
	INK,
	LINE,
	MONO,
	MUTED,
	PANEL,
	RAISED,
	SANS,
	SOFT,
	VIOLET,
} from "./theme.js";

/** Content area of the browser (below its 56 px toolbar). */
export const CW = FRAME.width;
export const CH = FRAME.height - 56;

const SIDEBAR = 252;
const PAD = 44;
const MAIN_X = SIDEBAR + PAD;
const MAIN_W = CW - MAIN_X - PAD;

export const DEPLOY_BUTTON = {
	x: CW - PAD - 136,
	y: 62,
	width: 136,
	height: 44,
};
const VISIT_BUTTON = {
	x: DEPLOY_BUTTON.x - 12 - 104,
	y: 62,
	width: 104,
	height: 44,
};

const STATS_Y = 140;
const STATS_H = 112;
const LIST_HEAD_Y = 288;
export const TABLE = {
	x: MAIN_X,
	y: 324,
	width: MAIN_W,
	height: CH - 324 - PAD,
};
const ROW_H = 68;

/** The Promote button on the new (first) row, in content px. */
export const PROMOTE_BUTTON = {
	x: TABLE.x + TABLE.width - 384,
	y: TABLE.y + (ROW_H - 34) / 2,
	width: 104,
	height: 34,
};

export interface Timeline {
	/** The page has loaded: content animates in from here. */
	loaded: number;
	/** Deploy press / release / click. */
	deployDown: number;
	deployUp: number;
	deployClick: number;
	/** The build finishes. */
	ready: number;
	promoteDown: number;
	promoteUp: number;
	promoteClick: number;
}

const ease = "expo.out";
const sec = (s: number) => Math.round(s * FPS);

/** Rise-and-fade in at `at` (content frames), offset to the node's `y`. */
function rise(y: number, at: number, distance = 14, duration = sec(0.6)) {
	return LayerAnimation.create()
		.keys("opacity", [
			[0, 0],
			[at, 0, "hold"],
			[at + duration, 1, ease],
		])
		.keys("y", [
			[0, y + distance],
			[at, y + distance, "hold"],
			[at + duration, y, ease],
		]);
}

/** A press: shrink while the button is down, spring back on release. */
function press(down: number, up: number) {
	return LayerAnimation.keys("scale", [
		[0, 1],
		[down, 1, "hold"],
		[down + 3, 0.955, "power2.out"],
		[up, 0.955, "hold"],
		[up + sec(0.35), 1, "back.out(2.4)"],
	]);
}

function text(
	value: string,
	o: {
		x: number;
		y: number;
		size: number;
		color?: string;
		weight?: number;
		font?: string;
		width?: number;
		align?: "start" | "center" | "end";
		id?: string;
	},
) {
	return Layer.text(value, {
		...(o.id && { id: o.id }),
		position: "absolute",
		x: o.x,
		y: o.y,
		...(o.width !== undefined && { width: o.width }),
		...(o.align && { align: o.align }),
		fontFamily: o.font ?? SANS,
		fontSize: o.size,
		fontWeight: o.weight ?? 400,
		fill: o.color ?? INK,
	});
}

function sidebar(t: Timeline): LayoutNode {
	const nav = [
		"Overview",
		"Deploys",
		"Domains",
		"Analytics",
		"Logs",
		"Settings",
	];
	const children: LayoutNode[] = [
		Layer.box({
			position: "absolute",
			x: 24,
			y: 24,
			width: 30,
			height: 30,
			borderRadius: 9,
			background: `linear-gradient(135deg, ${ACCENT}, ${VIOLET})`,
			children: [
				text("N", {
					x: 0,
					y: 5,
					width: 30,
					align: "center",
					size: 16,
					weight: 700,
					color: "#ffffff",
				}),
			],
		}),
		text("Northwind", { x: 66, y: 29, size: 16, weight: 600 }),
	];
	nav.forEach((label, i) => {
		const y = 96 + i * 42;
		const active = label === "Deploys";
		if (active) {
			children.push(
				Layer.box({
					position: "absolute",
					x: 14,
					y: y - 9,
					width: SIDEBAR - 28,
					height: 38,
					borderRadius: 10,
					background: RAISED,
				}),
			);
		}
		children.push(
			Layer.shape("circle", {
				position: "absolute",
				x: 30,
				y: y + 5,
				width: 8,
				height: 8,
				fillColor: active ? ACCENT : EDGE,
			}),
			text(label, {
				x: 52,
				y,
				size: 15,
				weight: active ? 600 : 450,
				color: active ? INK : SOFT,
			}),
		);
	});
	children.push(
		Layer.box({
			position: "absolute",
			x: 24,
			y: CH - 64,
			width: 34,
			height: 34,
			borderRadius: 17,
			background: "linear-gradient(135deg, #f7b267, #f4845f)",
			children: [
				text("AL", {
					x: 0,
					y: 9,
					width: 34,
					align: "center",
					size: 12,
					weight: 700,
					color: "#1a0f08",
				}),
			],
		}),
		text("Ada Lovelace", { x: 70, y: CH - 64, size: 14, weight: 600 }),
		text("Pro plan", { x: 70, y: CH - 44, size: 12.5, color: MUTED }),
	);
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: SIDEBAR,
		height: CH,
		background: PANEL,
		children: [
			...children,
			Layer.box({
				position: "absolute",
				x: SIDEBAR - 1,
				y: 0,
				width: 1,
				height: CH,
				background: LINE,
			}),
		],
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[t.loaded - sec(0.2), 0, "hold"],
			[t.loaded + sec(0.4), 1, "power2.out"],
		]),
	);
}

function header(t: Timeline): LayoutNode[] {
	const at = t.loaded;
	const deploy = Layer.box({
		id: "deploy-button",
		position: "absolute",
		...DEPLOY_BUTTON,
		borderRadius: 11,
		background: `linear-gradient(180deg, #7d9bff, ${ACCENT_DEEP})`,
		children: [
			Layer.shape("path", {
				position: "absolute",
				x: 0,
				y: 0,
				width: DEPLOY_BUTTON.width,
				height: DEPLOY_BUTTON.height,
				d: "M31 26 L37 18 L43 26 M37 18 L37 30",
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: 2.2,
				strokeLineCap: "round",
				strokeLineJoin: "round",
			}),
			text("Deploy", {
				x: 54,
				y: 12,
				size: 15.5,
				weight: 600,
				color: "#ffffff",
			}),
		],
	})
		.animate(rise(DEPLOY_BUTTON.y, at + sec(0.15)))
		.animate(press(t.deployDown, t.deployUp));
	return [
		text("northwind / web", {
			x: MAIN_X,
			y: 34,
			size: 13.5,
			color: MUTED,
			font: MONO,
		}).animate(rise(34, at)),
		text("Deploys", { x: MAIN_X, y: 60, size: 32, weight: 650 }).animate(
			rise(60, at + 2),
		),
		Layer.box({
			position: "absolute",
			...VISIT_BUTTON,
			borderRadius: 11,
			borderColor: EDGE,
			borderWidth: 1,
			strokeAlign: "inside",
			background: CARD,
			children: [
				text("Visit", {
					x: 0,
					y: 12,
					width: VISIT_BUTTON.width,
					align: "center",
					size: 15.5,
					weight: 500,
				}),
			],
		}).animate(rise(VISIT_BUTTON.y, at + sec(0.1))),
		deploy,
	];
}

const SPARKS = [
	[12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19],
	[22, 19, 20, 17, 18, 15, 16, 14, 15, 13, 14, 12],
	[3, 5, 4, 7, 6, 8, 9, 8, 11, 10, 13, 14],
];

function sparkline(
	values: number[],
	w: number,
	h: number,
	color: string,
): LayoutNode[] {
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const pts = values.map(
		(v, i) =>
			[
				(i / (values.length - 1)) * w,
				h - ((v - lo) / (hi - lo || 1)) * h,
			] as const,
	);
	const line = pts
		.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
		.join(" ");
	return [
		Layer.shape("path", {
			position: "absolute",
			x: 0,
			y: 0,
			width: w,
			height: h,
			d: `${line} L${w} ${h} L0 ${h} Z`,
			fill: `linear-gradient(180deg, ${color}55, ${color}00)`,
		}),
		Layer.shape("path", {
			position: "absolute",
			x: 0,
			y: 0,
			width: w,
			height: h,
			d: line,
			fillType: "none",
			strokeColor: color,
			strokeWidth: 2,
			strokeLineCap: "round",
			strokeLineJoin: "round",
		}),
	];
}

function stats(t: Timeline): LayoutNode[] {
	const cards = [
		{
			label: "Uptime · 30 days",
			value: "99.98%",
			delta: "+0.02%",
			up: true,
			color: GREEN,
		},
		{
			label: "p95 latency",
			value: "182 ms",
			delta: "−24 ms",
			up: true,
			color: ACCENT,
		},
		{
			label: "Deploys today",
			value: "14",
			after: "15",
			delta: "+3 vs avg",
			up: true,
			color: VIOLET,
		},
	];
	const gap = 18;
	const w = (MAIN_W - gap * 2) / 3;
	return cards.map((c, i) => {
		const x = MAIN_X + i * (w + gap);
		const value = (v: string) =>
			text(v, { x: 24, y: 48, size: 34, weight: 650 });
		const values: LayoutNode[] = [value(c.value)];
		if (c.after) {
			// The count ticks over when the new build lands.
			values[0] = value(c.value).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[t.ready, 1],
						[t.ready + 6, 0, "power2.in"],
					])
					.keys("y", [
						[t.ready, 48],
						[t.ready + 8, 30, "power2.in"],
					]),
			);
			values.push(
				value(c.after).animate(
					LayerAnimation.create()
						.keys("opacity", [
							[0, 0],
							[t.ready + 4, 0, "hold"],
							[t.ready + 14, 1, "power2.out"],
						])
						.keys("y", [
							[0, 66],
							[t.ready + 4, 66, "hold"],
							[t.ready + 18, 48, ease],
						]),
				),
			);
		}
		return Layer.box({
			position: "absolute",
			x,
			y: STATS_Y,
			width: w,
			height: STATS_H,
			borderRadius: 16,
			background: CARD,
			borderColor: LINE,
			borderWidth: 1,
			strokeAlign: "inside",
			overflow: "hidden",
			children: [
				text(c.label, { x: 24, y: 22, size: 13.5, color: MUTED, weight: 500 }),
				...values,
				text(c.delta, {
					x: 24,
					y: 88 - 4,
					size: 12.5,
					color: c.color,
					weight: 600,
				}),
				Layer.box({
					position: "absolute",
					x: w - 24 - 150,
					y: 40,
					width: 150,
					height: 44,
					children: sparkline(SPARKS[i] ?? [], 150, 44, c.color),
				}),
			],
		}).animate(rise(STATS_Y, t.loaded + sec(0.25) + i * 3));
	});
}

interface Row {
	title: string;
	meta: string;
	when: string;
}

const ROWS: Row[] = [
	{
		title: "Tighten cache headers for /assets",
		meta: "main · a91f3e2 · Ada",
		when: "2h ago",
	},
	{
		title: "Add regional failover for eu-west",
		meta: "main · 7c02d18 · Grace",
		when: "5h ago",
	},
	{
		title: "Upgrade runtime to Node 22",
		meta: "main · 3be41aa · Linus",
		when: "yesterday",
	},
	{
		title: "Fix flaky checkout test",
		meta: "fix/checkout · 0d9e7b5 · Ada",
		when: "yesterday",
	},
	{
		title: "Ship onboarding v2",
		meta: "main · 51c8e60 · Margaret",
		when: "2 days ago",
	},
	{
		title: "Rotate signing keys",
		meta: "main · c3d9f02 · Grace",
		when: "3 days ago",
	},
	{
		title: "Initial edge config",
		meta: "main · 0a11b7e · Linus",
		when: "last week",
	},
];

function pill(label: string, color: string, x: number, y: number, w = 96) {
	return Layer.box({
		position: "absolute",
		x,
		y,
		width: w,
		height: 28,
		borderRadius: 14,
		background: `${color}1f`,
		children: [
			Layer.shape("circle", {
				position: "absolute",
				x: 12,
				y: 10,
				width: 8,
				height: 8,
				fillColor: color,
			}),
			text(label, { x: 26, y: 6, size: 13, weight: 600, color }),
		],
	});
}

function row(r: Row, y: number, status: LayoutNode, extra: LayoutNode[] = []) {
	const w = TABLE.width;
	return Layer.box({
		position: "absolute",
		x: 0,
		y,
		width: w,
		height: ROW_H,
		children: [
			text(r.title, { x: 24, y: 14, size: 15.5, weight: 550 }),
			text(r.meta, { x: 24, y: 38, size: 12.5, color: MUTED, font: MONO }),
			status,
			...extra,
			text(r.when, {
				x: w - 24 - 110,
				y: 24,
				width: 110,
				align: "end",
				size: 13.5,
				color: MUTED,
			}),
			Layer.box({
				position: "absolute",
				x: 0,
				y: ROW_H - 1,
				width: w,
				height: 1,
				background: LINE,
			}),
		],
	});
}

function table(t: Timeline): LayoutNode {
	const w = TABLE.width;
	const statusX = w - 24 - 110 - 18 - 100;
	const shift = sec(0.55);
	const arrive = t.deployClick + 4;
	const rows = ROWS.map((r, i) =>
		row(
			r,
			i * ROW_H,
			pill("Ready", GREEN, statusX, (ROW_H - 28) / 2, 82),
		).animate(
			LayerAnimation.create()
				.keys("y", [
					[0, i * ROW_H],
					[arrive, i * ROW_H, "hold"],
					[arrive + shift, (i + 1) * ROW_H, ease],
				])
				.keys("opacity", [
					[0, 0],
					[t.loaded + sec(0.4) + i * 2, 0, "hold"],
					[t.loaded + sec(0.9) + i * 2, 1, "power2.out"],
				]),
		),
	);

	// The new deploy: building (amber, breathing) → ready → production.
	const building = pill(
		"Building",
		AMBER,
		statusX - 14,
		(ROW_H - 28) / 2,
		96,
	).animate(
		LayerAnimation.keys("opacity", [
			[0, 1],
			[t.ready, 1, "hold"],
			[t.ready + 6, 0, "power2.in"],
		]),
	);
	const ready = pill("Ready", GREEN, statusX, (ROW_H - 28) / 2, 82).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[t.ready + 3, 0, "hold"],
			[t.ready + 12, 1, "power2.out"],
			[t.promoteUp + 4, 1, "hold"],
			[t.promoteUp + 10, 0, "power2.in"],
		]),
	);
	const promote = Layer.box({
		id: "promote-button",
		position: "absolute",
		x: PROMOTE_BUTTON.x - TABLE.x,
		y: PROMOTE_BUTTON.y - TABLE.y,
		width: PROMOTE_BUTTON.width,
		height: PROMOTE_BUTTON.height,
		borderRadius: 9,
		background: RAISED,
		borderColor: EDGE,
		borderWidth: 1,
		strokeAlign: "inside",
		children: [
			text("Promote", {
				x: 0,
				y: 8,
				width: PROMOTE_BUTTON.width,
				align: "center",
				size: 13.5,
				weight: 600,
			}),
		],
	})
		.animate(
			LayerAnimation.keys("opacity", [
				[0, 0],
				[t.ready + 8, 0, "hold"],
				[t.ready + 20, 1, "power2.out"],
				[t.promoteUp + 4, 1, "hold"],
				[t.promoteUp + 12, 0, "power2.in"],
			]),
		)
		.animate(press(t.promoteDown, t.promoteUp));
	// Promoting swaps the Ready pill for a Production badge in its place.
	const production = Layer.box({
		position: "absolute",
		x: statusX - 20,
		y: (ROW_H - 28) / 2,
		width: 122,
		height: 28,
		borderRadius: 14,
		background: `linear-gradient(90deg, ${ACCENT}, ${VIOLET})`,
		children: [
			text("Production", {
				x: 0,
				y: 6,
				width: 122,
				align: "center",
				size: 13,
				weight: 650,
				color: "#ffffff",
			}),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[t.promoteUp + 8, 0, "hold"],
				[t.promoteUp + 16, 1, "power2.out"],
			])
			.keys("scale", [
				[0, 0.8],
				[t.promoteUp + 8, 0.8, "hold"],
				[t.promoteUp + 22, 1, "back.out(2)"],
			]),
	);
	const fresh = row(
		{
			title: "Speed up image pipeline 3×",
			meta: "main · e47b21c · Ada",
			when: "just now",
		},
		0,
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: w,
			height: ROW_H,
			children: [building, ready],
		}),
		[promote, production],
	).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[arrive + 4, 0, "hold"],
				[arrive + shift, 1, "power2.out"],
			])
			.keys("x", [
				[0, -18],
				[arrive + 4, -18, "hold"],
				[arrive + shift, 0, ease],
			]),
	);
	// A soft highlight sweeps the new row in, then fades.
	const glow = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: w,
		height: ROW_H,
		background: `linear-gradient(90deg, ${ACCENT}26, ${ACCENT}00 70%)`,
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[arrive, 0, "hold"],
			[arrive + 8, 1, "power2.out"],
			[t.ready + sec(1.4), 0, "power2.inOut"],
		]),
	);

	return Layer.box({
		position: "absolute",
		...TABLE,
		borderRadius: 16,
		background: CARD,
		borderColor: LINE,
		borderWidth: 1,
		strokeAlign: "inside",
		overflow: "hidden",
		children: [glow, ...rows, fresh],
	}).animate(rise(TABLE.y, t.loaded + sec(0.35)));
}

function toast(t: Timeline): LayoutNode {
	const w = 380;
	const h = 78;
	const x = CW - PAD - w;
	const y = CH - PAD - h;
	const show = t.promoteUp + sec(0.3);
	const hide = show + sec(2.6);
	return Layer.box({
		position: "absolute",
		x,
		y,
		width: w,
		height: h,
		borderRadius: 16,
		background: RAISED,
		borderColor: EDGE,
		borderWidth: 1,
		strokeAlign: "inside",
		children: [
			Layer.shape("circle", {
				position: "absolute",
				x: 20,
				y: 23,
				width: 32,
				height: 32,
				fillColor: `${GREEN}26`,
			}),
			Layer.shape("path", {
				position: "absolute",
				x: 0,
				y: 0,
				width: w,
				height: h,
				d: "M29 39.5 L34 44.5 L43.5 34",
				fillType: "none",
				strokeColor: GREEN,
				strokeWidth: 2.6,
				strokeLineCap: "round",
				strokeLineJoin: "round",
			}),
			text("Promoted to production", { x: 68, y: 19, size: 15.5, weight: 600 }),
			text("e47b21c · live on northwind.dev", {
				x: 68,
				y: 43,
				size: 13,
				color: MUTED,
				font: MONO,
			}),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[show, 0, "hold"],
				[show + 10, 1, "power2.out"],
				[hide, 1, "hold"],
				[hide + 10, 0, "power2.in"],
			])
			.keys("x", [
				[0, x + 40],
				[show, x + 40, "hold"],
				[show + sec(0.5), x, ease],
			])
			.keys("y", [
				[0, y],
				[hide, y, "hold"],
				[hide + 10, y + 12, "power2.in"],
			]),
	);
}

/** The whole page, in content px. */
export function dashboard(t: Timeline): LayoutNode[] {
	return [
		sidebar(t),
		...header(t),
		...stats(t),
		text("Recent deploys", {
			x: MAIN_X,
			y: LIST_HEAD_Y,
			size: 17,
			weight: 600,
		}).animate(rise(LIST_HEAD_Y, t.loaded + sec(0.3))),
		table(t),
		toast(t),
	];
}
