import { Composition, Layer, LayerAnimation } from "framefields";
import { liveScene } from "./scenes/live.js";
import { marketScene } from "./scenes/market.js";
import { mixScene } from "./scenes/mix.js";
import { outroScene } from "./scenes/outro.js";
import { revenueScene } from "./scenes/revenue.js";
import { titleScene } from "./scenes/title.js";
import { registerSignals } from "./signals.js";
import { ACCENT, BG, FPS, H, registerFonts, W } from "./theme.js";
import { DURATION } from "./timeline.js";
import { backdrop } from "./ui.js";

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: BG,
	});
	// Signals first: layers bind to them by name.
	registerSignals(film);

	film.add([
		...backdrop(),
		titleScene(),
		revenueScene(),
		liveScene(),
		mixScene(),
		marketScene(),
		outroScene(),
		// A hairline progress bar along the bottom edge, linear over the whole film.
		Layer.box({
			id: "progress",
			position: "absolute",
			x: 0,
			y: H - 4,
			width: 0,
			height: 4,
			background: ACCENT,
		}).animate(
			LayerAnimation.create().fromTo("width", 0, W, {
				start: 0,
				end: DURATION,
				ease: "none",
			}),
		),
	]);
	return film;
}
