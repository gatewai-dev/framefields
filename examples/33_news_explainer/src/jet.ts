/**
 * The Learjet 60 as two silhouettes, drawn nose to the right on a grid 100
 * units long: from above (swept wings, rear engines, T-tail) for the map, and
 * from the side for the storm diagram. Proportions follow the type: a
 * 58.7 ft fuselage, a 43.8 ft wingspan.
 */
import { Layer, type LayoutNode } from "framefields";
import { toPathData, type Vec2 } from "framefields/components";

/** Half the outline seen from above, nose to tail along the top (−y) side. */
const TOP_HALF: Vec2[] = [
	[50, 0],
	[48.5, -2.2],
	[45, -3.8],
	[38, -4.6],
	[9, -4.6],
	[-4, -37],
	[-10, -37.4],
	[-11, -4.6],
	[-25, -4.4],
	[-25, -10.4],
	[-41, -10.4],
	[-41.5, -4.2],
	[-43, -3.9],
	[-47, -15.5],
	[-52, -15.5],
	[-50.5, -2.6],
	[-51, 0],
];

const mirror = (points: Vec2[]): Vec2[] => [
	...points,
	...points
		.slice(1, -1)
		.reverse()
		.map(([x, y]): Vec2 => [x, -y]),
];

/** The outline seen from the side: fuselage, cockpit, fin and stabilizer. */
const SIDE: Vec2[] = [
	[50, 0.6],
	[48.8, -1.8],
	[46, -3.6],
	[41, -5.6],
	[36.5, -7.4],
	[30, -8.2],
	[-26, -8.2],
	[-36, -7.4],
	[-44, -24],
	[-41.5, -24.6],
	[-58, -25.2],
	[-58.2, -23.6],
	[-50.5, -23.2],
	[-53.5, -7],
	[-55, -4.2],
	[-48, -1.2],
	[-30, 2.6],
	[10, 3.8],
	[36, 3.4],
	[45, 2.6],
];
/** The engine nacelle on the near side, high on the rear fuselage. */
const NACELLE: Vec2[] = [
	[-20, -11.4],
	[-36, -11.4],
	[-38.5, -9.2],
	[-36, -6.6],
	[-20, -6.6],
	[-18.6, -9],
];
/** The near wing, swept back and down from the lower fuselage. */
const WING: Vec2[] = [
	[14, 2.6],
	[-12, 2.2],
	[-20, 5.2],
	[-6, 5.6],
];

const scaled = (points: Vec2[], s: number, dx: number, dy: number): Vec2[] =>
	points.map(([x, y]): Vec2 => [x * s + dx, y * s + dy]);

/** Path data for the jet from above, `length` px long, centred on its box. */
export function topViewPath(length: number): string {
	const s = length / 102;
	return toPathData(
		scaled(mirror(TOP_HALF), s, length / 2, length * 0.38),
		true,
	);
}

/** The box the top view sits in (it is as wide as it is long × 0.76). */
export const topViewSize = (length: number) => ({
	width: length,
	height: length * 0.76,
});

export interface SideView {
	body: string;
	nacelle: string;
	wing: string;
	windows: Array<{ x: number; y: number; size: number }>;
	width: number;
	height: number;
	/** How far below the box's top the fuselage's centreline runs. */
	axisY: number;
}

/** The side view's parts, `length` px long. */
export function sideView(length: number): SideView {
	const s = length / 110;
	const dx = 58.5 * s;
	const dy = 26 * s;
	const at = (p: Vec2[]) => toPathData(scaled(p, s, dx, dy), true);
	return {
		body: at(SIDE),
		nacelle: at(NACELLE),
		wing: at(WING),
		windows: [24, 17, 10, 3, -4, -11].map((x) => ({
			x: x * s + dx,
			y: -3.6 * s + dy,
			size: 2.6 * s,
		})),
		width: length,
		height: 32 * s,
		axisY: dy,
	};
}

/** The jet from above as one layer, nose to the right, centred on `at`; it turns about its centre. */
export function jetTop(o: {
	id: string;
	length: number;
	color: string;
	at: Vec2;
}): ReturnType<typeof Layer.shape> {
	const { width, height } = topViewSize(o.length);
	return Layer.shape("path", {
		id: o.id,
		position: "absolute",
		x: o.at[0] - width / 2,
		y: o.at[1] - height / 2,
		width,
		height,
		d: topViewPath(o.length),
		fill: o.color,
	});
}

/** The jet from the side: body, nacelle, wing and a row of windows. */
export function jetSide(o: {
	id: string;
	length: number;
	color: string;
	window: string;
}): LayoutNode[] {
	const v = sideView(o.length);
	const part = (name: string, d: string, fill: string) =>
		Layer.shape("path", {
			id: `${o.id}-${name}`,
			position: "absolute",
			x: 0,
			y: 0,
			width: v.width,
			height: v.height,
			d,
			fill,
		});
	return [
		part("wing", v.wing, o.color),
		part("body", v.body, o.color),
		part("nacelle", v.nacelle, o.color),
		...v.windows.map((w, i) =>
			Layer.shape("ellipse", {
				id: `${o.id}-window-${i}`,
				position: "absolute",
				x: w.x - w.size / 2,
				y: w.y - w.size / 2,
				width: w.size * 1.3,
				height: w.size,
				fill: o.window,
			}),
		),
	];
}
