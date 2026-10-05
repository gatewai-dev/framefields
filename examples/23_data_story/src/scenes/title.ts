import { Layer, LayerAnimation, type LayoutNode } from "gitframes";
import { odometer } from "../motion.js";
import {
	ACCENT,
	CYAN_TEXT,
	DISPLAY,
	EASE_IN,
	MARGIN,
	MONO,
	MUTED,
	SANS,
	TEXT,
} from "../theme.js";
import { TITLE } from "../timeline.js";
import { riseAt, scene } from "../ui.js";

/** "Growth, in motion." with the headline number rolling in on an odometer. */
export function titleScene(): LayoutNode {
	const numberY = 560;
	const size = 170;
	return scene("title", TITLE.from, TITLE.to, [
		Layer.text("GITFRAMES ANALYTICS  ·  Q3 REPORT", {
			id: "title-kicker",
			position: "absolute",
			x: MARGIN,
			y: 300,
			width: 1200,
			height: 32,
			fontFamily: MONO,
			fontSize: 24,
			fontWeight: 600,
			letterSpacing: 5,
			fill: CYAN_TEXT,
		}).animate(riseAt(4, 300)),
		Layer.text("Growth, in motion.", {
			id: "title-headline",
			position: "absolute",
			x: MARGIN,
			y: 344,
			width: 1700,
			height: 150,
			fontFamily: DISPLAY,
			fontSize: 112,
			fontWeight: 800,
			fill: TEXT,
		}).animate(riseAt(8, 344, 70, 30)),
		Layer.box({
			id: "title-rule",
			position: "absolute",
			x: MARGIN,
			y: 534,
			height: 6,
			width: 0,
			borderRadius: 3,
			background: ACCENT,
		}).animate(
			LayerAnimation.create().fromTo("width", 0, 560, {
				start: 16,
				end: 46,
				ease: EASE_IN,
			}),
		),
		odometer("+142%", {
			id: "title-odometer",
			x: MARGIN - 8,
			y: numberY,
			size,
			at: 22,
			stagger: 4,
		}),
		Layer.text("year-over-year active users", {
			id: "title-caption",
			position: "absolute",
			x: MARGIN + Math.round(size * 0.62) * 5 + 28,
			y: numberY + 120,
			width: 700,
			height: 44,
			fontFamily: SANS,
			fontSize: 34,
			fontWeight: 500,
			fill: MUTED,
		}).animate(riseAt(44, numberY + 120, 24)),
	]);
}
