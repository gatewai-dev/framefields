/**
 * First Light: the framefields desktop launch film. One world, one take:
 * a field of sleeping frames, the app standing in it as the one lit window,
 * a line typed into its composer, and the field waking to it.
 */
import {
	Composition,
	FilmGrain,
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Vignette,
} from "framefields";
import { camera } from "./camera.js";
import { field, MARK, playheadX, WAKE_SPEED } from "./field.js";
import { sound } from "./sound.js";
import {
	BEAT,
	BEAT_FRAMES,
	DISPLAY,
	DURATION,
	FONTS,
	FPS,
	H,
	INK,
	PAPER,
	SIGNAL,
	W,
} from "./theme.js";
import { appWindow } from "./window.js";

export { DURATION };

/** Degrees the name leans up from the floor, toward where the lens ends. */
const NAME_TILT = 18;

/**
 * The playhead: a line of signal yellow on the floor across the whole field,
 * and a faint sheet of the same light standing on it.
 */
function playhead(): LayoutNode[] {
	const from = BEAT.play - 8;
	const keys: Array<[number, number, string]> = [];
	for (let f = from; f <= BEAT.played + 8; f++)
		keys.push([f - from, playheadX(f), "none"]);
	const part = (id: string, height: number, glow: number, opacity: number) =>
		Layer3D.roundedBox({
			id,
			x: playheadX(from),
			y: -height / 2 - 2,
			z: 3600,
			width: 6,
			height,
			depth: 34000,
			radius: 2,
			color: SIGNAL,
			material: "unlit",
			emissive: SIGNAL,
			emissiveIntensity: glow,
			opacity,
			castShadow: false,
			startFrame: from,
			durationFrames: BEAT.played - BEAT.play + 16,
		}).animate(LayerAnimation.create().keys("x", keys)) as LayoutNode;
	return [part("playhead", 8, 3.2, 1), part("playhead-sheet", 300, 0.6, 0.16)];
}

/** A thin ring of light running out over the floor from a hit. */
function ring(options: {
	id: string;
	at: number;
	x: number;
	z: number;
	/** Px a frame, and how many frames it lasts. */
	speed: number;
	span: number;
	color: string;
}) {
	const { span } = options;
	return Layer3D.torus({
		id: options.id,
		x: options.x,
		y: -4,
		z: options.z,
		rotateX: 90,
		radius: 100,
		tube: 0.09,
		tubularSegments: 256,
		radialSegments: 8,
		color: options.color,
		material: "unlit",
		emissive: options.color,
		emissiveIntensity: 3,
		castShadow: false,
		scale: 0.01,
		startFrame: options.at,
		durationFrames: span,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.01],
				[span, (options.speed * span) / 100, "none"],
			])
			.keys("opacity", [
				[0, 1],
				[span * 0.6, 0.8],
				[span, 0, "sine.in"],
			]),
	);
}

/** A breath of light over the whole picture on a hit. */
function flash(id: string, at: number, strength: number) {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "#cfe0ff",
		blendMode: "screen",
		opacity: 0,
		startFrame: at - 1,
		durationFrames: 16,
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[2, strength, "power2.out"],
			[15, 0, "power2.out"],
		]),
	);
}

/**
 * The mark's four corners, drawn round the picture as a viewfinder: they
 * draw on at the open, kick on every hit, fly out of frame as the lens goes
 * through the preview and close in on the mark as it lands, where the real
 * ones take over.
 */
function viewfinder() {
	const margin = 60;
	const arm = 86;
	const size = arm + 12;
	// One corner, drawn from the end of one arm round to the end of the other.
	const corner = (flipX: boolean, flipY: boolean) => {
		const x = (v: number) => (flipX ? size - v : v);
		const y = (v: number) => (flipY ? size - v : v);
		return `M ${x(6)} ${y(arm)} L ${x(6)} ${y(30)} Q ${x(6)} ${y(6)} ${x(30)} ${y(6)} L ${x(arm)} ${y(6)}`;
	};
	const corners = [
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	].map(([right, bottom], i) =>
		Layer.shape("path", {
			id: `finder-${i}`,
			position: "absolute",
			x: right ? W - margin - size : margin,
			y: bottom ? H - margin - size : margin,
			width: size,
			height: size,
			d: corner(Boolean(right), Boolean(bottom)),
			strokeColor: PAPER,
			strokeWidth: 4,
			fill: "transparent",
			trimEnd: 0,
		}).animate(
			LayerAnimation.keys("trimEnd", [
				[4 + i * 3, 0],
				[22 + i * 3, 1, "expo.out"],
			]),
		),
	);
	const kicks: Array<[number, number, string?]> = [[0, 1]];
	const kick = (at: number, by: number) => {
		kicks.push(
			[at - 1, 1],
			[at + 2, 1 + by, "power2.out"],
			[at + 16, 1, "expo.out"],
		);
	};
	kick(BEAT.send, 0.012);
	kick(BEAT.wake, 0.05);
	for (let n = 0; n < 4; n++) kick(BEAT.flips + n * BEAT_FRAMES, 0.014);
	kicks.push(
		// Out of frame with the lens, back in over the field, down onto the mark.
		[BEAT.played + 12, 1],
		[BEAT.through - 2, 1.6, "expo.in"],
		[BEAT.gather + 36, 1.6],
		[BEAT.gather + 70, 1, "expo.out"],
		[BEAT.mark - 26, 1],
		[BEAT.mark, 0.4, "expo.in"],
	);
	return Layer.box({
		id: "finder",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		opacity: 0.6,
		children: corners,
	}).animate(
		LayerAnimation.create()
			.keys("scale", kicks)
			.keys("y", [
				[BEAT.mark - 26, 0],
				[BEAT.mark, -112, "expo.in"],
			])
			.keys("opacity", [
				[BEAT.mark - 8, 0.6],
				[BEAT.mark + 2, 0],
			]),
	);
}

