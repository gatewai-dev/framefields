/**
 * Static checks for things that render "fine" but not as intended: a color
 * the parser can't read (drawn transparent), text that disappears into its
 * background, a layer parked off-canvas, a shadow on a light that can't cast
 * one. Pure and fast; `renderVideo({ qa })` folds the findings into its report.
 */
import {
	Color,
	parseCssColor,
	parseCssGradient,
	type RenderDiagnostic,
} from "@framefields/core";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";

type AnyNode = LayoutNode & Record<string, unknown>;

const COLOR_PROPS = [
	"background",
	"fill",
	"fillColor",
	"strokeColor",
	"borderColor",
	"gradientEndColor",
	"emissive",
	"color",
] as const;

/**
 * Keyframes on one layer past which an animation is probably keyed every
 * frame by mistake. There is no hard limit: evaluation and playback handle
 * any count, but programs this size are slow to send, read and edit.
 */
export const LARGE_ANIMATION_KEYFRAMES = 2000;

/**
 * Characters layout draws from the color emoji font (the renderer's own
 * test, `emojiGraphemes` in webgpu-renderers).
 */
const EMOJI =
	/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])/u;

/** The text a text node draws: its string and its spans'. */
function textOf(node: AnyNode): string {
	const spans = (node.spans as Array<{ text?: unknown }> | undefined) ?? [];
	return [node.text, ...spans.map((s) => s.text)]
		.filter((t): t is string => typeof t === "string")
		.join("");
}

export interface LintOptions {
	/**
	 * Whether a color emoji font is registered (framefields'
	 * `FontManager.hasEmojiFont()`). When false, text with emoji is flagged:
	 * the emoji would draw nothing. Unknown (omitted): not checked.
	 */
	emojiFont?: boolean;
}

/** Contrast below this makes text hard to read (WCAG large-text minimum). */
const MIN_TEXT_CONTRAST = 3;

function tracksOf(node: AnyNode): Array<{
	prop: string;
	keyframes?: Array<{ value: unknown }>;
	source?: { type?: string };
}> {
	const a = node.animation as { tracks?: unknown[] } | undefined;
	return (a?.tracks ?? []) as never;
}

const animates = (node: AnyNode, props: string[]) =>
	tracksOf(node).some((t) => props.includes(t.prop));

const CONTAINERS = new Set(["box", "flex", "block", "group"]);

/** Whether a layer puts pixels behind whatever is drawn after it (text over text aside). */
function paints(node: AnyNode): boolean {
	if (node.kind === "text" || node.kind === "light" || node.kind === "camera")
		return false;
	if (!CONTAINERS.has(String(node.kind))) return true;
	const bg = node.background;
	if (typeof bg === "string" && bg !== "" && bg !== "transparent") return true;
	return ((node.children as AnyNode[] | undefined) ?? []).some(paints);
}

const byZ = (nodes: AnyNode[]) =>
	[...nodes].sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0));

function solidColor(value: unknown): string | null {
	if (typeof value !== "string" || value.includes("gradient(")) return null;
	const c = parseCssColor(value);
	return c && c[3] > 0.99 ? value : null;
}

