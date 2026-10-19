/**
 * pnpm assets → assets/{emoji,lottie,svg,fonts}
 *
 * Every downloaded file is listed here with where it came from and its licence; this script is
 * the record (the files themselves stay out of git like other examples' fonts). Idempotent: files
 * already on disk are kept.
 *
 * | Folder | Source | Licence |
 * | --- | --- | --- |
 * | emoji/   | Noto Animated Emoji (Lottie), fonts.gstatic.com            | CC BY 4.0, Google |
 * | lottie/  | lottie-ios Tests/Samples (Airbnb)                         | Apache-2.0 |
 * | lottie/  | lottie-ios Tests/Samples/LottieFiles (lottiefiles.com)    | Lottie Simple License |
 * | lottie/  | lottie-web demo/ (Airbnb)                                 | MIT |
 * | svg/fluent/  | Fluent Emoji, color SVGs (Microsoft)                  | MIT |
 * | svg/twemoji/ | Twemoji 15.1 (jdecked/twemoji)                        | CC BY 4.0 |
 * | svg/lucide/  | Lucide icons, lucide-static                           | ISC |
 * | fonts/   | copied from the repo's assets/fonts and the renderer's Noto Color Emoji | OFL |
 */
import fs from "node:fs/promises";
import path from "node:path";
import { FLUENT, LOTTIES, LUCIDE, NOTO, TWEMOJI } from "./manifest.js";
import { ASSETS, FONTS, REPO } from "./paths.js";

const FONT_FILES = [
	path.join(REPO, "assets/fonts/Syne.ttf"),
	path.join(REPO, "assets/fonts/Inter.ttf"),
	path.join(REPO, "assets/fonts/JetBrainsMono.ttf"),
	path.join(REPO, "assets/fonts/InstrumentSerif-Italic.ttf"),
	path.join(REPO, "packages/renderer/src/assets/NotoColorEmoji.ttf"),
];
const NOTO_SANS_ARABIC =
	"https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf";
const NOTO_SANS_HEBREW =
	"https://raw.githubusercontent.com/google/fonts/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf";

async function exists(file: string): Promise<boolean> {
	return (await fs.stat(file).catch(() => null)) !== null;
}

async function download(url: string, file: string): Promise<boolean> {
	if (await exists(file)) return true;
	const res = await fetch(url);
	if (!res.ok) {
		console.warn(
			`skip ${path.relative(ASSETS, file)}: HTTP ${res.status} ${url}`,
		);
		return false;
	}
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
	console.log(path.relative(ASSETS, file));
	return true;
}

const snake = (folder: string) => folder.toLowerCase().replace(/ /g, "_");

async function main(): Promise<void> {
	const jobs: Array<Promise<boolean>> = [];
	for (const [name, code] of Object.entries(NOTO)) {
		jobs.push(
			download(
				`https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/lottie.json`,
				path.join(ASSETS, "emoji", `${name}.json`),
			),
		);
	}
	for (const [name, url] of Object.entries(LOTTIES)) {
		jobs.push(download(url, path.join(ASSETS, "lottie", `${name}.json`)));
	}
	for (const [name, folder] of Object.entries(FLUENT)) {
		const base = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${encodeURIComponent(folder)}`;
		const file = path.join(ASSETS, "svg/fluent", `${name}.svg`);
		jobs.push(
			download(`${base}/Color/${snake(folder)}_color.svg`, file).then(
				(ok) =>
					ok ||
					// Emoji with skin tones keep their colour SVG one folder deeper.
					download(
						`${base}/Default/Color/${snake(folder)}_color_default.svg`,
						file,
					),
			),
		);
	}
	for (const [name, code] of Object.entries(TWEMOJI)) {
		jobs.push(
			download(
				`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${code}.svg`,
				path.join(ASSETS, "svg/twemoji", `${name}.svg`),
			),
		);
	}
	for (const name of LUCIDE) {
		jobs.push(
			download(
				`https://unpkg.com/lucide-static@0.460.0/icons/${name}.svg`,
				path.join(ASSETS, "svg/lucide", `${name}.svg`),
			),
		);
	}
	jobs.push(download(NOTO_SANS_ARABIC, path.join(FONTS, "NotoSansArabic.ttf")));
	jobs.push(download(NOTO_SANS_HEBREW, path.join(FONTS, "NotoSansHebrew.ttf")));
	await fs.mkdir(FONTS, { recursive: true });
	for (const src of FONT_FILES) {
		const dst = path.join(FONTS, path.basename(src));
		if (!(await exists(dst))) {
			await fs.copyFile(src, dst);
			console.log(path.relative(ASSETS, dst));
		}
	}
	const results = await Promise.all(jobs);
	const missing = results.filter((ok) => !ok).length;
	console.log(
		`${results.length - missing}/${results.length} downloads present`,
	);
}

await main();
process.exit(0);
