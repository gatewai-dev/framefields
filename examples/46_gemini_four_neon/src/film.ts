/**
 * Gemini 4 Neon — Light-Speed Intelligence (20.0s · 600 frames · 1080p · 30 fps)
 *
 * Five choreographed WebGPU acts sequenced on a 120 BPM musical grid:
 *   1. The Neon Singularity  (0–4s)   WGSL caustics, sculpted 3D Gemini Star Prism, GPU sparks
 *   2. Deep Reasoning        (4–8s)   1,800-node morphing 3D tensor lattice, 10M context & chart
 *   3. Agentic Execution     (8–12s)  Floating 3D glass IDE streaming code → live 3D SDF manifold
 *   4. Omni-Modal & Physics  (12–16s) Voronoi 3D physics shatter, GPU shard swarm, audio equalizer
 *   5. Hero Lockup           (16–20s) 1,500-shard swarm convergence into Gemini Star & end card
 */
import { existsSync } from "node:fs";
import {
	Composition,
	FilmGrain,
	Layer,
	LayerAnimation,
	type LayoutNode,
	RGBSplit,
	Signal,
	Transition,
	Vignette,
} from "framefields";
import { registerFonts } from "./fonts.js";
import { scene1Ignition } from "./scenes/scene1-ignition.js";
import { scene2Reasoning } from "./scenes/scene2-reasoning.js";
import { scene3Agentic } from "./scenes/scene3-agentic.js";
import { scene4Omnimodal } from "./scenes/scene4-omnimodal.js";
import { scene5Finale } from "./scenes/scene5-finale.js";
import {
	BEAT,
	DURATION,
	FPS,
	H,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	SCORE_PATH,
	TRANSITION_FRAMES,
	W,
} from "./theme.js";

export { DURATION };

/** Brief screen-blended optical flash on major musical drops. */
function impactFlash(
	id: string,
	at: number,
	color: string,
	peak: number,
): LayoutNode {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: color,
		blendMode: "screen",
		opacity: 0,
		startFrame: Math.max(0, at - 1),
		durationFrames: 16,
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[2, peak, "power2.out"],
			[15, 0, "power2.out"],
		]),
	) as LayoutNode;
}

/** Smooth 10-frame opening reveal and 10-frame closing blackout (avoids black_frames QA). */
function bookendFades(): LayoutNode {
	return Layer.box({
		id: "global-bookend-fade",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "#000000",
		startFrame: 0,
		durationFrames: DURATION,
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0.92],
			[10, 0, "sine.out"],
			[BEAT.fadeOut, 0],
			[DURATION - 1, 0.96, "sine.in"],
		]),
	) as LayoutNode;
}

export async function buildFilm(): Promise<Composition> {
	const fonts = await registerFonts();
	const omnimodalScene = await scene4Omnimodal();

	const sequence = Layer.sequence(
		[
			{ scene: scene1Ignition(), duration: SCENE_DURATIONS.ignition },
			{
				scene: scene2Reasoning(),
				duration: SCENE_DURATIONS.reasoning,
				transition: Transition.zoom(TRANSITION_FRAMES, "expo.inOut"),
			},
			{
				scene: scene3Agentic(),
				duration: SCENE_DURATIONS.agentic,
				transition: Transition.whip("left", TRANSITION_FRAMES),
			},
			{
				scene: omnimodalScene,
				duration: SCENE_DURATIONS.omnimodal,
				transition: Transition.iris(TRANSITION_FRAMES, {
					at: [0.5, 0.45],
					ease: "expo.inOut",
				}),
			},
			{
				scene: scene5Finale(),
				duration: SCENE_DURATIONS.finale,
				transition: Transition.crossfade(TRANSITION_FRAMES, "sine.inOut"),
			},
		],
		{ id: "gemini-4-neon-sequence", width: W, height: H },
	);

	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: sequence.totalFrames,
		backgroundColor: PALETTE.void,
		fonts,
	});

	comp.add(sequence as LayoutNode);

	// Synchronized optical impact flashes on key musical drops.
	comp.add(impactFlash("flash-ignite", BEAT.ignite, "#B8F8FF", 0.24));
	comp.add(impactFlash("flash-lock", BEAT.latticeLock, "#A8D4FF", 0.14));
	comp.add(impactFlash("flash-pass", BEAT.buildPass, "#E6FF9E", 0.14));
	comp.add(impactFlash("flash-shatter", BEAT.shatter, "#FFD4F0", 0.28));
	comp.add(impactFlash("flash-star", BEAT.starLock, "#C8F5FF", 0.24));

	comp.add(bookendFades());

	// 48 kHz stereo synthesized soundtrack, locked to the exact visual beat grid.
	if (existsSync(SCORE_PATH)) {
		comp.add(
			Layer.audio(SCORE_PATH, {
				id: "gemini-score",
				volume: 1,
				startFrame: 0,
				durationFrames: sequence.totalFrames,
			}) as LayoutNode,
		);
	}

	// Subtle radial chromatic prism kick right on Ignition, Voronoi Shatter, and Star Lock.
	const prismKick = Signal.fromArray(
		Array.from(
			{ length: DURATION },
			(_, f) =>
				pulseAt(f, BEAT.ignite, 9) * 7.5 +
				pulseAt(f, BEAT.shatter, 11) * 11.5 +
				pulseAt(f, BEAT.starLock, 9) * 6.5,
		),
		FPS,
	);
	comp.apply(
		new RGBSplit({
			radial: true,
			amount: prismKick,
		}),
	);
	comp.apply(new Vignette({ strength: 28, radius: 1.06, softness: 0.58 }));
	comp.apply(new FilmGrain({ strength: 3.5, size: 1.1, monochrome: true }));

	return comp;
}
