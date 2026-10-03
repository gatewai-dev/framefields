/**
 * Chapter 05: Vision — "Track it."
 *
 * Demonstrates Gitframes's on-device vision with unmistakable visual punch:
 * 1. Temporal object tracking (`vision.objects.byCategory("person")`)
 *    anchoring precision spatial telemetry and bounding reticles.
 * 2. High-energy 2.5D perspective homography section (`Layer.section`) with 3D banking,
 *    rapid 5Hz shutter strobe (`fastStrobe`), harmonic spectral hue cycling (`fastHue`),
 *    and micro-contrast UnsharpMask.
 * 3. Moody desaturated background plate setting off the vivid glowing tracked subject.
 * 4. 3D perspective ground contact plane: concentric elliptical contact rings anchored
 *    to her floor contact point (`anchor: "bottomCenter"`) with 3D perspective tilt (`rotateX: 72`).
 * 5. Optical reticle corner brackets and center alignment ticks framing her bounds.
 * 6. Pinned spatial telemetry HUD pills displaying neural tracking metrics and contact coordinates.
 */
import fsSync from "node:fs";
import {
	Layer,
	LayerAnimation,
	type ObjectTrackSignals,
	type TrackedObject,
	VisionBundle,
} from "gitframes";
import {
	asset,
	chapter,
	EASE_OUT,
	EMBER,
	FPS,
	H,
	headline,
	INK,
	label,
	PAPER,
	SAND,
	scene,
	W,
} from "../theme.js";

export const TRACK_FROM = 792;
export const TRACK_TO = 936; // 8 beats @ 100 BPM (4.8 seconds)

/** 2.39:1 anamorphic letterbox bars */
const BAR = Math.round((H - W / 2.39) / 2);

function letterbox(id: string, y: number, at: number, fromBottom = false) {
	return Layer.shape("rect", {
		id,
		position: "absolute",
		x: 0,
		y: fromBottom ? H : y,
		width: W,
		height: BAR,
		fillColor: INK,
	}).animate(
		LayerAnimation.create().fromTo("y", fromBottom ? H : -BAR, y, {
			start: at,
			end: at + 18,
			ease: EASE_OUT,
		}),
	);
}

function cornerBracket(
	id: string,
	anchor: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
	d: string,
	targetPerson: ObjectTrackSignals,
	offX: number,
	offY: number,
	len: number,
) {
	return Layer.shape("path", {
		id,
		position: "absolute",
		width: 22,
		height: 22,
		d,
		fillType: "none",
		strokeColor: EMBER,
		strokeWidth: 2,
		strokeLineCap: "round",
		strokeLineJoin: "round",
	})
		.pinToObject(targetPerson, {
			anchor,
			offsetX: offX,
			offsetY: offY,
			smoothFrames: 2,
		})
		.animate(
			LayerAnimation.create()
				.fadeIn(8, 20, "power2.out")
				.fadeOut(len - 18, len - 6, "power2.in"),
		);
}

function centerReticleTick(
	id: string,
	anchor: "topCenter" | "bottomCenter",
	targetPerson: ObjectTrackSignals,
	offY: number,
	len: number,
) {
	return Layer.shape("rect", {
		id,
		position: "absolute",
		width: 56,
		height: 2,
		fillColor: EMBER,
		fillType: "solid",
	})
		.pinToObject(targetPerson, {
			anchor,
			offsetX: -28,
			offsetY: offY,
			smoothFrames: 2,
		})
		.animate(
			LayerAnimation.create()
				.fadeIn(8, 20, "power2.out")
				.fadeOut(len - 18, len - 6, "power2.in"),
		);
}

function centerCrosshair(
	id: string,
	targetPerson: ObjectTrackSignals,
	len: number,
) {
	return Layer.shape("path", {
		id,
		position: "absolute",
		width: 32,
		height: 32,
		d: "M 0 16 L 10 16 M 22 16 L 32 16 M 16 0 L 16 10 M 16 22 L 16 32",
		fillType: "none",
		strokeColor: EMBER,
		strokeWidth: 2,
		strokeLineCap: "round",
	})
		.pinToObject(targetPerson, {
			anchor: "center",
			offsetX: -16,
			offsetY: -16,
			smoothFrames: 2,
		})
		.animate(
			LayerAnimation.create()
				.fadeIn(8, 20, "power2.out")
				.fadeOut(len - 18, len - 6, "power2.in"),
		);
}

