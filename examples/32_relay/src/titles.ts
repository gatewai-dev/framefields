/**
 * Everything that sits on the glass rather than in the app: the opening
 * line with the client's request, the captions while the task takes shape,
 * and the end card.
 */
import {
	FontManager,
	Layer,
	LayerAnimation,
	type LayoutNode,
	TextAnimator,
} from "framefields";
import { APP, H, INK, REGULAR, SANS, SEMIBOLD, SOFT, sec, W } from "./theme.js";
import { MARK_RADIUS, relayMark } from "./ui/brand.js";
import { shell } from "./ui/handoffs.js";
import { messageRow, REQUEST_MESSAGE } from "./ui/inbox.js";
import { type Rect, raise } from "./ui/kit.js";
import { LIST_W, ROW_H } from "./ui/layout.js";

const ARRIVE = "power3.inOut";
/**
 * The vertical leg of the flight: later and steeper than the horizontal one,
 * so the card travels a curve, not a straight line, into its row.
 */
const DIVE = "expo.inOut";

/**
 * A line whose words rise out of a soft blur one after another, starting at
 * `at` (local frame); `extra` adds more keys (an exit) to the line.
 */
function kinetic(
	value: string,
	o: { y: number; size: number; strong?: boolean; color?: string; at: number },
	extra?: LayerAnimation,
) {
	const sweep = LayerAnimation.create().kineticSweep(
		-1,
		1,
		o.at,
		o.at + 20,
		"power2.inOut",
	);
	return Layer.text(value, {
		position: "absolute",
		x: 0,
		y: o.y,
		width: W,
		align: "center",
		fontFamily: SANS,
		fontSize: o.size,
		fontWeight: o.strong ? SEMIBOLD : REGULAR,
		fill: o.color ?? INK,
		animators: [
			// Word progress runs 1 → 0 as the sweep passes, so an "in" curve is
			// what makes each word decelerate into place.
			TextAnimator.waveRise({
				unit: "word",
				y: o.size * 0.4,
				rotationX: 0,
				opacity: 0,
				blur: 8,
				easing: "expo.in",
			}),
		],
	}).animate(extra ? LayerAnimation.merge(sweep, extra) : sweep);
}

/**
 * "From request to ready." over the request, shown twice its inbox size;
 * at `fly` it shrinks into its row (`row`, on the stage) and lands at `landed`.
 */
export function opening(fly: number, landed: number, row: Rect): LayoutNode[] {
	const k = 2;
	const x = (W - LIST_W * k) / 2;
	const y = 452;
	const cardIn = sec(0.45);
	const headline = kinetic(
		"From request to ready.",
		{ y: 312, size: 76, strong: true, at: sec(0.15) },
		LayerAnimation.create()
			.keys("opacity", [
				[0, 1],
				[fly - 26, 1, "hold"],
				[fly - 12, 0, "power2.inOut"],
			])
			.keys("y", [
				[0, 312],
				[fly - 26, 312, "hold"],
				[fly - 12, 296, "power2.in"],
			])
			// A slow push while it reads.
			.keys("scale", [
				[0, 0.98],
				[fly - 12, 1.03, "sine.inOut"],
			]),
	);
	const card = raise(
		Layer.box({
			overflow: "hidden",
			position: "absolute",
			x,
			y,
			width: LIST_W,
			height: ROW_H,
			anchorX: 0,
			anchorY: 0,
			borderRadius: 12,
			background: APP,
			children: messageRow(REQUEST_MESSAGE, true),
		}),
		"popover",
	).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[cardIn, 0, "hold"],
				[cardIn + 12, 1, "power2.out"],
				[landed, 1, "hold"],
				[landed + 5, 0, "power2.out"],
			])
			.keys("x", [
				[0, x],
				[fly, x, "hold"],
				[landed, row.x, ARRIVE],
			])
			.keys("y", [
				[0, y + 40],
				[cardIn, y + 40, "hold"],
				[cardIn + sec(0.8), y, "expo.out"],
				// It floats up a little while it waits, then lifts before diving.
				[fly - 4, y - 10, "sine.inOut"],
				[landed, row.y, DIVE],
			])
			.keys("scale", [
				[0, k * 0.92],
				[cardIn, k * 0.92, "hold"],
				[cardIn + sec(0.8), k, "expo.out"],
				[fly, k * 1.02, "sine.inOut"],
				[landed, 1, ARRIVE],
			])
			// Banks into the turn and levels out as it lands.
			.keys("rotation", [
				[0, 0],
				[fly, 0, "hold"],
				[fly + (landed - fly) * 0.45, -2.5, "power2.inOut"],
				[landed, 0, "power2.out"],
			]),
	);
	return [headline, card];
}

/**
 * One line, three promises, each arriving as the modal delivers it: the pill
 * appears with the first, widens for each next one as its words rise in, and
 * leaves at `close`.
 */
