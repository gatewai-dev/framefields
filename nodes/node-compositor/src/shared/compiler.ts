import { resolveLayerDuration } from "@gitframes/compositions";
import {
	type AnimationTrack,
	collectNodeOps,
	type EaseRef,
	evaluateTrackAtFrame,
	type LayerAnimation,
} from "@gitframes/compositions/program";
import {
	DEFAULT_DURATION_MS,
	getActiveMediaMetadata,
	type VirtualMediaData,
} from "@gitframes/core";
import gsapModule from "gsap";
import { solveCubicBezier } from "./bezier-solver.js";

const gsap = (gsapModule as any).timeline
	? gsapModule
	: (gsapModule as any).default || gsapModule;

export interface LayerStub {
	id: string;
	inputHandleId: string;
	trackId?: string;
	x: number;
	y: number;
	scale: number;
	rotation: number;
	opacity: number;
	volume: number;
	width?: number;
	height?: number;
	hidden: boolean;
	muted: boolean;
	text?: number;
	fontSize?: number;
	fill?: string;
	borderColor?: string;
	backgroundColor?: string;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	perspective?: number;
	perspectiveOriginX?: number;
	perspectiveOriginY?: number;
	translateZ?: number;
	backfaceVisibility?: "visible" | "hidden";
	transformStyle?: "flat" | "preserve-3d";
	drawProgress?: number;
	chartProgress?: number;
	// 3D Layer Props
	is3D?: boolean;
	z?: number;
	scaleZ?: number;
	twoSided?: boolean;
	// 3D Material Props
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
	// 3D Camera Props
	cameraX?: number;
	cameraY?: number;
	cameraZ?: number;
	targetX?: number;
	targetY?: number;
	targetZ?: number;
	cameraPitch?: number;
	cameraYaw?: number;
	cameraRoll?: number;
	cameraFov?: number;
	cameraZoom?: number;
	focalLength?: number;
	focusDistance?: number;
	fStop?: number;
	maxBlurRadius?: number;
	shakeTranslation?: number;
	shakeRotation?: number;
	orbitRadius?: number;
	orbitAzimuth?: number;
	orbitElevation?: number;
	// 3D Model Props
	animationProgress?: number;
	animationTime?: number;
	animationSpeed?: number;
	wireframe?: boolean;
	scaleX?: number;
	scaleY?: number;
	// 3D Light Props
	lightType?: string;
	intensity?: number;
	radius?: number;
	angle?: number;
	penumbra?: number;
	decay?: number;
	[key: string]: unknown;
}


export type CompilerVirtualMedia = {
	metadata?: Partial<VirtualMediaData["metadata"]>;
	operation?: Partial<VirtualMediaData["operation"]> & Record<string, any>;
	children?: CompilerNodeVM[];
};

/** A node op inside the render tree (CompositorLayer). */
export type CompilerNodeVM = CompilerVirtualMedia;

export interface CompileResult {
	tl: gsap.core.Timeline;
	targetsById: Record<string, LayerStub>;
	/** Node ops the timeline was compiled from (tree order). */
	nodes: CompilerNodeVM[];
}

// L2: compiled timelines and their LayerStubs are cached per cacheKey and
// SHARED across frames — `tl.seek()` mutates the stubs in place. This is safe
// because frame rendering is strictly single-threaded per renderId, and the
// 10s TTL bounds staleness. Do NOT render two frames of the same renderId
// concurrently without cloning `tl` + stubs first.
const cache = new Map<string, { cacheTime: number; value: CompileResult }>();

function fnv1a(str: string): string {
	let hash = 2166136261;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash +=
			(hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16);
}

function stableStringify(obj: any): string {
	if (obj === null) return "null";
	if (obj === undefined) return "undefined";
	if (typeof obj !== "object") return JSON.stringify(obj);
	if (ArrayBuffer.isView(obj)) {
		return `[TypedArray:${(obj as ArrayBufferView).byteLength}]`;
	}
	if (Array.isArray(obj)) {
		return "[" + obj.map(stableStringify).join(",") + "]";
	}
	const sortedKeys = Object.keys(obj).sort();
	const parts = sortedKeys.map((key) => {
		return `${JSON.stringify(key)}:${stableStringify(obj[key])}`;
	});
	return "{" + parts.join(",") + "}";
}

