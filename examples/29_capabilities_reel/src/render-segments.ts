/**
 * pnpm render:segments → output/capabilities-reel.mp4
 *
 * A single long renderVideo of this reel grows GPU memory until macOS kills the process near the
 * end, so the picture is rendered in a few fresh processes instead, each one a run of frames
 * piped to ffmpeg. Segments split where chapters cut (no transition), so nothing stateful —
 * particles, trails, vision — straddles a boundary. The audio is mixed once by framefields (the
 * stems through the audio nodes) and muxed on at the end.
 *
 *   tsx src/render-segments.ts                 all segments, then concat + mux
 *   tsx src/render-segments.ts segment 720 1140 out.mp4   one run (used by the parent)
 *   tsx src/render-segments.ts audio out.wav   only the mix
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Composition, HeadlessMediaRenderer } from "framefields";
import { mix } from "./film.js";
import { OUTPUT } from "./paths.js";
import { FPS, H, INK, registerFonts, W } from "./theme.js";
import { chapter, TOTAL_FRAMES } from "./timeline.js";

const SELF = fileURLToPath(import.meta.url);
const DIR = path.join(OUTPUT, "segments");
const [mode = "all", ...args] = process.argv.slice(2);

function run(
	cmd: string,
	argv: string[],
	input?: (stdin: NodeJS.WritableStream) => Promise<void>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, argv, {
			stdio: [input ? "pipe" : "ignore", "inherit", "inherit"],
		});
		child.on("error", reject);
		child.on("exit", (code, sig) =>
			code === 0
				? resolve()
				: reject(new Error(`${cmd} exited ${code ?? sig}`)),
		);
		if (input && child.stdin)
			input(child.stdin).then(() => child.stdin?.end(), reject);
	});
}

async function segment(from: number, to: number, out: string): Promise<void> {
	const { buildFilm } = await import("./film.js");
	const comp = await buildFilm();
	const renderer = new HeadlessMediaRenderer();
	const started = Date.now();
	await run(
		"ffmpeg",
		[
			"-y",
			"-v",
			"error",
			"-f",
			"image2pipe",
			"-framerate",
			String(FPS),
			"-c:v",
			"png",
			"-i",
			"-",
			"-c:v",
			"libx264",
			"-preset",
			"medium",
			"-crf",
			"15",
			"-pix_fmt",
			"yuv420p",
			"-r",
			String(FPS),
			out,
		],
		async (stdin) => {
			for (let f = from; f < to; f++) {
				const png = await comp.renderFrame({ frame: f, renderer });
				if (!stdin.write(png)) await new Promise((r) => stdin.once("drain", r));
				if ((f - from) % 60 === 0)
					console.log(
						`  frame ${f} (${((Date.now() - started) / 1000).toFixed(0)} s)`,
					);
			}
		},
	);
}

async function audio(out: string): Promise<void> {
	await registerFonts();
	// The same mix the film uses, over black frames: framefields renders the audio graph.
	const comp = new Composition({
		width: 320,
		height: 180,
		fps: FPS,
		durationFrames: TOTAL_FRAMES,
		backgroundColor: INK,
	});
	mix(comp);
	const tmp = path.join(DIR, "audio-carrier.mp4");
	const r = await comp.renderVideo({
		outputPath: tmp,
		quality: "draft",
		qa: { targetLufs: -14 },
	});
	await r.cleanup?.().catch(() => {});
	if (r.qa)
		console.log(
			`  audio: ${r.qa.audio?.integratedLufs?.toFixed(1)} LUFS, peak ${r.qa.audio?.peakDbfs?.toFixed(1)} dBFS`,
		);
	await run("ffmpeg", [
		"-y",
		"-v",
		"error",
		"-i",
		tmp,
		"-vn",
		"-c:a",
		"pcm_s16le",
		out,
	]);
}

if (mode === "segment") {
	await segment(Number(args[0]), Number(args[1]), args[2]);
} else if (mode === "audio") {
	await audio(args[0]);
} else {
	fs.mkdirSync(DIR, { recursive: true });
	// Split at chapters that open on a hard cut (or whose predecessor holds no state).
	const cuts = [
		0,
		chapter("stylize").start,
		chapter("vision").start,
		chapter("nodes").start,
		TOTAL_FRAMES,
	];
	const parts: string[] = [];
	const started = Date.now();
	for (let i = 0; i < cuts.length - 1; i++) {
		const out = path.join(DIR, `part-${i}.mp4`);
		console.log(`segment ${i}: frames ${cuts[i]}–${cuts[i + 1] - 1}`);
		await run("npx", [
			"tsx",
			SELF,
			"segment",
			String(cuts[i]),
			String(cuts[i + 1]),
			out,
		]);
		parts.push(out);
	}
	const wav = path.join(DIR, "mix.wav");
	console.log("audio mix");
	await run("npx", ["tsx", SELF, "audio", wav]);
	const list = path.join(DIR, "parts.txt");
	fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
	const final = path.join(OUTPUT, "capabilities-reel.mp4");
	await run("ffmpeg", [
		"-y",
		"-v",
		"error",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		list,
		"-i",
		wav,
		"-map",
		"0:v",
		"-map",
		"1:a",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"256k",
		"-shortest",
		"-movflags",
		"+faststart",
		final,
	]);
	console.log(
		`${final} (${((Date.now() - started) / 1000).toFixed(0)} s, ${W}x${H})`,
	);
}
process.exit(0);
