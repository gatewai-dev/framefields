/**
 * The map: Natural Earth 1:50m countries (world-atlas) and US Census 1:10m
 * states (us-atlas), both public domain, projected to Mercator over the
 * Gulf and fitted to the map sheet. The flight is drawn as great circles:
 * Austin to the crash site, and the leg to North Eleuthera it never flew.
 */
import { createRequire } from "node:module";
import {
	type GeoProjection,
	geoInterpolate,
	geoMercator,
	geoPath,
} from "d3-geo";
import type { Vec2 } from "framefields/components";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const require = createRequire(import.meta.url);

type Lonlat = [lon: number, lat: number];

/** Where things are (lon, lat). */
export const PLACES = {
	/** Austin–Bergstrom International Airport. */
	austin: [-97.6699, 30.1945],
	/** North Eleuthera Airport, the Bahamas. */
	eleuthera: [-76.6835, 25.4749],
	/** Military Trail at 10th Avenue North, Palm Beach County. */
	crash: [-80.1131, 26.6329],
} satisfies Record<string, Lonlat>;

/** Map labels, at hand-picked points (lon, lat). */
export const LABELS = {
	texas: [-98.7, 28.1],
	florida: [-81.45, 28.9],
	mexico: [-99.5, 24.6],
	cuba: [-79.3, 22.25],
	bahamas: [-75.7, 23.1],
} satisfies Record<string, Lonlat>;

/** The part of the world on the sheet. */
const BOUNDS: [Lonlat, Lonlat] = [
	[-100.5, 22.6],
	[-74.2, 32.6],
];

/** US states drawn lighter: the two ends of the flight. */
const HOME_STATES = new Set(["48", "12"]);
/** Natural Earth's id for the United States, drawn from the Census states instead. */
const USA = "840";

type Objects<K extends string> = Topology<Record<K, GeometryCollection>>;

export interface MapGeometry {
	width: number;
	height: number;
	project(p: Lonlat): Vec2;
	/** Countries other than the US. */
	countries: string;
	/** Every US state. */
	states: string;
	/** Texas and Florida. */
	home: string;
	/** Lines between states, and between countries. */
	stateLines: string;
	countryLines: string;
	/** Every coast (and outer border), drawn in ink. */
	coasts: string;
	/** The flight as flown, and the leg it never flew, as projected points. */
	flown: Vec2[];
	unflown: Vec2[];
}

function greatCircle(from: Lonlat, to: Lonlat, steps: number): Lonlat[] {
	const at = geoInterpolate(from, to);
	return Array.from({ length: steps + 1 }, (_, i) => at(i / steps) as Lonlat);
}

/** The map fitted into a `width` × `height` sheet, `margin` px inside its edges. */
export function mapGeometry(
	width: number,
	height: number,
	margin = 0,
): MapGeometry {
	const world =
		require("world-atlas/countries-50m.json") as Objects<"countries">;
	const us = require("us-atlas/states-10m.json") as Objects<"states">;
	const projection: GeoProjection = geoMercator()
		.fitExtent(
			[
				[margin, margin],
				[width - margin, height - margin],
			],
			{ type: "MultiPoint", coordinates: BOUNDS },
		)
		.clipExtent([
			[-20, -20],
			[width + 20, height + 20],
		]);
	const path = geoPath(projection).digits(1);
	const draw = (features: Array<Feature<Geometry>>) =>
		features.map((f) => path(f) ?? "").join("");
	const countries = feature(
		world,
		world.objects.countries,
	) as FeatureCollection<Geometry>;
	const states = feature(us, us.objects.states) as FeatureCollection<Geometry>;
	const project = (p: Lonlat): Vec2 => {
		const xy = projection(p);
		if (!xy) throw new Error(`Cannot project ${p.join(", ")}`);
		return [xy[0], xy[1]];
	};
	return {
		width,
		height,
		project,
		countries: draw(countries.features.filter((f) => f.id !== USA)),
		states: draw(states.features),
		home: draw(states.features.filter((f) => HOME_STATES.has(String(f.id)))),
		stateLines: path(mesh(us, us.objects.states, (a, b) => a !== b)) ?? "",
		countryLines:
			path(
				mesh(
					world,
					world.objects.countries,
					(a, b) => a !== b && a.id !== USA && b.id !== USA,
				),
			) ?? "",
		coasts:
			(path(mesh(us, us.objects.states, (a, b) => a === b)) ?? "") +
			(path(
				mesh(world, world.objects.countries, (a, b) => a === b && a.id !== USA),
			) ?? ""),
		flown: greatCircle(PLACES.austin, PLACES.crash, 80).map(project),
		unflown: greatCircle(PLACES.crash, PLACES.eleuthera, 24).map(project),
	};
}

/** Census FIPS code of Florida. */
export const FLORIDA = "12";

/** One state on its own, fitted into `width` × `height`: its outline and a projection. */
export function stateOutline(
	fips: string,
	width: number,
	height: number,
	margin = 0,
): { d: string; project(p: Lonlat): Vec2 } {
	const us = require("us-atlas/states-10m.json") as Objects<"states">;
	const states = feature(us, us.objects.states) as FeatureCollection<Geometry>;
	const state = states.features.find((f) => String(f.id) === fips);
	if (!state) throw new Error(`No state with FIPS ${fips}`);
	const projection = geoMercator().fitExtent(
		[
			[margin, margin],
			[width - margin, height - margin],
		],
		state,
	);
	return {
		d: geoPath(projection).digits(1)(state) ?? "",
		project(p) {
			const xy = projection(p);
			if (!xy) throw new Error(`Cannot project ${p.join(", ")}`);
			return [xy[0], xy[1]];
		},
	};
}

/** A polyline's length, and the point and heading (degrees) at a share of it. */
export function along(points: Vec2[]): {
	length: number;
	at(share: number): { point: Vec2; heading: number };
} {
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as Vec2;
		const b = points[i] as Vec2;
		lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
	}
	const length = lengths.at(-1) ?? 0;
	return {
		length,
		at(share) {
			const target = Math.min(1, Math.max(0, share)) * length;
			let i = 1;
			while (i < points.length - 1 && (lengths[i] ?? 0) < target) i++;
			const a = points[i - 1] as Vec2;
			const b = points[i] as Vec2;
			const from = lengths[i - 1] ?? 0;
			const span = (lengths[i] ?? from) - from || 1;
			const t = (target - from) / span;
			return {
				point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
				heading: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
			};
		},
	};
}
