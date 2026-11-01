/**
 * The task as one surface: Create task grows into the modal, and the saved
 * modal shrinks into its card on the board. Each handoff is an empty shell
 * carried from one rect to the other while the views around it change; the
 * real surface takes over on the frame the shell arrives.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { ACCENT, APP, LINE, space } from "../theme.js";
import { during, type Reshape, raise, reshape, shrink } from "./kit.js";
import { CREATE_BUTTON, cardSlot, MODAL, READY } from "./layout.js";
import {
	cardLands,
	handOff,
	modalIn,
	modalOpen,
	type Timeline,
} from "./timeline.js";

export const MODAL_RADIUS = 14;
export const CARD_RADIUS = 10;
/** Create task is still held down (at 96 %) when the modal starts to grow. */
const PRESSED = 0.96;

/**
 * A white shell carried along `m`. With `from` set, it starts as an accent
 * surface (a primary button) that turns white over its first frames; with
 * `to`, it ends as one.
 */
export function shell(
	m: Reshape,
	level: "card" | "popover" | "modal",
	accent?: "from" | "to",
): LayoutNode[] {
	const box = (background: string) =>
		Layer.box({
			position: "absolute",
			...m.from,
			borderRadius: m.radius[0],
			background,
			...(background === APP && {
				borderColor: LINE,
				borderWidth: 1,
				strokeAlign: "inside" as const,
			}),
		}).animate(reshape(m));
	const nodes: LayoutNode[] = [
		raise(box(APP), level).animate(during(m.at, m.until)),
	];
	if (accent === "from")
		nodes.push(
			box(ACCENT).animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[m.at - 1, 0, "hold"],
					[m.at, 1, "hold"],
					[m.at + 5, 0, "power2.out"],
				]),
			),
		);
	if (accent === "to")
		nodes.push(
			box(ACCENT).animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[m.at + 4, 0, "hold"],
					[m.at + 14, 1, "power2.inOut"],
					[m.until, 1, "hold"],
					[m.until + 1, 0, "hold"],
				]),
			),
		);
	return nodes;
}

/** Create task → the modal, then the saved modal → its card in Ready. */
export function handoffs(t: Timeline): LayoutNode[] {
	return [
		...shell(
			{
				from: shrink(CREATE_BUTTON, PRESSED),
				to: MODAL,
				radius: [space(1), MODAL_RADIUS],
				at: modalIn(t),
				until: modalOpen(t),
				ease: "power3.out",
			},
			"modal",
			"from",
		),
		...shell(
			{
				from: MODAL,
				to: cardSlot(READY, 0),
				radius: [MODAL_RADIUS, CARD_RADIUS],
				at: handOff(t),
				until: cardLands(t),
			},
			"popover",
		),
	];
}
