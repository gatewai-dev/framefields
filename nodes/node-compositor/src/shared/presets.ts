import type {
	AnimatableProp,
	AnimationTrack,
	EaseRef,
	Keyframe,
} from "@gitframes/compositions/program";

export interface LayerBase {
	x: number;
	y: number;
	scale: number;
	rotation: number;
	opacity: number;
	width?: number;
	height?: number;
	durationFrames: number;
}

export interface PresetChip {
	groupId: string;
	presetType: string;
	kind: "entrance" | "exit" | "emphasis";
	label: string;
	durationFrames: number;
	ease?: EaseRef;
}

function generateId() {
	return Math.random().toString(36).substring(2, 11);
}

export function getPresetDetails(presetType: string): {
	kind: "entrance" | "exit" | "emphasis";
	label: string;
} {
	switch (presetType) {
		case "fade-in":
			return { kind: "entrance", label: "Fade In" };
		case "fade-out":
			return { kind: "exit", label: "Fade Out" };
		case "typewriter":
			return { kind: "entrance", label: "Typewriter" };
		case "word-reveal":
			return { kind: "entrance", label: "Word Reveal" };
		case "line-reveal":
			return { kind: "entrance", label: "Line Reveal" };
		case "karaoke":
			return { kind: "entrance", label: "Karaoke" };
		case "slide-in-left":
			return { kind: "entrance", label: "Slide In Left" };
		case "slide-in-right":
			return { kind: "entrance", label: "Slide In Right" };
		case "slide-in-top":
			return { kind: "entrance", label: "Slide In Top" };
		case "slide-in-bottom":
			return { kind: "entrance", label: "Slide In Bottom" };
		case "slide-out-left":
			return { kind: "exit", label: "Slide Out Left" };
		case "slide-out-right":
			return { kind: "exit", label: "Slide Out Right" };
		case "slide-out-top":
			return { kind: "exit", label: "Slide Out Top" };
		case "slide-out-bottom":
			return { kind: "exit", label: "Slide Out Bottom" };
		case "zoom-in":
			return { kind: "entrance", label: "Zoom In" };
		case "zoom-out":
			return { kind: "exit", label: "Zoom Out" };
		case "bounce-in":
			return { kind: "entrance", label: "Bounce In" };
		case "rotate-cw":
			return { kind: "emphasis", label: "Rotate Clockwise" };
		case "rotate-ccw":
			return { kind: "emphasis", label: "Rotate Counter-Clockwise" };
		case "pulse":
			return { kind: "emphasis", label: "Pulse" };
		case "shake":
			return { kind: "emphasis", label: "Shake" };
		case "wobble":
			return { kind: "emphasis", label: "Wobble" };
		case "bounce":
			return { kind: "emphasis", label: "Bounce" };
		case "tracking-expand":
			return { kind: "entrance", label: "Tracking Expand" };
		case "blur-reveal":
			return { kind: "entrance", label: "Blur Reveal" };
		case "kinetic-wave":
			return { kind: "emphasis", label: "Kinetic Wave" };
		case "slice-wipe":
			return { kind: "entrance", label: "Slice Wipe" };
		default:
			return { kind: "emphasis", label: presetType };
	}
}

export function chipsForLayer(
	layer:
		| {
				animation?: { tracks?: AnimationTrack[] };
		  }
		| null
		| undefined,
): PresetChip[] {
	const groups: Record<
		string,
		{ minFrame: number; maxFrame: number; ease?: EaseRef; presetType?: string }
	> = {};
	const tracks = layer?.animation?.tracks ?? [];

	for (const track of tracks) {
		for (const kf of track.keyframes) {
			if (kf.presetGroupId) {
				if (!groups[kf.presetGroupId]) {
					groups[kf.presetGroupId] = {
						minFrame: kf.frame,
						maxFrame: kf.frame,
						ease: kf.ease,
						presetType: kf.presetType,
					};
				} else {
					const g = groups[kf.presetGroupId];
					if (kf.frame < g.minFrame) g.minFrame = kf.frame;
					if (kf.frame > g.maxFrame) {
						g.maxFrame = kf.frame;
						if (kf.ease) g.ease = kf.ease;
					}
					if (kf.presetType && !g.presetType) {
						g.presetType = kf.presetType;
					}
				}
			}
		}
	}

	const chips: PresetChip[] = [];
	for (const [groupId, data] of Object.entries(groups)) {
		const presetType =
			data.presetType ||
			(groupId.includes("_")
				? groupId.slice(0, groupId.lastIndexOf("_"))
				: groupId) ||
			"";
		const { kind, label } = getPresetDetails(presetType);
		chips.push({
			groupId,
			presetType,
			kind,
			label,
			durationFrames: data.maxFrame - data.minFrame,
			ease: data.ease,
		});
	}

	return chips;
}

