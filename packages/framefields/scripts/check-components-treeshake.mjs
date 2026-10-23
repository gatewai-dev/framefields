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

/** [names imported, markers that must not survive, max added bytes]. */
const cases = [
	[["themes", "defineTheme"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
	[["boxPath", "ellipsePath"], [CONTRACT, TARGETS, MOTION], 6_000],
	[["resolveTarget", "targetPoint"], [CONTRACT, STROKES, MOTION], 10_000],
	[["staggerOffsets", "toFrames"], [CONTRACT, STROKES, TARGETS, MOTION], 3_000],
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
for (const [names, forbidden, budget] of cases) {
	const code = await bundle(
		`${baseline}\nimport { ${names.join(", ")} } from ${JSON.stringify(components)};\nconsole.log(${names.join(", ")});`,
	);
	const label = `import { ${names.join(", ")} }`;
	for (const marker of forbidden) {
		if (code.includes(marker) && !base.includes(marker)) {
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
