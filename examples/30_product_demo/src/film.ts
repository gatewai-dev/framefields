/**
 * A 13-second product demo: the browser opens on a deploys dashboard, the
 * pointer ships a build and promotes it, and the camera follows every click.
 *
 * Three components carry it: AppFrame (the browser), MousePointer (the
 * hand), FocusZoom (the camera). Everything that reacts — button presses,
 * the new row, the toast — keys off the pointer's cues, so moving a
 * waypoint re-times the whole film.
 */
import {
	AppFrame,
	Composition,
	FocusZoom,
	FontManager,
	Layer,
	LayerAnimation,
	type LayoutNode,
	MousePointer,
	type Waypoint,
} from "framefields";
import {
	ACCENT,
	APP,
	FONTS,
	FPS,
	FRAME,
	H,
	INK,
	MONO,
	MUTED,
	NIGHT,
	SANS,
	VIOLET,
	W,
} from "./theme.js";
import {
	DEPLOY_BUTTON,
	dashboard,
	PROMOTE_BUTTON,
	type Timeline,
} from "./ui.js";

const sec = (s: number) => Math.round(s * FPS);

/** The page behind the window: a cold night sky with a little color under the glass. */
function backdrop(): LayoutNode[] {
	return [
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			background: `radial-gradient(ellipse at 50% 0%, #161b2e 0%, ${NIGHT} 62%)`,
		}),
		Layer.box({
			position: "absolute",
			x: W * 0.12,
			y: H * 0.18,
			width: W * 0.76,
			height: H * 0.9,
			background: `radial-gradient(ellipse at 50% 50%, ${ACCENT}2e 0%, ${VIOLET}10 40%, transparent 70%)`,
		}),
	];
}

function lockup(at: number): LayoutNode {
	const mark = 64;
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: at,
		children: [
			Layer.box({
				position: "absolute",
				x: W / 2 - mark / 2,
				y: H / 2 - 120,
				width: mark,
				height: mark,
				borderRadius: 18,
				background: `linear-gradient(135deg, ${ACCENT}, ${VIOLET})`,
				children: [
					Layer.text("N", {
						position: "absolute",
						x: 0,
						y: 12,
						width: mark,
						align: "center",
						fontFamily: SANS,
						fontSize: 34,
						fontWeight: 700,
						fill: "#ffffff",
					}),
				],
			}).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[0, 0],
						[12, 1, "power2.out"],
					])
					.keys("scale", [
						[0, 0.7],
						[sec(0.7), 1, "back.out(1.8)"],
					]),
			),
			Layer.text("Northwind", {
				position: "absolute",
				x: 0,
				y: H / 2 - 30,
				width: W,
				align: "center",
				fontFamily: SANS,
				fontSize: 64,
				fontWeight: 650,
				fill: INK,
				letterSpacing: -1.5,
			}).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[0, 0],
						[6, 0, "hold"],
						[sec(0.8), 1, "power2.out"],
					])
					.keys("y", [
						[0, H / 2 - 10],
						[6, H / 2 - 10, "hold"],
						[sec(0.9), H / 2 - 30, "expo.out"],
					]),
			),
			Layer.text("Ship on a Friday. Sleep on a Friday.", {
				position: "absolute",
				x: 0,
				y: H / 2 + 58,
				width: W,
				align: "center",
				fontFamily: SANS,
				fontSize: 24,
				fill: MUTED,
			}).animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[sec(0.5), 0, "hold"],
					[sec(1.2), 1, "power2.out"],
				]),
			),
			Layer.text("northwind.dev", {
				position: "absolute",
				x: 0,
				y: H / 2 + 112,
				width: W,
				align: "center",
				fontFamily: MONO,
				fontSize: 17,
				fill: ACCENT,
				letterSpacing: 1,
			}).animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[sec(0.8), 0, "hold"],
					[sec(1.5), 1, "power2.out"],
				]),
			),
		],
	});
}

