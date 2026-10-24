/**
 * A host for unit tests: builds plain nodes (no GPU, no fonts) and measures
 * text with a fixed advance per character, so geometry is easy to predict.
 */
import type { LayoutNode } from "@framefields/compositions/program";
import type { Animatable, Host } from "../core/host.js";
import type { MeasureOptions, Metrics } from "../core/text.js";

type Tracks = { tracks: Array<{ prop: string; keyframes: unknown[] }> };

function animatable<T extends object>(
	node: T,
): Animatable<T> & { animation?: Tracks } {
	const target = node as Animatable<T> & { animation?: Tracks };
	Object.defineProperty(target, "animate", {
		value: (...anims: unknown[]) => {
			const incoming = anims.flat().flatMap((a) => (a as Tracks).tracks ?? []);
			target.animation = {
				tracks: [...(target.animation?.tracks ?? []), ...incoming],
			};
			return target;
		},
		enumerable: false,
	});
	return target;
}

/** Every glyph is `fontSize × 0.5` wide; lines are `fontSize × 1.2` tall. */
export function fakeMeasure(text: string, options: MeasureOptions): Metrics {
	const fontSize = options.fontSize ?? 48;
	const advance = fontSize * 0.5 + (options.letterSpacing ?? 0);
	const lineHeight =
		options.lineHeight !== undefined && options.lineHeight < 10
			? options.lineHeight * fontSize
			: (options.lineHeight ?? fontSize * 1.2);
	const glyphs: Metrics["glyphs"] = [];
	let line = 0;
	let x = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i] as string;
		if (char === "\n") {
			line++;
			x = 0;
			continue;
		}
		if (
			options.width !== undefined &&
			x + advance > options.width &&
			char !== " "
		) {
			// Wrap at the previous space (word wrap), or here.
			const lastSpace = glyphs.findLastIndex(
				(g) => g.line === line && g.char === " ",
			);
			line++;
			if (lastSpace >= 0) {
				let nx = 0;
				for (const g of glyphs.slice(lastSpace + 1)) {
					g.line = line;
					g.x = nx;
					nx += advance;
				}
				x = nx;
			} else x = 0;
		}
		glyphs.push({ char, index: i, x, width: advance, line });
		x += advance;
	}
	const lines = line + 1;
	const width = Math.max(0, ...glyphs.map((g) => g.x + g.width));
	return {
		width,
		height: lines * lineHeight,
		lines,
		lineHeight,
		glyphs,
		caretX: (count) => {
			const before = glyphs.filter((g) => g.index < count);
			const last = before[before.length - 1];
			return last ? last.x + last.width : 0;
		},
	};
}

export function fakeHost(): Host & { created: LayoutNode[] } {
	const created: LayoutNode[] = [];
	const counters = new Map<string, number>();
	const make = <T extends object>(node: T) => {
		created.push(node as unknown as LayoutNode);
		return animatable(node);
	};
	return {
		created,
		box: (o) =>
			make({ kind: "box", id: o.id ?? "box", children: [], ...o }) as never,
		flex: (o) =>
			make({ kind: "flex", id: o.id ?? "flex", children: [], ...o }) as never,
		text: (content, o = {}) =>
			make({ kind: "text", id: o.id ?? "text", text: content, ...o }) as never,
		shape: (type, o = {}) =>
			make({
				kind: "shape",
				id: o.id ?? "shape",
				shapeType: type,
				...o,
			}) as never,
		measure: fakeMeasure,
		fonts: () => ["Inter", "JetBrains Mono"],
		media: (source, o) =>
			make({ kind: "media", id: o.id ?? "media", source, ...o }) as never,
		style: (node, config) => {
			(node as unknown as { styles?: unknown[] }).styles = [
				...((node as unknown as { styles?: unknown[] }).styles ?? []),
				config,
			];
			return node;
		},
		cutout: (source, o) =>
			make({
				kind: "media",
				id: o.id ?? "cutout",
				source,
				cutout: o.mode ?? "person",
				...o,
			}) as never,
		particles: (o) =>
			make({ kind: "particles", ...o, id: o.id ?? "particles" }) as never,
		signal: (values, fps) => ({ kind: "signal", values: [...values], fps }),
		grain: (o) => make({ kind: "grain", ...o, id: o.id ?? "grain" }) as never,
		extrudedText: (o) =>
			make({ kind: "model", ...o, id: o.id ?? "extruded" }) as never,
		matte: (node, matte, mode = "alpha") => {
			(node as unknown as { matte?: unknown }).matte = { node: matte, mode };
			return node;
		},
		autoId: (prefix) => {
			const n = (counters.get(prefix) ?? 0) + 1;
			counters.set(prefix, n);
			return `${prefix}-auto-${n}`;
		},
	};
}
