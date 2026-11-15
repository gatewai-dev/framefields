/// <reference lib="dom" />
/**
 * The page's entry: the composition (for the player) and, in the browser,
 * the app around it: a real-time loop that advances the simulation with the
 * wall clock and draws each frame, joint sliders and keys, an orbit camera
 * dragged with the mouse, and the task's progress.
 */
import { controls, drag, FPS, FRAMES, restartDemo, world } from "./scene.js";
import { CLOSED, HOME, JOINTS, OPEN } from "./so101.js";
import * as task from "./task.js";

export { default } from "./scene.js";

/** What the page needs of the player `window.framefieldsPlayer` resolves to. */
interface Player {
	canvas: HTMLCanvasElement;
	render(frame: number, options?: { cache?: boolean }): Promise<number>;
	lastRenderMs: number;
}

const $ = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;

/** Hands the arm to the page: the demo stops where it is. */
function takeOver() {
	controls.demo = false;
	$<HTMLInputElement>("demo").checked = false;
}

function sliders(): Array<(value: number) => void> {
	const box = $("joints");
	return JOINTS.map((joint, i) => {
		const row = document.createElement("label");
		row.className = "joint";
		const name = document.createElement("span");
		name.textContent = joint.label;
		const input = document.createElement("input");
		input.type = "range";
		input.min = String(joint.min);
		input.max = String(joint.max);
		input.step = String((joint.max - joint.min) / 400);
		const value = document.createElement("output");
		const show = (v: number) => {
			input.value = String(v);
			value.textContent =
				joint.name === "gripper"
					? `${Math.round(((v - joint.min) / (joint.max - joint.min)) * 100)}%`
					: `${Math.round((v * 180) / Math.PI)}°`;
		};
		input.addEventListener("input", () => {
			takeOver();
			controls.targets[i] = Number(input.value);
			show(controls.targets[i]);
		});
		show(controls.targets[i]);
		row.append(name, input, value);
		box.append(row);
		return show;
	});
}

/** Keys nudge a joint each frame they are held: Q/A, W/S, E/D, R/F, T/G; space opens or closes the jaw. */
const KEYS: Record<string, [number, number]> = {
	q: [0, 1],
	a: [0, -1],
	w: [1, -1],
	s: [1, 1],
	e: [2, -1],
	d: [2, 1],
	r: [3, -1],
	f: [3, 1],
	t: [4, 1],
	g: [4, -1],
};

function setUpInput(show: Array<(v: number) => void>, held: Set<string>) {
	window.addEventListener("keydown", (e) => {
		if (e.target instanceof HTMLInputElement && e.target.type !== "range")
			return;
		const key = e.key.toLowerCase();
		if (key === " ") {
			takeOver();
			const grip = JOINTS.length - 1;
			controls.targets[grip] =
				controls.targets[grip] > (CLOSED + OPEN) / 2 ? CLOSED : OPEN;
			show[grip](controls.targets[grip]);
			e.preventDefault();
		} else if (KEYS[key]) held.add(key);
	});
	window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));

	const canvas = $("canvas");
	let orbit: { x: number; y: number } | undefined;
	canvas.addEventListener("pointerdown", (e) => {
		orbit = { x: e.clientX, y: e.clientY };
	});
	canvas.addEventListener("pointermove", (e) => {
		// Holding an object: the pointer pulls it instead of turning the camera.
		if (!orbit || drag?.grabbed) return;
		const { camera } = controls;
		camera.yaw += (e.clientX - orbit.x) * 0.3;
		camera.pitch = Math.max(
			3,
			Math.min(80, camera.pitch + (e.clientY - orbit.y) * 0.25),
		);
		orbit = { x: e.clientX, y: e.clientY };
	});
	canvas.addEventListener("pointerup", () => {
		orbit = undefined;
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			const { camera } = controls;
			camera.distance = Math.max(
				500,
				Math.min(4000, camera.distance * Math.exp(e.deltaY * 0.001)),
			);
			e.preventDefault();
		},
		{ passive: false },
	);
}

/** Moves held keys' joints, within their ranges. */
function nudge(held: Set<string>, show: Array<(v: number) => void>) {
	for (const key of held) {
		const [i, dir] = KEYS[key];
		const { min, max } = JOINTS[i];
		takeOver();
		controls.targets[i] = Math.max(
			min,
			Math.min(max, controls.targets[i] + dir * 0.03),
		);
		show[i](controls.targets[i]);
	}
}

