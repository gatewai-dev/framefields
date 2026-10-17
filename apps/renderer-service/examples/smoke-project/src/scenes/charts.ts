import { Layer } from "framefields";
import { asset, H, INK, label, PAPER, W } from "../theme.js";

export const CHARTS_FRAMES = 90;

/** Charts built from native nodes (bars, lines, slices), plus SRT captions. */
export function chartsScene() {
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
	const bars = Layer.chart(
		{
			type: "bar",
			width: 560,
			height: 300,
			categories: months,
			series: [
				{ name: "renders", data: [12, 19, 15, 28, 34, 41] },
				{ name: "minutes", data: [6, 11, 9, 16, 21, 30] },
			],
			fontFamily: "Inter",
			textColor: PAPER,
			yAxis: { grid: true, ticks: 4 },
			legend: true,
			animate: { start: 0, duration: 30, stagger: 3, ease: "expo.out" },
		},
		{ id: "bars", position: "absolute", x: 40, y: 110 },
	);

	const line = Layer.chart(
		{
			type: "line",
			width: 560,
			height: 160,
			categories: months,
			series: [
				{
					name: "GPU s/min",
					data: [9, 7.5, 6, 4.2, 3.1, 2.4],
					curve: "smooth",
					pointRadius: 5,
				},
			],
			fontFamily: "Inter",
			textColor: PAPER,
			yAxis: { format: ".1f", ticks: 3 },
			animate: { start: 10, duration: 40 },
		},
		{ id: "line", position: "absolute", x: W - 600, y: 110 },
	);

	const donut = Layer.chart(
		{
			type: "donut",
			width: 260,
			height: 260,
			data: [
				{ label: "render", value: 62 },
				{ label: "install", value: 23 },
				{ label: "checkout", value: 15 },
			],
			fontFamily: "Inter",
			textColor: PAPER,
			valueLabels: true,
			animate: { start: 20, duration: 30, stagger: 5 },
		},
		{ id: "donut", position: "absolute", x: W - 450, y: 300 },
	);

	const captions = Layer.caption(asset("captions.srt"), {
		id: "captions",
		position: "absolute",
		x: 0,
		y: H - 150,
		width: W,
		height: 90,
		fontFamily: "Inter",
		fontSize: 30,
	});

	return Layer.box({
		id: "charts",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: INK,
		children: [
			Layer.text("charts · captions", {
				position: "absolute",
				x: 40,
				y: 32,
				fontFamily: "Syne",
				fontSize: 40,
				fill: PAPER,
			}),
			bars,
			line,
			donut,
			captions,
			label("bar · line · donut · SRT captions"),
		],
	});
}
