/**
 * Charts built from ordinary layout nodes. d3 does the math (scales, ticks,
 * line/area/arc geometry, stacking); every bar, line, slice and label is a
 * regular box, shape or text node, so charts use the composition's fonts and
 * can be animated, graded and composited like any other layer.
 */
import {
	type BoxNode,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { format as d3Format } from "d3-format";
import {
	type ScaleBand,
	type ScaleLinear,
	type ScaleTime,
	scaleBand,
	scaleLinear,
	scaleUtc,
} from "d3-scale";
import {
	type CurveFactory,
	curveLinear,
	curveMonotoneX,
	curveStepAfter,
	arc as d3Arc,
	area as d3Area,
	line as d3Line,
	pie as d3Pie,
	stack as d3Stack,
	stackOffsetDiverging,
} from "d3-shape";
import { autoId } from "./ids.js";
import { type AnimatableNode, Layer } from "./index.js";

export type ChartType =
	| "line"
	| "area"
	| "bar"
	| "scatter"
	| "pie"
	| "donut"
	| "candlestick";

export type ChartX = number | string | Date;

/** A plain value (x is its index or `categories[i]`), an `[x, y]` pair, or `{ x, y }`. */
export type ChartDatum =
	| number
	| readonly [ChartX, number]
	| { x: ChartX; y: number };

export interface ChartCandle {
	x: ChartX;
	open: number;
	high: number;
	low: number;
	close: number;
}

/** A pie or donut slice. */
export interface ChartSlice {
	label: string;
	value: number;
	color?: string;
}

export interface ChartSeries {
	name?: string;
	/** Series type in a combined chart; defaults to the chart's `type`. */
	type?: Exclude<ChartType, "pie" | "donut">;
	data: readonly ChartDatum[] | readonly ChartCandle[];
	color?: string;
	/** Line width for line and area series. Default 3. */
	strokeWidth?: number;
	/** Line and area interpolation. Default "smooth". */
	curve?: "linear" | "smooth" | "step";
	/** Dot radius drawn on line points; scatter point radius. 0 hides line dots. */
	pointRadius?: number;
}

export interface ChartAxisOptions {
	/** Show tick labels. Default true. */
	show?: boolean;
	/** Draw grid lines across the plot. Default true for y, false for x. */
	grid?: boolean;
	min?: number;
	max?: number;
	/** Approximate number of ticks. Default 5. */
	ticks?: number;
	/** A d3-format specifier such as ",.0f", "$.2s" or ".0%", or a function. */
	format?: string | ((value: ChartX) => string);
}

export interface ChartAnimationOptions {
	/** Frame the reveal starts, relative to the chart's own start. Default 0. */
	start?: number;
	/** Frames each element takes to animate in. Default 30. */
	duration?: number;
	/** Frames between consecutive bars, points or slices. Default spreads them over `duration`. */
	stagger?: number;
	/** Easing for bars, points and slices. Default "power3.out". */
	ease?: string;
}

export interface ChartPadding {
	top?: number;
	right?: number;
	bottom?: number;
	left?: number;
}

export interface ChartOptions {
	/** Chart type, and the default for series without their own. Default "line". */
	type?: ChartType;
	width?: number;
	height?: number;
	series?: readonly ChartSeries[];
	/** Shorthand for a single series, or the slices of a pie or donut. */
	data?: readonly ChartDatum[] | readonly ChartCandle[] | readonly ChartSlice[];
	/** Labels for x positions when data are plain values; slice labels for pie charts. */
	categories?: readonly string[];
	/** Stack bar and area series instead of grouping or overlapping them. */
	stacked?: boolean;
	colors?: readonly string[];
	xAxis?: ChartAxisOptions;
	yAxis?: ChartAxisOptions;
	/** Space around the plot for axis labels and legend. Computed when omitted. */
	padding?: number | ChartPadding;
	fontFamily?: string;
	/** Axis, legend and value label size. Default 18. */
	fontSize?: number;
	/** Axis labels; when set, also the legend and value labels. */
	textColor?: string;
	gridColor?: string;
	background?: string;
	/** Show the series or slice legend. Default: on for several series and for pies. */
	legend?: boolean;
	/** Print values on bars and slices (pie values print as percentages). */
	valueLabels?: boolean;
	/** Donut hole as a fraction of the radius. Default 0.6 for "donut". */
	innerRadius?: number;
	/** Corner radius of bars and slices. Default 4. */
	cornerRadius?: number;
	upColor?: string;
	downColor?: string;
	/** Reveal animation, or `false` for a static chart. */
	animate?: false | ChartAnimationOptions;
}

export const DEFAULT_CHART_COLORS = [
	"#6366f1",
	"#22d3ee",
	"#f59e0b",
	"#ec4899",
	"#10b981",
	"#8b5cf6",
	"#f97316",
	"#3b82f6",
] as const;

type XScale =
	| ScaleBand<string>
	| ScaleLinear<number, number>
	| ScaleTime<number, number>;

interface Timing {
	enabled: boolean;
	start: number;
	duration: number;
	stagger: number;
	ease: string;
}

interface Point {
	x: ChartX;
	y: number;
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const isCandle = (d: unknown): d is ChartCandle =>
	typeof d === "object" && d !== null && "open" in d && "close" in d;

const isSlice = (d: unknown): d is ChartSlice =>
	typeof d === "object" && d !== null && "label" in d && "value" in d;

function curveOf(curve: ChartSeries["curve"]): CurveFactory {
	if (curve === "linear") return curveLinear;
	if (curve === "step") return curveStepAfter;
	return curveMonotoneX;
}

function withAlpha(color: string, alpha: number): string {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!hex) return color;
	let h = hex[1];
	if (h.length === 3) h = [...h].map((c) => c + c).join("");
	const n = parseInt(h, 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fmt(
	axis: ChartAxisOptions | undefined,
): ((v: ChartX) => string) | null {
	if (!axis?.format) return null;
	if (typeof axis.format === "function") return axis.format;
	const f = d3Format(axis.format);
	return (v) => (typeof v === "number" ? f(v) : String(v));
}

function round(v: number): number {
	return Math.round(v * 100) / 100;
}

function fadeIn(t: Timing, delay = 0, duration = t.duration): LayerAnimation {
	return LayerAnimation.create().fromTo("opacity", 0, 1, {
		start: t.start + delay,
		end: t.start + delay + Math.max(1, duration),
		ease: "power2.out",
	});
}

/** Builds the chart as a box of absolutely positioned child nodes. */
export function buildChart(
	options: ChartOptions,
	props: Partial<BoxNode>,
	defaultFontFamily: string,
): AnimatableNode<BoxNode> {
	const id = props.id ?? autoId("chart");
	const width =
		options.width ?? (typeof props.width === "number" ? props.width : 960);
	const height =
		options.height ?? (typeof props.height === "number" ? props.height : 540);
	const type = options.type ?? "line";
	const fontSize = options.fontSize ?? 18;
	const fontFamily = options.fontFamily ?? defaultFontFamily;
	const textColor = options.textColor ?? "#94a3b8";
	// Legend and value labels read a little stronger than axis labels; with a custom
	// textColor (e.g. dark text on a light background) they use it as is.
	const strongText = options.textColor ?? "#e2e8f0";
	const gridColor = options.gridColor ?? "rgba(148, 163, 184, 0.18)";
	const colors = options.colors?.length ? options.colors : DEFAULT_CHART_COLORS;
	const radius = options.cornerRadius ?? 4;

	const anim = options.animate === false ? undefined : (options.animate ?? {});
	const timing: Timing = {
		enabled: anim !== undefined,
		start: anim?.start ?? 0,
		duration: anim?.duration ?? 30,
		stagger: anim?.stagger ?? -1,
		ease: anim?.ease ?? "power3.out",
	};

	const children: LayoutNode[] = [];
	const label = (
		text: string,
		rect: Rect,
		align: "start" | "center" | "end",
		extra: { delay?: number; color?: string; weight?: number } = {},
		key = "",
	) => {
		const node = Layer.text(text, {
			id: `${id}-label-${key || children.length}`,
			position: "absolute",
			x: round(rect.x),
			y: round(rect.y),
			width: round(rect.width),
			height: round(rect.height),
			fontFamily,
			fontSize,
			fontWeight: extra.weight ?? 500,
			fill: extra.color ?? textColor,
			align,
			verticalAlign: "middle",
		});
		if (timing.enabled) node.animate(fadeIn(timing, extra.delay ?? 0));
		children.push(node);
	};

	const lineHeight = Math.ceil(fontSize * 1.4);

	if (type === "pie" || type === "donut") {
		buildPie();
	} else {
		buildCartesian();
	}

	// Staggers and fractional durations land between frames; the program schema
	// wants whole-frame keyframes.
	for (const child of children) snapKeyframes(child);

	return Layer.box({
		background: options.background ?? "transparent",
		...props,
		id,
		width,
		height,
		children,
	});

	// ── pie & donut ─────────────────────────────────────────────────────

	function buildPie(): void {
		const slices = collectSlices();
		const total = slices.reduce((s, d) => s + Math.max(0, d.value), 0);
		const showLegend = options.legend ?? true;
		const pad = resolvePadding({
			top: 16,
			right: showLegend ? legendColumnWidth(slices.map((s) => s.label)) : 16,
			bottom: 16,
			left: 16,
		});
		const plot = plotRect(pad);
		const r = Math.max(1, Math.min(plot.width, plot.height) / 2);
		const inner = r * (options.innerRadius ?? (type === "donut" ? 0.6 : 0));
		const cx = plot.x + plot.width / 2;
		const cy = plot.y + plot.height / 2;
		const m = 4;
		const arcs = d3Pie<ChartSlice>()
			.sort(null)
			.value((d) => Math.max(0, d.value))
			.padAngle(slices.length > 1 ? 0.012 : 0)(slices);
		const arcGen = d3Arc<(typeof arcs)[number]>()
			.innerRadius(inner)
			.outerRadius(r)
			.cornerRadius(Math.min(radius, (r - inner) / 2));
		const step = staggerStep(arcs.length);

		arcs.forEach((a, i) => {
			const d = arcGen(a);
			if (!d) return;
			const color = slices[i].color ?? colors[i % colors.length];
			const node = Layer.shape("path", {
				id: `${id}-slice-${i}`,
				position: "absolute",
				x: round(cx - r - m),
				y: round(cy - r - m),
				width: round(2 * (r + m)),
				height: round(2 * (r + m)),
				d: translatePath(d, r + m, r + m),
				fillColor: color,
				anchorX: 0.5,
				anchorY: 0.5,
			});
			if (timing.enabled) {
				const s = timing.start + i * step;
				node.animate(
					LayerAnimation.create()
						.fromTo("opacity", 0, 1, {
							start: s,
							end: s + timing.duration * 0.5,
						})
						.fromTo("scale", 0.85, 1, {
							start: s,
							end: s + timing.duration,
							ease: timing.ease,
						}),
				);
			}
			children.push(node);

			if (options.valueLabels && total > 0 && a.value > 0) {
				const [lx, ly] = d3Arc<(typeof arcs)[number]>()
					.innerRadius(inner || r * 0.55)
					.outerRadius(r)
					.centroid(a);
				const pct = `${Math.round((a.value / total) * 100)}%`;
				label(
					pct,
					{
						x: cx + lx - 60,
						y: cy + ly - lineHeight / 2,
						width: 120,
						height: lineHeight,
					},
					"center",
					{
						delay: i * step + timing.duration * 0.5,
						color: "#ffffff",
						weight: 700,
					},
					`value-${i}`,
				);
			}
		});

		if (showLegend) {
			legendColumn(
				slices.map((s, i) => ({
					name: s.label,
					color: s.color ?? colors[i % colors.length],
				})),
				{ x: plot.x + plot.width + 24, y: plot.y, height: plot.height },
			);
		}
	}

	function collectSlices(): ChartSlice[] {
		const raw = (options.data ??
			options.series?.[0]?.data ??
			[]) as readonly unknown[];
		return raw.map((d, i) => {
			if (isSlice(d)) return d;
			const value =
				typeof d === "number"
					? d
					: Array.isArray(d)
						? Number(d[1])
						: Number((d as Point).y);
			const name =
				options.categories?.[i] ??
				(Array.isArray(d)
					? String(d[0])
					: typeof d === "object" && d
						? String((d as Point).x)
						: `${i + 1}`);
			return { label: name, value };
		});
	}

	// ── cartesian: line, area, bar, scatter, candlestick ───────────────

	function buildCartesian(): void {
		const series: ChartSeries[] = options.series?.length
			? [...options.series]
			: options.data
				? [{ data: options.data as ChartSeries["data"] }]
				: [];
		if (series.length === 0) return;

		const typeOf = (s: ChartSeries) =>
			s.type ?? (type as ChartSeries["type"]) ?? "line";
		const colorOf = (s: ChartSeries, i: number) =>
			s.color ?? colors[i % colors.length];

		// Normalise every series to points (candles keep their OHLC values).
		const points: Point[][] = series.map((s) =>
			(s.data as readonly unknown[]).map((d, i) => {
				if (isCandle(d)) return { x: d.x, y: d.close };
				if (typeof d === "number")
					return { x: options.categories?.[i] ?? i, y: d };
				if (Array.isArray(d)) return { x: d[0] as ChartX, y: Number(d[1]) };
				return { x: (d as Point).x, y: Number((d as Point).y) };
			}),
		);

		const anyBand = series.some(
			(s) => typeOf(s) === "bar" || typeOf(s) === "candlestick",
		);
		const allX = points.flat().map((p) => p.x);
		const xKind: "band" | "time" | "linear" =
			anyBand || allX.some((x) => typeof x === "string")
				? "band"
				: allX.some((x) => x instanceof Date)
					? "time"
					: "linear";

		// Stacking for bars and areas.
		const stackable = (s: ChartSeries) =>
			typeOf(s) === "bar" || typeOf(s) === "area";
		const stacked = !!options.stacked;
		const categories = xKind === "band" ? [...new Set(allX.map(String))] : [];
		const stackRanges = new Map<number, [number, number][]>();
		if (stacked) {
			const keys = series.map((_, i) => i).filter((i) => stackable(series[i]));
			const rows = categories.length
				? categories
				: [...new Set(allX.map((x) => +x))].sort((a, b) => a - b).map(String);
			const table = rows.map((key) => {
				const row: Record<string, number> = {};
				for (const i of keys) {
					const p = points[i].find(
						(pt) => String(xKind === "band" ? pt.x : +pt.x) === key,
					);
					row[i] = p?.y ?? 0;
				}
				return row;
			});
			const layers = d3Stack<Record<string, number>>()
				.keys(keys.map(String))
				.offset(stackOffsetDiverging)(table);
			layers.forEach((layer) => {
				const i = Number(layer.key);
				stackRanges.set(
					i,
					points[i].map((p) => {
						const idx = rows.indexOf(String(xKind === "band" ? p.x : +p.x));
						return [layer[idx][0], layer[idx][1]];
					}),
				);
			});
		}

		// y domain
		const yValues: number[] = [0];
		series.forEach((s, i) => {
			const range = stackRanges.get(i);
			if (typeOf(s) === "candlestick") {
				for (const c of s.data as readonly ChartCandle[])
					yValues.push(c.high, c.low);
			} else if (range) {
				for (const [a, b] of range) yValues.push(a, b);
			} else {
				for (const p of points[i]) yValues.push(p.y);
			}
		});
		if (
			series.every(
				(s) =>
					typeOf(s) === "candlestick" ||
					typeOf(s) === "scatter" ||
					typeOf(s) === "line",
			)
		) {
			// Line, scatter and price charts don't have to include zero.
			yValues.shift();
		}

		const yAxis = options.yAxis ?? {};
		const xAxis = options.xAxis ?? {};
		const yTickCount = yAxis.ticks ?? 5;
		let lo = yAxis.min ?? Math.min(...yValues);
		let hi = yAxis.max ?? Math.max(...yValues);
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
		if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
		const y = scaleLinear().domain([lo, hi]);
		if (yAxis.min === undefined || yAxis.max === undefined) y.nice(yTickCount);
		const yFormat =
			fmt(yAxis) ?? ((v: ChartX) => y.tickFormat(yTickCount)(v as number));
		const yTicks = y.ticks(yTickCount);

		const legendItems = series.map((s, i) => ({
			name: s.name ?? `Series ${i + 1}`,
			color: colorOf(s, i),
		}));
		const showLegend = options.legend ?? series.length > 1;
		const showY = yAxis.show !== false;
		const showX = xAxis.show !== false;
		const yLabelWidth = showY
			? Math.max(...yTicks.map((t) => yFormat(t).length)) * fontSize * 0.7 + 20
			: 0;
		const pad = resolvePadding({
			top: (showLegend ? lineHeight + 20 : 0) + Math.ceil(lineHeight / 2),
			right: 20,
			bottom: showX ? lineHeight + 14 : 12,
			left: Math.max(16, Math.ceil(yLabelWidth)),
		});
		const plot = plotRect(pad);
		// Room for value labels above positive bars and below negative ones.
		const labelRoom = lineHeight + 6;
		const barValues = options.valueLabels
			? series.flatMap((s, i) =>
					typeOf(s) === "bar" ? points[i].map((p) => p.y) : [],
				)
			: [];
		const topInset = barValues.some((v) => v > 0) ? labelRoom : 0;
		const bottomInset = barValues.some((v) => v < 0) ? labelRoom : 0;
		y.range([plot.height - bottomInset, topInset]);

		let x: XScale;
		if (xKind === "band") {
			x = scaleBand<string>()
				.domain(categories)
				.range([0, plot.width])
				.paddingInner(anyBand ? 0.28 : 0)
				.paddingOuter(anyBand ? 0.14 : 0.5);
		} else if (xKind === "time") {
			const xs = allX.map((v) => +new Date(v as Date));
			x = scaleUtc()
				.domain([Math.min(...xs), Math.max(...xs)])
				.range([0, plot.width]);
		} else {
			const xs = allX.map(Number);
			x = scaleLinear()
				.domain([xAxis.min ?? Math.min(...xs), xAxis.max ?? Math.max(...xs)])
				.range([0, plot.width]);
		}
		const xPos = (v: ChartX): number => {
			if (xKind === "band") {
				const b = x as ScaleBand<string>;
				return (b(String(v)) ?? 0) + b.bandwidth() / 2;
			}
			if (xKind === "time")
				return (x as ScaleTime<number, number>)(new Date(v as Date));
			return (x as ScaleLinear<number, number>)(Number(v));
		};

		// Grid and y labels.
		const gridDelay = 0;
		if (yAxis.grid !== false) {
			yTicks.forEach((t, i) => {
				const node = Layer.box({
					id: `${id}-ygrid-${i}`,
					position: "absolute",
					x: plot.x,
					y: round(plot.y + y(t) - 0.5),
					width: plot.width,
					height: 1,
					background: gridColor,
				});
				if (timing.enabled)
					node.animate(fadeIn(timing, gridDelay, timing.duration / 2));
				children.push(node);
			});
		}
		if (showY) {
			yTicks.forEach((t, i) => {
				label(
					yFormat(t),
					{
						x: 0,
						y: plot.y + y(t) - lineHeight / 2,
						width: plot.x - 12,
						height: lineHeight,
					},
					"end",
					{},
					`y-${i}`,
				);
			});
		}

		// x labels (and optional vertical grid).
		const xTicks: { pos: number; text: string }[] = [];
		const xFormat = fmt(xAxis);
		if (xKind === "band") {
			const b = x as ScaleBand<string>;
			const every = Math.max(
				1,
				Math.ceil(
					categories.length /
						Math.max(1, Math.floor(plot.width / (fontSize * 4))),
				),
			);
			categories.forEach((c, i) => {
				if (i % every === 0)
					xTicks.push({
						pos: (b(c) ?? 0) + b.bandwidth() / 2,
						text: xFormat ? xFormat(c) : c,
					});
			});
		} else {
			const s = x as ScaleLinear<number, number>;
			const count =
				xAxis.ticks ?? Math.max(2, Math.floor(plot.width / (fontSize * 6)));
			const tf = s.tickFormat(count);
			for (const t of s.ticks(count)) {
				xTicks.push({
					pos: s(t),
					text: xFormat ? xFormat(xKind === "time" ? new Date(t) : t) : tf(t),
				});
			}
		}
		if (xAxis.grid) {
			xTicks.forEach((t, i) => {
				const node = Layer.box({
					id: `${id}-xgrid-${i}`,
					position: "absolute",
					x: round(plot.x + t.pos - 0.5),
					y: plot.y,
					width: 1,
					height: plot.height,
					background: gridColor,
				});
				if (timing.enabled)
					node.animate(fadeIn(timing, gridDelay, timing.duration / 2));
				children.push(node);
			});
		}
		if (showX) {
			const slot = Math.max(
				fontSize * 3,
				plot.width / Math.max(1, xTicks.length),
			);
			xTicks.forEach((t, i) => {
				label(
					t.text,
					{
						x: plot.x + t.pos - slot / 2,
						y: plot.y + plot.height + 10,
						width: slot,
						height: lineHeight,
					},
					"center",
					{},
					`x-${i}`,
				);
			});
		}

		// Baseline at zero when it is inside the domain.
		const [y0, y1] = y.domain();
		if (y0 <= 0 && y1 >= 0 && anyBand) {
			const node = Layer.box({
				id: `${id}-zero`,
				position: "absolute",
				x: plot.x,
				y: round(plot.y + y(0) - 1),
				width: plot.width,
				height: 2,
				background: withAlpha("#94a3b8", 0.45),
			});
			if (timing.enabled) node.animate(fadeIn(timing, 0, timing.duration / 2));
			children.push(node);
		}

		// Series. Bars first so lines draw on top.
		const barSeries = series
			.map((_, i) => i)
			.filter((i) => typeOf(series[i]) === "bar");
		const order = [
			...barSeries,
			...series
				.map((_, i) => i)
				.filter((i) => typeOf(series[i]) === "candlestick"),
			...series.map((_, i) => i).filter((i) => typeOf(series[i]) === "area"),
			...series.map((_, i) => i).filter((i) => typeOf(series[i]) === "line"),
			...series.map((_, i) => i).filter((i) => typeOf(series[i]) === "scatter"),
		];

		const band = xKind === "band" ? (x as ScaleBand<string>) : null;
		const bandStep = band ? staggerStep(categories.length) : 0;
		const categoryIndex = (v: ChartX) =>
			band ? categories.indexOf(String(v)) : 0;

		order.forEach((si, rank) => {
			const s = series[si];
			const color = colorOf(s, si);
			const kind = typeOf(s);
			const pts = points[si];
			const range = stackRanges.get(si);

			if (kind === "bar" && band) {
				const groupSize = stacked ? 1 : barSeries.length;
				const groupIdx = stacked ? 0 : barSeries.indexOf(si);
				const bw = band.bandwidth() / groupSize;
				const gap = groupSize > 1 ? Math.min(4, bw * 0.12) : 0;
				pts.forEach((p, i) => {
					const [lo, hi] = range ? range[i] : [0, p.y];
					const top = plot.y + y(Math.max(lo, hi));
					const bottom = plot.y + y(Math.min(lo, hi));
					const h = Math.max(0, bottom - top);
					const bx =
						plot.x + (band(String(p.x)) ?? 0) + groupIdx * bw + gap / 2;
					const grows = p.y >= 0 ? "up" : "down";
					const node = Layer.box({
						id: `${id}-bar-${si}-${i}`,
						position: "absolute",
						x: round(bx),
						y: round(top),
						width: round(Math.max(1, bw - gap)),
						height: round(h),
						background: color,
						borderRadius: Math.min(radius, (bw - gap) / 2, h / 2),
					});
					const delay =
						categoryIndex(p.x) * bandStep +
						(stacked ? barSeries.indexOf(si) * timing.duration * 0.6 : 0);
					if (timing.enabled) {
						const st = timing.start + delay;
						const end = st + timing.duration;
						const a = LayerAnimation.create().fromTo("height", 0, round(h), {
							start: st,
							end,
							ease: timing.ease,
						});
						if (grows === "up") {
							a.fromTo("y", round(top + h), round(top), {
								start: st,
								end,
								ease: timing.ease,
							});
						}
						node.animate(a);
					}
					children.push(node);
					if (options.valueLabels) {
						const text = yFormat(p.y);
						const ly = grows === "up" ? top - lineHeight - 4 : top + h + 4;
						label(
							text,
							{ x: bx - 30, y: ly, width: bw - gap + 60, height: lineHeight },
							"center",
							{
								delay: delay + timing.duration * 0.6,
								color: strongText,
								weight: 600,
							},
							`value-${si}-${i}`,
						);
					}
				});
				return;
			}

			if (kind === "candlestick" && band) {
				const up = options.upColor ?? "#22c55e";
				const down = options.downColor ?? "#ef4444";
				const bw = band.bandwidth();
				(s.data as readonly ChartCandle[]).forEach((c, i) => {
					const col = c.close >= c.open ? up : down;
					const cxp = plot.x + (band(String(c.x)) ?? 0) + bw / 2;
					const delay = categoryIndex(c.x) * bandStep;
					const parts: [string, Rect][] = [
						[
							"wick",
							{
								x: cxp - Math.max(1, bw * 0.06),
								y: plot.y + y(c.high),
								width: Math.max(2, bw * 0.12),
								height: Math.max(1, y(c.low) - y(c.high)),
							},
						],
						[
							"body",
							{
								x: cxp - bw / 2,
								y: plot.y + y(Math.max(c.open, c.close)),
								width: bw,
								height: Math.max(2, Math.abs(y(c.open) - y(c.close))),
							},
						],
					];
					for (const [part, r] of parts) {
						const node = Layer.box({
							id: `${id}-candle-${si}-${i}-${part}`,
							position: "absolute",
							x: round(r.x),
							y: round(r.y),
							width: round(r.width),
							height: round(r.height),
							background: col,
							borderRadius:
								part === "body" ? Math.min(radius / 2, r.width / 2) : 0,
						});
						if (timing.enabled) {
							const st = timing.start + delay;
							const mid = r.y + r.height / 2;
							node.animate(
								LayerAnimation.create()
									.fromTo("height", 0, round(r.height), {
										start: st,
										end: st + timing.duration,
										ease: timing.ease,
									})
									.fromTo("y", round(mid), round(r.y), {
										start: st,
										end: st + timing.duration,
										ease: timing.ease,
									}),
							);
						}
						children.push(node);
					}
				});
				return;
			}

			if (kind === "line" || kind === "area") {
				const sw = s.strokeWidth ?? 3;
				const m = Math.ceil(sw * 2 + (s.pointRadius ?? 0) + 2);
				const xy = pts.map((p, i) => ({
					x: xPos(p.x) + m,
					top: (range ? y(range[i][1]) : y(p.y)) + m,
					base:
						(range
							? y(range[i][0])
							: y(Math.max(y.domain()[0], Math.min(0, y.domain()[1])))) + m,
				}));
				const curve = curveOf(s.curve);
				const frame: Rect = {
					x: plot.x - m,
					y: plot.y - m,
					width: plot.width + 2 * m,
					height: plot.height + 2 * m,
				};
				const delay = rank * (timing.duration / 3);

				if (kind === "area") {
					const d = d3Area<(typeof xy)[number]>()
						.x((p) => p.x)
						.y0((p) => p.base)
						.y1((p) => p.top)
						.curve(curve)(xy);
					if (d) {
						const node = Layer.shape("path", {
							id: `${id}-area-${si}`,
							position: "absolute",
							...roundRect(frame),
							d: roundPath(d),
							fillType: "linear",
							fillColor: withAlpha(color, 0.45),
							gradientEndColor: withAlpha(color, 0.02),
							gradientAngle: 90,
						});
						if (timing.enabled)
							node.animate(
								fadeIn(timing, delay + timing.duration * 0.4, timing.duration),
							);
						children.push(node);
					}
				}

				const d = d3Line<(typeof xy)[number]>()
					.x((p) => p.x)
					.y((p) => p.top)
					.curve(curve)(xy);
				if (d && sw > 0) {
					const node = Layer.shape("path", {
						id: `${id}-line-${si}`,
						position: "absolute",
						...roundRect(frame),
						d: roundPath(d),
						fillType: "none",
						strokeColor: color,
						strokeWidth: sw,
						strokeLineCap: "round",
						strokeLineJoin: "round",
					});
					if (timing.enabled) {
						node.animate(
							LayerAnimation.create().fromTo("trimEnd", 0, 1, {
								start: timing.start + delay,
								end: timing.start + delay + timing.duration * 1.5,
								ease: "power2.inOut",
							}),
						);
					}
					children.push(node);
				}

				if ((s.pointRadius ?? 0) > 0) {
					dots(
						si,
						pts,
						color,
						s.pointRadius ?? 0,
						delay + timing.duration * 0.5,
						range,
					);
				}
				return;
			}

			if (kind === "scatter") {
				dots(
					si,
					pts,
					color,
					s.pointRadius ?? 6,
					rank * (timing.duration / 3),
					range,
				);
			}
		});

		if (showLegend) legendRow(legendItems);

		function dots(
			si: number,
			pts: Point[],
			color: string,
			r: number,
			baseDelay: number,
			range: [number, number][] | undefined,
		): void {
			const step = staggerStep(pts.length);
			pts.forEach((p, i) => {
				const py = range ? y(range[i][1]) : y(p.y);
				const node = Layer.shape("circle", {
					id: `${id}-point-${si}-${i}`,
					position: "absolute",
					x: round(plot.x + xPos(p.x) - r),
					y: round(plot.y + py - r),
					width: round(r * 2),
					height: round(r * 2),
					fillColor: color,
					anchorX: 0.5,
					anchorY: 0.5,
				});
				if (timing.enabled) {
					const st = timing.start + baseDelay + i * step;
					node.animate(
						LayerAnimation.create()
							.fromTo("scale", 0, 1, {
								start: st,
								end: st + timing.duration * 0.6,
								ease: "back.out(2)",
							})
							.fromTo("opacity", 0, 1, { start: st, end: st + 6 }),
					);
				}
				children.push(node);
			});
		}
	}

	// ── shared helpers ──────────────────────────────────────────────────

	function staggerStep(count: number): number {
		if (!timing.enabled || count <= 1) return 0;
		if (timing.stagger >= 0) return timing.stagger;
		return Math.min(4, timing.duration / count);
	}

	function resolvePadding(
		auto: Required<ChartPadding>,
	): Required<ChartPadding> {
		const p = options.padding;
		if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
		return {
			top: p?.top ?? auto.top,
			right: p?.right ?? auto.right,
			bottom: p?.bottom ?? auto.bottom,
			left: p?.left ?? auto.left,
		};
	}

	function plotRect(p: Required<ChartPadding>): Rect {
		return {
			x: p.left,
			y: p.top,
			width: Math.max(1, width - p.left - p.right),
			height: Math.max(1, height - p.top - p.bottom),
		};
	}

	function legendColumnWidth(names: string[]): number {
		const longest = Math.max(0, ...names.map((n) => n.length));
		return Math.min(width * 0.4, longest * fontSize * 0.6 + fontSize + 48);
	}

	function legendColumn(
		items: { name: string; color: string }[],
		at: { x: number; y: number; height: number },
	): void {
		const rowH = lineHeight + 8;
		const top = at.y + Math.max(0, (at.height - items.length * rowH) / 2);
		items.forEach((item, i) => {
			legendItem(item, at.x, top + i * rowH, i);
		});
	}

	function legendRow(items: { name: string; color: string }[]): void {
		const widths = items.map(
			(it) => it.name.length * fontSize * 0.6 + fontSize + 28,
		);
		const total = widths.reduce((a, b) => a + b, 0);
		let cursor = Math.max(0, width - total - 20);
		items.forEach((item, i) => {
			legendItem(item, cursor, 4, i);
			cursor += widths[i];
		});
	}

	function legendItem(
		item: { name: string; color: string },
		lx: number,
		ly: number,
		i: number,
	): void {
		const sw = Math.round(fontSize * 0.7);
		const swatch = Layer.box({
			id: `${id}-legend-swatch-${i}`,
			position: "absolute",
			x: round(lx),
			y: round(ly + (lineHeight - sw) / 2),
			width: sw,
			height: sw,
			borderRadius: Math.round(sw / 4),
			background: item.color,
		});
		if (timing.enabled) swatch.animate(fadeIn(timing, 0, timing.duration / 2));
		children.push(swatch);
		label(
			item.name,
			{
				x: lx + sw + 8,
				y: ly,
				width: item.name.length * fontSize * 0.6 + 12,
				height: lineHeight,
			},
			"start",
			{ color: options.textColor ?? "#cbd5e1" },
			`legend-${i}`,
		);
	}
}

function snapKeyframes(node: LayoutNode): void {
	for (const track of node.animation?.tracks ?? []) {
		for (const kf of track.keyframes ?? []) kf.frame = Math.round(kf.frame);
	}
	for (const child of (node as { children?: LayoutNode[] }).children ?? []) {
		snapKeyframes(child);
	}
}

function roundRect(r: Rect): Rect {
	return {
		x: round(r.x),
		y: round(r.y),
		width: round(r.width),
		height: round(r.height),
	};
}

/** Shortens the long float literals d3 emits. */
function roundPath(d: string): string {
	return d.replace(/-?\d*\.\d{3,}(?:e-?\d+)?/gi, (n) =>
		String(round(Number(n))),
	);
}

/** Offsets an absolute SVG path (as produced by d3-arc) by dx, dy. */
function translatePath(d: string, dx: number, dy: number): string {
	// d3-arc emits M/L/A/Z with absolute coordinates; A has 7 params, of which
	// the last two are the endpoint.
	const out: string[] = [];
	const re = /([MLAZ])([^MLAZ]*)/gi;
	for (const [, cmd, args] of d.matchAll(re)) {
		const nums = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
		if (cmd.toUpperCase() === "A") {
			for (let i = 0; i + 6 < nums.length; i += 7) {
				nums[i + 5] += dx;
				nums[i + 6] += dy;
			}
		} else if (cmd.toUpperCase() !== "Z") {
			for (let i = 0; i + 1 < nums.length; i += 2) {
				nums[i] += dx;
				nums[i + 1] += dy;
			}
		}
		out.push(cmd + nums.map(round).join(","));
	}
	return out.join("");
}
