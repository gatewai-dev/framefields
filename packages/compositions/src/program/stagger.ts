export type StaggerDirection = "forward" | "reverse" | "center-out";

/**
 * Calculates the frame delay offset for a child at `index` in a container of `totalCount` items.
 */
export function computeStaggerDelay(
	index: number,
	totalCount: number,
	staggerFrames: number,
	direction: StaggerDirection = "forward",
): number {
	if (staggerFrames <= 0 || totalCount <= 1) return 0;

	switch (direction) {
		case "reverse":
			return (totalCount - 1 - index) * staggerFrames;
		case "center-out": {
			const center = (totalCount - 1) / 2;
			const dist = Math.abs(index - center);
			return Math.round(dist * staggerFrames);
		}
		case "forward":
		default:
			return index * staggerFrames;
	}
}

/**
 * Applies stagger timing offsets to child nodes, returning cloned objects with adjusted `startFrame`.
 */
export function applyStaggerToChildren<T extends { startFrame?: number }>(
	children: T[],
	staggerFrames: number,
	direction: StaggerDirection = "forward",
	baseOffset = 0,
): T[] {
	if (!children || children.length === 0) return [];
	if (staggerFrames <= 0 && baseOffset === 0) return [...children];

	return children.map((child, idx) => {
		const delay = computeStaggerDelay(
			idx,
			children.length,
			staggerFrames,
			direction,
		);
		const currentStart = child.startFrame ?? 0;
		return {
			...child,
			startFrame: currentStart + delay + baseOffset,
		};
	});
}
