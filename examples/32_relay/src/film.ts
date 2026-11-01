/**
 * Relay, a 25-second product film: a client asks "Can we ship the homepage
 * update Friday?", and one pointer turns the message into an assigned,
 * scheduled task that lands on the project board.
 *
 *   0–3 s   the request, under "From request to ready."; it flies into the inbox
 *   3–8 s   select the message, Create task: the task modal opens
 *   8–14 s  Maya, Friday, a checklist: "An owner. A deadline. A clear next step."
 *  14–20 s  back out to the board: the modal shrinks into its card in Ready
 *  20–25 s  the card becomes the mark: Relay. Keep client work moving.
 *
 * AppFrame is the window, MousePointer the hand, FocusZoom the camera (added
 * with `framefields add app-frame mouse-pointer focus-zoom`). The UI reacts
 * to the pointer's cues, so moving a beat re-times everything after it, the
 * narration included. Voice, music and click are generated (audio.ts).
 */
import { Composition, FontManager, Layer, LayerAnimation } from "framefields";
import {
	CLICK_PATH,
	LINE_IDS,
	type LineId,
	MUSIC_PATH,
	readManifest,
	voicePath,
} from "./audio.js";
import { AppFrame } from "./components/app-frame/index.js";
import { FocusZoom } from "./components/focus-zoom/index.js";
import {
	MousePointer,
	type Waypoint,
} from "./components/mouse-pointer/index.js";
import { SFX, type SfxName, sfxPath } from "./sfx.js";
import {
	ACCENT,
	APP,
	FONTS,
	FPS,
	FRAME,
	H,
	SANS,
	SHADOW,
	sec,
	W,
	WALL,
	WALL_LIGHT,
} from "./theme.js";
import { captions, endCard, handover, opening } from "./titles.js";
import { relayApp } from "./ui/app.js";
import { DUE_OPTIONS, FRIDAY, TEAM } from "./ui/data.js";
import { CARD_RADIUS } from "./ui/handoffs.js";
import { centre, type Rect } from "./ui/kit.js";
import {
	ADD_CHECKLIST,
	ASSIGNEE_FIELD,
	COLUMN_W,
	CREATE_BUTTON,
	cardSlot,
	columnX,
	DUE_FIELD,
	inModal,
	LIST_TOP,
	LIST_X,
	MODAL,
	menuUnder,
	optionIn,
	PANE_W,
	PANE_X,
	READY,
	REQUEST_ROW,
	SAVE_BUTTON,
} from "./ui/layout.js";
import {
	type Click,
	cardLands,
	checklistItemAt,
	modalIn,
	type Timeline,
} from "./ui/timeline.js";

/** The storyboard's fixed marks. */
const WINDOW_IN = sec(2.1);
const FLY = sec(2.6);
const LANDED = sec(3.45);
const POINTER_IN = sec(3.2);
const END_CARD = sec(20);
/** The card leaves the board for the end card. */
const SCENE_OUT = END_CARD - sec(0.8);
const END = sec(25);

/**
 * MousePointer's click, at 30 fps: it settles 4 frames after arriving,
 * presses for 3 (the click lands) and is fully released 7 frames later.
 */
const CLICK_LANDS = 7;
const RELEASED = 14;

interface Beat {
	to: [number, number];
	/** Composition frame the click lands (or the pointer arrives, for a rest). */
	at: number;
	/** Frames on the way from the previous beat (the first comes in from the edge). */
	travel?: number;
	click?: boolean;
	/** Frames to rest after the last beat. */
	rest?: number;
}

/** Waypoints that leave each beat in time to make the next one. */
function perform(enter: number, beats: Beat[]): Waypoint[] {
	const arrival = (b: Beat) => b.at - (b.click ? CLICK_LANDS : 0);
	return beats.map((b, i) => {
		const next = beats[i + 1];
		const free = arrival(b) + (b.click ? RELEASED - CLICK_LANDS : 0);
		const dwell = next
			? arrival(next) - (next.travel ?? 0) - free
			: (b.rest ?? 0);
		if (dwell < 0)
			throw new Error(
				`Beat ${i + 1} cannot leave in time for beat ${i + 2}: ${-dwell} frames short.`,
			);
		return {
			to: b.to,
			at: arrival(b) - enter,
			dwell,
			...(b.click && { click: true }),
		};
	});
}

const clickAt = (
	cues: {
		presses: ReadonlyArray<{ frame: number }>;
		clicks: ReadonlyArray<{ frame: number }>;
		releases: ReadonlyArray<{ frame: number }>;
	},
	i: number,
): Click => ({
	down: cues.presses[i]?.frame ?? 0,
	at: cues.clicks[i]?.frame ?? 0,
	up: cues.releases[i]?.frame ?? 0,
});

