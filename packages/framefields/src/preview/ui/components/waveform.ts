/**
 * The waveform as one filled shape: the loudest sample under each step of
 * the track, mirrored about the middle, as an SVG path (`Path2D` draws it).
 * Linear in amplitude, so loud and quiet passages keep their difference.
 */
export function waveformPath(
	peaks: readonly number[],
	width: number,
	height: number,
	step = 2,
): string {
	if (!peaks.length || width <= 0 || height <= 0) return "";
	const mid = height / 2;
	const amp = Math.max(0, mid - 2);
	const ys: Array<[number, number]> = [];
	for (let x = 0; x < width + step; x += step) {
		const at = Math.min(x, width);
		const from = Math.floor((at / width) * peaks.length);
		const to = Math.max(
			from + 1,
			Math.ceil((Math.min(width, at + step) / width) * peaks.length),
		);
		let v = 0;
		for (let b = from; b < Math.min(to, peaks.length); b++)
			v = Math.max(v, peaks[b] ?? 0);
		ys.push([at, Math.max(0.5, Math.min(1, v) * amp)]);
		if (at === width) break;
	}
	const r = (n: number) => Math.round(n * 100) / 100;
	const top = ys.map(([x, y]) => `L${r(x)} ${r(mid - y)}`).join("");
	const bottom = ys
		.reverse()
		.map(([x, y]) => `L${r(x)} ${r(mid + y)}`)
		.join("");
	return `M0 ${r(mid)}${top}${bottom}Z`;
}
