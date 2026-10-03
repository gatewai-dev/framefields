import type { ExtendedLayer } from "@gitframes/core";
import { DEFAULT_DURATION_MS } from "@gitframes/core";
import { interpolate, spring } from "@gitframes/renderers";

export const isStaticVisualMedia = (type?: string): boolean =>
	type === "Image" || type === "SVG" || type === "Text";

export const resolveLayerDuration = (
	layerDurationInMS?: number,
	metaDurationMs?: number,
	defaultDuration: number = DEFAULT_DURATION_MS,
	type?: string,
): number => {
	if (type === "Caption") {
		return metaDurationMs && metaDurationMs > 0
			? metaDurationMs
			: layerDurationInMS || defaultDuration;
	}

	const isStatic = isStaticVisualMedia(type);
	if (layerDurationInMS && metaDurationMs && !isStatic) {
		return Math.min(layerDurationInMS, metaDurationMs);
	}

	return layerDurationInMS || metaDurationMs || defaultDuration;
};

export const calculateLayerTransform = (
	layer: ExtendedLayer,
	frame: number,
	fps: number,
	viewport: { w: number; h: number },
) => {
	const relativeFrame = frame - (layer.startFrame ?? 0);
	let x = layer.x ?? 0;
	let y = layer.y ?? 0;
	let scale = layer.scale ?? 1;
	let rotation = layer.rotation ?? 0;
	let opacity = layer.opacity ?? 1;
	const volume = layer.volume ?? 1;

	const layerDurationMs = resolveLayerDuration(
		layer.durationInMS,
		layer.virtualMedia?.metadata?.durationMs ?? undefined,
		DEFAULT_DURATION_MS,
		layer.type,
	);

	const duration = Math.round((layerDurationMs / 1000) * fps);
	const animations =
		layer.type === "Text" || layer.type === "Caption"
			? []
			: (layer.animations ?? []);
	if (animations.length === 0)
		return { x, y, scale, rotation, opacity, volume };

	animations.forEach((anim) => {
		const durFrames = anim.value * fps;
		const isOut = anim.type.includes("-out");
		const startAnimFrame = isOut ? duration - durFrames : 0;
		const endAnimFrame = isOut ? duration : durFrames;
		if (relativeFrame < startAnimFrame || relativeFrame > endAnimFrame) return;

		const progress = interpolate(
			relativeFrame,
			[startAnimFrame, endAnimFrame],
			[0, 1],
			{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
		);

		switch (anim.type) {
			case "fade-in":
				opacity *= progress;
				break;
			case "fade-out":
				opacity *= 1 - progress;
				break;
			case "slide-in-left":
				x += -1 * viewport.w * (1 - progress);
				break;
			case "slide-in-right":
				x += 1 * viewport.w * (1 - progress);
				break;
			case "slide-in-top":
				y += -1 * viewport.h * (1 - progress);
				break;
			case "slide-in-bottom":
				y += 1 * viewport.h * (1 - progress);
				break;
			case "zoom-in":
				scale *= interpolate(progress, [0, 1], [0, 1]);
				break;
			case "zoom-out":
				scale *= interpolate(progress, [0, 1], [1, 0]);
				break;
			case "rotate-cw":
				rotation += 360 * progress;
				break;
			case "rotate-ccw":
				rotation += -360 * progress;
				break;
			case "bounce": {
				const bounceVal = spring({
					frame: relativeFrame - startAnimFrame,
					fps,
					config: { damping: 10, mass: 0.5, stiffness: 100 },
					durationInFrames: durFrames,
				});
				scale *= bounceVal;
				break;
			}
			case "shake": {
				x +=
					20 *
					Math.sin((relativeFrame * 10 * 2 * Math.PI) / durFrames) *
					(1 - progress);
				break;
			}
		}
	});

	return { x, y, scale, rotation, opacity, volume };
};
