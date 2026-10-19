/**
 * pnpm probe → output/probe-*.png: every downloaded asset in one contact sheet, to see
 * which ones the engine draws before building scenes around them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Composition, HeadlessMediaRenderer, Layer } from "framefields";
import { FLUENT, LOTTIES, LUCIDE, NOTO, TWEMOJI } from "./manifest.js";
import { emoji, fluent, lottie, lucide, OUTPUT, twemoji } from "./paths.js";
import { FONT_FILES, MONO, registerFonts } from "./theme.js";

await registerFonts();

function sheet(
	items: Array<[string, (o: object) => unknown]>,
	cell: number,
	cols: number,
) {
	const rows = Math.ceil(items.length / cols);
	const comp = new Composition({
		width: cols * cell,
		height: rows * (cell + 24),
		fps: 30,
		durationFrames: 60,
		backgroundColor: "#202028",
		fonts: FONT_FILES,
	});
	items.forEach(([name, make], i) => {
		const x = (i % cols) * cell;
		const y = Math.floor(i / cols) * (cell + 24);
		comp.add(
			make({
				position: "absolute",
				x: x + 8,
				y: y + 8,
				width: cell - 16,
				height: cell - 16,
			}) as never,
		);
		comp.add(
			Layer.text(name, {
				position: "absolute",
				x,
				y: y + cell - 4,
				width: cell,
				fontSize: 14,
				fontFamily: MONO,
				fill: "#ddd",
				align: "center",
			}),
		);
	});
	return comp;
}

const renderer = new HeadlessMediaRenderer();
await fs.mkdir(OUTPUT, { recursive: true });
const sheets: Record<string, Composition> = {
	emoji: sheet(
		Object.keys(NOTO).map((n) => [n, (o) => Layer.lottie(emoji(n), o)]),
		160,
		9,
	),
	lottie: sheet(
		Object.keys(LOTTIES).map((n) => [n, (o) => Layer.lottie(lottie(n), o)]),
		240,
		6,
	),
	svg: sheet(
		[
			...Object.keys(FLUENT).map((n): [string, (o: object) => unknown] => [
				n,
				(o) => Layer.svg(fluent(n), o),
			]),
			...Object.keys(TWEMOJI).map((n): [string, (o: object) => unknown] => [
				`tw:${n}`,
				(o) => Layer.svg(twemoji(n), o),
			]),
			...LUCIDE.map((n): [string, (o: object) => unknown] => [
				`lu:${n}`,
				(o) => Layer.svg(lucide(n), o),
			]),
		],
		140,
		12,
	),
};
for (const [name, comp] of Object.entries(sheets)) {
	const png = await comp.renderFrame({
		frame: Number(process.argv[2] ?? 20),
		renderer,
	});
	const file = path.join(OUTPUT, `probe-${name}.png`);
	await fs.writeFile(file, png);
	console.log(file);
}
process.exit(0);
