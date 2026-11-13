/**
 * Card pictures, rendered by the engine: a WebP still and a short muted H.264
 * loop for hover. HDRIs are shown lighting three spheres (chrome, gloss,
 * clay) while the panorama turns once, which says more about a light than
 * the flat panorama does.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	type LayoutNode,
	Signal,
} from "framefields";
import sharp from "sharp";

export const FPS = 30;

export interface RenderedPreview {
	/** WebP. */
	poster: Buffer;
	/** H.264 MP4, no audio. */
	clip: Buffer;
	aspect: number;
	color: string;
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

let renderer: HeadlessMediaRenderer | undefined;
/** One GPU device for the whole build. */
function gpu(): HeadlessMediaRenderer {
	renderer ??= new HeadlessMediaRenderer();
	return renderer;
}

/** A preview scene at a given output size (the framing stays the same). */
export type SceneBuilder = (size: {
	width: number;
	height: number;
}) => Composition;

/**
 * The still at `poster` and the clip of the whole scene at `size`. The still
 * renders at `supersample`× and is scaled down, for crisp edges on a 2×
 * display; pass 1 for a scene whose framing doesn't follow its size (2D
 * layouts in pixels).
 */
export async function renderPreview(
	build: SceneBuilder,
	poster: number,
	size: { width: number; height: number },
	supersample = 2,
): Promise<RenderedPreview> {
	const big = {
		width: size.width * supersample,
		height: size.height * supersample,
	};
	const png = await build(big).renderFrame({ frame: poster, renderer: gpu() });
	const webp = await sharp(png)
		.resize({ ...size, kernel: "lanczos3" })
		.webp({ quality: 88, effort: 6 })
		.toBuffer();
	const { dominant } = await sharp(png).stats();
	const dir = mkdtempSync(join(tmpdir(), "framefields-library-"));
	try {
		const outputPath = join(dir, "clip.mp4");
		await build(size).renderVideo({
			outputPath,
			codec: "h264",
			quality: "high",
			// Hover clips play muted: no audio track at all.
			audio: false,
			renderer: gpu(),
		});
		return {
			poster: webp,
			clip: readFileSync(outputPath),
			aspect: Number((size.width / size.height).toFixed(4)),
			color: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Cards show about 340 px wide, the details pane about 680 px on a 2× display. */
export const HDRI_WIDTH = 1280;
export const HDRI_HEIGHT = 720;
/** Four seconds for one full turn: the clip loops seamlessly. */
export const HDRI_FRAMES = 4 * FPS;

/** Three spheres on a floor, lit and reflected by `hdri`, which turns once. */
export function hdriScene(
	hdri: `${string}.hdr` | `${string}.exr`,
	size = { width: HDRI_WIDTH, height: HDRI_HEIGHT },
): Composition {
	// Scene units are a 640×360 frame's; the camera keeps that framing at any size.
	const comp = new Composition({
		...size,
		fps: FPS,
		durationFrames: HDRI_FRAMES,
		backgroundColor: "#16181d",
	});
	const floor = 250;
	const sphere = (x: number, options: Record<string, unknown>) =>
		Layer3D.sphere({
			x,
			y: floor - 62,
			z: 0,
			radius: 62,
			castShadow: true,
			...options,
		});
	// One full turn over the clip, so its last frame leads into its first.
	const turn = Signal.fromArray(
		Array.from({ length: HDRI_FRAMES }, (_, f) => (f * 360) / HDRI_FRAMES),
		FPS,
	);
	comp.add([
		// Close and a little above: the spheres fill the frame, the floor shows their shadows.
		Layer.camera({
			x: 320,
			y: 140,
			z: -540,
			targetX: 320,
			targetY: floor - 70,
			targetZ: 0,
			fov: 30,
		}),
		Layer.environment({
			hdri,
			intensity: 1,
			rotation: turn,
			floor: {
				y: floor,
				color: "#5a5d66",
				reflectivity: 0.08,
				roughness: 0.7,
				fadeDistance: 1600,
			},
		}),
		sphere(170, { color: "#f2f3f5", metallic: 1, roughness: 0.04 }),
		sphere(320, { color: "#f4f4f4", metallic: 0, roughness: 0.22 }),
		sphere(470, { color: "#c4ad98", metallic: 0, roughness: 0.85 }),
	] as LayoutNode[]);
	return comp;
}
