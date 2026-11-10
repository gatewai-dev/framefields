/**
 * Turns a mix (look + format + genre + media) into one brief an agent can
 * follow. Parts are written in precedence order: the format decides the frame
 * and timing, the genre the structure and audio, the look everything visual,
 * the media how it is produced.
 */
import type {
	Format,
	Genre,
	Look,
	Medium,
	Preset,
	StyleLibrary,
	StyleMix,
	StylePart,
	StyleRef,
	StyleSection,
} from "./types.js";

/** A mix with every id looked up. */
export interface ResolvedMix {
	look: Look;
	format: Format;
	genre: Genre;
	media: Medium[];
	/** Set only while the mix still matches the preset it started from. */
	preset: Preset | null;
}

/** Two parts of a mix that pull against each other. */
export interface StyleClash {
	from: StyleRef;
	to: StyleRef;
	/** e.g. "Keynote (look) pulls against Bumper 6s (format)". */
	message: string;
}

const byId = <T extends { id: string }>(items: T[], id: string) =>
	items.find((item) => item.id === id) ?? null;

const refOf = (part: StylePart): StyleRef => `${part.kind}/${part.id}`;

/** The mix a preset stands for. */
export function presetMix(preset: Preset): StyleMix {
	return {
		look: preset.look,
		format: preset.format,
		genre: preset.genre,
		media: [...preset.media],
		preset: preset.id,
	};
}

const sameMix = (a: StyleMix, b: StyleMix) =>
	a.look === b.look &&
	a.format === b.format &&
	a.genre === b.genre &&
	a.media.length === b.media.length &&
	a.media.every((m) => b.media.includes(m));

/**
 * Looks every id up. Returns null when one is unknown (a mix saved by a newer
 * library), so callers can fall back instead of failing.
 */
export function resolveMix(
	library: StyleLibrary,
	mix: StyleMix,
): ResolvedMix | null {
	const look = byId(library.looks, mix.look);
	const format = byId(library.formats, mix.format);
	const genre = byId(library.genres, mix.genre);
	const media = mix.media.map((id) => byId(library.media, id));
	if (!look || !format || !genre || media.length === 0) return null;
	if (media.some((m) => m === null)) return null;
	const preset = mix.preset ? byId(library.presets, mix.preset) : null;
	return {
		look,
		format,
		genre,
		media: media as Medium[],
		preset: preset && sameMix(presetMix(preset), mix) ? preset : null,
	};
}

const partsOf = (mix: ResolvedMix): StylePart[] => [
	mix.format,
	mix.genre,
	mix.look,
	...mix.media,
];

/** Pairs in the mix that either side marks as clashing. */
export function mixClashes(mix: ResolvedMix): StyleClash[] {
	const parts = partsOf(mix);
	const refs = new Map(parts.map((p) => [refOf(p), p]));
	const clashes: StyleClash[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		for (const target of part.clashes) {
			const other = refs.get(target);
			const key = [refOf(part), target].sort().join("|");
			if (!other || seen.has(key)) continue;
			seen.add(key);
			clashes.push({
				from: refOf(part),
				to: target,
				message: `${part.name} (${part.kind}) pulls against ${other.name} (${other.kind})`,
			});
		}
	}
	return clashes;
}

const sections = (list: StyleSection[]) =>
	list.map((s) => `#### ${s.title}\n\n${s.body}`).join("\n\n");

const formatLine = (f: Format) =>
	`${f.width}×${f.height} at ${f.fps} fps, ${f.durationSec.min}–${f.durationSec.max} s`;

const artDirection = (look: Look) => `#### Art direction for generated media

Add these to every image and video prompt, so generated material matches the drawn parts:

- Direction: ${look.ai.direction}
- Avoid: ${look.ai.avoid}
- Motion: ${look.ai.motion}`;

function lookBlock(mix: ResolvedMix): string {
	const { look } = mix;
	const head = `### Look: ${look.name}\n\n${look.summary} Palette: ${look.palette.join(", ")}. Type: ${look.fonts.display} (display), ${look.fonts.body} (body)${look.fonts.mono ? `, ${look.fonts.mono} (mono)` : ""}.`;
	const ai = mix.media.some((m) => m.credit) ? `\n\n${artDirection(look)}` : "";
	return `${head}\n\n${sections(look.sections)}${ai}`;
}

const names = (media: Medium[]) => media.map((m) => m.name).join(" + ");

function intro(mix: ResolvedMix): string {
	const from = mix.preset ? `, from the ${mix.preset.name} preset` : "";
	return `This piece is directed as: ${mix.look.name} look, ${mix.format.name} format, ${mix.genre.name}, made with ${names(mix.media)}${from}.

Each part decides its own area: the format the frame and timing, the genre the structure and audio, the look everything visual, the media how it is produced. When two pull against each other, keep each one's rules in its own area.`;
}

/** The whole direction as one brief, in precedence order. */
export function combineResolved(mix: ResolvedMix): string {
	const blocks = [
		intro(mix),
		`### Format: ${mix.format.name}\n\n${formatLine(mix.format)}.\n\n${sections(mix.format.sections)}`,
		`### Genre: ${mix.genre.name}\n\nBeats: ${mix.genre.beats.join(" → ")}.\n\n${sections(mix.genre.sections)}`,
		lookBlock(mix),
		...mix.media.map(
			(m) => `### Medium: ${m.name}\n\n${m.summary}\n\n${sections(m.sections)}`,
		),
	];
	if (mix.preset?.note)
		blocks.push(`### ${mix.preset.name}\n\n${mix.preset.note}`);
	const clashes = mixClashes(mix);
	if (clashes.length > 0)
		blocks.push(
			`### Watch for\n\n${clashes.map((c) => `- ${c.message}: keep each to its own area, and simplify rather than break the format.`).join("\n")}`,
		);
	return blocks.join("\n\n");
}
