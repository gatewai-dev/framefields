import type { Signal, TextSpan, TextSpanMark } from "@gitframes/core";

export type { TextSpan, TextSpanMark };

export type TextSpanItem =
	| string
	| number
	| boolean
	| Signal<unknown>
	| TextSpan
	| (string | TextSpan)[]
	| null
	| undefined;

/**
 * Tagged template literal for authoring rich, multi-style text runs.
 *
 * Interpolates strings, numbers, reactive signals, and typed span modifiers
 * directly into a structured TextSpan[] array with zero runtime parsing.
 *
 * @example
 * rich`Scale ${bold("10x", { fill: "#6366f1" })} faster with ${mark("120 FPS", { bg: "#10b98133" })}`
 */
export function rich(
	strings: TemplateStringsArray,
	...values: TextSpanItem[]
): TextSpan[] {
	const spans: TextSpan[] = [];

	for (let i = 0; i < strings.length; i++) {
		const str = strings[i];
		if (str) {
			spans.push({ text: str });
		}

		if (i < values.length) {
			const val = values[i];
			if (val === null || val === undefined) {
				continue;
			}

			if (Array.isArray(val)) {
				for (const item of val) {
					if (typeof item === "string") {
						if (item) spans.push({ text: item });
					} else if (item && typeof item === "object" && "text" in item) {
						spans.push(item as TextSpan);
					}
				}
			} else if (typeof val === "object" && "text" in val) {
				spans.push(val as TextSpan);
			} else if (
				typeof val === "object" &&
				"get" in val &&
				typeof (val as { get: unknown }).get === "function"
			) {
				spans.push({ text: val as Signal<string> });
			} else {
				spans.push({ text: String(val) });
			}
		}
	}

	return spans;
}

export function span(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return { text, ...options };
}

export function bold(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return { text, fontWeight: options.fontWeight ?? 700, ...options };
}

export function italic(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return { text, fontStyle: "italic", ...options };
}

export function accent(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return { text, fill: options.fill ?? "#6366f1", ...options };
}

export function color(
	text: string | Signal<string>,
	fill: string | Signal<string>,
	options: Omit<TextSpan, "text" | "fill"> = {},
): TextSpan {
	return { text, fill, ...options };
}

export function size(
	text: string | Signal<string>,
	fontSize: number | Signal<number>,
	options: Omit<TextSpan, "text" | "fontSize"> = {},
): TextSpan {
	return { text, fontSize, ...options };
}

export interface MarkOptions extends Omit<TextSpan, "text" | "mark" | "fill"> {
	bg?: string | Signal<string>;
	fill?: string | Signal<string>;
	radius?: number;
	paddingX?: number;
	paddingY?: number;
}

export function mark(
	text: string | Signal<string>,
	options: MarkOptions = {},
): TextSpan {
	const { bg, fill, radius, paddingX, paddingY, ...rest } = options;
	return {
		text,
		fill,
		mark: {
			background: bg ?? "#6366f133",
			borderRadius: radius ?? 4,
			paddingX: paddingX ?? 6,
			paddingY: paddingY ?? 2,
		},
		...rest,
	};
}

export function sup(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return {
		text,
		baselineShift: options.baselineShift ?? -8,
		...options,
	};
}

export function sub(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return {
		text,
		baselineShift: options.baselineShift ?? 6,
		...options,
	};
}

export function code(
	text: string | Signal<string>,
	options: Omit<TextSpan, "text"> = {},
): TextSpan {
	return {
		text,
		fontFamily: options.fontFamily ?? "JetBrains Mono",
		mark: options.mark ?? {
			background: "#ffffff18",
			borderRadius: 4,
			paddingX: 6,
			paddingY: 2,
		},
		...options,
	};
}

/**
 * Normalizes string, TextSpan[], or array of mixed strings/spans into plain text and spans.
 */
export function normalizeTextSpans(
	input: string | TextSpan[] | (string | TextSpan)[],
): { text: string; spans?: TextSpan[] } {
	if (typeof input === "string") {
		return { text: input };
	}

	if (!Array.isArray(input)) {
		return { text: String(input) };
	}

	const spans: TextSpan[] = [];
	let plainText = "";

	for (const item of input) {
		if (typeof item === "string") {
			if (item) {
				spans.push({ text: item });
				plainText += item;
			}
		} else if (item && typeof item === "object" && "text" in item) {
			const s = item as TextSpan;
			spans.push(s);
			const piece =
				typeof s.text === "string"
					? s.text
					: s.text &&
							typeof s.text === "object" &&
							"get" in s.text &&
							typeof (s.text as { get: () => unknown }).get === "function"
						? String((s.text as { get: () => unknown }).get())
						: String(s.text ?? "");
			plainText += piece;
		}
	}

	return {
		text: plainText,
		spans: spans.length > 0 ? spans : undefined,
	};
}