export function getCachedTimeline(cacheKey: string): CompileResult | undefined {
	const entry = cache.get(cacheKey);
	if (entry) {
		if (Date.now() - entry.cacheTime > 10000) {
			cache.delete(cacheKey);
			return undefined;
		}
		entry.cacheTime = Date.now();
		cache.delete(cacheKey);
		cache.set(cacheKey, entry);
		return entry.value;
	}
	return undefined;
}

export function setCachedTimeline(cacheKey: string, value: CompileResult) {
	const now = Date.now();
	for (const [key, entry] of cache.entries()) {
		if (now - entry.cacheTime > 10000) {
			cache.delete(key);
		}
	}
	if (cache.size >= 50) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) {
			cache.delete(oldestKey);
		}
	}
	cache.set(cacheKey, { cacheTime: now, value });
}

export function mappedEase(
	ease?: EaseRef,
	durationFrames?: number,
	fps = 24,
): string | ((p: number) => number) {
	if (!ease) return "none";
	const { name, dir, params } = ease;
	if (name === "none") return "none";

	// Custom closed-form Spring ease solver
	if ((name as string) === "spring") {
		const damping = Math.max(0.001, params?.[0] ?? 10);
		const stiffness = Math.max(0.001, params?.[1] ?? 100);
		const mass = Math.max(0.001, params?.[2] ?? 1);

		return (p: number) => {
			const safeFps = fps > 0 ? fps : 24;
			const durSec =
				durationFrames && durationFrames > 0 ? durationFrames / safeFps : 1.0;
			const t = p * durSec;

			const m = mass;
			const k = stiffness;
			const c = damping;

			const w0 = Math.sqrt(k / m);
			const zeta = c / (2 * Math.sqrt(k * m));

			let x = 0;
			if (zeta < 1) {
				const wd = w0 * Math.sqrt(1 - zeta * zeta);
				const A = -1;
				const B = (-zeta * w0) / wd;
				x =
					Math.exp(-zeta * w0 * t) *
					(A * Math.cos(wd * t) + B * Math.sin(wd * t));
			} else if (zeta === 1) {
				const A = -1;
				const B = -w0;
				x = Math.exp(-w0 * t) * (A + B * t);
			} else {
				const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
				const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
				const C1 = -1 / (1 - r1 / r2);
				const C2 = -1 - C1;
				x = C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t);
			}
			return 1 + x;
		};
	}

	if ((name as string) === "cubic") {
		const x1 = params?.[0] ?? 0.25;
		const y1 = params?.[1] ?? 0.1;
		const x2 = params?.[2] ?? 0.25;
		const y2 = params?.[3] ?? 1.0;
		return (p: number) => solveCubicBezier(x1, y1, x2, y2, p);
	}

	if ((name as string) === "hold") {
		// GSAP rounds time to 1e-7 s, so on its own end frame a short segment's
		// progress can land ~1e-5 under 1; 1e-4 of a segment is safe slack for the
		// jump (it would only fire a frame early on segments over 10,000 frames).
		return (p: number) => (p >= 1 - 1e-4 ? 1 : 0);
	}

	const easeName = name as string;
	let suffix = "";
	if (params && params.length > 0) {
		suffix = `(${params.join(", ")})`;
	} else if (name === "back") {
		suffix = "(1.7)";
	} else if (name === "elastic") {
		suffix = "(1, 0.3)";
	}

	return `${easeName}.${dir}${suffix}`;
}

