/**
 * bar 11 – 15 — The drop. Light flashes on every bar (and every beat once the
 * montage starts) and the title orbits the ring a quarter turn per bar.
 */
import { LayerAnimation } from "framefields";
import { BEAT_RING } from "../edit.js";
import { bar, DROP } from "../grid.js";
import { BONE, type Key, keys, orbit, plane, scene } from "../theme.js";

export function dropScene() {
	const from = bar(DROP);
	const to = bar(DROP + 4);
	const local = (b: number) => bar(b) - from;

	const flash: Key[] = [];
	// Each flash is a spike: dark right up to the hit, then a fast decay.
	const hit = (at: number, peak: number) => {
		const last = flash[flash.length - 1];
		if (last && last[0] < at - 1) flash.push([at - 1, 0]);
		flash.push([at, peak], [at + 7, 0, "power2.out"]);
	};
	hit(0, 0.6);
	hit(local(DROP + 1), 0.3);
	for (let b = 0; b < 8; b++)
		hit(local(DROP + 2 + b / 4), b % 4 === 0 ? 0.3 : 0.14);

	return scene("drop", from, to, [
		orbit({
			id: "drop-orbit",
			text: "FULL CIRCLE",
			ring: { ...BEAT_RING, r: BEAT_RING.r + 110 },
			inAt: 4,
			outAt: to - from - 8,
			// A quarter turn per bar.
			turns: 1,
			duration: to - from,
		}),
		plane("drop-flash", BONE, "screen").animate(
			keys("opacity", flash, LayerAnimation.create()),
		),
	]);
}
