/** bar 15 – 17 — Through the tunnel toward the light: the sentence completes. */
import { bar, DROP } from "../grid.js";
import { line, MARGIN, scene } from "../theme.js";

export function tunnelScene() {
	const from = bar(DROP + 4);
	const to = bar(DROP + 6);
	return scene("tunnel-copy", from, to, [
		line({
			id: "tunnel-line",
			text: "comes back around.",
			y: MARGIN,
			size: 118,
			inAt: 8,
			outAt: to - from - 12,
		}),
	]);
}