export function captions(
	phrases: string[],
	lights: number[],
	close: number,
): LayoutNode {
	const size = 30;
	const gap = 14;
	const padX = 32;
	const height = 64;
	const grow = 14;
	const widths = phrases.map(
		(p) =>
			FontManager.measure(p, {
				fontFamily: SANS,
				fontSize: size,
				fontWeight: SEMIBOLD,
			}).width,
	);
	// The pill's width once the first `n` phrases are in.
	const widthWith = (n: number) =>
		widths.slice(0, n).reduce((a, b) => a + b, 0) + gap * (n - 1) + 2 * padX;
	const y = H - 56 - height;
	const open = lights[0] ?? 0;
	let cursor = padX;
	const words = phrases.map((p, i) => {
		const at = (lights[i] ?? 0) - open;
		const node = Layer.text(p, {
			position: "absolute",
			x: cursor,
			y: 15,
			fontFamily: SANS,
			fontSize: size,
			fontWeight: SEMIBOLD,
			fill: "#ffffff",
			animators: [
				TextAnimator.waveRise({
					unit: "word",
					y: size * 0.5,
					rotationX: 0,
					opacity: 0,
					blur: 6,
					easing: "expo.in",
				}),
			],
		}).animate(
			LayerAnimation.create().kineticSweep(
				-1,
				1,
				at + 2,
				at + 16,
				"power2.out",
			),
		);
		cursor += (widths[i] ?? 0) + gap;
		return node;
	});
	const steps = lights
		.slice(1)
		.flatMap((light, i): Array<[number, number, string?]> => {
			const before = widthWith(i + 1);
			const after = widthWith(i + 2);
			return [
				[light - open, before, "hold"],
				[light - open + grow, after, "expo.out"],
			];
		});
	const xs = steps.map(([f, w, e]): [number, number, string?] => [
		f,
		(W - w) / 2,
		e,
	]);
	const first = widthWith(1);
	return Layer.box({
		position: "absolute",
		x: (W - first) / 2,
		y,
		width: first,
		height,
		borderRadius: height / 2,
		background: INK,
		overflow: "hidden",
		startFrame: open,
		durationFrames: close - open + 8,
		children: words,
	}).animate(
		LayerAnimation.create()
			.keys("width", [[0, first], ...steps])
			.keys("x", [[0, (W - first) / 2], ...xs])
			.keys("opacity", [
				[0, 0],
				[8, 1, "power2.out"],
				[close - open, 1, "hold"],
				[close - open + 8, 0, "power2.in"],
			])
			.keys("y", [
				[0, y + 18],
				[sec(0.6), y, "expo.out"],
			])
			.keys("scale", [
				[0, 0.9],
				[sec(0.6), 1, "expo.out"],
			]),
	);
}

const MARK = 112;
const NAME_SIZE = 112;
const MARK_GAP = 32;
const MARK_TOP = 404;

/** Where the end card's mark sits, so the board's card can land on it. */
export function endMark(): Rect {
	const name = FontManager.measure("Relay", {
		fontFamily: SANS,
		fontSize: NAME_SIZE,
		fontWeight: SEMIBOLD,
	});
	return {
		x: (W - (MARK + MARK_GAP + name.width)) / 2,
		y: MARK_TOP,
		width: MARK,
		height: MARK,
	};
}

/**
 * The new card leaves the board and becomes the mark: a shell from the card
 * on screen (`card`, corner radius `radius`) to the end card's mark, turning
 * to the accent on the way. It lands at `until`, when the end card starts.
 */
export function handover(
	card: Rect,
	radius: number,
	at: number,
	until: number,
): LayoutNode[] {
	return shell(
		{
			from: card,
			to: endMark(),
			radius: [radius, MARK * MARK_RADIUS],
			at,
			until,
			ease: "power3.inOut",
		},
		"card",
		"to",
	);
}

/**
 * "Relay. Keep client work moving." The mark is there from the first frame
 * (the card has just become it): its dot appears and its arrow draws as the
 * name slides out beside it and the line rises underneath, while the whole
 * card pushes in slowly.
 */
export function endCard(at: number, length: number): LayoutNode {
	const mark = endMark();
	const name = FontManager.measure("Relay", {
		fontFamily: SANS,
		fontSize: NAME_SIZE,
		fontWeight: SEMIBOLD,
	});
	const nameX = mark.x + MARK + MARK_GAP;
	const nameY = MARK_TOP + (MARK - name.height) / 2;
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: at,
		durationFrames: length,
		children: [
			relayMark({ x: mark.x, y: mark.y, size: MARK, drawAt: 4 }),
			Layer.text("Relay", {
				position: "absolute",
				x: nameX,
				y: nameY,
				fontFamily: SANS,
				fontSize: NAME_SIZE,
				fontWeight: SEMIBOLD,
				fill: INK,
				letterSpacing: -2,
			}).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[0, 0],
						[sec(0.45), 1, "power2.out"],
					])
					.keys("x", [
						[0, nameX - 28],
						[sec(0.8), nameX, "expo.out"],
					]),
			),
			kinetic("Keep client work moving.", {
				y: MARK_TOP + MARK + 52,
				size: 40,
				color: SOFT,
				at: sec(0.4),
			}),
		],
	}).animate(
		// A slow push for as long as it holds, so the last shot still moves.
		LayerAnimation.keys("scale", [
			[0, 1],
			[length, 1.05, "power1.out"],
		]),
	);
}