function compileTrackToTimeline(
	tl: gsap.core.Timeline,
	stub: Record<string, any>,
	track: AnimationTrack,
	startFrame: number,
	fps: number,
	durationFrames: number,
	signals?: Record<string, any>,
): { dropped: number; maxAuthoredFrame: number } {
	const prop = track.prop;
	const source = track.source ?? { type: "keyframe" };

	if (source.type !== "keyframe") {
		const endF = Number.isFinite(durationFrames)
			? durationFrames
			: Math.round(fps * 5);
		const frameStepSec = 1 / fps;
		const kfList: Array<Record<string, unknown>> = [];

		const firstVal = evaluateTrackAtFrame(track, startFrame, fps, {
			startFrame,
			baseValues: stub,
			signals,
		});
		stub[prop] = firstVal;
		kfList.push({
			[prop]: firstVal,
			duration: 0,
		});

		for (let f = 1; f <= endF; f++) {
			const val = evaluateTrackAtFrame(track, startFrame + f, fps, {
				startFrame,
				baseValues: stub,
				signals,
			});
			kfList.push({
				[prop]: val,
				duration: frameStepSec,
				ease: "none",
			});
		}

		tl.to(
			stub,
			{
				keyframes: kfList,
				repeat: track.repeat ?? 0,
				yoyo: !!track.yoyo,
				lazy: false,
				overwrite: false,
				immediateRender: false,
			},
			startFrame / fps,
		);

		return { dropped: 0, maxAuthoredFrame: 0 };
	}

	const sortedKeyframes = [...track.keyframes].sort(
		(a, b) => a.frame - b.frame,
	);
	// M8: keyframes outside the clip window [0, durationFrames] cannot play —
	// keep the clamp (the renderer's temporal gate clips the same window) but
	// REPORT it: an author who keys past the node's duration otherwise gets a
	// silent static mid-animation with no diagnostic.
	const validKeyframes = sortedKeyframes.filter(
		(kf) => kf.frame >= 0 && kf.frame <= durationFrames,
	);
	const dropped = sortedKeyframes.length - validKeyframes.length;
	const maxAuthoredFrame =
		dropped > 0 ? sortedKeyframes[sortedKeyframes.length - 1].frame : 0;

	if (validKeyframes.length === 0) {
		return { dropped, maxAuthoredFrame };
	}

	const isDiscrete = prop === "hidden" || prop === "muted";

	if (isDiscrete) {
		for (const kf of validKeyframes) {
			const absoluteSec = (startFrame + kf.frame) / fps;
			tl.set(
				stub,
				{
					[prop]: kf.value,
					immediateRender: false,
				},
				absoluteSec,
			);
		}
	} else {
		const repeat = track.repeat ?? 0;
		const yoyo = !!track.yoyo;

		if (validKeyframes.length === 1) {
			const kf0 = validKeyframes[0];
			const absoluteSec = (startFrame + kf0.frame) / fps;
			tl.set(
				stub,
				{
					[prop]: kf0.value,
					immediateRender: false,
				},
				absoluteSec,
			);
		} else if (validKeyframes.length === 2) {
			const kf0 = validKeyframes[0];
			const kf1 = validKeyframes[1];
			const val0 = kf0.value;
			const val1 = kf1.value;
			const startSec = (startFrame + kf0.frame) / fps;
			const durSec = (kf1.frame - kf0.frame) / fps;
			const trackDurationFrames = track.durationFrames ?? kf1.frame - kf0.frame;
			const easeRef = kf1.ease ?? kf0.ease;
			const easeVal = mappedEase(easeRef, trackDurationFrames, fps);

			if (val0 === stub[prop]) {
				tl.to(
					stub,
					{
						[prop]: val1,
						duration: durSec,
						ease: easeVal,
						repeat,
						yoyo,
						lazy: false,
						overwrite: false,
						immediateRender: false,
					},
					startSec,
				);
			} else {
				tl.fromTo(
					stub,
					{
						[prop]: val0,
					},
					{
						[prop]: val1,
						duration: durSec,
						ease: easeVal,
						repeat,
						yoyo,
						lazy: false,
						overwrite: false,
						immediateRender: false,
					},
					startSec,
				);
			}
		} else {
			const kf0 = validKeyframes[0];
			const startSec = (startFrame + kf0.frame) / fps;

			const kfList: Array<Record<string, unknown>> = [];
			kfList.push({
				[prop]: kf0.value,
				duration: 0,
			});

			for (let i = 1; i < validKeyframes.length; i++) {
				const prevKf = validKeyframes[i - 1];
				const currKf = validKeyframes[i];
				const deltaFrames = currKf.frame - prevKf.frame;
				const durSec = deltaFrames / fps;
				const easeVal = mappedEase(currKf.ease, deltaFrames, fps);

				kfList.push({
					[prop]: currKf.value,
					duration: durSec,
					ease: easeVal,
				});
			}

			tl.to(
				stub,
				{
					keyframes: kfList,
					repeat,
					yoyo,
					lazy: false,
					overwrite: false,
					immediateRender: false,
				},
				startSec,
			);
		}
	}

	return { dropped, maxAuthoredFrame };
}

