/**
 * The files `framefields init` writes: the project layout the framefields
 * setup skill describes. `film.ts` only builds; `render.ts` renders frames,
 * a grid, the live preview or the video; `theme.ts` holds the numbers.
 */

/**
 * Packages with install scripts. framefields needs exactly one (skia-canvas
 * downloads its native binary); the others work without theirs.
 */
const ALLOWED_SCRIPTS = ["skia-canvas"];
const DENIED_SCRIPTS = [
	"sharp",
	"webgpu",
	"onnxruntime-node",
	"node-av",
	"esbuild",
	"protobufjs",
];

/** Dev tools the scripts use, at versions the scaffold is tested with. */
export const DEV_DEPENDENCIES: Record<string, string> = {
	"@types/node": "^24.1.0",
	tsx: "^4.20.3",
	typescript: "^5.8.3",
};

export const SCRIPTS: Record<string, string> = {
	typecheck: "tsc --noEmit -p .",
	check: "tsc --noEmit -p . && framefields check src/film.ts --json",
	"check:render":
		"tsc --noEmit -p . && framefields check src/film.ts --render --json",
	frames: "tsx src/render.ts frames",
	grid: "tsx src/render.ts grid",
	preview: "tsx src/render.ts preview",
	render: "tsx src/render.ts",
};

/**
 * The `package.json` fields a framefields project needs. npm reads
 * `allowScripts`, pnpm its `pnpm` block, bun `trustedDependencies`.
 */
export function packageFields(o: {
	framefieldsVersion: string;
	packageManager?: string;
}) {
	return {
		type: "module",
		...(o.packageManager && { packageManager: o.packageManager }),
		scripts: SCRIPTS,
		dependencies: { framefields: `^${o.framefieldsVersion}` },
		devDependencies: DEV_DEPENDENCIES,
		allowScripts: Object.fromEntries([
			...ALLOWED_SCRIPTS.map((p) => [p, true]),
			...DENIED_SCRIPTS.map((p) => [p, false]),
		]),
		pnpm: {
			onlyBuiltDependencies: ALLOWED_SCRIPTS,
			ignoredBuiltDependencies: DENIED_SCRIPTS,
		},
		trustedDependencies: ALLOWED_SCRIPTS,
	};
}

export const TSCONFIG = `${JSON.stringify(
	{
		compilerOptions: {
			module: "NodeNext",
			moduleResolution: "NodeNext",
			target: "ES2022",
			strict: true,
			skipLibCheck: true,
			noEmit: true,
			types: ["node"],
		},
		include: ["src/**/*"],
	},
	null,
	"\t",
)}\n`;

/** Lines `init` makes sure `.gitignore` has. */
export const GITIGNORE = [
	"node_modules/",
	"output/",
	"scratch/",
	".DS_Store",
	".env",
];

/** Where the AI gateway's keys come from. */
export const AI_DASHBOARD = "https://framefields.dev/dashboard";

/** Optional settings; `render.ts` loads `.env` when there is one. Commit this, not `.env`. */
export const ENV_EXAMPLE = `# Copy to .env (git-ignored). Everything here is optional.

# framefields AI gateway: generate images, video, music, voice and 3D from code.
# Create a key at ${AI_DASHBOARD}
FRAMEFIELDS_API_KEY=
`;

/** Media, LUTs and fonts go to Git LFS; renders stay out of Git. */
export const GITATTRIBUTES = [
	"assets/**/*.mp4 filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.mov filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.webm filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.mp3 filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.wav filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.cube filter=lfs diff=lfs merge=lfs -text",
	"assets/**/*.lottie filter=lfs diff=lfs merge=lfs -text",
	"assets/fonts/**/*.ttf filter=lfs diff=lfs merge=lfs -text",
	"assets/fonts/**/*.otf filter=lfs diff=lfs merge=lfs -text",
];

export const THEME_TS = `import { registerFonts as registerInstalledFonts } from "./components/fonts.js";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const INK = "#0E0D0C";
export const PAPER = "#EEE9E0";
/** Installed by \`framefields init\` (assets/fonts), registered below. */
export const SANS = "Inter";
export const MONO = "JetBrains Mono";

/**
 * Register the film's fonts. Fonts framefields installed
 * (\`npx framefields fonts add <role>\`) come from the generated
 * components/fonts.ts; register any others here with \`FontManager.register\`.
 */
export async function registerFonts(): Promise<void> {
	await registerInstalledFonts();
}
`;

