import type { ObjectTrackSignals } from "@gitframes/yolo";
import { BlurBase, type BlurBaseProps } from "../generated/classes.js";

export interface BlurProps extends BlurBaseProps {
	/**
	 * Follow a tracked object. Turns on `partialBlur` and derives the region
	 * (`centerX`, `centerY`, `radius`, `radiusY`, `shape`) and `strength` from
	 * the track. Any of those passed explicitly wins over the track.
	 */
	track?: ObjectTrackSignals;
}

/** Props the track supplies when the caller does not. */
function trackDefaults(track: ObjectTrackSignals): BlurBaseProps {
	return {
		partialBlur: true,
		centerX: track.center.x,
		centerY: track.center.y,
		radius: track.bounds.width.multiply(0.55),
		radiusY: track.bounds.height.multiply(0.55),
		shape: "ellipse",
		// Fades the blur out while the object is not being tracked.
		strength: track.active.multiply(25),
	};
}

/**
 * Blur effect. Props, defaults and ranges are generated from `node-blur`'s
 * schema ({@link BlurBase}); this subclass only adds `track`.
 */
export class Blur extends BlurBase {
	constructor(config: BlurProps = {}) {
		const { track, ...rest } = config;
		super(track ? { ...trackDefaults(track), ...definedOnly(rest) } : rest);
	}
}

function definedOnly<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as T;
}
