/**
 * pnpm images → assets/images/*.png: the layers the compositing chapter
 * stacks, generated with FLUX.2 [pro] on fal. Each is made for one
 * compositing operation:
 *   backdrop  the plate everything sits on
 *   subject   a camera on a flat green screen, for ColorKey to pull
 *   leak      light on pure black, for screen blending (black drops out)
 *   paper     an even paper grain, for multiply blending (white drops out)
 * Idempotent: delete an image to regenerate it.
 */
import path from "node:path";
import { download, exists, FalClient } from "./fal.js";
import { IMAGE_SIZE, IMAGES, type ImageName, image } from "./images.js";
import { ROOT } from "./paths.js";

async function main() {
	process.loadEnvFile(path.join(ROOT, ".env"));
	const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
	if (!key) throw new Error("FAL_API_KEY missing from the repo root .env");
	const fal = new FalClient(key);
	const megapixels = (IMAGE_SIZE.width * IMAGE_SIZE.height) / 1e6;
	for (const [name, prompt] of Object.entries(IMAGES) as [
		ImageName,
		string,
	][]) {
		if (await exists(image(name))) continue;
		const out = await fal.run<{ images: { url: string }[] }>(
			"fal-ai/flux-2-pro",
			{ prompt, image_size: IMAGE_SIZE, output_format: "png", seed: 22 },
			megapixels,
		);
		await download(out.images[0].url, image(name));
		console.log(`image  ${name}`);
	}
	console.log(`fal    $${fal.totalUsd.toFixed(3)}`);
}

await main();
process.exit(0);