/**
 * Upfront parser for external CMS or subtitle strings containing basic tags
 * (<b>, <i>, <span>, <color>, <mark>, <accent>, <code>, <sup>, <sub>).
 *
 * Compiles string markup into clean TextSpan[] before entering the composition pipeline.
 */
export function parseMarkup(markup: string): TextSpan[] {
	if (!markup || !markup.includes("<")) {
		return [{ text: markup }];
	}

	const spans: TextSpan[] = [];
	const tagRegex = /<(\/?[a-zA-Z0-9_-]+)([^>]*)>/g;
	let lastIndex = 0;

	interface StyleState {
		tag: string;
		style: Partial<TextSpan>;
	}
	const stack: StyleState[] = [];

	const getCurrentStyle = (): Partial<TextSpan> => {
		const merged: Partial<TextSpan> = {};
		for (const state of stack) {
			Object.assign(merged, state.style);
		}
		return merged;
	};

	for (;;) {
		const match = tagRegex.exec(markup);
		if (!match) {
			break;
		}
		const textBefore = markup.slice(lastIndex, match.index);
		if (textBefore) {
			spans.push({ text: textBefore, ...getCurrentStyle() });
		}
		lastIndex = match.index + match[0].length;

		const tagName = match[1].toLowerCase();
		const rawAttrs = match[2];

		if (tagName.startsWith("/")) {
			const closingTag = tagName.slice(1);
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tag === closingTag) {
					stack.splice(i, 1);
					break;
				}
			}
		} else {
			const attrs: Record<string, string> = {};
			const attrRegex = /([a-zA-Z0-9_-]+)=["']([^"']*)["']/g;
			for (;;) {
				const attrMatch = attrRegex.exec(rawAttrs);
				if (!attrMatch) {
					break;
				}
				attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
			}

			const style: Partial<TextSpan> = {};

			if (tagName === "b" || tagName === "strong") {
				style.fontWeight = 700;
				if (attrs.color || attrs.fill) style.fill = attrs.color ?? attrs.fill;
			} else if (tagName === "i" || tagName === "em") {
				style.fontStyle = "italic";
				if (attrs.color || attrs.fill) style.fill = attrs.color ?? attrs.fill;
			} else if (tagName === "accent") {
				style.fill = "#6366f1";
			} else if (tagName === "color") {
				style.fill = attrs.value ?? attrs.hex ?? attrs.fill;
			} else if (tagName === "size") {
				const num = parseFloat(attrs.value ?? attrs.px ?? attrs.pt ?? "0");
				if (num > 0) style.fontSize = num;
			} else if (tagName === "mark") {
				style.mark = {
					background: attrs.bg ?? attrs.background ?? "#6366f133",
					borderRadius: attrs.radius ? parseFloat(attrs.radius) : 4,
					paddingX: attrs.paddingx ? parseFloat(attrs.paddingx) : 6,
					paddingY: attrs.paddingy ? parseFloat(attrs.paddingy) : 2,
				};
				if (attrs.color || attrs.fill) style.fill = attrs.color ?? attrs.fill;
			} else if (tagName === "sup") {
				style.baselineShift = -8;
			} else if (tagName === "sub") {
				style.baselineShift = 6;
			} else if (tagName === "code") {
				style.fontFamily = "JetBrains Mono";
				style.mark = {
					background: attrs.bg ?? "#ffffff18",
					borderRadius: 4,
					paddingX: 6,
					paddingY: 2,
				};
			} else if (tagName === "span") {
				if (attrs.color || attrs.fill) style.fill = attrs.color ?? attrs.fill;
				if (attrs.fontfamily) style.fontFamily = attrs.fontfamily;
				if (attrs.fontsize) style.fontSize = parseFloat(attrs.fontsize);
				if (attrs.fontweight) {
					const nw = parseInt(attrs.fontweight, 10);
					style.fontWeight = Number.isNaN(nw) ? attrs.fontweight : nw;
				}
				if (attrs.fontstyle === "italic" || attrs.fontstyle === "normal") {
					style.fontStyle = attrs.fontstyle;
				}
				if (attrs.letterspacing)
					style.letterSpacing = parseFloat(attrs.letterspacing);
				if (attrs.baselineshift)
					style.baselineShift = parseFloat(attrs.baselineshift);
				if (attrs.opacity) style.opacity = parseFloat(attrs.opacity);
			}

			stack.push({ tag: tagName, style });
		}
	}

	const remainingText = markup.slice(lastIndex);
	if (remainingText) {
		spans.push({ text: remainingText, ...getCurrentStyle() });
	}

	return spans;
}
