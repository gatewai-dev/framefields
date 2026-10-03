import type { ObjectTrackSignals } from "../signals/vision-bundle.js";
import type {
	LandmarkCoordinateSignals,
	PinToLandmarkOptions,
	PinToObjectOptions,
} from "../types.js";

export function pinNodeToLandmark<
	T extends { x?: unknown; y?: unknown; z?: unknown; [key: string]: unknown },
>(
	node: T,
	target:
		| LandmarkCoordinateSignals
		| { x: number; y: number; z?: number; screenX?: number; screenY?: number },
	options: PinToLandmarkOptions = {},
): T {
	const offX = options.offsetX ?? 0;
	const offY = options.offsetY ?? 0;
	const offZ = options.offsetZ ?? 0;

	if (!target || typeof target !== "object") {
		return node;
	}

	// Check if target provides programmatic signals
	if (
		"screenX" in target &&
		target.screenX &&
		typeof target.screenX === "object"
	) {
		const signals = target as LandmarkCoordinateSignals;
		node.x = offX !== 0 ? signals.screenX.add(offX) : signals.screenX;
		node.y = offY !== 0 ? signals.screenY.add(offY) : signals.screenY;
		node.z = offZ !== 0 ? signals.z.add(offZ) : signals.z;
	} else if (
		"x" in target &&
		typeof target.x === "object" &&
		target.x !== null
	) {
		const signals = target as LandmarkCoordinateSignals;
		node.x = offX !== 0 ? signals.x.add(offX) : signals.x;
		node.y = offY !== 0 ? signals.y.add(offY) : signals.y;
		node.z = offZ !== 0 ? signals.z.add(offZ) : signals.z;
	} else {
		const staticCoord = target as {
			x: number;
			y: number;
			z?: number;
			screenX?: number;
			screenY?: number;
		};
		node.x = (staticCoord.screenX ?? staticCoord.x) + offX;
		node.y = (staticCoord.screenY ?? staticCoord.y) + offY;
		node.z = (staticCoord.z ?? 0) + offZ;
	}

	return node;
}

export function pinNodeToObject<
	T extends {
		x?: unknown;
		y?: unknown;
		z?: unknown;
		width?: unknown;
		height?: unknown;
		opacity?: unknown;
		[key: string]: unknown;
	},
>(
	node: T,
	target:
		| ObjectTrackSignals
		| LandmarkCoordinateSignals
		| { x: number; y: number; z?: number; screenX?: number; screenY?: number },
	options: PinToObjectOptions = {},
): T {
	if (!target || typeof target !== "object") {
		return node;
	}

	if ("anchors" in target && target.anchors) {
		const track = target as ObjectTrackSignals;
		const anchorName =
			options.anchor ??
			(options.matchWidth || options.matchHeight ? "topLeft" : "center");
		const rawAnchor = track.anchors[anchorName] ?? track.center;

		let resolvedAnchor = rawAnchor;
		if (options.smoothFrames && options.smoothFrames > 1) {
			resolvedAnchor = {
				x: rawAnchor.x.smooth(options.smoothFrames),
				y: rawAnchor.y.smooth(options.smoothFrames),
				z: rawAnchor.z,
				screenX: rawAnchor.screenX.smooth(options.smoothFrames),
				screenY: rawAnchor.screenY.smooth(options.smoothFrames),
			};
		}

		if (options.matchWidth) {
			node.width =
				options.smoothFrames && options.smoothFrames > 1
					? track.bounds.screenWidth.smooth(options.smoothFrames)
					: track.bounds.screenWidth;
		}

		if (options.matchHeight) {
			node.height =
				options.smoothFrames && options.smoothFrames > 1
					? track.bounds.screenHeight.smooth(options.smoothFrames)
					: track.bounds.screenHeight;
		}

		if (options.hideWhenLost) {
			node.opacity = track.active;
		}

		return pinNodeToLandmark(node, resolvedAnchor, options);
	}

	return pinNodeToLandmark(
		node,
		target as
			| LandmarkCoordinateSignals
			| {
					x: number;
					y: number;
					z?: number;
					screenX?: number;
					screenY?: number;
			  },
		options,
	);
}
