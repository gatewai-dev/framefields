import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as framefields from "../index.js";
import { readStyleLibrary, STYLE_SKILL_DIR, withSkillTables } from "./build.js";
import {
	combineStyles,
	presetMix,
	resolveStyleMix,
	styleClashes,
	styleLibrary,
} from "./index.js";

const COMPONENTS_DIR = path.resolve(
	import.meta.dirname,
	"../../../components/src",
);
const source = readStyleLibrary();

describe("style library source", () => {
	it("matches the generated catalog", () => {
		expect(styleLibrary).toEqual(JSON.parse(JSON.stringify(source)));
	});

	it("matches the generated SKILL.md tables", () => {
		const skill = readFileSync(path.join(STYLE_SKILL_DIR, "SKILL.md"), "utf8");
		expect(withSkillTables(skill, source)).toBe(skill);
	});

	it("names only real exports and registry components under Build it with", () => {
		const parts = [
			...source.looks,
			...source.formats,
			...source.genres,
			...source.media,
		];
		const unknown: string[] = [];
		for (const part of parts) {
			const section = part.sections.find((s) => s.title === "Build it with");
			for (const [, name] of section?.body.matchAll(/`([^`]+)`/g) ?? []) {
				if (!resolves(name)) unknown.push(`${part.kind}/${part.id}: ${name}`);
			}
		}
		expect(unknown).toEqual([]);
	});

	it("resolves every preset to its own mix", () => {
		for (const preset of source.presets)
			expect(resolveStyleMix(presetMix(preset))?.preset?.id).toBe(preset.id);
	});
});

/** An export path (`Layer.shape`, `TextAnimator.wordPop`) or `components/<id>`; other code is not checked. */
function resolves(name: string): boolean {
	const component = /^components\/([a-z-]+)$/.exec(name);
	if (component) return existsSync(path.join(COMPONENTS_DIR, component[1]));
	if (!/^[A-Z]\w*(\.\w+)*$/.test(name) || !/[a-z]/.test(name)) return true;
	let value: unknown = framefields;
	for (const key of name.split(".")) {
		if (value === null || value === undefined) return false;
		value = (value as Record<string, unknown>)[key];
	}
	return value !== undefined;
}

describe("section ownership", () => {
	const fixture = (edit: (dir: string) => void) => {
		const dir = mkdtempSync(path.join(tmpdir(), "styles-"));
		cpSync(STYLE_SKILL_DIR, dir, { recursive: true });
		edit(dir);
		return () => readStyleLibrary(dir);
	};
	const patch = (
		dir: string,
		file: string,
		from: string | RegExp,
		to: string,
	) => {
		const at = path.join(dir, file);
		writeFileSync(at, readFileSync(at, "utf8").replace(from, to));
	};

	it("rejects a look that sets a format's facts", () => {
		const read = fixture((dir) =>
			patch(
				dir,
				"looks/motion.md",
				"tags:",
				"durationSec: { min: 5, max: 9 }\ntags:",
			),
		);
		expect(read).toThrow(/looks\/motion\.md.*durationSec/s);
	});

	it("rejects a look that writes a format's section", () => {
		const read = fixture((dir) =>
			patch(
				dir,
				"looks/motion.md",
				"## Avoid",
				"## Timing\n\nCut every second.\n\n## Avoid",
			),
		);
		expect(read).toThrow(/"## Timing" is not a look section/);
	});

	it("rejects a missing required section and an unknown reference", () => {
		const missing = fixture((dir) =>
			patch(dir, "genres/explainer.md", /## Audio[\s\S]*?(?=## On screen)/, ""),
		);
		expect(missing).toThrow(/missing "## Audio"/);
		const unknown = fixture((dir) =>
			patch(dir, "presets/motion.md", "look: motion", "look: nowhere"),
		);
		expect(unknown).toThrow(/preset\/motion: unknown part look\/nowhere/);
	});

	it("rejects a file whose id is not its name", () => {
		const read = fixture((dir) => {
			mkdirSync(path.join(dir, "looks"), { recursive: true });
			patch(dir, "looks/keynote.md", "id: keynote", "id: other");
		});
		expect(read).toThrow(/must match the file name/);
	});
});

describe("combineStyles", () => {
	const preset = styleLibrary.presets.find((p) => p.id === "launch-teaser");
	if (!preset) throw new Error("launch-teaser preset missing");
	const teaser = presetMix(preset);

	it("writes the parts in precedence order", () => {
		const brief = combineStyles({ ...teaser, media: ["3d", "ai-generated"] });
		const order = [
			"### Format:",
			"### Genre:",
			"### Look:",
			"### Medium: 3D",
			"### Medium: AI-generated",
		];
		const at = order.map((h) => brief.indexOf(h));
		expect(at.every((i) => i >= 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		// Media aren't part of a preset, so choosing them makes the mix custom.
		expect(brief).not.toContain("from the Launch teaser preset");
	});

	it("leaves media to the agent when the mix doesn't set them", () => {
		const brief = combineStyles(teaser);
		expect(brief).toContain("from the Launch teaser preset");
		expect(brief).toContain("### Media\n\nNot set for this piece");
		for (const m of styleLibrary.media)
			expect(brief).toContain(`**${m.name}**`);
		expect(brief).not.toContain("### Medium:");
		expect(brief.indexOf("### Media")).toBeLessThan(
			brief.indexOf("### Launch teaser"),
		);
	});

	it("adds the look's art direction only when a medium generates", () => {
		expect(combineStyles(teaser)).toContain(
			"Art direction for generated media",
		);
		expect(combineStyles({ ...teaser, media: ["3d"] })).not.toContain(
			"Art direction",
		);
	});

	it("drops the preset's note once the mix leaves it", () => {
		const changed = combineStyles({ ...teaser, format: "vertical" });
		expect(changed).not.toContain("### Launch teaser");
		expect(changed).not.toContain("from the Launch teaser preset");
	});

	it("reports clashes from either side, once", () => {
		const mix = {
			look: "collage",
			format: "ad-spot",
			genre: "explainer",
			media: ["code-drawn"],
		};
		expect(styleClashes(mix).map((c) => c.message)).toEqual([
			"Ad spot (format) pulls against Collage (look)",
		]);
		expect(combineStyles(mix)).toContain("### Watch for");
	});

	it("returns null for ids this version doesn't know", () => {
		expect(resolveStyleMix({ ...teaser, look: "from-the-future" })).toBeNull();
		expect(() => combineStyles({ ...teaser, media: ["hologram"] })).toThrow(
			/Unknown style/,
		);
	});
});
