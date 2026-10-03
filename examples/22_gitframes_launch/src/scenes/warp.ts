/**
 * "Drop a mesh and make it bend, warp the vertices to the bass, ripple, twist
 * and fold the space, every frame a different shape." Dense meshes deformed
 * on the GPU by the song itself (deformWithAudio reads the soundtrack's
 * spectrum per frame), each verb the deformer it names:
 *   drop / bend      a sphere falls onto the stage and bends in a harmonic wave
 *   warp … bass      its vertices push out along their normals with the 20–120 Hz band
 *   ripple           concentric waves run across a torus, struck by the drums
 *   twist            a column winds about its axis on the bass
 *   fold the space   the camera cranes over the winding column
 *   every frame …    a new shape on every beat, pulsing from the centre
 */
import { CameraAnimation, Layer, Layer3D, LayerAnimation } from "gitframes";
import { BEAT, bar } from "../grid.js";
import { lineWords, type SungWord, sung } from "../lyrics.js";
import { asset } from "../paths.js";
import {
	ACCENT,
	BG,
	EASE_IN,
	EASE_OUT,
	FG,
	flashes,
	H,
	keys,
	plane,
	SNAP,
	scene,
	sungLine,
	W,
} from "../theme.js";
import { CH } from "../timeline.js";
import { type MeshName, meshFile } from "../warp/meshes.js";

const CX = W / 2;
const CY = H / 2 - 40;
const SONG = asset("song.mp3");

type Mode =
	| "harmonic_wave"
	| "normal_extrusion"
	| "ripple"
	| "twist"
	| "radial_pulse";

interface Take {
	mesh: MeshName;
	mode: Mode;
	at: number;
	until: number;
	amp: number;
	color: string;
	rotateX?: number;
}

/** One mesh under one deformer, on screen over [at, until) of the scene, turning slowly. */
function warped(t: Take, i: number) {
	return Layer3D.obj(meshFile(t.mesh), {
		id: `warp-mesh-${i}`,
		x: CX,
		y: CY,
		z: 0,
		rotateX: t.rotateX ?? 0,
		color: t.color,
		material: "lit",
		shininess: 48,
		twoSided: true,
		startFrame: t.at,
		durationFrames: t.until - t.at,
	} as never)
		.animate(
			LayerAnimation.create()
				.fromTo("rotateY", -20, 40, {
					start: 0,
					end: t.until - t.at,
					ease: "none",
				})
				.fromTo("scale", 1.25, 1, { start: 0, end: 8, ease: SNAP }),
		)
		.deformWithAudio({
			audioTrackId: SONG,
			mode: t.mode,
			frequencyRange: [20, 120],
			amplitudeMultiplier: t.amp,
			damping: 0.2,
		});
}

export function warpScene() {
	const from = bar(CH.warp);
	const to = bar(CH.code);
	const len = to - from;
	const local = (w: SungWord) => w.at - from;
	const drop = sung("drop", from - BEAT);
	const bend = sung("bend", drop.at);
	const warp = sung("warp", bend.at);
	const ripple = sung("ripple", warp.at);
	const twist = sung("twist", ripple.at);
	const fold = sung("fold", twist.at);
	const every = sung("every", fold.at);
	const land = local(drop);

	// "every frame a different shape": a new mesh on every beat to the end.
	const shapes: MeshName[] = [
		"knot",
		"torus",
		"sphere",
		"column",
		"knot",
		"torus",
	];
	const shapeTakes: Take[] = [];
	for (let f = local(every), k = 0; f < len; f += BEAT, k++)
		shapeTakes.push({
			mesh: shapes[k % shapes.length],
			mode: "radial_pulse",
			at: f,
			until: Math.min(len, f + BEAT),
			amp: 1.4,
			color: k % 2 ? FG : ACCENT,
			rotateX: 20,
		});
	const takes: Take[] = [
		{
			mesh: "sphere",
			mode: "harmonic_wave",
			at: 0,
			until: local(warp),
			amp: 2.2,
			color: ACCENT,
		},
		{
			mesh: "sphere",
			mode: "normal_extrusion",
			at: local(warp),
			until: local(ripple),
			amp: 2.6,
			color: ACCENT,
		},
		{
			mesh: "torus",
			mode: "ripple",
			at: local(ripple),
			until: local(twist),
			amp: 2,
			color: FG,
			rotateX: -62,
		},
		{
			mesh: "column",
			mode: "twist",
			at: local(twist),
			until: local(every),
			amp: 1.6,
			color: ACCENT,
		},
		...shapeTakes,
	];

	const cam = CameraAnimation.camera()
		.orbit({
			azimuth: { from: -18, to: 8 },
			elevation: { from: 14, to: 10 },
			radius: { from: 1500, to: 1050 },
			start: 0,
			end: local(ripple),
			ease: "sine.inOut",
		})
		.orbit({
			azimuth: { from: 8, to: -10 },
			elevation: { from: 10, to: 30 },
			radius: { from: 1050, to: 1250 },
			start: local(ripple) + 1,
			end: local(fold),
			ease: "sine.inOut",
		})
		// "fold the space": crane over the column as it winds.
		.orbit({
			azimuth: { from: -10, to: 20 },
			elevation: { from: 30, to: 8 },
			radius: { from: 1250, to: 1000 },
			start: local(fold) + 1,
			end: len,
			ease: EASE_OUT,
		});

	const lines = [drop, warp, ripple, every].map((w) => lineWords(w.line));
	const lineEnds = [local(warp), local(ripple), local(every), len];

	return scene(
		"warp",
		from,
		to,
		[
			Layer.camera({
				id: "warp-cam",
				targetX: CX,
				targetY: CY,
				targetZ: 0,
				animation: cam,
			} as never),
			Layer.directionalLight({
				id: "warp-key",
				color: "#FFFFFF",
				intensity: 1.1,
				direction: [-0.5, 0.6, 1],
			} as never),
			Layer.ambientLight({
				id: "warp-fill",
				color: "#FFFFFF",
				intensity: 0.5,
			} as never),
			// "Drop a mesh": the first one falls onto the stage.
			Layer.box({
				id: "warp-drop",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				transformStyle: "preserve-3d",
				children: takes.map(warped),
			} as never).animate(
				keys("y", [
					[0, -1100],
					[land, 0, EASE_IN],
				]),
			),
			plane("warp-impact", BG).animate(flashes([{ at: land, peak: 0.6 }], 12)),
			...lines.map((ws, i) =>
				sungLine({
					id: `warp-line-${i}`,
					words: ws,
					from,
					y: H - 200,
					size: 84,
					colors: ws.map((w) =>
						["bend,", "bass,", "twist", "shape."].includes(w.text)
							? ACCENT
							: undefined,
					),
					outAt: lineEnds[i] - 4 < len - 6 ? lineEnds[i] - 4 : undefined,
				}),
			),
		],
		{ background: BG },
	);
}
