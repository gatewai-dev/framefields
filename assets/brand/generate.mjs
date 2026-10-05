/**
 * Generates the framefields brand assets (logo + README banner) as SVG and PNG.
 *
 *   node assets/brand/generate.mjs
 *
 * Text is converted to vector outlines with fontkit, so the SVGs render identically everywhere
 * without the fonts installed. PNGs are rasterized with resvg at 2× for crisp README display.
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
// fontkit and resvg are dependencies of the SDK package; resolve them from there.
const require = createRequire(join(ROOT, "packages/framefields/package.json"));
const fontkit = require("fontkit");
const { Resvg } = require("@resvg/resvg-js");

const INTER = fontkit.openSync(join(ROOT, "assets/fonts/Inter.ttf"));

// Blue + white palette.
const SKY = "#7DD3FC";
const AZURE = "#3B82F6";
const BLUE = "#1D4ED8";
const NAVY = "#0B1E4D";
const WHITE = "#FFFFFF";

/** Lays out `text` as one SVG path (outlines), returning the path and its advance width. */
function textPath(
	font,
	text,
	{ size, weight = 400, x = 0, y = 0, tracking = 0 },
) {
	const face = font.variationAxes?.wght
		? font.getVariation({ wght: weight })
		: font;
	const scale = size / face.unitsPerEm;
	const run = face.layout(text);
	let pen = 0;
	let d = "";
	run.glyphs.forEach((glyph, i) => {
		const ox = x + pen * scale;
		const path = glyph.path.scale(scale, -scale).translate(ox, y);
		d += path.toSVG();
		pen += run.positions[i].xAdvance + tracking * face.unitsPerEm;
	});
	return { d, width: pen * scale };
}

/**
 * The mark: git and frames. Viewfinder brackets (the frame) around a git
 * branch: two commits on a line, and a branch leaving the top commit whose
 * head is a play triangle (the commit that plays).
 * One solid paint: azure unless `paint` says otherwise.
 */
function mark({ x, y, size, paint }) {
	const s = size / 512;
	const t = (v) => (v * s).toFixed(2);
	const stroke = 34;
	const arm = 128;
	const inset = 56;
	const r = 30;
	const corner = (cx, cy, dx, dy) =>
		`M ${t(cx + dx * arm)} ${t(cy)} L ${t(cx + dx * r)} ${t(cy)} Q ${t(cx)} ${t(cy)} ${t(cx)} ${t(cy + dy * r)} L ${t(cx)} ${t(cy + dy * arm)}`;
	const a = inset;
	const b = 512 - inset;
	const brackets = [
		corner(a, a, 1, 1),
		corner(b, a, -1, 1),
		corner(a, b, 1, -1),
		corner(b, b, -1, -1),
	].join(" ");
	const fill = paint ?? AZURE;
	// The branch: a trunk between two commits, and a curve off the top commit
	// into the play triangle (the branch head), whose round-joined stroke of
	// the same paint softens its corners evenly.
	const trunk = `M ${t(176)} ${t(182)} L ${t(176)} ${t(330)} M ${t(176)} ${t(182)} C ${t(176)} ${t(256)} ${t(236)} ${t(256)} ${t(276)} ${t(256)}`;
	const commit = (cy) =>
		`<circle cx="${t(176)}" cy="${t(cy)}" r="${t(32)}" fill="${fill}"/>`;
	const tri = `M ${t(284)} ${t(200)} L ${t(362)} ${t(256)} L ${t(284)} ${t(312)} Z`;
	return `
	<g transform="translate(${x} ${y})">
		<path d="${brackets}" fill="none" stroke="${fill}" stroke-width="${t(stroke)}" stroke-linecap="round" stroke-linejoin="round"/>
		<path d="${trunk}" fill="none" stroke="${fill}" stroke-width="${t(28)}" stroke-linecap="round"/>
		${commit(172)}
		${commit(340)}
		<path d="${tri}" fill="${fill}" stroke="${fill}" stroke-width="${t(34)}" stroke-linejoin="round"/>
	</g>`;
}

