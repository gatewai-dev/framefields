/**
 * Generates the framefields brand assets (logo + README banner) as SVG and PNG.
 *
 *   node assets/brand/generate.mjs
 *
 * Text is converted to vector outlines with fontkit, so the SVGs render identically everywhere
 * without the fonts installed. PNGs are rasterized with resvg at 2× for crisp README display.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
// fontkit and resvg are dependencies of the SDK package; resolve them from there.
const require = createRequire(join(ROOT, "packages/framefields/package.json"));
const fontkit = require("fontkit");
const { Resvg } = require("@resvg/resvg-js");

const INTER = fontkit.openSync(join(ROOT, "assets/fonts/Inter.ttf"));

// The logos' blue + white palette.
const AZURE = "#3B82F6";
const NAVY = "#0B1E4D";
const WHITE = "#FFFFFF";

/** Lays out `text` as one SVG path (outlines), returning the path and its advance width. */
function textPath(
	font,
	text,
	{ size, weight = 400, width, x = 0, y = 0, tracking = 0 },
) {
	const face = font.variationAxes?.wght
		? font.getVariation({ wght: weight, ...(width && { wdth: width }) })
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

// ── README banners: framefields.dev's palette ───────────────────────────────
// Paper and ink for the room, graphite for the tools, black for the picture, and broadcast
// yellow only where the playhead is. Archivo condensed and heavy for display, a mono for
// kickers and timecode, small corners.
const ARCHIVO = fontkit.openSync(join(ROOT, "assets/fonts/Archivo.ttf"));
const MONO = fontkit.openSync(join(ROOT, "assets/fonts/JetBrainsMono.ttf"));
const SITE = {
	paper: "#E6E8E6",
	ink: "#000000",
	steel: "#4F5256",
	rule: "#BFC2C2",
	graphite: "#1F2022",
	graphite2: "#2A2B2E",
	graphiteLine: "#3A3C3F",
	onGraphite: "#E8E9E7",
	graphiteDim: "#9A9DA0",
	side: "#18191A",
	chat: "#141516",
	signal: "#F5E300",
	scenes: ["#8D9093", "#C4C7C7", "#5B5E61"],
};
/** Text as outlines: `{ svg, width }`. Display is Archivo 800 at width 68. */
function type(
	s,
	{
		font = ARCHIVO,
		size,
		weight = 400,
		width,
		x,
		y,
		fill,
		opacity = 1,
		tracking = 0,
	},
) {
	const t = textPath(font, s, { size, weight, width, x, y, tracking });
	const alpha = opacity === 1 ? "" : ` fill-opacity="${opacity}"`;
	return { svg: `<path d="${t.d}" fill="${fill}"${alpha}/>`, width: t.width };
}
const display = (s, o) => type(s, { weight: 800, width: 68, ...o });
const mono = (s, { upper = true, ...o }) =>
	type(upper ? s.toUpperCase() : s, {
		font: MONO,
		size: 12.5,
		tracking: 0.04,
		...o,
	});

// ── Showcase: what people make with framefields, from the style library's cards (the ones
// the desktop app shows, served by framefields.dev at /v1/styles/frames). One 16:9 picture
// the banners and the homepage share; `showcase.png` is what the site serves.
const SHOWCASE_TILES = [
	["launch-teaser", "3D product"],
	["social-vertical", "Social & UGC"],
	["motion", "Motion graphics"],
	["technical-explainer", "Explainer"],
	["brand-film", "Brand film"],
	["lyric-video", "Lyric video"],
];
const SHOWCASE = (() => {
	const W = 1280;
	const H = 720;
	const gap = 8;
	const cols = 3;
	const tw = (W - gap * (cols - 1)) / cols;
	const th = (H - gap) / 2;
	const tiles = SHOWCASE_TILES.map(([name, label], i) => {
		const x = (i % cols) * (tw + gap);
		const y = Math.floor(i / cols) * (th + gap);
		const src = readFileSync(join(HERE, `style-${name}.png`)).toString(
			"base64",
		);
		const tag = mono(label, {
			size: 22,
			x: x + 30,
			y: y + th - 30,
			fill: SITE.onGraphite,
		});
		return `
	<clipPath id="tile-${i}"><rect x="${x.toFixed(1)}" y="${y}" width="${tw.toFixed(1)}" height="${th}"/></clipPath>
	<image href="data:image/png;base64,${src}" x="${x.toFixed(1)}" y="${y}" width="${tw.toFixed(1)}" height="${th}" preserveAspectRatio="xMidYMid slice" clip-path="url(#tile-${i})"/>
	<rect x="${(x + 18).toFixed(1)}" y="${y + th - 58}" width="${(tag.width + 24).toFixed(1)}" height="40" rx="3" fill="#000" fill-opacity="0.72"/>
	${tag.svg}`;
	}).join("");
	const content = svg(
		W,
		H,
		`\n\t<rect width="${W}" height="${H}" fill="#000"/>${tiles}`,
	);
	const png = new Resvg(content, { fitTo: { mode: "width", value: W } })
		.render()
		.asPng();
	writeFileSync(join(HERE, "showcase.png"), png);
	console.log("wrote assets/brand/showcase.png");
	return `data:image/png;base64,${png.toString("base64")}`;
})();

/**
 * Each look's film (the ones framefields.dev's desktop section plays: four drawn with
 * framefields, two generated through its AI gateway) as a sheet of its first two seconds at
 * GIF_FPS: 5 × 4 frames of 480 × 270, already cut to 256 colors, which is all a GIF holds. Sheets
 * rather than the MP4s, which stay out of git.
 */
const SHEET = { columns: 5, rows: 4, width: 2400, height: 1080 };
/** Each film's frames, cut out of its sheet once: one PNG data URI per frame. */
const FILMS = SHOWCASE_TILES.map(([name]) => {
	const sheet = `data:image/png;base64,${readFileSync(join(HERE, `film-${name}.png`)).toString("base64")}`;
	const [cw, ch] = [SHEET.width / SHEET.columns, SHEET.height / SHEET.rows];
	return Array.from({ length: SHEET.columns * SHEET.rows }, (_, cell) => {
		const cx = (cell % SHEET.columns) * cw;
		const cy = Math.floor(cell / SHEET.columns) * ch;
		const png = new Resvg(
			svg(
				cw,
				ch,
				`<image href="${sheet}" x="${-cx}" y="${-cy}" width="${SHEET.width}" height="${SHEET.height}"/>`,
			),
			{ fitTo: { mode: "width", value: cw } },
		)
			.render()
			.asPng();
		return `data:image/png;base64,${png.toString("base64")}`;
	});
});

/**
 * The black picture, cropped to fill: the showcase mosaic, or with `shot` one look's film at
 * `frame` with its label (the animated banners cut from one to the next).
 */
function picture(x, y, w, h, r, shot = null, frame = 0) {
	const id = `pic-${x}-${y}`;
	let label = "";
	if (shot !== null) {
		const size = Math.max(10, h * 0.042);
		const tag = mono(SHOWCASE_TILES[shot][1], {
			size,
			x: x + size * 1.7,
			y: y + h - size * 1.7,
			fill: SITE.onGraphite,
		});
		label = `<rect x="${(x + size * 0.9).toFixed(1)}" y="${(y + h - size * 3.2).toFixed(1)}" width="${(tag.width + size * 1.6).toFixed(1)}" height="${(size * 2.2).toFixed(1)}" rx="3" fill="#000" fill-opacity="0.72"/>${tag.svg}`;
	}
	const href =
		shot === null
			? SHOWCASE
			: FILMS[shot][frame % (SHEET.columns * SHEET.rows)];
	const image = `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
	return `
	<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
	<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#000"/>
	${image}${label}`;
}

/**
 * The animated banner: one shot per look, its film playing, cut in turn; `render(shot, t, frame)`
 * gets the loop's progress (t, 0..1) and the frame of the shot's film. Frames go through resvg, then ffmpeg makes one GIF with a palette
 * shared by every frame.
 */
const GIF_FPS = 10;
const SHOT_SECONDS = 2;
function writeGif(name, render, width, background) {
	const frames = SHOWCASE_TILES.length * SHOT_SECONDS * GIF_FPS;
	const dir = mkdtempSync(join(tmpdir(), `${name}-`));
	try {
		for (let f = 0; f < frames; f++) {
			const shot = Math.floor(f / (SHOT_SECONDS * GIF_FPS));
			const png = new Resvg(
				render(shot, f / frames, f % (SHOT_SECONDS * GIF_FPS)),
				{
					fitTo: { mode: "width", value: width },
					// Opaque, square corners: a transparent pixel anywhere stops the GIF encoder from
					// keeping unchanged pixels between frames, and every frame is sent whole.
					background,
				},
			)
				.render()
				.asPng();
			writeFileSync(join(dir, `f${String(f).padStart(4, "0")}.png`), png);
		}
		execFileSync(
			"ffmpeg",
			[
				"-loglevel",
				"error",
				"-y",
				"-framerate",
				String(GIF_FPS),
				"-i",
				join(dir, "f%04d.png"),
				"-filter_complex",
				"split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
				"-loop",
				"0",
				join(HERE, `${name}.gif`),
			],
			{ stdio: "inherit" },
		);
		console.log(`wrote assets/brand/${name}.gif`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * The showcase for framefields.dev's desktop section: each style alone with its label for two
 * seconds, then the mosaic, as one animated WebP (img2webp, from libwebp). `showcase.png` is
 * the still the site shows when motion is reduced.
 */
{
	const W = 960;
	const H = 540;
	const dir = mkdtempSync(join(tmpdir(), "showcase-"));
	try {
		const shots = [...SHOWCASE_TILES.keys(), null];
		const files = shots.map((shot, i) => {
			const file = join(dir, `s${i}.png`);
			const png = new Resvg(svg(W, H, picture(0, 0, W, H, 0, shot)), {
				fitTo: { mode: "width", value: W },
			})
				.render()
				.asPng();
			writeFileSync(file, png);
			return file;
		});
		execFileSync(
			"img2webp",
			[
				"-loop",
				"0",
				"-lossy",
				"-q",
				"80",
				...files.flatMap((f, i) => [
					"-d",
					i === files.length - 1 ? "3000" : String(SHOT_SECONDS * 1000),
					f,
				]),
				"-o",
				join(HERE, "showcase.webp"),
			],
			{ stdio: "ignore" },
		);
		console.log("wrote assets/brand/showcase.webp");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── Main banner: the engine. Paper room, a graphite monitor with the film and its timeline.
{
	const W = 1280;
	const H = 400;
	const left = 80;
	const kicker = mono("The video engine for coding agents", {
		x: left,
		y: 112,
		fill: SITE.steel,
	});
	const word = display("framefields", {
		size: 100,
		x: left + 96,
		y: 218,
		fill: SITE.ink,
		tracking: 0.005,
	});
	const lede = type(
		"Compositing, motion graphics and 3D, written in TypeScript.",
		{
			size: 21,
			weight: 500,
			x: left,
			y: 276,
			fill: SITE.ink,
		},
	);
	const sub = type("Rendered natively on the GPU. No headless browser.", {
		size: 18,
		x: left,
		y: 306,
		fill: SITE.steel,
	});

	// The monitor: picture over a timeline of three scenes, the playhead in signal yellow.
	const mx = 712;
	const my = 44;
	const mw = 492;
	const pw = mw - 24;
	const ph = Math.round((pw * 9) / 16);
	const mh = ph + 24 + 44;
	const tlY = my + 12 + ph + 16;
	// One clip per style on the timeline.
	const clips = SHOWCASE_TILES.length;
	const clipW = pw / clips;
	const scenes = SHOWCASE_TILES.map(
		(_, i) =>
			`<rect x="${(mx + 12 + i * clipW).toFixed(1)}" y="${tlY}" width="${(clipW - 3).toFixed(1)}" height="14" rx="2" fill="${SITE.scenes[i % SITE.scenes.length]}"/>`,
	).join("");
	const loopFrames = clips * SHOT_SECONDS * 30;
	const timecode = (t) => {
		const f = Math.round(t * loopFrames);
		const ss = String(Math.floor(f / 30)).padStart(2, "0");
		const ff = String(f % 30).padStart(2, "0");
		return mono(`00:00:${ss}:${ff}`, {
			size: 11,
			x: mx + 12,
			y: tlY + 33,
			fill: SITE.graphiteDim,
			tracking: 0.02,
		});
	};
	const fps = mono("1920×1080 · 30 fps", {
		size: 11,
		x: 0,
		y: 0,
		fill: SITE.graphiteDim,
		tracking: 0.02,
	});
	const fpsSvg = mono("1920×1080 · 30 fps", {
		size: 11,
		x: mx + 12 + pw - fps.width,
		y: tlY + 33,
		fill: SITE.graphiteDim,
		tracking: 0.02,
	});
	const monitor = (shot, t, frame) => {
		const head = mx + 12 + pw * t;
		return `
	<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="6" fill="${SITE.graphite}"/>
	${picture(mx + 12, my + 12, pw, ph, 3, shot, frame)}
	${scenes}
	<line x1="${head}" y1="${tlY - 10}" x2="${head}" y2="${tlY + 20}" stroke="${SITE.signal}" stroke-width="2"/>
	<path d="M ${head - 6} ${tlY - 6} L ${head + 6} ${tlY - 6} L ${head} ${tlY + 1} Z" fill="${SITE.signal}"/>
	${timecode(t).svg}${fpsSvg.svg}`;
	};

	const body = (shot, t, frame) => `
	<rect width="${W}" height="${H}" rx="8" fill="${SITE.paper}"/>
	<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="7.5" fill="none" stroke="${SITE.rule}"/>
	${kicker.svg}
	${mark({ x: left - 4, y: 140, size: 88, paint: SITE.ink })}
	${word.svg}
	${lede.svg}${sub.svg}
	${monitor(shot, t, frame)}`;
	writeBoth("banner", svg(W, H, body(null, 0.24)), W);
	writeGif(
		"banner",
		(shot, t, frame) => svg(W, H, body(shot, t, frame)),
		W,
		SITE.paper,
	);
}

// ── Desktop banner: the app. Graphite, as framefields.dev's desktop section, with the window
// drawn to its real layout: sessions, the preview over the conversation, a render running.
{
	const W = 1280;
	const H = 400;
	const left = 80;
	const kicker = mono("Desktop app for macOS and Linux", {
		x: left,
		y: 96,
		fill: SITE.graphiteDim,
	});
	const word = display("framefields", {
		size: 92,
		x: left,
		y: 196,
		fill: SITE.onGraphite,
		tracking: 0.005,
	});
	const lede = type("Make videos by talking to an agent.", {
		size: 23,
		weight: 500,
		x: left,
		y: 244,
		fill: SITE.onGraphite,
	});
	const sub = type(
		"Say what you want, watch it come together, export it ready to post.",
		{
			size: 17,
			x: left,
			y: 274,
			fill: SITE.graphiteDim,
		},
	);
	const cta = type("Download for macOS and Linux", {
		size: 17,
		weight: 700,
		x: left + 50,
		y: 323,
		fill: SITE.ink,
	});
	const bx = left;
	const by = 296;
	const ix = bx + 22;
	const iy = by + 11;
	const button = `
	<rect x="${bx}" y="${by}" width="${(cta.width + 72).toFixed(1)}" height="42" rx="4" fill="${SITE.onGraphite}"/>
	<path d="M ${ix + 8} ${iy} V ${iy + 13} M ${ix + 3} ${iy + 8} L ${ix + 8} ${iy + 13} L ${ix + 13} ${iy + 8} M ${ix + 1} ${iy + 19} H ${ix + 15}" fill="none" stroke="${SITE.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
	${cta.svg}`;

	// The window.
	const wx = 652;
	const wy = 28;
	const ww = 556;
	const wh = 344;
	const bar = 38;
	const side = 148;
	const lights = [0, 1, 2]
		.map(
			(i) =>
				`<circle cx="${wx + 18 + i * 16}" cy="${wy + bar / 2}" r="5" fill="${SITE.graphiteLine}"/>`,
		)
		.join("");
	// One session per style: as the preview cuts, the session it belongs to is the open one.
	const PROJECTS = [
		[
			"Speaker launch teaser",
			"Product launch · 16:9",
			"Slow the light sweep and land it on the logo.",
		],
		[
			"Creator cut, 9:16",
			"Social · 9:16",
			"Cut it to 9:16 with captions that pop on the beat.",
		],
		[
			"Shapes bumper",
			"Bumper · 16:9",
			"Swing the bar in on the downbeat, then hold.",
		],
		[
			"How the gearbox works",
			"Explainer · 16:9",
			"Draw each arrow as the voice names the step.",
		],
		[
			"Lighthouse brand film",
			"Brand film · 16:9",
			"Let the beam cross the sea before the title.",
		],
		[
			"Lyric video, verse 2",
			"Music · 16:9",
			"Sync each line of verse 2 to the vocal.",
		],
	];
	const header = (open) => {
		const [name, about] = PROJECTS[open];
		const title = type(name, {
			size: 12.5,
			weight: 600,
			x: wx + 76,
			y: wy + 23.5,
			fill: SITE.onGraphite,
		});
		const path = type(about, {
			size: 11.5,
			x: wx + 76 + title.width + 10,
			y: wy + 23.5,
			fill: SITE.graphiteDim,
		});
		return title.svg + path.svg;
	};
	let tx = wx + ww - 12;
	const toggles = [
		["Exports · 1", "busy"],
		["Files", ""],
		["Preview", "on"],
	]
		.map(([label, state]) => {
			const t = type(label, {
				size: 11,
				weight: 600,
				x: 0,
				y: 0,
				fill: SITE.ink,
			});
			const w = t.width + 16;
			tx -= w;
			const x = tx;
			tx -= 6;
			const on = state === "on";
			const stroke =
				on || state === "busy" ? SITE.onGraphite : SITE.graphiteLine;
			const label2 = type(label, {
				size: 11,
				weight: 600,
				x: x + 8,
				y: wy + 23,
				fill: on ? SITE.ink : SITE.onGraphite,
			});
			return `<rect x="${x.toFixed(1)}" y="${wy + 10.5}" width="${w.toFixed(1)}" height="18" rx="4" fill="${on ? SITE.onGraphite : "none"}" stroke="${stroke}"/>${label2.svg}`;
		})
		.join("");

	const sx = wx + 12;
	const brand = display("framefields", {
		size: 16,
		x: sx,
		y: wy + bar + 26,
		fill: SITE.onGraphite,
	});
	const newBtn = `<rect x="${sx - 0.5}" y="${wy + bar + 38.5}" width="${side - 24}" height="24" rx="5" fill="none" stroke="${SITE.graphiteLine}"/>${type("+ New", { size: 11.5, x: sx + 8, y: wy + bar + 55, fill: SITE.onGraphite }).svg}`;
	const session = (name, about, y, on) =>
		`${
			on
				? `<rect x="${sx - 4}" y="${y}" width="${side - 16}" height="34" rx="5" fill="${SITE.graphite2}"/><rect x="${sx - 4}" y="${y}" width="2" height="34" fill="${SITE.onGraphite}"/>`
				: ""
		}${type(name, { size: 11.5, x: sx + 4, y: y + 15, fill: SITE.onGraphite }).svg}${type(about, { size: 10, x: sx + 4, y: y + 29, fill: SITE.graphiteDim }).svg}`;
	const sessions = (open) =>
		PROJECTS.map(([name, about], i) =>
			session(name, about, wy + bar + 76 + i * 36, i === open),
		).join("");

	// Main: the preview, then the conversation and the render.
	const mx = wx + side;
	const mw = ww - side;
	const ph = Math.round((mw * 9) / 16);
	const py = wy + bar;
	const cx = mx + 14;
	const cw = mw - 28;
	const cy = py + ph + 12;
	const user = (open) =>
		`<rect x="${cx}" y="${cy}" width="${cw}" height="24" rx="4" fill="${SITE.graphite2}"/>${
			type(PROJECTS[open][2], {
				size: 11.5,
				x: cx + 10,
				y: cy + 16,
				fill: SITE.onGraphite,
			}).svg
		}`;
	const jy = cy + 32;
	const jobName = type("film", {
		size: 11,
		weight: 600,
		x: cx + 10,
		y: jy + 16,
		fill: SITE.onGraphite,
	});
	const trackX = cx + 18 + jobName.width;
	const trackW = cx + cw - 44 - trackX;
	const job = (done) => {
		const pct = mono(`${Math.round(done * 100)}%`, {
			size: 10,
			x: cx + cw - 34,
			y: jy + 15.5,
			fill: SITE.graphiteDim,
			tracking: 0,
		});
		return `<rect x="${cx + 0.5}" y="${jy + 0.5}" width="${cw - 1}" height="23" rx="6" fill="none" stroke="${SITE.graphiteLine}"/>${jobName.svg}
	<rect x="${trackX.toFixed(1)}" y="${jy + 10}" width="${trackW.toFixed(1)}" height="4" rx="2" fill="${SITE.graphiteLine}"/>
	<rect x="${trackX.toFixed(1)}" y="${jy + 10}" width="${(trackW * done).toFixed(1)}" height="4" rx="2" fill="${SITE.onGraphite}"/>${pct.svg}`;
	};

	const appWindow = (shot, done, frame) => `
	<rect x="${wx}" y="${wy + 18}" width="${ww}" height="${wh}" rx="10" fill="#000" fill-opacity="0.5" filter="url(#app-shadow)"/>
	<clipPath id="app-clip"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="10"/></clipPath>
	<g clip-path="url(#app-clip)">
		<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="${SITE.graphite}"/>
		<rect x="${wx}" y="${wy + bar}" width="${side}" height="${wh - bar}" fill="${SITE.side}"/>
		<rect x="${mx}" y="${wy + bar}" width="${mw}" height="${wh - bar}" fill="${SITE.chat}"/>
		<path d="M ${wx} ${wy + bar - 0.5} H ${wx + ww} M ${mx - 0.5} ${wy + bar} V ${wy + wh}" stroke="${SITE.graphiteLine}"/>
		${lights}${header(shot ?? 0)}${toggles}
		${brand.svg}${newBtn}${sessions(shot ?? 0)}
		${picture(mx, py, mw, ph, 0, shot, frame)}${user(shot ?? 0)}${job(done)}
	</g>
	<rect x="${wx + 0.5}" y="${wy + 0.5}" width="${ww - 1}" height="${wh - 1}" rx="9.5" fill="none" stroke="${SITE.graphiteLine}"/>`;

	const body = (shot, done, frame) => `
	<defs>
		<filter id="app-shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
	</defs>
	<rect width="${W}" height="${H}" rx="8" fill="${SITE.graphite}"/>
	<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="7.5" fill="none" stroke="${SITE.graphiteLine}"/>
	${kicker.svg}${word.svg}
	${lede.svg}${sub.svg}${button}
	${appWindow(shot, done, frame)}`;
	writeBoth("banner-desktop", svg(W, H, body(null, 0.64)), W);
	// Each project's render runs from 8% to done while its shot plays.
	writeGif(
		"banner-desktop",
		(shot, t, frame) => {
			const within = (t * SHOWCASE_TILES.length) % 1;
			return svg(W, H, body(shot, 0.08 + 0.92 * within, frame));
		},
		W,
		SITE.graphite,
	);
}
