/**
 * Memory probe: renders frames in order and samples the process footprint (which, unlike RSS,
 * counts Metal / IOAccelerator allocations) every `every` frames.
 *
 *   tsx src/mem-probe.ts film <from> <to> [every]     the real film
 *   tsx src/mem-probe.ts stress <case> <frames> [every]  one suspect in isolation
 */
import { execSync } from "node:child_process";
import { Composition, HeadlessMediaRenderer, Layer } from "framefields";
import { buildFilm } from "./film.js";
import { DANCER, emoji, lottie } from "./paths.js";
import { FONT_FILES, FPS, H, registerFonts, W } from "./theme.js";

const [mode, a, b, c] = process.argv.slice(2);

const toMb = (v: string, u: string) =>
	Number(v) *
	({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 } as Record<string, number>)[
		u
	];

/** Footprint and its top categories (dirty MB). */
function footprint(): { total: number; top: string } {
	const out = execSync(`footprint -p ${process.pid}`, { encoding: "utf8" });
	const total = out.match(/phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/);
	const cats: Array<[string, number]> = [];
	for (const m of out.matchAll(
		/^\s*([\d.]+)\s+(B|KB|MB|GB)\s+[\d.]+\s+(?:B|KB|MB|GB)\s+[\d.]+\s+(?:B|KB|MB|GB)\s+\d+\s+(.+)$/gm,
	)) {
		if (m[3].trim() !== "TOTAL") cats.push([m[3].trim(), toMb(m[1], m[2])]);
	}
	cats.sort((x, y) => y[1] - x[1]);
	return {
		total: total ? toMb(total[1], total[2]) : 0,
		top: cats
			.slice(0, 3)
			.map(([n, v]) => `${n}=${v.toFixed(0)}`)
			.join(" "),
	};
}

function stress(kind: string, frames: number): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: frames,
		backgroundColor: "#000",
		fonts: FONT_FILES,
	});
	const full = {
		position: "absolute" as const,
		x: 0,
		y: 0,
		width: W,
		height: H,
	};
	if (kind === "particles") {
		comp.add(
			Layer.particles({
				...full,
				max: 30000,
				emitter: { shape: "ring", x: W / 2, y: H / 2, radius: 600, rate: 4000 },
				lifetime: [1, 2],
				speed: [60, 140],
				spread: 360,
				size: [5, 2],
				shape: "spark",
				blend: "add",
				color: ["#0ff", "#f0f"],
			} as never),
		);
	} else if (kind === "videos-seq") {
		// A new video layer every 8 frames (like the montage / beat-switched looks).
		for (let k = 0; k * 8 < frames; k++)
			comp.add(
				Layer.video(DANCER, {
					...full,
					fit: "cover",
					muted: true,
					startFrame: k * 8,
					durationFrames: 8,
					trimStartSec: ((k * 8) / 30) % 5,
				}),
			);
	} else if (kind === "videos-same") {
		// Eight video layers of the same clip alive at once.
		for (let k = 0; k < 8; k++)
			comp.add(
				Layer.video(DANCER, {
					position: "absolute",
					x: (k % 4) * 480,
					y: Math.floor(k / 4) * 540,
					width: 480,
					height: 540,
					fit: "cover",
					muted: true,
					trimStartSec: k * 0.3,
				}),
			);
	} else if (kind === "video-one") {
		comp.add(Layer.video(DANCER, { ...full, fit: "cover", muted: true }));
	} else if (kind === "lotties") {
		const names = [
			"fireworks",
			"dogCar",
			"gatin",
			"growth",
			"cactus",
			"happy2016",
			"squares",
			"navidad",
		];
		names.forEach((n, i) => {
			comp.add(
				Layer.lottie(lottie(n), {
					position: "absolute",
					x: (i % 4) * 480,
					y: Math.floor(i / 4) * 540,
					width: 480,
					height: 540,
					fit: "cover",
				}),
			);
		});
	} else if (kind === "emoji") {
		const names = [
			"fire",
			"rocket",
			"heartEyes",
			"party",
			"starStruck",
			"unicorn",
			"robot",
			"rainbow",
			"cool",
			"alien",
			"gem",
			"brain",
			"globe",
			"popcorn",
			"rofl",
			"inLove",
			"octopus",
			"trophy",
			"zap",
			"eyes",
		];
		names.forEach((n, i) => {
			comp.add(
				Layer.lottie(emoji(n), {
					position: "absolute",
					x: (i % 5) * 380,
					y: Math.floor(i / 5) * 270,
					width: 160,
					height: 160,
				}),
			);
		});
	} else if (kind === "image" || kind === "image-moving") {
		const img = Layer.image(`${DANCER.replace("dancer.mp4", "dancer.png")}`, {
			...full,
			fit: "cover",
		});
		comp.add(kind === "image" ? img : img.animate({ tracks: [] } as never));
	} else if (kind === "video-frozen") {
		comp.add(Layer.video(DANCER, { ...full, fit: "cover", muted: true }));
	} else if (kind === "baseline") {
		comp.add(Layer.text("baseline", { ...full, fontSize: 100, fill: "#fff" }));
	} else throw new Error(`unknown case ${kind}`);
	return comp;
}

let comp: Composition;
let from = 0;
let to: number;
const every = Number(c ?? 30);
if (mode === "film") {
	comp = await buildFilm();
	from = Number(a);
	to = Number(b);
} else {
	await registerFonts();
	to = Number(b);
	comp = stress(a, to);
}
if (process.env.VIA === "video") {
	// Through renderVideo (the export path), sampling as frames finish.
	let next = every;
	const r = await comp.renderVideo({
		outputPath: `/tmp/mem-probe-${process.pid}.mp4`,
		quality: "draft",
		onProgress: (p: {
			phase?: string;
			frame?: number;
			framesDone?: number;
		}) => {
			const f = p.framesDone ?? p.frame ?? 0;
			if (f >= next) {
				next += every;
				const m = footprint();
				console.log(
					`frame ${f} total=${m.total.toFixed(0)}MB [${m.top}] ext=${(process.memoryUsage().external / 1048576).toFixed(0)}MB`,
				);
			}
		},
	} as never);
	await r.cleanup?.();
	process.exit(0);
}
const renderer = new HeadlessMediaRenderer();
const t0 = footprint();
console.log(`start total=${t0.total.toFixed(0)}MB ${t0.top}`);
for (let f = from; f < to; f++) {
	await comp.renderFrame({
		frame: mode === "stress" && a === "video-frozen" ? 0 : f,
		renderer,
	});
	if (process.env.GC) (globalThis as { gc?: () => void }).gc?.();
	if ((f - from + 1) % every === 0) {
		const m = footprint();
		const heap = process.memoryUsage();
		console.log(
			`frame ${f} total=${m.total.toFixed(0)}MB [${m.top}] rss=${(heap.rss / 1048576).toFixed(0)}MB heap=${(heap.heapUsed / 1048576).toFixed(0)}MB ext=${(heap.external / 1048576).toFixed(0)}MB`,
		);
	}
}
process.exit(0);
