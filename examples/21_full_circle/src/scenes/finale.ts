/**
 * bar 17 – end — The moon. The title rises beneath it, the name orbits the
 * moon one last time, the credit settles, the plugin install lines land at the
 * foot of the frame, and the picture and score fade out together.
 */
import { Layer, LayerAnimation } from "gitframes";
import { EDIT, ringAt } from "../edit.js";
import { bar, DROP, DURATION } from "../grid.js";
import {
	BONE,
	caption,
	DISPLAY,
	EASE_OUT,
	H,
	INK,
	line,
	MARGIN,
	MONO,
	orbit,
	plane,
	STONE,
	scene,
	W,
} from "../theme.js";

export const FADE = 24;
const TITLE = 132;
const TITLE_Y = 630;

/** Agent plugin installs: Claude Code (official directory, bare name), then Codex. */
const INSTALL = [
	"/plugin install gitframes",
	"codex plugin marketplace add gatewai-dev/gitframes",
];
const INSTALL_Y = H - MARGIN - 22;

export function finaleScene() {
	const from = bar(DROP + 6);
	const to = DURATION;
	const len = to - from;
	const moon = EDIT.find((c) => c.id === "moon");
	if (!moon) throw new Error("edit has no moon cut");
	const settled = ringAt(moon, len - 1);

	return scene("finale", from, to, [
		orbit({
			id: "finale-orbit",
			text: "EVERYTHING THAT TURNS COMES BACK AROUND",
			ring: { ...settled, r: settled.r + 56 },
			inAt: 18,
			turns: -0.12,
			duration: len,
			size: 22,
		}),
		line({
			id: "finale-title",
			text: "FULL CIRCLE",
			y: TITLE_Y,
			size: TITLE,
			font: DISPLAY,
			weight: 700,
			letterSpacing: 26,
			inAt: 6,
		}),
		// Under the title, in the dark sky: the lone figure owns the bottom of the frame.
		caption({
			id: "finale-credit",
			text: "Eight shots  ·  one ring  ·  made in code with Gitframes",
			y: TITLE_Y + TITLE * 1.3 + 12,
			inAt: 30,
			color: STONE,
		}),
		// Either side of the lone figure, on the caption margin, so neither line crosses him.
		...INSTALL.map((text, i) =>
			Layer.text(text, {
				id: `finale-install-${i}`,
				position: "absolute",
				x: i === 0 ? MARGIN : W / 2 + 80,
				y: INSTALL_Y,
				width: W / 2 - 80 - MARGIN,
				align: i === 0 ? "start" : "end",
				fontFamily: MONO,
				fontSize: 22,
				fill: BONE,
			}).animate(
				LayerAnimation.create()
					.fromTo("opacity", 0, 0.8, {
						start: 42 + i * 6,
						end: 52 + i * 6,
						ease: "power2.out",
					})
					.fromTo("y", INSTALL_Y + 12, INSTALL_Y, {
						start: 42 + i * 6,
						end: 58 + i * 6,
						ease: EASE_OUT,
					}),
			),
		),
		plane("finale-black", INK).animate(
			LayerAnimation.create().fromTo("opacity", 0, 1, {
				start: len - FADE,
				end: len - 1,
				ease: "sine.inOut",
			}),
		),
	]);
}
