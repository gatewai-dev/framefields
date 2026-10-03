import * as fontkit from "fontkit";
import fs from "fs/promises";
import { SlugFontCache, SlugGeometry } from "./dist/index.mjs";

async function main() {
	const fontBuffer = await fs.readFile(
		"/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
	);
	const font = fontkit.create(fontBuffer);

	// We can simulate getFont's behaviour by setting parsedFontCache
	SlugFontCache.parsedFontCache.set("Liberation Sans Bold", font);

	const slugFont = SlugFontCache.getFont("Liberation Sans Bold", 900);
	console.log("SlugFont loaded:", !!slugFont);

	const fontSize = 56;
	const letterSpacing = 8;
	const lineHeight = fontSize * 1.2;

	const measured = SlugGeometry.measure(
		"QUANTUM SLEEK",
		slugFont,
		fontSize,
		letterSpacing,
		lineHeight,
	);
	console.log("Measured natural size:", measured);

	const layout = SlugGeometry.layout(
		"QUANTUM SLEEK",
		slugFont,
		fontSize,
		letterSpacing,
		lineHeight,
		measured.width,
	);
	console.log("Lines with natural width:", layout.linesCount);
	for (const g of layout.glyphs) {
		console.log(`Char: ${g.char}, x: ${g.x}, lineIndex: ${g.lineIndex}`);
	}
}

main().catch(console.error);