export async function buildFilm(): Promise<Composition> {
	await FontManager.register({ family: SANS, source: `${FONTS}Inter.ttf` });
	await FontManager.register({
		family: MONO,
		source: `${FONTS}JetBrainsMono.ttf`,
	});

	const frame = AppFrame({
		id: "browser",
		kind: "browser",
		...FRAME,
		url: { text: "app.northwind.dev/deploys", typeAt: sec(0.4), cps: 34 },
		appearance: "dark",
		contentBackground: APP,
		elevation: 3,
		enter: { preset: "tilt", duration: sec(1.2) },
	});
	// The page paints as soon as the address is in; the load bar finishes over it.
	const loaded = (frame.cues.urlTyped[0]?.frame ?? sec(1)) + sec(0.3);

	// Composition coordinates of a content-space rect, and its centre.
	const rect = (r: { x: number; y: number; width: number; height: number }) => {
		const [x, y] = frame.at(r.x, r.y);
		return { x, y, width: r.width, height: r.height };
	};
	const centre = (r: { x: number; y: number; width: number; height: number }) =>
		frame.at(r.x + r.width / 2, r.y + r.height / 2);

	// Pass 1 places the deploy click; the build takes 2.4 s from there, and
	// the pointer comes back to promote it once it's ready.
	const enterAt = loaded + sec(0.5);
	const toDeploy: Waypoint = {
		to: centre(DEPLOY_BUTTON),
		click: true,
		dwell: sec(0.3),
	};
	const draft = MousePointer({
		id: "pointer",
		at: enterAt,
		from: "bottom",
		path: [toDeploy],
	});
	const deployClick = draft.cues.clicks[0]?.frame ?? 0;
	const ready = deployClick + sec(2.4);
	const promoteArrive = ready + sec(0.7);

	const [px, py] = centre(PROMOTE_BUTTON);
	const pointer = MousePointer({
		id: "pointer",
		at: enterAt,
		from: "bottom",
		to: "right",
		path: [
			toDeploy,
			// Watch the build: drift down beside the new row.
			{ to: [px - 180, py + 150], dwell: sec(0.4) },
			{
				to: [px, py],
				at: promoteArrive - enterAt,
				click: true,
				dwell: sec(0.9),
			},
		],
		size: 38,
		hoverRegions: [
			{ target: rect(DEPLOY_BUTTON), style: "hand" },
			{ target: rect(PROMOTE_BUTTON), style: "hand" },
		],
		fps: FPS,
	});

	const [deployPress, promotePress] = pointer.cues.presses;
	const [deployRelease, promoteRelease] = pointer.cues.releases;
	const t: Timeline = {
		loaded,
		deployDown: deployPress?.frame ?? 0,
		deployUp: deployRelease?.frame ?? 0,
		deployClick,
		ready,
		promoteDown: promotePress?.frame ?? 0,
		promoteUp: promoteRelease?.frame ?? 0,
		promoteClick: pointer.cues.clicks[1]?.frame ?? 0,
	};
	frame.fill(...dashboard(t));

	const outro = t.promoteClick + sec(2.4);
	const end = outro + sec(2.8);

	const camera = FocusZoom({
		id: "camera",
		content: [...backdrop(), frame, pointer],
		follow: pointer,
		bounds: FRAME,
		zoom: 1.65,
		padding: 220,
		idle: sec(1.1),
		length: end,
		fps: FPS,
	});
	const scene = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		children: [camera],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 1],
				[outro, 1, "hold"],
				[outro + sec(0.6), 0, "power2.inOut"],
			])
			.keys("scale", [
				[0, 1],
				[outro, 1, "hold"],
				[outro + sec(0.8), 0.94, "power3.in"],
			]),
	);

	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (end / FPS) * 1000,
		backgroundColor: NIGHT,
		fonts: [`${FONTS}Inter.ttf`, `${FONTS}JetBrainsMono.ttf`],
	});
	comp.add([scene, lockup(outro + sec(0.6))]);
	return comp;
}
