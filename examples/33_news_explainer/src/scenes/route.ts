/**
 * The flight. A map sheet of the Gulf; an index card for the aircraft while
 * it is named; Austin pinned as it is said, the planned route to North
 * Eleuthera dashed in on "Bahamas". Then the jet flies it, the line drawn
 * behind it, and the map pushes in on Palm Beach County as it reaches
 * Florida, where it is tagged at its cruising height.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { toPathData, type Vec2 } from "framefields/components";
import { Annotate } from "../components/annotate/index.js";
import { along, LABELS, mapGeometry, PLACES } from "../geo.js";
import { jetSide, jetTop, topViewSize } from "../jet.js";
import { layDown, pin, popIn, riseIn, sheet, strip, tape } from "../paper.js";
import {
	BORDER,
	CARD,
	DISPLAY,
	INK,
	INK_FAINT,
	INK_SOFT,
	LAND,
	LAND_HOME,
	MONO,
	RED,
	SANS,
	SEA,
	SHEET,
	sec,
	YELLOW,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const MAP = { x: 70, y: 50, width: 1780, height: 980 } as const;
const MAP_ROTATION = -0.6;
/** How far the map pushes in on Palm Beach County. */
const ZOOM = 1.9;
/** Share of the flown leg the jet covers: it stops just short of the site. */
const REACH = 0.975;
/** The jet on the map, nose to tail, px. */
const JET_LENGTH = 60;
/** Frames between the keys that carry the jet along its path. */
const STEP = 2;

