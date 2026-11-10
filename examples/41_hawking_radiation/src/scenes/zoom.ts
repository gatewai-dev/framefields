/**
 * The dive: from the stars into one atom, through its electron cloud to the
 * nucleus, and past it into empty space. The zoom lands on each thing as the
 * narrator names it.
 */
import type { LayoutNode } from "framefields";
import { ATOM_DEPTH, NUCLEUS_DEPTH, VACUUM_DEPTH } from "../shaders/journey.js";
import { BLUE, GOLD, H, INK, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { figure, label, leader } from "../type.js";
import { journey, sceneRoot } from "./shell.js";

/** The protons' red, a shade off the film's gold. */
const PROTON = "#ff6a3d";

export function zoomScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const zoom = lineIn(t, "zoom");
	const atom = wordIn(t, "atom", "atom");
	const cloud = wordIn(t, "atom", "cloud");
	const past = wordIn(t, "atom", "past", 1);
	const nucleus = wordIn(t, "atom", "nucleus");
	const empty = lineIn(t, "empty");
	const space = wordIn(t, "empty", "space");
	const atomShown = { from: atom.start, to: past.start + 4 };
	const nucleusShown = { from: nucleus.start + 4, to: empty.start + sec(0.5) };

	return sceneRoot(t, [
		journey(t, {
			depth: [
				[0, 0],
				[zoom.end, 1.5],
				[atom.start + 8, ATOM_DEPTH],
				[past.start, ATOM_DEPTH + 0.5, "linear"],
				[nucleus.start + 8, NUCLEUS_DEPTH - 0.1],
				[empty.start + sec(0.4), NUCLEUS_DEPTH + 0.45, "linear"],
				[space.start + 6, VACUUM_DEPTH],
				[end, VACUUM_DEPTH + 0.4, "linear"],
			],
		}),
		label("Atom", { id: "zoom-atom", x: 130, y: 452, ...atomShown, fill: INK }),
		figure("0.000 000 000 1 m", {
			id: "zoom-atom-size",
			x: 130,
			y: 486,
			size: 34,
			...atomShown,
		}),
		...leader("zoom-cloud-line", [W - 470, 300], [W / 2 + 250, 380], {
			from: cloud.start,
			to: atomShown.to,
		}),
		label("Electron cloud", {
			id: "zoom-cloud",
			x: W - 454,
			y: 276,
			from: cloud.start,
			to: atomShown.to,
			fill: BLUE,
		}),
		label("Nucleus", {
			id: "zoom-nucleus",
			x: 130,
			y: 452,
			...nucleusShown,
			fill: INK,
		}),
		figure("0.000 000 000 000 001 m", {
			id: "zoom-nucleus-size",
			x: 130,
			y: 486,
			size: 34,
			...nucleusShown,
		}),
		label("Protons", {
			id: "zoom-protons",
			x: W - 454,
			y: 470,
			from: wordIn(t, "atom", "protons").start,
			to: nucleusShown.to,
			fill: PROTON,
		}),
		label("Neutrons", {
			id: "zoom-neutrons",
			x: W - 454,
			y: 506,
			from: wordIn(t, "atom", "neutrons").start,
			to: nucleusShown.to,
			fill: BLUE,
		}),
		label("Empty space", {
			id: "zoom-empty",
			x: 0,
			y: H - 170,
			width: W,
			align: "center",
			from: space.start + 10,
			to: end - sec(0.3),
			fill: GOLD,
		}),
	]);
}