function svg(width, height, body) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}\n</svg>\n`;
}

function writeBoth(name, content, width) {
	writeFileSync(join(HERE, `${name}.svg`), content);
	const png = new Resvg(content, {
		fitTo: { mode: "width", value: width * 2 },
		background: "rgba(0,0,0,0)",
	})
		.render()
		.asPng();
	writeFileSync(join(HERE, `${name}.png`), png);
	console.log(`wrote assets/brand/${name}.svg + .png`);
}

// ── Logo (mark only, transparent) ───────────────────────────────────────────
writeBoth("logo", svg(512, 512, mark({ x: 0, y: 0, size: 512 })), 512);

// ── Logo with wordmark (for light/dark docs) ───────────────────────────────
for (const [name, fg, markPaint] of [
	["logo-wordmark-dark", WHITE, WHITE],
	["logo-wordmark-light", NAVY, undefined],
]) {
	const word = textPath(INTER, "framefields", {
		size: 112,
		weight: 700,
		tracking: -0.03,
		x: 156,
		y: 112,
	});
	const width = Math.ceil(156 + word.width + 8);
	writeBoth(
		name,
		svg(
			width,
			150,
			`${mark({ x: 0, y: 4, size: 140, paint: markPaint })}
	<path d="${word.d}" fill="${fg}"/>`,
		),
		width,
	);
}

// ── README banner ───────────────────────────────────────────────────────────
{
	const W = 1280;
	const H = 400;

	// Left: lockup.
	const word = textPath(INTER, "framefields", {
		size: 76,
		weight: 700,
		tracking: -0.03,
		x: 196,
		y: 226,
	});
	// Right: a strip of frames — a subject easing along a curve, locked by the reticle at the end.
	const fw = 124;
	const fh = 88;
	const gap = 18;
	const fx0 = 664;
	const fy = 169;
	const n = 4;
	// ease-out positions of the subject inside each frame (0..1 of travel).
	const ease = (p) => 1 - (1 - p) ** 3;
	let strip = "";
	const centers = [];
	for (let i = 0; i < n; i++) {
		const x = fx0 + i * (fw + gap);
		const p = ease(i / (n - 1));
		const cx = x + 34 + p * (fw - 68);
		const cy = fy + fh - 24 - Math.sin(p * Math.PI) * 30;
		centers.push([cx, cy]);
		const last = i === n - 1;
		strip += `
		<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" rx="10" fill="${WHITE}" fill-opacity="${last ? 0.12 : 0.06}" stroke="${WHITE}" stroke-opacity="${0.2 + i * 0.08}"/>
		<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="${WHITE}" fill-opacity="${last ? 1 : 0.3 + i * 0.18}"/>`;
	}
	// Motion path through the subjects (one smooth curve across frames).
	const pathD = centers
		.map(([cx, cy], i) => {
			if (i === 0) return `M ${cx.toFixed(1)} ${cy.toFixed(1)}`;
			const [px, py] = centers[i - 1];
			const mx = (px + cx) / 2;
			return `C ${mx.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${cy.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
		})
		.join(" ");
	// Reticle around the last subject (the vision engine locking on).
	const [lx, ly] = centers[n - 1];
	const rr = 20;
	const ra = 8;
	const reticle = [
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	]
		.map(
			([sx, sy]) =>
				`M ${(lx + sx * rr).toFixed(1)} ${(ly + sy * (rr - ra)).toFixed(1)} L ${(lx + sx * rr).toFixed(1)} ${(ly + sy * rr).toFixed(1)} L ${(lx + sx * (rr - ra)).toFixed(1)} ${(ly + sy * rr).toFixed(1)}`,
		)
		.join(" ");
	// Playhead over the strip.
	const timeline = `
		<line x1="${fx0}" y1="${fy - 26}" x2="${fx0 + n * fw + (n - 1) * gap}" y2="${fy - 26}" stroke="${WHITE}" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>
		<line x1="${fx0}" y1="${fy - 26}" x2="${fx0 + (n - 1) * (fw + gap) + fw / 2}" y2="${fy - 26}" stroke="${SKY}" stroke-width="2" stroke-linecap="round"/>
		<circle cx="${fx0 + (n - 1) * (fw + gap) + fw / 2}" cy="${fy - 26}" r="5" fill="${WHITE}"/>`;

	const body = `
	<defs>
		<linearGradient id="banner-bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="${NAVY}"/>
			<stop offset="0.6" stop-color="#123A9C"/>
			<stop offset="1" stop-color="${BLUE}"/>
		</linearGradient>
		<radialGradient id="banner-glow" cx="0.78" cy="0.2" r="0.6">
			<stop offset="0" stop-color="${SKY}" stop-opacity="0.28"/>
			<stop offset="1" stop-color="${SKY}" stop-opacity="0"/>
		</radialGradient>
	</defs>
	<rect width="${W}" height="${H}" rx="24" fill="url(#banner-bg)"/>
	<rect width="${W}" height="${H}" rx="24" fill="url(#banner-glow)"/>
	<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="${WHITE}" stroke-opacity="0.14"/>
	${mark({ x: 82, y: 148, size: 104, paint: WHITE })}
	<path d="${word.d}" fill="${WHITE}"/>
	${timeline}
	<path d="${pathD}" fill="none" stroke="${SKY}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
	${strip}
	<path d="${reticle}" fill="none" stroke="${SKY}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
	writeBoth("banner", svg(W, H, body), W);
}