function groundRings(targetPerson: ObjectTrackSignals, len: number) {
	const groundPulseInner = Layer.box({
		id: "track-ground-inner",
		position: "absolute",
		width: 280,
		height: 60,
		borderRadius: 30,
		background: "rgba(255, 90, 31, 0.12)",
		borderColor: EMBER,
		borderWidth: 1.5,
	})
		.pinToObject(targetPerson, {
			anchor: "bottomCenter",
			offsetX: -140,
			offsetY: -30,
			smoothFrames: 2,
		})
		.animate(
			LayerAnimation.create()
				.tilt3D({
					from: { rotateX: 72, perspective: 1000 },
					to: { rotateX: 72, perspective: 1000 },
					start: 0,
					end: len,
				})
				.fadeIn(8, 24, "power2.out")
				.fadeOut(len - 20, len - 6, "power2.in"),
		);

	const groundPulseOuter = Layer.box({
		id: "track-ground-outer",
		position: "absolute",
		width: 440,
		height: 96,
		borderRadius: 48,
		background: "transparent",
		borderColor: "rgba(255, 90, 31, 0.45)",
		borderWidth: 1,
	})
		.pinToObject(targetPerson, {
			anchor: "bottomCenter",
			offsetX: -220,
			offsetY: -48,
			smoothFrames: 3,
		})
		.animate(
			LayerAnimation.create()
				.tilt3D({
					from: { rotateX: 72, perspective: 1000 },
					to: { rotateX: 72, perspective: 1000 },
					start: 0,
					end: len,
				})
				.fromTo("scale", 0.95, 1.05, {
					start: 0,
					end: len,
					ease: "sine.inOut",
				})
				.fadeIn(12, 28, "power2.out")
				.fadeOut(len - 20, len - 6, "power2.in"),
		);

	const floorCrosshair = Layer.shape("path", {
		id: "track-ground-axis",
		position: "absolute",
		width: 160,
		height: 1,
		d: "M 0 0 L 160 0",
		fillType: "none",
		strokeColor: "rgba(255, 90, 31, 0.6)",
		strokeWidth: 1,
	})
		.pinToObject(targetPerson, {
			anchor: "bottomCenter",
			offsetX: -80,
			offsetY: 0,
			smoothFrames: 2,
		})
		.animate(
			LayerAnimation.create()
				.fadeIn(10, 24, "power2.out")
				.fadeOut(len - 18, len - 6, "power2.in"),
		);

	return [groundPulseOuter, groundPulseInner, floorCrosshair];
}

export interface TrackSceneOptions {
	readonly from?: number;
	readonly to?: number;
}

