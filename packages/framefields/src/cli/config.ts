/**
 * `framefields.json` at the project root: where installed components live,
 * and which fonts `framefields add` / `framefields fonts add` installed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "framefields.json";

export interface ProjectConfig {
	/** Components directory, relative to the project root. */
	components: string;
	/**
	 * Font files by role (`emoji`), relative to the project root. A role
	 * set here counts as installed: point it at your own font to use that.
	 */
	fonts?: Partial<Record<string, string>>;
}

/** The project's config, or the default it would get: `src/components` when there is a `src`. */
export function readConfig(cwd: string): {
	config: ProjectConfig;
	saved: boolean;
} {
	const file = join(cwd, CONFIG_FILE);
	if (existsSync(file)) {
		const config = JSON.parse(
			readFileSync(file, "utf8"),
		) as Partial<ProjectConfig>;
		if (typeof config.components !== "string")
			throw new Error(`${CONFIG_FILE}: "components" must be a directory path`);
		if (
			config.fonts !== undefined &&
			(typeof config.fonts !== "object" ||
				Object.values(config.fonts).some((v) => typeof v !== "string"))
		)
			throw new Error(
				`${CONFIG_FILE}: "fonts" must map roles to font file paths, e.g. { "emoji": "assets/fonts/NotoColorEmoji.ttf" }`,
			);
		return { config: config as ProjectConfig, saved: true };
	}
	const components = existsSync(join(cwd, "src"))
		? "src/components"
		: "components";
	return { config: { components }, saved: false };
}

export function writeConfig(cwd: string, config: ProjectConfig): void {
	writeFileSync(
		join(cwd, CONFIG_FILE),
		`${JSON.stringify(config, null, "\t")}\n`,
	);
}