export function materializePreset(
	layerBase: LayerBase,
	presetType: string,
	options: {
		width: number;
		height: number;
		fps: number;
		presetGroupId?: string;
		durationFrames?: number;
	},
): AnimationTrack[] {
	const groupId = options.presetGroupId ?? `${presetType}_${generateId()}`;
	const width = options.width;
	const height = options.height;
	const layerDuration = layerBase.durationFrames;
	const defaultDuration = options.durationFrames ?? options.fps; // Default 1s or custom duration

	let prop: AnimatableProp;
	let keyframes: Keyframe[] = [];
	let repeat: number | undefined;
	let yoyo: boolean | undefined;

	switch (presetType) {
		case "fade-in": {
			prop = "opacity";
			keyframes = [
				{ id: generateId(), frame: 0, value: 0, presetGroupId: groupId },
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.opacity,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "fade-out": {
			prop = "opacity";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.opacity,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: 0,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-in-left": {
			prop = "x";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.x - width,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.x,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-in-right": {
			prop = "x";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.x + width,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.x,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-in-top": {
			prop = "y";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.y - height,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.y,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-in-bottom": {
			prop = "y";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.y + height,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.y,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-out-left": {
			prop = "x";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.x,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: layerBase.x - width,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-out-right": {
			prop = "x";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.x,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: layerBase.x + width,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-out-top": {
			prop = "y";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.y,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: layerBase.y - height,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "slide-out-bottom": {
			prop = "y";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.y,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: layerBase.y + height,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "zoom-in": {
			prop = "scale";
			keyframes = [
				{ id: generateId(), frame: 0, value: 0, presetGroupId: groupId },
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.scale,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "zoom-out": {
			prop = "scale";
			keyframes = [
				{
					id: generateId(),
					frame: Math.max(0, layerDuration - defaultDuration),
					value: layerBase.scale,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: layerDuration,
					value: 0,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "bounce-in": {
			prop = "scale";
			keyframes = [
				{ id: generateId(), frame: 0, value: 0, presetGroupId: groupId },
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.scale,
					ease: { name: "back", dir: "out", params: [1.7] },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "rotate-cw": {
			prop = "rotation";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.rotation,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.rotation + 360,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			repeat = 1;
			break;
		}
		case "rotate-ccw": {
			prop = "rotation";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.rotation,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.rotation - 360,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			repeat = 1;
			break;
		}
		case "pulse": {
			prop = "scale";
			const halfDur = Math.max(1, Math.round(defaultDuration / 2));
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.scale,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: halfDur,
					value: layerBase.scale * 1.1,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
				},
			];
			repeat = -1;
			yoyo = true;
			break;
		}
		case "shake": {
			prop = "x";
			const segmentDur = Math.max(1, Math.round(defaultDuration / 10));
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.x,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: segmentDur,
					value: layerBase.x + 20,
					ease: { name: "sine", dir: "inOut" },
					presetGroupId: groupId,
				},
			];
			repeat = 9;
			yoyo = true;
			break;
		}
		case "wobble": {
			prop = "rotation";
			const segmentDur = Math.max(1, Math.round(defaultDuration / 6));
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.rotation,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: segmentDur,
					value: layerBase.rotation + 15,
					ease: { name: "sine", dir: "inOut" },
					presetGroupId: groupId,
				},
			];
			repeat = 9;
			yoyo = true;
			break;
		}
		case "bounce": {
			prop = "y";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.y - 100,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.y,
					ease: { name: "bounce", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "typewriter":
		case "word-reveal":
		case "line-reveal":
		case "karaoke": {
			prop = "text";
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: 0,
					presetGroupId: groupId,
					presetType,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: 1,
					ease: { name: "none", dir: "out" },
					presetGroupId: groupId,
					presetType,
				},
			];
			break;
		}
		case "tracking-expand": {
			prop = "letterSpacing";
			keyframes = [
				{ id: generateId(), frame: 0, value: 0, presetGroupId: groupId },
				{
					id: generateId(),
					frame: defaultDuration,
					value: 24,
					ease: { name: "sine", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "blur-reveal": {
			prop = "opacity";
			keyframes = [
				{ id: generateId(), frame: 0, value: 0, presetGroupId: groupId },
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.opacity,
					ease: { name: "power1", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		case "kinetic-wave": {
			prop = "y";
			const halfDur = Math.max(1, Math.round(defaultDuration / 2));
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.y,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: halfDur,
					value: layerBase.y - 24,
					ease: { name: "sine", dir: "inOut" },
					presetGroupId: groupId,
				},
			];
			repeat = 3;
			yoyo = true;
			break;
		}
		case "slice-wipe": {
			prop = "x";
			const offset = layerBase.width ?? 300;
			keyframes = [
				{
					id: generateId(),
					frame: 0,
					value: layerBase.x - offset,
					presetGroupId: groupId,
				},
				{
					id: generateId(),
					frame: defaultDuration,
					value: layerBase.x,
					ease: { name: "expo", dir: "out" },
					presetGroupId: groupId,
				},
			];
			break;
		}
		default:
			throw new Error(`Unsupported preset type: ${presetType}`);
	}

	return [
		{
			id: generateId(),
			prop,
			keyframes: keyframes.map((kf) => ({ ...kf, presetType })),
			...(repeat !== undefined && { repeat }),
			...(yoyo !== undefined && { yoyo }),
		},
	];
}