/** The name under the mark, tipped up off the floor to face the lens. */
function name() {
	const width = 3000;
	const height = 380;
	// The words track in: set wide, they close up to their setting as they appear.
	const word = (text: string, weight: number, fill: string, at: number) =>
		Layer.text(text, {
			fontFamily: DISPLAY,
			fontSize: 290,
			fontWeight: weight,
			fontVariations: { wdth: 68 },
			letterSpacing: -1.4,
			fill,
			opacity: 0,
		}).animate(
			LayerAnimation.create()
				.keys("opacity", [
					[at, 0],
					[at + 8, 1],
				])
				.keys("letterSpacing", [
					[at, 46],
					[at + 22, -1.4, "expo.out"],
				]),
		);
	return Layer3D.plane({
		id: "name",
		x: MARK.x - width / 2,
		y: -70 - height / 2,
		z: MARK.z - MARK.size / 2 - 600,
		rotateX: -90 + NAME_TILT,
		width,
		height,
		background: "transparent",
		material: "unlit",
		children: [
			Layer.flex({
				position: "absolute",
				x: 0,
				y: 0,
				width,
				height,
				dir: "row",
				justify: "center",
				align: "end",
				gap: 56,
				children: [
					word("framefields", 800, PAPER, BEAT.name),
					word("desktop", 300, "#8d9299", BEAT.name + 6),
				],
			}),
		] as LayoutNode[],
	});
}

/** A soft bloom of light around the window: its glow in the night air. */
function halo() {
	const width = 6400;
	const height = 4400;
	return Layer3D.plane({
		id: "halo",
		x: -width / 2,
		y: -840 - height / 2,
		z: 70,
		width,
		height,
		background:
			"radial-gradient(closest-side, rgba(170, 195, 255, 0.2) 0%, rgba(120, 150, 255, 0.07) 45%, rgba(120, 150, 255, 0) 100%)",
		material: "unlit",
	}).animate(
		// Once the field is awake its own light takes over.
		LayerAnimation.keys("opacity", [
			[0, 0],
			[BEAT.rise + 8, 0],
			[BEAT.rise + 34, 1, "sine.out"],
			[BEAT.wake, 1],
			[BEAT.wake + 30, 0, "sine.inOut"],
		]),
	);
}

export async function buildFilm(): Promise<Composition> {
	for (const [family, source] of Object.entries(FONTS))
		await FontManager.register({ family, source });
	const world = Layer.box({
		id: "world",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: INK,
		children: [
			camera(),
			Layer.environment("night", {
				id: "sky",
				exposure: -0.4,
				toneMapping: "agx",
				fog: { color: INK, start: 2600, end: 21000 },
				bloom: { intensity: 0.42, threshold: 1.25, radius: 7 },
				floor: {
					y: 0,
					color: "#05070a",
					reflectivity: 0.86,
					roughness: 0.1,
					fadeDistance: 2600,
				},
			}).animate(
				LayerAnimation.keys("exposure", [
					[BEAT.wake, -0.4],
					[BEAT.wake + 24, 0.45, "sine.inOut"],
					[BEAT.gather, 0.45],
					[BEAT.mark, -0.1, "sine.inOut"],
				]),
			),
			// A cold rim from far behind the window: edges, not faces.
			Layer.directionalLight({
				id: "rim",
				x: -5000,
				y: -3200,
				z: 16000,
				targetX: 0,
				targetY: 0,
				targetZ: 0,
				color: "#a9c2ff",
				intensity: 1.1,
			}),
			...field(),
			halo(),
			...appWindow(),
			ring({
				id: "wake-ring",
				at: BEAT.wake,
				x: 0,
				z: 0,
				speed: WAKE_SPEED,
				span: 60,
				color: "#cfe0ff",
			}),
			ring({
				id: "mark-ring",
				at: BEAT.mark,
				x: MARK.x,
				z: MARK.z,
				speed: 130,
				span: 70,
				color: "#3b82f6",
			}),
			...playhead(),
			name(),
		] as LayoutNode[],
	});

	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: DURATION,
		backgroundColor: INK,
		fonts: Object.values(FONTS),
	});
	film.add(world);
	film.add(viewfinder());
	film.add(flash("wake-flash", BEAT.wake, 0.2));
	film.add(flash("mark-flash", BEAT.mark, 0.14));
	film.add(
		Layer.box({
			id: "fade",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			background: "#000000",
		}).animate(
			LayerAnimation.create().keys("opacity", [
				[0, 1],
				[20, 0, "sine.out"],
				[BEAT.out, 0],
				[DURATION - 6, 1, "sine.in"],
			]),
		),
	);
	film.add(sound());
	film.apply(new Vignette({ strength: 26, softness: 0.55 }));
	film.apply(new FilmGrain({ strength: 2.2, size: 1.1 }));
	return film;
}
