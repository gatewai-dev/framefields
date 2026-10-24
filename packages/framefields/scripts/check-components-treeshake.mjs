// Fails the build when components leak into the package or don't tree-shake
// (spec §9.5). Components are not in framefields: `framefields add` copies
// them from dist/registry. So: the dist carries no component code; each
// toolkit import pulls only what it uses; and each registry component,
// installed the way `add` writes it and bundled against the dist the way a
// user's bundler would, carries itself and what it builds on, within budget.
// Sizes are what an import adds on top of a baseline that already uses
// `Layer` (every framefields project does).
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const components = fileURLToPath(
	new URL("../dist/components/index.mjs", import.meta.url),
);
const registry = fileURLToPath(new URL("../dist/registry", import.meta.url));

// Strings that only exist in one module each.
const CONTRACT = "invalid props";
const STROKES = "wobble:";
const TARGETS = "has no absolute geometry";
const MOTION = "Unknown motion preset";
const POINTER = "hover regions must be static targets";
const FRAME = "Expected a layer, an array of layers, or a media path";
const CAMERA = "must be a static target.";
const REVEAL = "is not registered. Registered:";
const COUNTER = "Counter: unsupported format";
const ANNOTATE = "Moving targets arrive with Callout";
const GLYPHS = "L[k+1]-L[k]";
const CAPTIONS = "give `words` or a `transcript`";
const SHELL = "spinner-";
const CODE = "satisfies keyof declare";
const TITLE = "kicker";
const LOWER = "role-plate";
const METER = "Meter: give `value`";
const CHAT = "A message needs `text` or `image`.";
const TOAST = "bottom-center";
const CALLOUT = "leader-2";
const SPOT = "radial-gradient(closest-side, #ffffff ";
const CONFETTI = "sparkles-";
const LOGO = "LogoReveal: give a `mark`";
const BACKDROP = "radial-gradient(rgba(0,0,0,0) 45%";
const WAVE = "Waveform: the audio was analysed";
const WORDS = "width keys exceed the";
const DEVICE = "status-battery";
const TOUCH = "-ripple-";
const SPLIT = "before-clip";
const SELECT = "Selection: give";
const CARDS = "Expected a layer or { title";

/** Each component (by factory): a string only its module has, and what it may compose. */
const COMPONENTS = {
	MousePointer: { own: POINTER, uses: [], budget: 66_000 },
	AppFrame: { own: FRAME, uses: [], budget: 45_000 },
	FocusZoom: { own: CAMERA, uses: [], budget: 40_000 },
	TextReveal: { own: REVEAL, uses: [GLYPHS], budget: 58_000 },
	Counter: { own: COUNTER, uses: [], budget: 45_000 },
	Annotate: { own: ANNOTATE, uses: [], budget: 50_000 },
	Captions: { own: CAPTIONS, uses: [GLYPHS], budget: 55_000 },
	Terminal: { own: SHELL, uses: [FRAME, COUNTER], budget: 80_000 },
	CodeBlock: { own: CODE, uses: [FRAME], budget: 70_000 },
	TitleCard: { own: TITLE, uses: [REVEAL, GLYPHS], budget: 70_000 },
	LowerThird: { own: LOWER, uses: [], budget: 45_000 },
	Meter: { own: METER, uses: [COUNTER], budget: 55_000 },
	ChatThread: { own: CHAT, uses: [], budget: 50_000 },
	Toasts: { own: TOAST, uses: [], budget: 45_000 },
	Callout: { own: CALLOUT, uses: [], budget: 50_000 },
	Spotlight: { own: SPOT, uses: [], budget: 45_000 },
	Confetti: { own: CONFETTI, uses: [], budget: 45_000 },
	LogoReveal: { own: LOGO, uses: [GLYPHS], budget: 55_000 },
	Backdrop: { own: BACKDROP, uses: [], budget: 45_000 },
	Waveform: { own: WAVE, uses: [], budget: 50_000 },
	WordCycle: { own: WORDS, uses: [], budget: 45_000 },
	DeviceFrame: { own: DEVICE, uses: [], budget: 45_000 },
	TouchPoint: { own: TOUCH, uses: [], budget: 45_000 },
	BeforeAfter: { own: SPLIT, uses: [], budget: 40_000 },
	Selection: { own: SELECT, uses: [], budget: 45_000 },
	CardStack: { own: CARDS, uses: [], budget: 40_000 },
};
const OWN = Object.values(COMPONENTS).map((c) => c.own);

