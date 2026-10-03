import type { Signal } from "../signals/index.js";

export interface TextSpanMark {
	background: string | Signal<string>;
	borderRadius?: number;
	paddingX?: number;
	paddingY?: number;
}

export interface TextSpan {
	text: string | Signal<string>;
	fontFamily?: string;
	fontSize?: number | Signal<number>;
	fontWeight?: number | string;
	fontStyle?: "normal" | "italic";
	fill?: string | Signal<string>;
	letterSpacing?: number;
	baselineShift?: number; // px offset (+ down, - up)
	opacity?: number | Signal<number>;
	mark?: TextSpanMark;
}
