/**
 * The module a media item installs next to the project's components: the
 * pinned file's path plus what the library measured, so code imports it
 * the way it imports anything else.
 *
 *   import { whooshSoft } from "./components/sfx/whoosh-soft.js";
 *   Layer.audio(whooshSoft.src, { … }) // whooshSoft.onset lines the hit up
 */
import {
	LIBRARY_ASSETS_DIR,
	type LibraryAnalysis,
	type LibraryLicense,
} from "framefields/library";

/** `studio-small-09` → `studioSmall09`; a leading digit gets the kind in front. */
export function exportName(kind: string, slug: string): string {
	const camel = slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
	return /^[0-9]/.test(camel)
		? `${kind}${camel.charAt(0).toUpperCase()}${camel.slice(1)}`
		: camel;
}

function credit(license: LibraryLicense): string {
	const parts = [
		`License: ${license.id}${license.commercial ? "" : " (not for commercial use)"}.`,
	];
	if (license.attribution) parts.push(`Credit: ${license.attribution}.`);
	if (license.source) parts.push(`Source: ${license.source}`);
	return parts.join(" ");
}

/** Numbers as short as they read, arrays wrapped at 80 columns. */
function literal(value: unknown, indent: string): string {
	if (!Array.isArray(value)) return JSON.stringify(value);
	const items = value.map((v) => JSON.stringify(v));
	const lines: string[] = [];
	let line = "";
	for (const item of items) {
		if (line && line.length + item.length + 2 > 72) {
			lines.push(line);
			line = item;
		} else line = line ? `${line}, ${item}` : item;
	}
	if (line) lines.push(line);
	if (lines.length <= 1) return `[${lines[0] ?? ""}]`;
	return `[\n${lines.map((l) => `${indent}\t${l},`).join("\n")}\n${indent}]`;
}

export interface ModuleInput {
	kind: string;
	slug: string;
	title: string;
	kindLabel: string;
	license: LibraryLicense;
	/** The file under `assets/library/`: `sfx/whoosh-soft.wav`. */
	assetPath: string;
	analysis: LibraryAnalysis;
	/** Seconds an audition starts at (music). */
	start?: number;
	loop?: boolean;
}

/** The installed file: `<kind>/<slug>.ts` in the components folder. */
export function mediaModule(input: ModuleInput): {
	path: string;
	content: string;
	title: string;
} {
	const name = exportName(input.kind, input.slug);
	const fields: Array<[string, unknown]> = [
		["src", `${LIBRARY_ASSETS_DIR}/${input.assetPath}`],
		["duration", input.analysis.duration],
		["bpm", input.analysis.bpm],
		["onset", input.analysis.onset],
		["start", input.start || undefined],
		["loop", input.loop || undefined],
		["width", input.analysis.width],
		["height", input.analysis.height],
		["beats", input.analysis.beats?.length ? input.analysis.beats : undefined],
		["license", input.license.id],
		["attribution", input.license.attribution],
	];
	const body = fields
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `\t${k}: ${literal(v, "\t")},`)
		.join("\n");
	const content = `/**
 * ${input.title} (${input.kindLabel}) from the framefields library.
 * ${credit(input.license)}
 * The file is pinned in framefields.json and kept out of git; \`framefields
 * assets pull\` downloads it again on a fresh checkout.
 */
export const ${name} = {
${body}
} as const;
`;
	return { path: `${input.kind}/${input.slug}.ts`, content, title: name };
}
