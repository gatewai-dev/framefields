/**
 * The end. On "Gitframes." the logo and the name, extruded in 3D, whips in under an
 * orbiting camera; "Motion, compiled." builds word by word beneath it, and
 * on the final hit the install line lands with the Claude Code plugin and skills CLI
 * installs beneath it, held through the ring-out.
 */
import { CameraAnimation, Layer, Layer3D, LayerAnimation } from "gitframes";
import { BEAT, bar } from "../grid.js";
import { lineWords, sung } from "../lyrics.js";
import {
	ACCENT,
	BG,
	DISPLAY,
	EASE_OUT,
	FG,
	flashes,
	GUEST,
	H,
	keys,
	label,
	logoMark,
	MONO,
	MUTED,
	plane,
	SNAP,
	scene,
	sungLine,
	W,
	window3D,
} from "../theme.js";
import { CH, DURATION } from "../timeline.js";

/** Agent plugin installs: Claude Code (official directory, bare name), then every other agent via the skills CLI. */
const PLUGIN_INSTALL = [
	"/plugin install gitframes",
	"npx skills add gatewai-dev/gitframes",
];

const CX = W / 2;
const CY = H / 2;

/** The logo, standing in the 3D scene above the name. */
function brandMark(at: number) {
	return logoMark({
		id: "final-mark",
		size: 190,
		x: CX,
		y: CY - 225,
		z: 0,
	}).animate(
		keys("scale", [
			[0, 0],
			[at, 0],
			[at + 10, 1, SNAP],
		]),
	);
}

function lockup() {
	const from = bar(CH.outro);
	const len = DURATION - from;
	// The name whips in on the voice; the install line lands on the final hit.
	const settle = sung("gitframes", from - BEAT).at - from + 10;
	const hit = bar(CH.final) - from;
	const cam = CameraAnimation.camera()
		.orbit({
			azimuth: { from: 34, to: 0 },
			elevation: { from: -18, to: 4 },
			radius: { from: 2100, to: 1450 },
			start: 0,
			end: settle,
			ease: EASE_OUT,
		})
		.orbit({
			azimuth: { from: 0, to: -3 },
			elevation: { from: 4, to: 2 },
			radius: { from: 1450, to: 1380 },
			start: settle + 1,
			end: len,
			ease: "sine.inOut",
		});
	return scene(
		"final",
		from,
		DURATION,
		[
			Layer.camera({
				id: "final-cam",
				targetX: CX,
				targetY: CY - 60,
				targetZ: 0,
				animation: cam,
			} as never),
			Layer.directionalLight({
				id: "final-key",
				color: "#FFFFFF",
				intensity: 1.1,
				direction: [-0.4, 0.5, 1],
			} as never),
			Layer.ambientLight({
				id: "final-fill",
				color: "#FFFFFF",
				intensity: 0.6,
			} as never),
			brandMark(settle - 10),
			// The name stands only once it is sung.
			window3D("final-name-window", settle - 10, len - settle + 10, [
				Layer3D.extrudedText({
					id: "final-name",
					text: "gitframes",
					fontFamily: DISPLAY,
					fontWeight: 900,
					fontSize: 200,
					fill: ACCENT,
					depth: 80,
					x: CX,
					y: CY - 40,
					z: 0,
				}),
			]),
			// The reading lines stay flat: the camera moves, the words hold still.
			sungLine({
				id: "final-line",
				words: lineWords(sung("motion", from - BEAT).line),
				from,
				y: CY + 90,
				size: 72,
				font: GUEST.fraunces,
				weight: 700,
				upper: false,
				enter: "rise",
			}),
			Layer.text("pnpm add gitframes", {
				id: "final-install",
				position: "absolute",
				x: CX - 260,
				y: CY + 290,
				width: 520,
				fontFamily: MONO,
				fontSize: 30,
				fontWeight: 600,
				letterSpacing: 2,
				fill: BG,
				background: FG,
				padding: 18,
				borderRadius: 14,
				align: "center",
			}).animate(
				LayerAnimation.create()
					.fadeIn(hit, hit + 6)
					.fromTo("y", CY + 310, CY + 290, {
						start: hit,
						end: hit + 16,
						ease: EASE_OUT,
					}),
			),
			...PLUGIN_INSTALL.map((text, i) =>
				Layer.text(text, {
					id: `final-plugin-${i}`,
					position: "absolute",
					x: 0,
					y: CY + 400 + i * 38,
					width: W,
					align: "center",
					fontFamily: MONO,
					fontSize: 24,
					fontWeight: 500,
					fill: i === 0 ? FG : MUTED,
				}).animate(
					LayerAnimation.create()
						.fadeIn(hit + 8 + i * 4, hit + 16 + i * 4)
						.fromTo("y", CY + 412 + i * 38, CY + 400 + i * 38, {
							start: hit + 8 + i * 4,
							end: hit + 22 + i * 4,
							ease: EASE_OUT,
						}),
				),
			),
			label({
				id: "final-url",
				text: "WebGPU motion engine",
				y: 52,
				inAt: hit + 16,
				color: FG,
				size: 20,
			}),
			plane("final-hit", ACCENT).animate(
				flashes(
					[
						{ at: settle - 10, peak: 0.85 },
						{ at: hit, peak: 0.5 },
					],
					14,
				),
			),
		],
		{ background: BG },
	);
}

export function outroScenes() {
	return [lockup()];
}