// ── M8: truncated-track diagnostics ───────────────────────────────────

export interface TruncationInfo {
	layerId: string;
	trackId: string;
	prop: string;
	dropped: number;
	maxAuthoredFrame: number;
}

/** Dedupe per compiled cache key — a fresh render of the same broken doc SHOULD re-warn. */
const truncationWarnedKeys = new Set<string>();
const TRUNCATION_WARNED_CAP = 100;

function warnTruncationOnce(cacheKey: string, truncations: TruncationInfo[]) {
	if (truncationWarnedKeys.has(cacheKey)) return;
	if (truncationWarnedKeys.size >= TRUNCATION_WARNED_CAP) {
		truncationWarnedKeys.clear();
	}
	truncationWarnedKeys.add(cacheKey);

	const details = truncations
		.map(
			(t) =>
				`'${t.prop}' (track '${t.trackId}') on '${t.layerId}': ${t.dropped} keyframe(s) past the clip window (last authored frame ${t.maxAuthoredFrame})`,
		)
		.join("; ");
	console.warn(
		`[compositor] ${truncations.length} track(s) truncated — animation tails will not play: ${details}. Extend durationFrames or move those keyframes.`,
	);
}

export function compileTimeline(
	renderId: string,
	virtualMedia: CompilerVirtualMedia | null | undefined,
	options: { fps: number; durationSec: number },
): CompileResult {
	const fps = options.fps;
	const durationSec = options.durationSec;
	const width = virtualMedia?.metadata?.width ?? 1920;
	const height = virtualMedia?.metadata?.height ?? 1080;

	// Collect node ops from the render tree (pre-order: parents first).
	const nodeOps = collectNodeOps((virtualMedia?.children as any) ?? []);

	// LRU cache check
	const irHashInput = stableStringify({
		nodes: nodeOps.map((vm) => {
			const lop = (vm?.operation || {}) as any;
			return {
				id: lop.id,
				animation: lop.animation,
				startFrame: lop.startFrame,
				durationFrames: lop.durationFrames,
				x: lop.x,
				y: lop.y,
				scale: lop.scale,
				rotation: lop.rotation,
				opacity: lop.opacity,
				volume: lop.volume,
				width: lop.width,
				height: lop.height,
				hidden: lop.hidden,
				muted: lop.muted,
				backgroundColor: lop.backgroundColor,
				fill: lop.fill,
				borderColor: lop.borderColor,
				textBackgroundColor: lop.textBackgroundColor,
				rotateX: lop.rotateX,
				rotateY: lop.rotateY,
				rotateZ: lop.rotateZ,
				perspective: lop.perspective,
				perspectiveOriginX: lop.perspectiveOriginX,
				perspectiveOriginY: lop.perspectiveOriginY,
				translateZ: lop.translateZ,
				backfaceVisibility: lop.backfaceVisibility,
				transformStyle: lop.transformStyle,
				drawProgress: lop.drawProgress,
				chartProgress: lop.chartProgress,
				is3D: lop.is3D,
				z: lop.z,
				scaleZ: lop.scaleZ,
				twoSided: lop.twoSided,
				cameraX: lop.cameraX,
				cameraY: lop.cameraY,
				cameraZ: lop.cameraZ,
				targetX: lop.targetX,
				targetY: lop.targetY,
				targetZ: lop.targetZ,
				cameraPitch: lop.cameraPitch,
				cameraYaw: lop.cameraYaw,
				cameraRoll: lop.cameraRoll,
				cameraFov: lop.cameraFov,
				cameraZoom: lop.cameraZoom,
				focalLength: lop.focalLength,
				focusDistance: lop.focusDistance,
				fStop: lop.fStop,
				maxBlurRadius: lop.maxBlurRadius,
				shakeTranslation: lop.shakeTranslation,
				shakeRotation: lop.shakeRotation,
				orbitRadius: lop.orbitRadius,
				orbitAzimuth: lop.orbitAzimuth,
				orbitElevation: lop.orbitElevation,
				// 3D Material Props
				material: lop.material,
				shininess: lop.shininess,
				roughness: lop.roughness,
				specularIntensity: lop.specularIntensity,
				ambientIntensity: lop.ambientIntensity,
				metallic: lop.metallic,
				// 3D Light Props
				lightType: lop.lightType,
				intensity: lop.intensity,
				radius: lop.radius,
				angle: lop.angle,
				penumbra: lop.penumbra,
				// 3D Model Props
				animationProgress: lop.animationProgress,
				animationTime: lop.animationTime,
				animationSpeed: lop.animationSpeed,
				wireframe: lop.wireframe,
				scaleX: lop.scaleX,
				scaleY: lop.scaleY,
				// The LayerStub bakes fontSize (compiler.ts:425) and both the
				// layout measure and the text draw prefer the stub's value
				// over the live op — a fontSize change MUST bust the cache or
				// the rendered text keeps the stale size for the whole TTL.
				fontSize: lop.fontSize,
				text: lop.text,
			};
		}),
		width,
		height,
		fps,
		durationSec,
		signals: (virtualMedia as any)?.operation?.signals ?? (virtualMedia as any)?.signals,
	});
	const irHash = fnv1a(irHashInput);
	const cacheKey = `${renderId}_${irHash}`;

	const cached = getCachedTimeline(cacheKey);
	if (cached) {
		return cached;
	}

	const tl = gsap.timeline({ paused: true, smoothChildTiming: false });
	const targetsById: Record<string, LayerStub> = {};
	const signals =
		(virtualMedia as any)?.operation?.signals ??
		(virtualMedia as any)?.signals ??
		{};

	nodeOps.forEach((vm, index: number) => {
		const lop = (vm?.operation || {}) as any;
		const layerId = lop.id || lop.inputHandleId || `layer_${index}`;

		const stub: LayerStub = {
			id: layerId,
			inputHandleId: lop.inputHandleId || `layer_${index}`,
			trackId: layerId,
			x: lop.kind === "camera" || lop.kind === "light" ? (lop.x ?? lop.cameraX) : (lop.x ?? 0),
			y: lop.kind === "camera" || lop.kind === "light" ? (lop.y ?? lop.cameraY) : (lop.y ?? 0),
			scale: lop.scale ?? 1,
			rotation: lop.rotation ?? 0,
			opacity: lop.opacity ?? 1,
			volume: lop.volume ?? 1,
			width: lop.width,
			height: lop.height,
			hidden: !!lop.hidden,
			muted: !!lop.muted,
			rotateX: lop.rotateX ?? 0,
			rotateY: lop.rotateY ?? 0,
			rotateZ: lop.rotateZ ?? 0,
			perspective: lop.perspective ?? 0,
			perspectiveOriginX: lop.perspectiveOriginX ?? 0.5,
			perspectiveOriginY: lop.perspectiveOriginY ?? 0.5,
			translateZ: lop.translateZ ?? 0,
			backfaceVisibility: lop.backfaceVisibility ?? "visible",
			transformStyle: lop.transformStyle ?? "flat",
			drawProgress: lop.drawProgress ?? 1,
			chartProgress: lop.chartProgress ?? 1,
			fontSize: lop.fontSize,
			text: 1,
			fill: lop.fill,
			fillColor: lop.fillColor ?? lop.fill,
			strokeColor: lop.strokeColor ?? lop.stroke,
			strokeWidth: lop.strokeWidth,
			letterSpacing: lop.letterSpacing,
			firstMargin: lop.firstMargin ?? lop.pathOptions?.firstMargin,
			lastMargin: lop.lastMargin ?? lop.pathOptions?.lastMargin,
			baselineShift: lop.baselineShift ?? lop.pathOptions?.baselineShift,
			offset: lop.offset,
			rangeStart: lop.rangeStart,
			rangeEnd: lop.rangeEnd,
			animators: lop.animators,
			pathOptions: lop.pathOptions,
			typewriter: lop.typewriter,
			marquee: lop.marquee,
			// 3D Layer Props
			is3D: lop.is3D ?? (lop.kind === "camera" || lop.kind === "light" || lop.kind === "model3d" ? true : false),
			z: lop.z ?? (lop.kind === "camera" ? (lop.z ?? -1500) : 0),
			scaleZ: lop.scaleZ ?? 1,
			twoSided: lop.twoSided ?? true,
			// 3D Material Props
			material: lop.material,
			shininess: lop.shininess,
			roughness: lop.roughness,
			specularIntensity: lop.specularIntensity,
			ambientIntensity: lop.ambientIntensity,
			metallic: lop.metallic,
			// 3D Model Props
			animationProgress: lop.animationProgress ?? 0,
			animationTime: lop.animationTime ?? 0,
			animationSpeed: lop.animationSpeed ?? 1,
			wireframe: lop.wireframe ?? false,
			scaleX: lop.scaleX ?? 1,
			scaleY: lop.scaleY ?? 1,
			// 3D Camera Props
			cameraX: lop.cameraX ?? (lop.kind === "camera" ? lop.x : undefined),
			cameraY: lop.cameraY ?? (lop.kind === "camera" ? lop.y : undefined),
			cameraZ: lop.cameraZ ?? (lop.kind === "camera" ? lop.z : undefined),
			targetX: lop.targetX,
			targetY: lop.targetY,
			targetZ: lop.targetZ,
			cameraPitch: lop.cameraPitch ?? lop.pitch ?? 0,
			cameraYaw: lop.cameraYaw ?? lop.yaw ?? 0,
			cameraRoll: lop.cameraRoll ?? lop.roll ?? 0,
			cameraFov: lop.cameraFov ?? lop.lens?.fov ?? 50,
			cameraZoom: lop.cameraZoom ?? lop.lens?.zoom ?? 1,
			focalLength: lop.focalLength ?? lop.lens?.focalLength ?? 50,
			focusDistance: lop.focusDistance ?? lop.dof?.focusDistance,
			fStop: lop.fStop ?? lop.dof?.fStop ?? 2.8,
			maxBlurRadius: lop.maxBlurRadius ?? lop.dof?.maxBlurRadius ?? 24,
			shakeTranslation:
				lop.shakeTranslation ??
				(lop.shake?.enabled ? (lop.shake?.translationAmplitude ?? 0) : 0),
			shakeRotation:
				lop.shakeRotation ??
				(lop.shake?.enabled ? (lop.shake?.rotationAmplitude ?? 0) : 0),
			orbitRadius: lop.orbitRadius,
			orbitAzimuth: lop.orbitAzimuth,
			orbitElevation: lop.orbitElevation,
			// 3D Light Props
			lightType: lop.lightType,
			intensity: lop.intensity ?? (lop.kind === "light" ? 1 : undefined),
			radius: lop.radius,
			angle: lop.angle,
			penumbra: lop.penumbra,
			decay: lop.decay,
		};


		for (const track of lop.animation?.tracks ?? []) {
			const source = track.source ?? { type: "keyframe" };
			if (source.type !== "keyframe") {
				(stub as Record<string, unknown>)[track.prop] = evaluateTrackAtFrame(
					track,
					lop.startFrame ?? 0,
					fps,
					{ startFrame: lop.startFrame ?? 0, baseValues: stub, signals },
				);
			} else if (track.keyframes && track.keyframes.length > 0) {
				const kf0 = track.keyframes[0];
				const seeded = stub as Record<string, unknown>;
				if (kf0.frame === 0) {
					seeded[track.prop] = kf0.value;
				} else if (seeded[track.prop] === undefined) {
					// GSAP only tweens props that exist on its target; props the stub
					// doesn't model (trimEnd, borderWidth, …) start from the node's own
					// value, else hold the first key until it's reached.
					seeded[track.prop] = lop[track.prop] ?? kf0.value;
				}
			}
		}

		targetsById[layerId] = stub;
	});

	// M8: keyframes beyond the clip window are clamped, but silently — a track
	// whose tail was truncated plays a static value with no diagnostic. Collect
	// them here and warn ONCE per compiled cache key (per-frame seeks hit the
	// cache, so this is naturally once per render/preview session).
	const truncations: TruncationInfo[] = [];

	nodeOps.forEach((vm) => {
		const lop = (vm?.operation || {}) as any;
		const layerId = lop.id || lop.inputHandleId;
		const stub = layerId ? targetsById[layerId] : undefined;
		if (!stub) return;

		const startFrame = lop.startFrame ?? 0;
		let durationFrames = lop.durationFrames;
		if (durationFrames === undefined) {
			const child = vm.children?.[0];
			const childMeta = child ? getActiveMediaMetadata(child as any) : null;
			const composeDuration =
				(virtualMedia as any)?.metadata?.durationMs ?? DEFAULT_DURATION_MS;
			const layerType =
				lop.type ??
				(lop.kind === "text"
					? "Text"
					: lop.kind === "media"
						? child
							? (child.operation as any)?.dataType
							: undefined
						: undefined);
			const durationMs = resolveLayerDuration(
				undefined,
				childMeta?.durationMs ?? undefined,
				composeDuration,
				layerType,
			);
			durationFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
		}

		for (const track of lop.animation?.tracks ?? []) {
			const { dropped, maxAuthoredFrame } = compileTrackToTimeline(
				tl,
				stub,
				track,
				startFrame,
				fps,
				durationFrames,
				signals,
			);
			if (dropped > 0) {
				truncations.push({
					layerId,
					trackId: track.id,
					prop: track.prop,
					dropped,
					maxAuthoredFrame,
				});
			}
		}
	});

	if (truncations.length > 0) warnTruncationOnce(cacheKey, truncations);

	tl.seek(1e-6);
	tl.seek(0);

	const compileResult: CompileResult = {
		tl,
		targetsById,
		nodes: nodeOps,
	};

	setCachedTimeline(cacheKey, compileResult);

	return compileResult;
}

