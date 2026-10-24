// Fails the build when an import from `framefields/components` drags in code
// it doesn't use (spec §9.5). Bundles the built dist the way a user's bundler
// would, on top of a baseline that already uses `Layer` (every framefields
// project does), and checks what the import adds: no marker strings from
// modules it must not pull, and a size budget.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const components = fileURLToPath(
	new URL("../dist/components/index.mjs", import.meta.url),
);

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

/** [names imported, markers that must not survive, max added bytes]. */
const cases = [
	[["themes", "defineTheme"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
	[["boxPath", "ellipsePath"], [CONTRACT, TARGETS, MOTION], 6_000],
	[["resolveTarget", "targetPoint"], [CONTRACT, STROKES, MOTION], 10_000],
	[["staggerOffsets", "toFrames"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
	// Each component alone: none of the others.
	[
		["MousePointer"],
		[FRAME, CAMERA, REVEAL, COUNTER, ANNOTATE, GLYPHS, CAPTIONS, SHELL],
		60_000,
	],
	[
		["AppFrame"],
		[POINTER, CAMERA, REVEAL, COUNTER, ANNOTATE, GLYPHS, CAPTIONS, SHELL],
		45_000,
	],
	[
		["FocusZoom"],
		[POINTER, FRAME, REVEAL, COUNTER, ANNOTATE, GLYPHS, CAPTIONS, SHELL],
		40_000,
	],
	[
		["TextReveal"],
		[POINTER, FRAME, CAMERA, COUNTER, ANNOTATE, CAPTIONS, SHELL],
		55_000,
	],
	[
		["Counter"],
		[POINTER, FRAME, CAMERA, REVEAL, ANNOTATE, GLYPHS, CAPTIONS, SHELL],
		45_000,
	],
	[
		["Annotate"],
		[POINTER, FRAME, CAMERA, REVEAL, COUNTER, GLYPHS, CAPTIONS, SHELL],
		50_000,
	],
	[
		["Captions"],
		[POINTER, FRAME, CAMERA, REVEAL, COUNTER, ANNOTATE, SHELL],
		55_000,
	],
	// Terminal composes AppFrame and Counter on purpose.
	[["Terminal"], [POINTER, CAMERA, REVEAL, ANNOTATE, GLYPHS, CAPTIONS], 80_000],
];

async function bundle(contents) {
	const result = await build({
		stdin: { contents, resolveDir: process.cwd(), loader: "js" },
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
// Using framefields without components must carry none of them: component
// modules may not build anything (schemas, glyphs) at import time.
for (const marker of [
	CONTRACT,
	STROKES,
	TARGETS,
	POINTER,
	FRAME,
	CAMERA,
	REVEAL,
	COUNTER,
	ANNOTATE,
	GLYPHS,
	CAPTIONS,
	SHELL,
]) {
	if (base.includes(marker))
		failures.push(`import { Layer } alone kept component code ("${marker}")`);
}
for (const [names, forbidden, budget] of cases) {
	const code = await bundle(
		`${baseline}\nimport { ${names.join(", ")} } from ${JSON.stringify(components)};\nconsole.log(${names.join(", ")});`,
	);
	const label = `import { ${names.join(", ")} }`;
	for (const marker of forbidden) {
		if (code.includes(marker)) {
			failures.push(`${label} kept code containing "${marker}"`);
		}
	}
	const added = code.length - base.length;
	if (added > budget)
		failures.push(`${label} added ${added} bytes (budget ${budget})`);
}

if (failures.length > 0) {
	console.error(
		`framefields/components does not tree-shake:\n  ${failures.join("\n  ")}`,
	);
	process.exit(1);
}
console.log(`framefields/components tree-shakes (${cases.length} cases)`);