function sound(file: string, frame: number, seconds: number, volume: number) {
	return Layer.audio(file, {
		startFrame: frame,
		durationFrames: Math.ceil(seconds * FPS) + 2,
		volume,
	});
}

const cue = (name: SfxName, frame: number, volume: number) =>
	sound(sfxPath(name), frame, SFX[name].seconds, volume);

/** Where each line of narration starts: on the beat it describes. */
function lineStarts(t: Timeline): Record<LineId, number> {
	return {
		ask: sec(0.5),
		inbox: LANDED - 2,
		owner: t.maya.at + 2,
		deadline: t.friday.at + 2,
		step: checklistItemAt(t, 0),
		board: cardLands(t) + 4,
		close: END_CARD + sec(0.7),
	};
}

export interface Line {
	id: LineId;
	start: number;
	end: number;
}

/** Music level between lines, and under them. */
const BED = 0.5;
const DUCKED = 0.22;
/** Lines closer than this keep the music down between them. */
const BRIDGE = 18;

/** The music's volume: down under every line, and out by the end. */
function ducking(lines: Line[]): Array<[number, number, string?]> {
	const keys: Array<[number, number, string?]> = [
		[0, 0],
		[6, BED, "power2.out"],
	];
	let i = 0;
	while (i < lines.length) {
		const start = lines[i]?.start ?? 0;
		let end = lines[i]?.end ?? 0;
		while (i + 1 < lines.length && (lines[i + 1]?.start ?? 0) - end < BRIDGE)
			end = lines[++i]?.end ?? end;
		keys.push(
			[start - 6, BED, "hold"],
			[start, DUCKED, "power2.out"],
			[end, DUCKED, "hold"],
			[end + 12, BED, "power2.inOut"],
		);
		i++;
	}
	keys.push([END - sec(1.6), BED, "hold"], [END, 0, "power2.in"]);
	return keys;
}

export interface Relay {
	film: Composition;
	timeline: Timeline;
	/** The camera, for asking where it looks at a frame. */
	camera: ReturnType<typeof FocusZoom>;
	/** Every click, in composition frames. */
	clicks: number[];
	/** The narration, in composition frames. */
	lines: Line[];
}