/** The eased share of a move at frame `f` of `from`–`to`: smooth start, steady cruise, gentle stop. */
function cruiseShare(f: number, from: number, to: number): number {
	const t = Math.min(1, Math.max(0, (f - from) / (to - from)));
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function mapLayer(
	id: string,
	d: string,
	style: {
		fill?: string;
		stroke?: string;
		width?: number;
		dash?: string;
		/** Drawn on from nothing. */
		drawOn?: boolean;
	},
): ReturnType<typeof Layer.shape> {
	return Layer.shape("path", {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: MAP.width,
		height: MAP.height,
		d,
		fill: style.fill ?? "transparent",
		...(style.fill === undefined && { fillType: "none" as const }),
		...(style.stroke && {
			strokeColor: style.stroke,
			strokeWidth: style.width ?? 1.5,
			strokeLineJoin: "round" as const,
			strokeLineCap: "round" as const,
		}),
		...(style.dash && { strokeDashArray: style.dash }),
		...(style.drawOn && { trimEnd: 0 }),
	});
}

function placeLabel(
	id: string,
	text: string,
	at: Vec2,
	o: { size: number; font?: string; color?: string; spacing?: number },
): ReturnType<typeof Layer.text> {
	return Layer.text(text, {
		id,
		position: "absolute",
		x: at[0] - 300,
		y: at[1] - o.size * 0.6,
		width: 600,
		align: "center",
		fontFamily: o.font ?? SANS,
		fontWeight: 700,
		fontSize: o.size,
		letterSpacing: o.spacing ?? o.size * 0.18,
		fill: o.color ?? INK_FAINT,
	});
}

/** A pinned place with its name and what it was to the flight, centred above or below the pin (shifted `dx`). */
function placeTag(
	id: string,
	at: Vec2,
	name: string,
	role: string,
	side: "above" | "below",
	appear: number,
	dx = 0,
): LayoutNode[] {
	const x = at[0] - 200 + dx;
	const y = side === "above" ? at[1] - 104 : at[1] + 26;
	const text = (part: string, content: string, dy: number, style: object) =>
		Layer.text(content, {
			id: `${id}-${part}`,
			position: "absolute",
			x,
			y: y + dy,
			width: 400,
			align: "center",
			...style,
		}).animate(riseIn(appear + 4 + dy / 10, y + dy, 12, 10));
	return [
		text("name", name, 0, {
			fontFamily: SANS,
			fontWeight: 800,
			fontSize: 30,
			fill: INK,
		}),
		text("role", role, 38, {
			fontFamily: MONO,
			fontWeight: 600,
			fontSize: 20,
			letterSpacing: 2,
			fill: INK_SOFT,
		}),
	];
}

/** The aircraft's index card, laid on the map while the jet is named. */
function aircraftCard(t: SceneTiming): LayoutNode {
	const named = wordIn(t, "route", "learjet").start - 8;
	const leaves = wordIn(t, "route", "austin").start + 4;
	const box = { x: 150, y: 640, width: 600, height: 330 };
	const plane = Layer.box({
		id: "card-plane",
		position: "absolute",
		x: 370,
		y: 60,
		width: 200,
		height: 60,
		children: jetSide({
			id: "card-jet",
			length: 200,
			color: INK,
			window: CARD,
		}),
	}).animate(riseIn(named + 10, 60, 16, 14));
	const type = Layer.text("LEARJET 60", {
		id: "card-type",
		position: "absolute",
		x: 40,
		y: 36,
		fontFamily: DISPLAY,
		fontSize: 76,
		fill: INK,
	});
	const specs = Layer.text(
		"TWIN-ENGINE BUSINESS JET\nBUILT IN 2004\nREGISTRATION N722BD",
		{
			id: "card-specs",
			position: "absolute",
			x: 42,
			y: 158,
			fontFamily: MONO,
			fontWeight: 600,
			fontSize: 26,
			lineHeight: 1.6,
			letterSpacing: 1,
			fill: INK_SOFT,
		},
	);
	const built = Annotate({
		...kit,
		id: "card-built",
		target: { text: specs, match: "2004" },
		mark: "highlight",
		at: wordIn(t, "route", "2004").start - 2,
		drawDuration: 10,
		padding: 4,
		seed: 5,
	});
	return Layer.box({
		id: "card",
		position: "absolute",
		...box,
		children: [
			sheet({
				id: "card-sheet",
				x: 0,
				y: 0,
				width: box.width,
				height: box.height,
				color: CARD,
				lift: 1.6,
				children: [
					Layer.shape("rect", {
						id: "card-rule",
						position: "absolute",
						x: 0,
						y: 132,
						width: box.width,
						height: 2,
						fill: RED,
						opacity: 0.6,
					}),
					built,
					type,
					specs,
					plane,
				],
			}),
			tape({ id: "card-tape", x: box.width / 2, y: 0, rotation: 3, seed: 17 }),
		],
	}).animate(
		layDown(named, { y: box.y, rotation: -3, from: -50 }),
		LayerAnimation.create()
			.keys("y", [
				[leaves, box.y],
				[leaves + 16, box.y + 520, "power3.in"],
			])
			.keys("rotation", [
				[leaves, -3],
				[leaves + 16, -9, "power2.in"],
			]),
	);
}

export function routeScene(t: SceneTiming): LayoutNode {
	const geo = mapGeometry(MAP.width, MAP.height, 40);
	const p = (k: keyof typeof PLACES) => geo.project(PLACES[k]);
	const austin = p("austin");
	const eleuthera = p("eleuthera");
	const site = p("crash");
	const cruise = lineIn(t, "cruise");
	const departs = wordIn(t, "route", "austin").start;
	const bound = wordIn(t, "route", "bahamas").start;

	// The flight: off on "By", along the great circle until the line is read.
	const flyFrom = cruise.start;
	const flyTo = cruise.end - sec(0.4);
	const flown = along(geo.flown);
	const jetBox = topViewSize(JET_LENGTH);
	const jetKeys = {
		x: [] as Array<[number, number]>,
		y: [] as Array<[number, number]>,
		rotation: [] as Array<[number, number]>,
		trim: [] as Array<[number, number]>,
	};
	for (let f = flyFrom; f <= flyTo + STEP; f += STEP) {
		const share = cruiseShare(f, flyFrom, flyTo) * REACH;
		const { point, heading } = flown.at(share);
		jetKeys.x.push([f, point[0] - jetBox.width / 2]);
		jetKeys.y.push([f, point[1] - jetBox.height / 2]);
		jetKeys.rotation.push([f, heading]);
		jetKeys.trim.push([f, share]);
	}
	const flownLine = mapLayer("route-flown", toPathData(geo.flown), {
		stroke: RED,
		width: 5,
		drawOn: true,
	}).animate(LayerAnimation.keys("trimEnd", [[0, 0], ...jetKeys.trim]));
	const planned = mapLayer(
		"route-planned",
		toPathData([...geo.flown, ...geo.unflown.slice(1)]),
		{ stroke: INK_SOFT, width: 3, dash: "10 9", drawOn: true },
	).animate(
		LayerAnimation.keys("trimEnd", [
			[bound - 6, 0],
			[bound + 30, 1, "power2.inOut"],
		]),
	);
	const jet = jetTop({
		id: "route-jet",
		length: JET_LENGTH,
		color: INK,
		at: austin,
	}).animate(
		LayerAnimation.create()
			.keys("x", jetKeys.x)
			.keys("y", jetKeys.y)
			.keys("rotation", jetKeys.rotation)
			.keys("opacity", [
				[flyFrom - 4, 0],
				[flyFrom + 2, 1],
			]),
	);

	// Pushes in on the site as Florida is said: the site ends at the sheet's centre.
	const zoomAt = wordIn(t, "cruise", "florida").start - 6;
	const cx = MAP.width / 2;
	const cy = MAP.height / 2;
	// Between the site and the Bahamas, so the leg it never flew stays in view.
	const target: Vec2 = [site[0] + 60, site[1] + 20];
	const camera = LayerAnimation.create()
		.keys("scale", [
			[zoomAt, 1],
			[zoomAt + sec(1.6), ZOOM, "power3.inOut"],
		])
		.keys("x", [
			[zoomAt, 0],
			[zoomAt + sec(1.6), -ZOOM * (target[0] - cx), "power3.inOut"],
		])
		.keys("y", [
			[zoomAt, 0],
			[zoomAt + sec(1.6), -ZOOM * (target[1] - cy), "power3.inOut"],
		]);

	const tagAt = wordIn(t, "cruise", "feet").start - 10;
	const tag = strip({
		id: "route-altitude",
		x: site[0] - 250,
		y: site[1] + 34,
		width: 270,
		height: 58,
		color: YELLOW,
		seed: 61,
		rotation: -3,
		children: [
			Layer.text("35,000 FT · EAST", {
				id: "route-altitude-text",
				position: "absolute",
				x: 0,
				y: 15,
				width: 270,
				align: "center",
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: 21,
				fill: INK,
			}),
		],
	}).animate(popIn(tagAt, 10));

	const labels = [
		placeLabel("label-texas", "TEXAS", geo.project(LABELS.texas), {
			size: 44,
			font: DISPLAY,
		}),
		placeLabel("label-florida", "FLORIDA", geo.project(LABELS.florida), {
			size: 30,
			font: DISPLAY,
		}),
		placeLabel("label-mexico", "MEXICO", geo.project(LABELS.mexico), {
			size: 22,
		}),
		placeLabel("label-cuba", "CUBA", geo.project(LABELS.cuba), { size: 22 }),
		placeLabel("label-bahamas", "THE BAHAMAS", geo.project(LABELS.bahamas), {
			size: 18,
		}),
	];

	const content = Layer.box({
		id: "route-camera",
		position: "absolute",
		x: 0,
		y: 0,
		width: MAP.width,
		height: MAP.height,
		children: [
			mapLayer("map-countries", geo.countries, { fill: LAND }),
			mapLayer("map-states", geo.states, { fill: LAND }),
			mapLayer("map-home", geo.home, { fill: LAND_HOME }),
			mapLayer("map-state-lines", geo.stateLines, {
				stroke: BORDER,
				width: 1.4,
			}),
			mapLayer("map-country-lines", geo.countryLines, {
				stroke: BORDER,
				width: 1.6,
			}),
			mapLayer("map-coasts", geo.coasts, { stroke: INK_SOFT, width: 1.6 }),
			...labels,
			planned,
			flownLine,
			pin({ id: "pin-austin", at: austin }).animate(popIn(departs - 2)),
			pin({ id: "pin-eleuthera", at: eleuthera, color: SHEET }).animate(
				popIn(bound + 24),
			),
			...placeTag(
				"tag-austin",
				austin,
				"AUSTIN, TEXAS",
				"DEPARTED",
				"above",
				departs,
			),
			...placeTag(
				"tag-eleuthera",
				eleuthera,
				"NORTH ELEUTHERA",
				"DESTINATION",
				"below",
				bound + 24,
				-90,
			),
			jet,
			tag,
		],
	}).animate(camera);

	const map = sheet({
		id: "route-map",
		...MAP,
		rotation: MAP_ROTATION,
		color: SEA,
		lift: 1.2,
		children: [
			content,
			Layer.text("APPROXIMATE ROUTE", {
				id: "route-note",
				position: "absolute",
				x: MAP.width - 330,
				y: MAP.height - 52,
				width: 300,
				align: "end",
				fontFamily: MONO,
				fontWeight: 600,
				fontSize: 18,
				letterSpacing: 2,
				fill: INK_SOFT,
			}),
		],
	});
	return sceneRoot(t, { stage: [map, aircraftCard(t)], push: 1.02 });
}