/** Toolkit imports: [names, markers that must not survive, max added bytes]. */
const cases = [
	[["themes", "defineTheme"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
	[["boxPath", "ellipsePath"], [CONTRACT, TARGETS, MOTION], 6_000],
	[["resolveTarget", "targetPoint"], [CONTRACT, STROKES, MOTION], 10_000],
	[["staggerOffsets", "toFrames"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
];

// Install every registry component into a scratch folder, as `add` would.
const installed = mkdtempSync(join(tmpdir(), "framefields-registry-"));
const index = JSON.parse(readFileSync(join(registry, "index.json"), "utf8"));
for (const entry of index) {
	const item = JSON.parse(
		readFileSync(join(registry, `${entry.name}.json`), "utf8"),
	);
	for (const file of item.files) {
		mkdirSync(dirname(join(installed, file.path)), { recursive: true });
		writeFileSync(join(installed, file.path), file.content);
	}
}
const listed = new Set(index.map((e) => e.title));
for (const name of Object.keys(COMPONENTS))
	if (!listed.has(name)) throw new Error(`${name} is not in the registry`);
for (const name of listed)
	if (!(name in COMPONENTS))
		throw new Error(
			`${name} has no row in COMPONENTS: add its marker and budget`,
		);

/** Installed component sources resolve `framefields` to the built dist. */
const toDist = {
	name: "framefields-dist",
	setup(b) {
		b.onResolve({ filter: /^framefields(\/components)?$/ }, (args) => ({
			path: args.path === "framefields" ? root : components,
		}));
	},
};
async function bundle(contents, resolveDir = process.cwd()) {
	const result = await build({
		stdin: { contents, resolveDir, loader: "ts" },
		plugins: [toDist],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		packages: "external",
		logLevel: "silent",
	});
	return result.outputFiles[0].text;
}

const baseline = `import { Layer } from ${JSON.stringify(root)};\nconsole.log(Layer);`;
const base = await bundle(baseline);

const failures = [];
// Using framefields without components must carry none of the toolkit:
// toolkit modules may not build anything (schemas, glyphs) at import time.
for (const marker of [CONTRACT, STROKES, TARGETS, GLYPHS, ...OWN]) {
	if (base.includes(marker))
		failures.push(`import { Layer } alone kept component code ("${marker}")`);
}
// No component ships in the package itself.
const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? e.name === "registry" || e.name === "preview-engine"
				? []
				: walk(join(dir, e.name))
			: e.name.endsWith(".mjs")
				? [join(dir, e.name)]
				: [],
	);
const dist = fileURLToPath(new URL("../dist", import.meta.url));
for (const file of walk(dist)) {
	const code = readFileSync(file, "utf8");
	for (const [name, c] of Object.entries(COMPONENTS))
		if (code.includes(c.own))
			failures.push(`${file.slice(dist.length + 1)} contains ${name}`);
}
for (const [names, forbidden, budget] of cases) {
	const code = await bundle(
		`${baseline}\nimport { ${names.join(", ")} } from ${JSON.stringify(components)};\nconsole.log(${names.join(", ")});`,
	);
	const label = `import { ${names.join(", ")} } from "framefields/components"`;
	for (const marker of forbidden) {
		if (code.includes(marker)) {
			failures.push(`${label} kept code containing "${marker}"`);
		}
	}
	const added = code.length - base.length;
	if (added > budget)
		failures.push(`${label} added ${added} bytes (budget ${budget})`);
}

// Each installed component alone: none of the others, except what it composes.
for (const entry of index) {
	const c = COMPONENTS[entry.title];
	const forbidden = [...OWN, GLYPHS].filter(
		(m) => m !== c.own && !c.uses.includes(m),
	);
	const code = await bundle(
		`${baseline}\nimport { ${entry.title} } from "./${entry.name}/index.js";\nconsole.log(${entry.title});`,
		installed,
	);
	const label = `framefields add ${entry.name}`;
	if (!code.includes(c.own)) failures.push(`${label}: lost its own code`);
	for (const marker of forbidden)
		if (code.includes(marker))
			failures.push(`${label} kept code containing "${marker}"`);
	const added = code.length - base.length;
	if (added > c.budget)
		failures.push(`${label} added ${added} bytes (budget ${c.budget})`);
}
rmSync(installed, { recursive: true, force: true });

if (failures.length > 0) {
	console.error(`Components do not tree-shake:\n  ${failures.join("\n  ")}`);
	process.exit(1);
}
console.log(
	`components tree-shake (${cases.length} toolkit imports, ${index.length} installed components)`,
);