export async function buildRelay(): Promise<Relay> {
	await FontManager.register({ family: SANS, source: `${FONTS}Inter.ttf` });
	const theme = { color: { bg: WALL, accent: ACCENT, shadow: SHADOW } };

	const frame = AppFrame({
		id: "relay-window",
		kind: "window",
		...FRAME,
		appearance: "light",
		contentBackground: APP,
		elevation: 2,
		theme,
		enter: {
			preset: "rise",
			duration: sec(0.9),
			delay: WINDOW_IN,
			distance: 60,
		},
	});
	// Content rects → the stage the camera films.
	const stage = (r: Rect): Rect => {
		const [x, y] = frame.at(r.x, r.y);
		return { x, y, width: r.width, height: r.height };
	};
	const aim = (r: Rect) => frame.at(...centre(r));
	const assignees = menuUnder(ASSIGNEE_FIELD, TEAM.length);
	const dates = menuUnder(DUE_FIELD, DUE_OPTIONS.length);
	const maya = inModal(optionIn(assignees, 0));
	const friday = inModal(optionIn(dates, FRIDAY));
	const newCard = cardSlot(READY, 0);

	const targets = {
		request: stage(REQUEST_ROW),
		create: stage(CREATE_BUTTON),
		assignee: stage(inModal(ASSIGNEE_FIELD)),
		maya: stage(maya),
		due: stage(inModal(DUE_FIELD)),
		friday: stage(friday),
		checklist: stage(inModal(ADD_CHECKLIST)),
		save: stage(inModal(SAVE_BUTTON)),
		card: stage(newCard),
	};
	const pointer = MousePointer({
		id: "pointer",
		at: POINTER_IN,
		from: "bottom",
		to: "right",
		size: 32,
		accent: ACCENT,
		fps: FPS,
		hoverRegions: Object.values(targets).map((target) => ({
			target,
			style: "hand" as const,
		})),
		path: perform(POINTER_IN, [
			{
				to: frame.at(LIST_X + 300, LIST_TOP + 52),
				at: sec(4.25),
				click: true,
			},
			{ to: aim(CREATE_BUTTON), at: sec(6.2), travel: 22, click: true },
			{
				to: aim(inModal(ASSIGNEE_FIELD)),
				at: sec(8.25),
				travel: 20,
				click: true,
			},
			{ to: aim(maya), at: sec(9.2), travel: 12, click: true },
			{ to: aim(inModal(DUE_FIELD)), at: sec(10.45), travel: 14, click: true },
			{ to: aim(friday), at: sec(11.45), travel: 14, click: true },
			{
				to: aim(inModal(ADD_CHECKLIST)),
				at: sec(13.05),
				travel: 18,
				click: true,
			},
			{ to: aim(inModal(SAVE_BUTTON)), at: sec(14.3), travel: 16, click: true },
			{
				to: frame.at(newCard.x + 236, newCard.y + 30),
				at: sec(16.2),
				travel: 30,
				rest: SCENE_OUT - sec(16.2),
			},
		]),
	});

	const cues = pointer.cues;
	const t: Timeline = {
		windowIn: WINDOW_IN,
		landed: LANDED,
		select: clickAt(cues, 0),
		create: clickAt(cues, 1),
		assignee: clickAt(cues, 2),
		mayaHover: (cues.arrivals[3]?.frame ?? 0) - 3,
		maya: clickAt(cues, 3),
		due: clickAt(cues, 4),
		fridayHover: (cues.arrivals[5]?.frame ?? 0) - 3,
		friday: clickAt(cues, 5),
		checklist: clickAt(cues, 6),
		save: clickAt(cues, 7),
		sceneOut: SCENE_OUT,
	};
	frame.fill(...relayApp(t));

	// The camera: in on each control while it's used, and still from the press
	// until the control has sprung back. A move starts once the click settles.
	const settled = (c: Click) => c.up + sec(0.2);
	const camera = FocusZoom({
		id: "camera",
		content: [frame, pointer],
		bounds: FRAME,
		length: END_CARD,
		fps: FPS,
		shots: [
			{
				at: settled(t.select),
				target: stage({ x: PANE_X, y: 0, width: PANE_W, height: 420 }),
				zoom: 1.6,
			},
			{
				at: modalIn(t) + 8,
				target: stage(
					inModal({ x: 0, y: 28, width: MODAL.width, height: 560 }),
				),
				zoom: 1.7,
			},
			{
				at: settled(t.friday),
				target: stage(
					inModal({ x: 0, y: 300, width: MODAL.width, height: 340 }),
				),
				zoom: 1.7,
			},
			{ at: settled(t.save), target: "full" },
			{
				at: cardLands(t) + sec(0.8),
				target: stage({
					x: columnX(READY) - 40,
					y: 0,
					width: COLUMN_W + 80,
					height: 560,
				}),
				zoom: 1.6,
				// Held until the card has handed over to the end card.
				hold: END_CARD - (cardLands(t) + sec(0.8)),
			},
		],
	});
	const scene = Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		children: [camera],
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 1],
			[SCENE_OUT, 1, "hold"],
			[SCENE_OUT + sec(0.6), 0, "power2.inOut"],
		]),
	);
	// The new card, where the camera shows it as it leaves for the end card.
	const card = stage(newCard);
	const [left, top] = camera.toScreen([card.x, card.y], SCENE_OUT);
	const [right, bottom] = camera.toScreen(
		[card.x + card.width, card.y + card.height],
		SCENE_OUT,
	);
	const onScreen = {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	};
	const zoomed = camera.cameraAt(SCENE_OUT).zoom;

	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (END / FPS) * 1000,
		backgroundColor: WALL,
		fonts: [`${FONTS}Inter.ttf`],
	});
	comp.add([
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			background: `radial-gradient(ellipse at 50% 30%, ${WALL_LIGHT} 0%, ${WALL} 75%)`,
		}),
		scene,
		...opening(FLY, LANDED, targets.request),
		captions(
			["An owner.", "A deadline.", "A clear next step."],
			[t.maya.at + 3, t.friday.at + 3, checklistItemAt(t, 0)],
			modalIn(t) + sec(1),
			t.save.down,
		),
		...handover(onScreen, CARD_RADIUS * zoomed, SCENE_OUT, END_CARD),
		endCard(END_CARD, END - END_CARD),
	]);

	// Narration on its beats, music ducked under it, and sparse cues: a click
	// as each press lands, the modal opening, the card landing.
	const audio = readManifest();
	const starts = lineStarts(t);
	const lines = LINE_IDS.map((id) => ({
		id,
		start: starts[id],
		end: starts[id] + Math.round(audio.voice[id].seconds * FPS),
	}));
	for (const line of lines)
		comp.addAudio(
			sound(voicePath(line.id), line.start, audio.voice[line.id].seconds, 1),
		);
	comp.addAudio(
		Layer.audio(MUSIC_PATH, {
			startFrame: 0,
			durationFrames: END,
			volume: BED,
		}).animate(LayerAnimation.keys("volume", ducking(lines))),
	);
	for (const c of cues.clicks)
		comp.addAudio(sound(CLICK_PATH, c.frame, audio.click.seconds, 0.6));
	comp.addAudio(cue("panel", modalIn(t), 0.6));
	comp.addAudio(cue("complete", cardLands(t), 0.8));
	return {
		film: comp,
		timeline: t,
		camera,
		clicks: cues.clicks.map((c) => c.frame),
		lines,
	};
}

export async function buildFilm(): Promise<Composition> {
	return (await buildRelay()).film;
}