export function trackScene(options: TrackSceneOptions = {}) {
	const from = options.from ?? TRACK_FROM;
	const to = options.to ?? TRACK_TO;
	const len = to - from;

	// 1. Initialize the vision bundle populated with temporal object tracking
	const vision = new VisionBundle({
		width: W,
		height: H,
		fps: FPS,
		totalFrames: Math.max(1, from + len),
	});

	try {
		const trackingPath = asset("dancer_tracking.json");
		if (fsSync.existsSync(trackingPath)) {
			const parsed = JSON.parse(
				fsSync.readFileSync(trackingPath, "utf8"),
			) as TrackedObject[][];
			for (let i = 0; i < len; i++) {
				const frameTracks = parsed[i] ?? [];
				vision.setObjectResult(from + i, frameTracks);
				if (from > 0) {
					vision.setObjectResult(i, frameTracks);
				}
			}
		}
	} catch (err) {
		console.warn("[trackScene] Warning loading dancer tracking cache:", err);
	}

	const targetPerson = vision.objects.byCategory("person");

	// 2. Neural Isolated Smoke Dancer ("Smoke Dancing"):
	// Her entire body (head, arms, torso, spinning dress) is converted into billowing ember smoke
	// via instance segmentation and background keying:
	// - Layer A (Silhouette Base): Full body & dress matte via background-keyed instance segmentation.
	// - Layer B (Smoke Fill): Billowing ember smoke video composited in source-in mode,
	//   strictly confined to her entire silhouette.
	// Seamlessly isolated inside a transparent container box without rectangular framing cards.
	const dancerFullSilhouette = Layer.video(asset("dancer.mp4"), {
		id: "track-dancer-silhouette",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		muted: true,
	}).withVision({
		mode: "matte",
		enableSegmentation: true,
		variant: "s",
		keyBackground: true,
		backgroundKeyThreshold: 75,
	});

	const smokePlume = Layer.video(asset("ink.mp4"), {
		id: "track-smoke-plume",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		muted: true,
		blendMode: "source-in",
		trimStartSec: 2.8,
	});

	const smokeDancerContainer = Layer.box({
		id: "track-smoke-dancer",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "transparent",
		children: [dancerFullSilhouette, smokePlume],
	}).animate(
		LayerAnimation.create()
			.fadeIn(4, 18, "power2.out")
			.fadeOut(len - 18, len - 6, "power2.in"),
	);

	// 5. Subtle studio horizon guide
	const horizonGuide = Layer.shape("path", {
		id: "track-horizon-guide",
		position: "absolute",
		x: 96,
		y: Math.round(H / 2 + 120),
		width: W - 192,
		height: 1,
		d: `M 0 0 L ${W - 192} 0`,
		fillType: "none",
		strokeColor: "rgba(140, 133, 123, 0.22)",
		strokeWidth: 1,
	}).animate(
		LayerAnimation.create()
			.fadeIn(8, 24, "power2.out")
			.fadeOut(len - 18, len - 6, "power2.in"),
	);

	return scene({
		id: "track",
		from,
		to,
		background: INK,
		children: [
			smokeDancerContainer,
			horizonGuide,
			...groundRings(targetPerson, len),
			cornerBracket(
				"track-bracket-tl",
				"topLeft",
				"M 0 22 L 0 0 L 22 0",
				targetPerson,
				-14,
				-14,
				len,
			),
			cornerBracket(
				"track-bracket-tr",
				"topRight",
				"M 0 0 L 22 0 L 22 22",
				targetPerson,
				-8,
				-14,
				len,
			),
			cornerBracket(
				"track-bracket-bl",
				"bottomLeft",
				"M 0 0 L 0 22 L 22 22",
				targetPerson,
				-14,
				-8,
				len,
			),
			cornerBracket(
				"track-bracket-br",
				"bottomRight",
				"M 22 0 L 22 22 L 0 22",
				targetPerson,
				-8,
				-8,
				len,
			),
			centerReticleTick(
				"track-reticle-top",
				"topCenter",
				targetPerson,
				-18,
				len,
			),
			centerReticleTick(
				"track-reticle-bottom",
				"bottomCenter",
				targetPerson,
				16,
				len,
			),
			centerCrosshair("track-reticle-crosshair", targetPerson, len),
			letterbox("track-bar-top", 0, 4),
			letterbox("track-bar-bottom", H - BAR, 4, true),
			headline({
				id: "track-title",
				text: "Track it.",
				x: 96,
				y: BAR + 40,
				width: 800,
				size: 112,
				color: PAPER,
				inAt: 8,
				outAt: len - 16,
			}),
			...chapter({
				id: "track-ch",
				index: "05",
				name: "Vision",
				color: PAPER,
				inAt: 16,
				outAt: len - 12,
				y: H - BAR / 2 - 11,
			}),
			label({
				id: "track-caption",
				text: "Neural Tracking · Full Smoke Silhouette Blend · 35mm Spatial Analysis",
				x: W - 96 - 920,
				y: H - BAR / 2 - 11,
				width: 920,
				align: "end",
				color: SAND,
				inAt: 22,
				outAt: len - 12,
			}),
		],
	});
}
