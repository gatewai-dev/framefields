/// <reference lib="dom" />
/**
 * The page's entry: the game (for the player) and, in the browser, the loop
 * that plays it in real time. Input reaches the game through the player,
 * which feeds the composition's `input` from the canvas and the keyboard;
 * the page only keeps the keys from scrolling it and starts over on R.
 */
import { FPS, FRAMES } from "./game.js";

export { default } from "./game.js";

/** What the page needs of the player `window.framefieldsPlayer` resolves to. */
interface Player {
	render(frame: number, options?: { cache?: boolean }): Promise<number>;
}

async function start() {
	const page = window as unknown as { framefieldsPlayer?: Promise<Player> };
	const player = await (page.framefieldsPlayer ??
		new Promise<Player>((resolve, reject) =>
			addEventListener(
				"framefields:player",
				() => page.framefieldsPlayer?.then(resolve, reject),
				{ once: true },
			),
		));
	document.getElementById("loading")?.remove();
	window.addEventListener("keydown", (e) => {
		if (
			["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
				e.code,
			)
		)
			e.preventDefault();
		if (e.code === "KeyR") location.reload();
	});
	// Restart the page when the server does (`pnpm dev` restarts on edits).
	let session: string | undefined;
	new EventSource("/events").addEventListener("hello", (e) => {
		const next = (JSON.parse((e as MessageEvent).data) as { session: string })
			.session;
		if (session && next !== session) location.reload();
		session = next;
	});

	let frame = 0;
	let clock = performance.now();
	const tick = async () => {
		const now = performance.now();
		// One simulation frame per 1/FPS of wall clock; slower, never skipping.
		if (now - clock >= 1000 / FPS && frame < FRAMES - 1) {
			clock = Math.max(clock + 1000 / FPS, now - 1000 / FPS);
			frame++;
		}
		await player.render(frame, { cache: false });
		requestAnimationFrame(() => void tick());
	};
	void tick();
}

// The preview server also loads this module in Node: start only on the page.
if (
	typeof document !== "undefined" &&
	typeof document.getElementById === "function" &&
	document.getElementById("canvas")
)
	start().catch((error: unknown) => {
		const box = document.getElementById("loading");
		if (box)
			box.textContent = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
	});