const layerTimelineCache = new Map<
	string,
	{
		cacheTime: number;
		value: {
			tl: gsap.core.Timeline;
			stub: { volume: number; muted: boolean };
		};
	}
>();

export function compileLayerTimeline(
	layerId: string,
	animation: LayerAnimation | undefined,
	baseVolume: number,
	baseMuted: boolean,
	fps: number,
): { tl: gsap.core.Timeline; stub: { volume: number; muted: boolean } } {
	const irHashInput = stableStringify({
		animation,
		baseVolume,
		baseMuted,
		fps,
	});
	const irHash = fnv1a(irHashInput);
	const cacheKey = `layer_${layerId}_${irHash}`;

	const cached = layerTimelineCache.get(cacheKey);
	if (cached) {
		if (Date.now() - cached.cacheTime <= 10000) {
			cached.cacheTime = Date.now();
			return cached.value;
		}
		layerTimelineCache.delete(cacheKey);
	}

	const tl = gsap.timeline({ paused: true, smoothChildTiming: false });
	const stub = {
		volume: baseVolume,
		muted: baseMuted,
	};

	const tracks: AnimationTrack[] = animation?.tracks ?? [];
	for (const track of tracks) {
		const prop = track.prop;
		if (prop !== "volume" && prop !== "muted") continue;
		compileTrackToTimeline(tl, stub, track, 0, fps, Infinity);
	}

	tl.seek(1e-6);
	tl.seek(0);

	const result = { tl, stub };
	layerTimelineCache.set(cacheKey, { cacheTime: Date.now(), value: result });
	return result;
}
