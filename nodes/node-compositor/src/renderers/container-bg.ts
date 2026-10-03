/**
 * Which container kinds paint their own background.
 *
 * flex/block/box all accept an optional `background` in the program schema.
 * The renderer must draw the rounded background pass for ALL of them (the old
 * code only painted `box`, so flex/block backgrounds were silently dropped and
 * their "transparent-optimized" fast path skipped the fill entirely).
 */
export function shouldPaintContainerBackground(
	kind: string | undefined,
	background?: string | null,
): boolean {
	if (!background) return false;
	return kind === "flex" || kind === "block" || kind === "box";
}