export const FILM_TS = `import { Composition, Layer, LayerAnimation } from "framefields";
import { FPS, H, INK, PAPER, registerFonts, SANS, W } from "./theme.js";

const DURATION = 3 * FPS; // frames

/** Builds the film. Only builds: no rendering or writes, so tests, the preview and renders share it. */
export async function buildFilm(): Promise<Composition> {
	// Fonts must be registered before any text layer is built.
	await registerFonts();

	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: INK,
	});

	film.add(
		Layer.text("Hello, framefields", {
			id: "title",
			position: "absolute",
			x: 0,
			y: H / 2 - 60,
			width: W,
			height: 120,
			fontFamily: SANS,
			fontSize: 96,
			fontWeight: 700,
			fill: PAPER,
			align: "center",
		}).animate(
			LayerAnimation.create()
				.fadeIn(0, 20, "power2.out")
				.fromTo("y", H / 2 - 20, H / 2 - 60, {
					start: 0,
					end: 30,
					ease: "expo.out",
				}),
		),
	);

	return film;
}
`;

export const RENDER_TS = `import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer, frameCount, startPreview } from "framefields";
import { buildFilm } from "./film.js";

// Optional settings such as FRAMEFIELDS_API_KEY (see .env.example).
const ENV = path.resolve(import.meta.dirname, "../.env");
if (existsSync(ENV)) process.loadEnvFile(ENV);

const OUT = path.resolve(import.meta.dirname, "../output");
// \`npm run frames -- 0 30\` needs the \`--\`; pnpm passes it through: drop it.
const [mode = "video", ...args] = process.argv
	.slice(2)
	.filter((a) => a !== "--");

if (mode === "preview") {
	// The page runs film.ts itself and renders it with WebGPU in the browser.
	const session = await startPreview({
		entry: new URL("./film.ts", import.meta.url),
		export: "buildFilm",
	});
	console.log(\`Preview at \${session.url}\`);
	await session.closed; // until its tab closes or the next preview replaces it
	process.exit(0);
}

const film = await buildFilm();
await fs.mkdir(OUT, { recursive: true });

if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	for (const frame of (args.length ? args : ["0"]).map(Number)) {
		const png = await film.renderFrame({ frame, renderer });
		const file = path.join(OUT, \`f\${String(frame).padStart(4, "0")}.png\`);
		await fs.writeFile(file, png);
		console.log(\`Wrote \${path.relative(process.cwd(), file)}\`);
	}
} else if (mode === "grid") {
	const png = await film.renderFrameGrid({
		frames: args.length ? args.map(Number) : [...new Set([0, Math.floor((frameCount(film.durationMs ?? await film.computeDuration(), film.fps) - 1) / 2), frameCount(film.durationMs ?? await film.computeDuration(), film.fps) - 1])],
		columns: 4,
		cellWidth: 480,
		showLabels: true,
	});
	await fs.writeFile(path.join(OUT, "grid.png"), png);
	console.log("Wrote output/grid.png");
} else {
	const result = await film.renderVideo({
		outputPath: path.join(OUT, "output.mp4"),
		quality: "high",
	});
	await result.cleanup?.();
	console.log(\`Exported \${result.filePath}\`);
}

// Native GPU and encoder threads keep Node alive; always exit explicitly.
process.exit(0);
`;

export function readme(name: string, run: (script: string) => string): string {
	return `# ${name}

A film built with [framefields](https://www.npmjs.com/package/framefields).

\`\`\`bash
${run("typecheck")}
${run("frames")} -- 0 30 60   # PNGs in output/
${run("grid")}                # a contact sheet of the motion
${run("preview")}             # play it in the browser
${run("render")}              # output/output.mp4
\`\`\`

- \`src/film.ts\` builds the composition, \`src/theme.ts\` holds sizes, colors and fonts,
  \`src/render.ts\` renders it.
- \`npx framefields list\` shows ready-made components; \`npx framefields add <name>\` copies
  one into \`src/components/\`.
- Optional: the AI gateway generates images, video, music, voice and 3D from code. Copy
  \`.env.example\` to \`.env\` and set \`FRAMEFIELDS_API_KEY\` (keys at ${AI_DASHBOARD}).
- Footage, audio and fonts live in \`assets/\` and are tracked with Git LFS
  (\`git lfs install\` once per machine, \`git lfs pull\` after cloning).
`;
}
