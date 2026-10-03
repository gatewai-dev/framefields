/**
 * bar 4¾ – 5¾ — The porthole closes into the ring as the score drops to a hush;
 * the first half of the sentence hangs in the dark.
 */
import { HUSH } from "../edit.js";
import { bar } from "../grid.js";
import { H, line, scene } from "../theme.js";

const SIZE = 118;

export function hushScene() {
	const from = bar(HUSH - 0.25);
	const to = bar(HUSH + 0.75);
	return scene("hush", from, to, [
		line({
			id: "hush-line",
			text: "Everything that turns",
			y: H / 2 - Math.round(SIZE * 0.65),
			size: SIZE,
			inAt: 2,
			outAt: to - from - 10,
		}),
	]);
}