/**
 * Reloads the page when the server restarts (`pnpm dev` restarts it on every
 * edit): each server greets the page with its own session.
 */
function reloadOnRestart() {
	let session: string | undefined;
	new EventSource("/events").addEventListener("hello", (e) => {
		const next = (JSON.parse((e as MessageEvent).data) as { session: string })
			.session;
		if (session && next !== session) location.reload();
		session = next;
	});
}

function header() {
	$("title").textContent = task.TITLE;
	$("about").textContent = task.ABOUT;
}

/** What is in the scene, each with a swatch of its color. */
function legend() {
	const list = $("things");
	for (const thing of task.THINGS) {
		const item = document.createElement("li");
		const swatch = document.createElement("span");
		swatch.className = "swatch";
		swatch.style.background = thing.color;
		item.append(swatch, thing.label);
		list.append(item);
	}
}

async function start() {
	reloadOnRestart();
	header();
	legend();
	// For the devtools console: `robotLab.world.body("gripper", frame)`, `robotLab.controls`.
	Object.assign(window, {
		robotLab: {
			controls,
			get world() {
				return world;
			},
		},
	});
	const show = sliders();
	const held = new Set<string>();
	setUpInput(show, held);
	const status = $("status");
	// The player starts once this module has run: wait for it.
	const page = window as unknown as { framefieldsPlayer?: Promise<Player> };
	const player = await (page.framefieldsPlayer ??
		new Promise<Player>((resolve, reject) =>
			addEventListener(
				"framefields:player",
				() => page.framefieldsPlayer?.then(resolve, reject),
				{ once: true },
			),
		));
	$("loading").remove();

	let frame = 0;
	let paused = false;
	let clock = performance.now();
	let drawn = 0;
	let since = performance.now();
	let since0 = 0;
	const demoBox = $<HTMLInputElement>("demo");
	demoBox.checked = controls.demo;
	demoBox.addEventListener("change", () => {
		if (demoBox.checked) restartDemo();
		else takeOver();
	});
	$("home").addEventListener("click", () => {
		takeOver();
		controls.targets = [...HOME];
		HOME.forEach((v, i) => {
			show[i](v);
		});
	});
	$("pause").addEventListener("click", (e) => {
		paused = !paused;
		(e.target as HTMLButtonElement).textContent = paused ? "Play" : "Pause";
		clock = performance.now();
	});
	$("reset").addEventListener("click", () => location.reload());

	const tick = async () => {
		const now = performance.now();
		if (!paused && frame < FRAMES - 1) {
			// The simulation keeps the wall clock's pace, a frame at a time;
			// when stepping and drawing fall behind, it slows down instead of
			// skipping.
			if (now - clock >= 1000 / FPS) {
				clock = Math.max(clock + 1000 / FPS, now - 1000 / FPS);
				frame++;
				nudge(held, show);
			}
		}
		await player.render(frame, { cache: false });
		drawn++;
		if (now - since > 500) {
			const pace = (frame - since0) / FPS / ((now - since) / 1000);
			const fps = (drawn * 1000) / (now - since);
			drawn = 0;
			since = now;
			since0 = frame;
			demoBox.checked = controls.demo;
			if (controls.demo)
				for (const [i, v] of controls.targets.entries()) show[i](v);
			status.textContent = [
				world ? task.metric(world, frame) : "",
				`Holding: ${drag?.grabbed ?? "nothing"}`,
				"",
				`${fps.toFixed(0)} fps · frame ${player.lastRenderMs.toFixed(1)} ms`,
				`sim ${(frame / FPS).toFixed(1)} s${paused ? " (paused)" : pace < 0.95 ? ` (${pace.toFixed(2)}× real time)` : ""}`,
			].join("\n");
		}
		requestAnimationFrame(() => void tick());
	};
	void tick();
}

// The preview server also loads this module in Node, where the renderer's
// stand-in `document` has no DOM: start only on the page.
if (
	typeof document !== "undefined" &&
	typeof document.getElementById === "function" &&
	document.getElementById("joints")
)
	start().catch((error: unknown) => {
		$("loading").textContent =
			`Could not start: ${error instanceof Error ? error.message : String(error)}`;
	});
