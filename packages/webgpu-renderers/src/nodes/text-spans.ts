import type { FrameContext, TextSpan } from "@framefields/core";

type Gettable<T> = { get: (ctx?: FrameContext) => T };

function isGettable<T>(v: unknown): v is Gettable<T> {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as { get?: unknown }).get === "function"
	);
}

function resolve<T>(v: T | Gettable<T>, ctx?: FrameContext): T {
	return isGettable<T>(v) ? v.get(ctx) : v;
}

/**
 * The spans' animated fields (text, size, fill, opacity, mark background)
 * read for one frame, so the spans can be sliced, compared and cached as
 * plain values.
 */
export function resolveTextSpans(
	spans: readonly TextSpan[],
	ctx?: FrameContext,
): TextSpan[] {
	return spans.map((s) => {
		const out: TextSpan = { ...s, text: String(resolve(s.text, ctx) ?? "") };
		if (s.fontSize !== undefined)
			out.fontSize = Number(resolve(s.fontSize, ctx));
		if (s.fill !== undefined) out.fill = String(resolve(s.fill, ctx));
		if (s.opacity !== undefined) out.opacity = Number(resolve(s.opacity, ctx));
		if (s.mark)
			out.mark = {
				...s.mark,
				background: String(resolve(s.mark.background, ctx)),
			};
		return out;
	});
}

/** The plain text the spans spell out, in order. */
export function spansText(spans: readonly TextSpan[]): string {
	let text = "";
	for (const s of spans) text += typeof s.text === "string" ? s.text : "";
	return text;
}

/**
 * Re-cut `text` across resolved spans by position: span i keeps the styling
 * of characters [start_i, end_i) of the spans' own text. A revealed prefix
 * (typewriter, word or line reveal) keeps each visible character in its
 * span's style and drops the spans not reached yet; a same-length rewrite
 * (scramble) restyles in place. Text past the spans' end takes the last
 * span's style.
 */
export function fitSpansToText(
	spans: readonly TextSpan[],
	text: string,
): TextSpan[] {
	const out: TextSpan[] = [];
	let offset = 0;
	for (const [i, s] of spans.entries()) {
		if (offset >= text.length) break;
		const len = typeof s.text === "string" ? s.text.length : 0;
		const end = i === spans.length - 1 ? text.length : offset + len;
		if (end > offset) out.push({ ...s, text: text.slice(offset, end) });
		offset = end;
	}
	return out;
}
