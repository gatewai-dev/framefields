/**
 * Generated images the references use. Each prompt is a picture described
 * the way a photographer would, followed by its look's art direction from the
 * style library, word for word: the same text an agent is told to use.
 * `pnpm images` makes the candidates; `pick` is the one the reference uses,
 * and `sha256` pins it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lookTokens } from "./frame.js";

export const GENERATED_DIR = new URL("../assets/generated/", import.meta.url)
	.pathname;

interface GeneratedImage {
	look: string;
	scene: string;
	aspectRatio: "4:3" | "16:9" | "1:1" | "3:4";
	candidates: number;
	/** The candidate in use, 1-based; null until one is chosen. */
	pick: number | null;
	sha256: string | null;
}

export const IMAGES: Record<"collage-archive", GeneratedImage> = {
	"collage-archive": {
		look: "collage",
		scene:
			"A city in 1931 in the middle of a great public works: a new river channel being dug straight through town, steam cranes and timber scaffolding along its banks, rows of workers with shovels in the mud in the foreground, brick warehouses and a church spire on the far bank, seen wide from a raised embankment, 35mm lens",
		aspectRatio: "4:3",
		candidates: 2,
		// 2: the workers are digging; 1 is a posed group portrait.
		pick: 2,
		sha256: "b41e4134d6b6ca13a0b3775167bbc8d3886fbbdce1b70e371469c934b624658f",
	},
};

export type ImageName = keyof typeof IMAGES;

export function promptFor(name: ImageName): string {
	const image = IMAGES[name];
	const { ai } = lookTokens(image.look);
	return `${image.scene}. ${ai.direction}. Avoid: ${ai.avoid}.`;
}

export const candidatePath = (name: ImageName, n: number) =>
	`${GENERATED_DIR}${name}.${n}.jpg`;

/** The picked file, checked against its pin. */
export function generatedImage(name: ImageName): string {
	const image = IMAGES[name];
	if (image.pick === null)
		throw new Error(
			`No candidate picked for ${name} yet: run \`pnpm images\` and set its pick in images.ts.`,
		);
	const file = candidatePath(name, image.pick);
	if (!existsSync(file))
		throw new Error(`${file} is missing: run \`pnpm images\`.`);
	const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
	if (image.sha256 && sha !== image.sha256)
		throw new Error(`${file}: SHA-256 ${sha}, pinned ${image.sha256}.`);
	return file;
}