export function lintComposition(
	config: Pick<CompositorProgramConfig, "width" | "height" | "layout"> & {
		backgroundColor?: string;
	},
	options: LintOptions = {},
): RenderDiagnostic[] {
	const out: RenderDiagnostic[] = [];
	const push = (
		severity: RenderDiagnostic["severity"],
		code: string,
		message: string,
		layerId?: string,
	) => out.push({ severity, code, message, ...(layerId && { layerId }) });

	const W = config.width;
	const H = config.height;
	let hasEnvironment = false;
	const ambientLights: string[] = [];
	let has3D = false;
	const pbrNodes: string[] = [];
	const shadowLights: string[] = [];
	const emojiText: string[] = [];

	const visit = (node: AnyNode, backdrop: string | null, atRoot: boolean) => {
		const id = String(node.id ?? "?");
		if (
			options.emojiFont === false &&
			node.kind === "text" &&
			EMOJI.test(textOf(node))
		)
			emojiText.push(id);

		for (const prop of COLOR_PROPS) {
			const v = node[prop];
			if (typeof v !== "string" || v === "" || v === "transparent") continue;
			if (v.includes("gradient(")) {
				if (!parseCssGradient(v)) {
					push(
						"error",
						"invalid_gradient",
						`\`${prop}\` on '${id}' is not a gradient this renderer reads: ${v}. It draws nothing.`,
						id,
					);
				}
			} else if (!parseCssColor(v)) {
				push(
					"warning",
					"unknown_color",
					`\`${prop}: "${v}"\` on '${id}' is not a color (hex, rgb(), hsl(), oklch() or a CSS name). It draws transparent.`,
					id,
				);
			}
		}

		if (node.kind === "light") {
			const type = node.lightType ?? "directional";
			if (type === "environment") hasEnvironment = true;
			if (type === "ambient") ambientLights.push(id);
			if (node.castShadow) {
				if (type === "directional" || type === "spot") shadowLights.push(id);
				else
					push(
						"warning",
						"shadow_unsupported_light",
						`'${id}' is a ${String(type)} light: only directional and spot lights cast shadows.`,
						id,
					);
			}
			return;
		}
		if (node.kind === "camera") return;

		if (node.kind === "media") {
			const src = node.inputHandleId;
			if (typeof src === "string") {
				const dataType = node.dataType ?? "Video";
				if (dataType === "Image") {
					if (/\.(json|lottie)(\?.*)?$/i.test(src)) {
						push(
							"error",
							"unsupported_image_format",
							`'${id}' is an image layer with source '${src}', which is a Lottie vector animation. Use Layer.lottie() instead.`,
							id,
						);
					} else if (/\.(mp4|mov|webm|mkv)(\?.*)?$/i.test(src)) {
						push(
							"error",
							"unsupported_image_format",
							`'${id}' is an image layer with video source '${src}'. Use Layer.video() instead.`,
							id,
						);
					} else if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(src)) {
						push(
							"error",
							"unsupported_image_format",
							`'${id}' is an image layer with audio source '${src}'. Use Layer.audio() instead.`,
							id,
						);
					}
				}
			}
		}

		const is3D =
			Boolean(node.is3D) || (typeof node.z === "number" && node.z !== 0);
		if (is3D || node.kind === "model3d") has3D = true;
		if (node.roughness !== undefined || node.metallic !== undefined)
			pbrNodes.push(id);

		// Text that vanishes into what is behind it.
		if (
			node.kind === "text" &&
			backdrop &&
			!animates(node, ["fill", "color"])
		) {
			const fg = solidColor(node.fill ?? node.color);
			const behind = solidColor(node.background) ?? backdrop;
			if (fg) {
				const ratio = Color.contrast(fg, behind);
				if (ratio < MIN_TEXT_CONTRAST) {
					push(
						"warning",
						"low_contrast_text",
						`Text '${id}' (${fg}) on ${behind} has contrast ${ratio.toFixed(2)}:1 (aim for ≥ ${MIN_TEXT_CONTRAST}; ${Color.readableOn(behind)} reads well).`,
						id,
					);
				}
			}
		}

		// A static layer entirely outside the canvas never shows.
		if (
			atRoot &&
			!is3D &&
			node.position === "absolute" &&
			typeof node.x === "number" &&
			typeof node.y === "number" &&
			typeof node.width === "number" &&
			typeof node.height === "number" &&
			!animates(node, [
				"x",
				"y",
				"translateX",
				"translateY",
				"scale",
				"scaleX",
				"scaleY",
				"rotation",
			])
		) {
			const { x, y, width, height } = node as unknown as Record<string, number>;
			if (x + width <= 0 || y + height <= 0 || x >= W || y >= H) {
				push(
					"warning",
					"offscreen_layer",
					`'${id}' sits entirely outside the ${W}×${H} canvas (x ${x}, y ${y}) and never moves in.`,
					id,
				);
			}
		}

		const keyframeCount = tracksOf(node).reduce(
			(n, t) => n + (t.keyframes?.length ?? 0),
			0,
		);
		if (keyframeCount > LARGE_ANIMATION_KEYFRAMES) {
			push(
				"warning",
				"large_animation",
				`'${id}' has ${keyframeCount} keyframes across its tracks (over ${LARGE_ANIMATION_KEYFRAMES}). Keying every frame is rarely needed: key the turning points and let eases fill in, or drive the prop from a signal.`,
				id,
			);
		}

		for (const t of tracksOf(node)) {
			const kfs = t.keyframes ?? [];
			if (
				(!t.source || t.source.type === "keyframe") &&
				kfs.length >= 2 &&
				kfs.every(
					(k) => JSON.stringify(k.value) === JSON.stringify(kfs[0].value),
				)
			) {
				push(
					"info",
					"static_track",
					`'${id}' animates \`${t.prop}\` but every keyframe holds ${JSON.stringify(kfs[0].value)}.`,
					id,
				);
			}
		}

		const ownBackdrop = solidColor(node.background) ?? backdrop;
		const children = node.children as AnyNode[] | undefined;
		// A full-canvas container passes "root" status down (scene boxes).
		const fullFrame =
			node.x === 0 && node.y === 0 && node.width === W && node.height === H;
		visitLevel(children ?? [], ownBackdrop, atRoot && fullFrame);
	};

	// The backdrop is known only until something paints over it: text after
	// an image, shape or panel at the same level sits on unknown pixels.
	const visitLevel = (
		nodes: AnyNode[],
		backdrop: string | null,
		atRoot: boolean,
	) => {
		let known = backdrop;
		for (const n of byZ(nodes)) {
			visit(n, known, atRoot);
			if (paints(n)) known = null;
		}
	};

	const rootBackdrop = solidColor(config.backgroundColor) ?? null;
	visitLevel(config.layout as AnyNode[], rootBackdrop, true);

	if (emojiText.length > 0) {
		const shown = emojiText
			.slice(0, 3)
			.map((id) => `'${id}'`)
			.join(", ");
		push(
			"warning",
			"missing_emoji_font",
			`${emojiText.length === 1 ? "Text" : `${emojiText.length} text layers`} ${shown}${emojiText.length > 3 ? ", …" : ""} ${emojiText.length === 1 ? "has" : "have"} emoji, but no emoji font is registered, so the emoji draw nothing. Run \`npx framefields fonts add emoji\` and call the generated \`registerFonts()\`, or \`FontManager.registerEmojiFont(path)\` with a color emoji font.`,
			emojiText[0],
		);
	}
	if (hasEnvironment && ambientLights.length > 0) {
		push(
			"info",
			"ambient_with_environment",
			`The environment already fills shadows with light; ambient light ${ambientLights.join(", ")} adds flat light on top (remove it, or lower it, if the scene looks washed out).`,
		);
	}
	if (shadowLights.length > 1) {
		push(
			"info",
			"multiple_shadow_lights",
			`${shadowLights.length} lights cast shadows (${shadowLights.join(", ")}); only the first one does.`,
		);
	}
	if (has3D && pbrNodes.length > 0 && !hasEnvironment) {
		push(
			"info",
			"pbr_without_environment",
			`roughness / metallic are set (${pbrNodes.slice(0, 3).join(", ")}${pbrNodes.length > 3 ? ", …" : ""}) but the scene has no Layer.environment(): add one for physically based shading, reflections and tone mapping.`,
		);
	}
	return out;
}
