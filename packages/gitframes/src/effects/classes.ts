import { Effect } from "@gitframes/core";
import type { CustomModelConfig } from "@gitframes/yolo";
import {
	AudioSignal,
	type AudioSignalOptions,
	type ExtractedAudioSignalsBundle,
} from "../signals/audio.js";
import type { EffectProp } from "./types.js";

// Vignette, Blur and ColorBalance are generated from their node packages
// (./generated, written by scripts/generate-effects.mts). The classes below
// are still hand-written and move there in later phases of spec/sync-node.md.
export * from "./generated/index.js";
export type { EffectProp } from "./types.js";

export interface LevelChannel {
	inBlack?: number;
	inWhite?: number;
	outBlack?: number;
	outWhite?: number;
}

export interface LevelsProps {
	master?: LevelChannel;
	red?: LevelChannel;
	green?: LevelChannel;
	blue?: LevelChannel;
}

export class Levels extends Effect<LevelsProps> {
	public readonly op = "Levels";

	public declare master: LevelChannel;
	public declare red: LevelChannel;
	public declare green: LevelChannel;
	public declare blue: LevelChannel;

	constructor(config: LevelsProps = {}) {
		const defaultChannel: LevelChannel = {
			inBlack: 0,
			inWhite: 1,
			outBlack: 0,
			outWhite: 1,
		};
		super({
			master: config.master ?? { ...defaultChannel },
			red: config.red ?? { ...defaultChannel },
			green: config.green ?? { ...defaultChannel },
			blue: config.blue ?? { ...defaultChannel },
			...config,
		});
	}
}

export interface FilmGrainProps {
	strength?: EffectProp<number>;
	size?: EffectProp<number>;
	monochrome?: boolean;
	animated?: boolean;
	speed?: EffectProp<number>;
	shadows?: EffectProp<number>;
	midtones?: EffectProp<number>;
	highlights?: EffectProp<number>;
}

export class FilmGrain extends Effect<FilmGrainProps> {
	public readonly op = "FilmGrain";

	public declare strength: number;
	public declare size: number;
	public declare monochrome: boolean;
	public declare animated: boolean;
	public declare speed: number;
	public declare shadows: number;
	public declare midtones: number;
	public declare highlights: number;

	constructor(config: FilmGrainProps = {}) {
		super({
			strength: config.strength ?? 15,
			size: config.size ?? 1.5,
			monochrome: config.monochrome ?? true,
			animated: config.animated ?? true,
			speed: config.speed ?? 50,
			shadows: config.shadows ?? 0.2,
			midtones: config.midtones ?? 1.0,
			highlights: config.highlights ?? 0.2,
			...config,
		});
	}
}

export class CustomEffect extends Effect<Record<string, unknown>> {
	public readonly op: string;

	constructor(opName: string, config: Record<string, unknown> = {}) {
		super(config);
		this.op = opName;
	}
}

export interface AudioSignalExtractorProps {
	extractionMode?:
		| "rms_envelope"
		| "transient_beat"
		| "sub_bass"
		| "bass"
		| "mid"
		| "high"
		| "spectral_flux";
	attackMs?: number;
	releaseMs?: number;
	sensitivity?: number;
	noiseFloorDb?: number;
	dynamicRangeDb?: number;
	autoRange?: boolean;
	smoothing?: number;
	curve?: "linear" | "exponential" | "logarithmic" | "square" | "smoothstep";
	beatThreshold?: number;
	beatDecayMs?: number;
	previewMode?: "waveform" | "envelope" | "beat_markers" | "spectrum";
	nodeId?: string;
}

export class AudioSignalExtractor extends Effect<AudioSignalExtractorProps> {
	public readonly op = "AudioSignalExtractor";

	public declare extractionMode: AudioSignalExtractorProps["extractionMode"];
	public declare attackMs: number;
	public declare releaseMs: number;
	public declare sensitivity: number;
	public declare noiseFloorDb: number;
	public declare dynamicRangeDb: number;
	public declare autoRange: boolean;
	public declare smoothing: number;
	public declare curve: AudioSignalExtractorProps["curve"];
	public declare beatThreshold: number;
	public declare beatDecayMs: number;
	public declare previewMode: AudioSignalExtractorProps["previewMode"];
	public declare nodeId: string;

	constructor(config: AudioSignalExtractorProps = {}) {
		super({
			extractionMode: config.extractionMode ?? "rms_envelope",
			attackMs: config.attackMs ?? 10,
			releaseMs: config.releaseMs ?? 120,
			sensitivity: config.sensitivity ?? 1.0,
			noiseFloorDb: config.noiseFloorDb ?? -48,
			dynamicRangeDb: config.dynamicRangeDb ?? 48,
			autoRange: config.autoRange ?? true,
			smoothing: config.smoothing ?? 0.15,
			curve: config.curve ?? "linear",
			beatThreshold: config.beatThreshold ?? 0.08,
			beatDecayMs: config.beatDecayMs ?? 80,
			previewMode: config.previewMode ?? "envelope",
			nodeId: config.nodeId ?? "audio_extractor",
			...config,
		});
	}

	public async extract(
		source: string,
		options: Partial<AudioSignalOptions> = {},
	): Promise<ExtractedAudioSignalsBundle> {
		return AudioSignal.extract(source, {
			extractionMode: this.extractionMode,
			attackMs: this.attackMs,
			releaseMs: this.releaseMs,
			sensitivity: this.sensitivity,
			noiseFloorDb: this.noiseFloorDb,
			dynamicRangeDb: this.dynamicRangeDb,
			smoothing: this.smoothing,
			curve: this.curve,
			beatThreshold: this.beatThreshold,
			beatDecayMs: this.beatDecayMs,
			previewMode: this.previewMode,
			...options,
		});
	}
}

// ─── Batch 1: Core Tonal, Color & Filter Effects ────────────────────────────

export interface CurvesChannelPoint {
	x: number;
	y: number;
}

export interface CurvesProps {
	curveType?: "rgb" | "hue-vs-hue" | "hue-vs-sat" | "lum-vs-sat" | "sat-vs-sat";
	master?: CurvesChannelPoint[];
	red?: CurvesChannelPoint[];
	green?: CurvesChannelPoint[];
	blue?: CurvesChannelPoint[];
	hueVsHue?: CurvesChannelPoint[];
	hueVsSat?: CurvesChannelPoint[];
	lumVsSat?: CurvesChannelPoint[];
	satVsSat?: CurvesChannelPoint[];
}

export class Curves extends Effect<CurvesProps> {
	public readonly op = "Curves";

	public declare curveType: CurvesProps["curveType"];
	public declare master: CurvesChannelPoint[];
	public declare red: CurvesChannelPoint[];
	public declare green: CurvesChannelPoint[];
	public declare blue: CurvesChannelPoint[];
	public declare hueVsHue: CurvesChannelPoint[];
	public declare hueVsSat: CurvesChannelPoint[];
	public declare lumVsSat: CurvesChannelPoint[];
	public declare satVsSat: CurvesChannelPoint[];

	constructor(config: CurvesProps = {}) {
		super({
			...config,
			curveType: config.curveType ?? "rgb",
			master: config.master ?? [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			red: config.red ?? [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			green: config.green ?? [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			blue: config.blue ?? [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			hueVsHue: config.hueVsHue ?? [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 },
			],
			hueVsSat: config.hueVsSat ?? [
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			],
			lumVsSat: config.lumVsSat ?? [
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			],
			satVsSat: config.satVsSat ?? [
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			],
		});
	}
}

export interface SelectiveColorAdjustment {
	cyan: number;
	magenta: number;
	yellow: number;
	black: number;
}

export interface SelectiveColorProps {
	method?: "Relative" | "Absolute";
	reds?: Partial<SelectiveColorAdjustment>;
	yellows?: Partial<SelectiveColorAdjustment>;
	greens?: Partial<SelectiveColorAdjustment>;
	cyans?: Partial<SelectiveColorAdjustment>;
	blues?: Partial<SelectiveColorAdjustment>;
	magentas?: Partial<SelectiveColorAdjustment>;
	whites?: Partial<SelectiveColorAdjustment>;
	neutrals?: Partial<SelectiveColorAdjustment>;
	blacks?: Partial<SelectiveColorAdjustment>;
}

export class SelectiveColor extends Effect<SelectiveColorProps> {
	public readonly op = "SelectiveColor";

	public declare method: "Relative" | "Absolute";
	public declare reds: SelectiveColorAdjustment;
	public declare yellows: SelectiveColorAdjustment;
	public declare greens: SelectiveColorAdjustment;
	public declare cyans: SelectiveColorAdjustment;
	public declare blues: SelectiveColorAdjustment;
	public declare magentas: SelectiveColorAdjustment;
	public declare whites: SelectiveColorAdjustment;
	public declare neutrals: SelectiveColorAdjustment;
	public declare blacks: SelectiveColorAdjustment;

	constructor(config: SelectiveColorProps = {}) {
		const defaultAdj: SelectiveColorAdjustment = {
			cyan: 0,
			magenta: 0,
			yellow: 0,
			black: 0,
		};
		super({
			...config,
			method: config.method ?? "Relative",
			reds: { ...defaultAdj, ...config.reds },
			yellows: { ...defaultAdj, ...config.yellows },
			greens: { ...defaultAdj, ...config.greens },
			cyans: { ...defaultAdj, ...config.cyans },
			blues: { ...defaultAdj, ...config.blues },
			magentas: { ...defaultAdj, ...config.magentas },
			whites: { ...defaultAdj, ...config.whites },
			neutrals: { ...defaultAdj, ...config.neutrals },
			blacks: { ...defaultAdj, ...config.blacks },
		});
	}
}

export interface GradientMapStop {
	position: number;
	color: string;
}

export interface GradientMapProps {
	stops?: GradientMapStop[];
	smooth?: boolean;
	dither?: boolean;
	opacity?: EffectProp<number>;
}

export class GradientMap extends Effect<GradientMapProps> {
	public readonly op = "GradientMap";

	public declare stops: GradientMapStop[];
	public declare smooth: boolean;
	public declare dither: boolean;
	public declare opacity: number;

	constructor(config: GradientMapProps = {}) {
		const defaultStops: GradientMapStop[] = [
			{ position: 0.0, color: "#000000" },
			{ position: 1.0, color: "#ffffff" },
		];
		super({
			...config,
			stops: config.stops ?? defaultStops,
			smooth: config.smooth ?? true,
			dither: config.dither ?? true,
			opacity: config.opacity ?? 1.0,
		});
	}
}

export interface ShadowsHighlightsProps {
	shadowAmount?: EffectProp<number>;
	shadowTonalWidth?: EffectProp<number>;
	shadowRadius?: EffectProp<number>;
	highlightAmount?: EffectProp<number>;
	highlightTonalWidth?: EffectProp<number>;
	highlightRadius?: EffectProp<number>;
	colorCorrection?: EffectProp<number>;
	midtoneContrast?: EffectProp<number>;
}

export class ShadowsHighlights extends Effect<ShadowsHighlightsProps> {
	public readonly op = "ShadowsHighlights";

	public declare shadowAmount: number;
	public declare shadowTonalWidth: number;
	public declare shadowRadius: number;
	public declare highlightAmount: number;
	public declare highlightTonalWidth: number;
	public declare highlightRadius: number;
	public declare colorCorrection: number;
	public declare midtoneContrast: number;

	constructor(config: ShadowsHighlightsProps = {}) {
		super({
			...config,
			shadowAmount: config.shadowAmount ?? 0,
			shadowTonalWidth: config.shadowTonalWidth ?? 50,
			shadowRadius: config.shadowRadius ?? 30,
			highlightAmount: config.highlightAmount ?? 0,
			highlightTonalWidth: config.highlightTonalWidth ?? 50,
			highlightRadius: config.highlightRadius ?? 30,
			colorCorrection: config.colorCorrection ?? 0,
			midtoneContrast: config.midtoneContrast ?? 0,
		});
	}
}

export interface ApplyLUTProps {
	lutUrl?: string;
	intensity?: EffectProp<number>;
}

export class ApplyLUT extends Effect<ApplyLUTProps> {
	public readonly op = "ApplyLUT";

	public declare lutUrl: string;
	public declare intensity: number;

	constructor(config: ApplyLUTProps = {}) {
		super({
			...config,
			lutUrl: config.lutUrl ?? "",
			intensity: config.intensity ?? 1.0,
		});
	}
}

export interface UnsharpMaskProps {
	amount?: EffectProp<number>;
	radius?: EffectProp<number>;
	threshold?: EffectProp<number>;
}

export class UnsharpMask extends Effect<UnsharpMaskProps> {
	public readonly op = "UnsharpMask";

	public declare amount: number;
	public declare radius: number;
	public declare threshold: number;

	constructor(config: UnsharpMaskProps = {}) {
		super({
			...config,
			amount: config.amount ?? 100,
			radius: config.radius ?? 1.5,
			threshold: config.threshold ?? 3,
		});
	}
}

export interface HighPassProps {
	radius?: EffectProp<number>;
	contrastBoost?: EffectProp<number>;
	monochrome?: boolean;
}

export class HighPass extends Effect<HighPassProps> {
	public readonly op = "HighPass";

	public declare radius: number;
	public declare contrastBoost: number;
	public declare monochrome: boolean;

	constructor(config: HighPassProps = {}) {
		super({
			...config,
			radius: config.radius ?? 3.0,
			contrastBoost: config.contrastBoost ?? 1.0,
			monochrome: config.monochrome ?? true,
		});
	}
}

export type HalftoneDotShape = "Circle" | "Diamond" | "Line" | "Square";
export type HalftoneMode = "Monochrome" | "CMYK";

export interface HalftoneScreenProps {
	mode?: HalftoneMode;
	dotShape?: HalftoneDotShape;
	frequency?: EffectProp<number>;
	angle?: EffectProp<number>;
	contrast?: EffectProp<number>;
	dotColor?: string;
	paperColor?: string;
	smooth?: boolean;
	invert?: boolean;
	cyanAngle?: EffectProp<number>;
	magentaAngle?: EffectProp<number>;
	yellowAngle?: EffectProp<number>;
	blackAngle?: EffectProp<number>;
	opacity?: EffectProp<number>;
}

export class HalftoneScreen extends Effect<HalftoneScreenProps> {
	public readonly op = "HalftoneScreen";

	public declare mode: HalftoneMode;
	public declare dotShape: HalftoneDotShape;
	public declare frequency: number;
	public declare angle: number;
	public declare contrast: number;
	public declare dotColor: string;
	public declare paperColor: string;
	public declare smooth: boolean;
	public declare invert: boolean;
	public declare cyanAngle: number;
	public declare magentaAngle: number;
	public declare yellowAngle: number;
	public declare blackAngle: number;
	public declare opacity: number;

	constructor(config: HalftoneScreenProps = {}) {
		super({
			...config,
			mode: config.mode ?? "Monochrome",
			dotShape: config.dotShape ?? "Circle",
			frequency: config.frequency ?? 30,
			angle: config.angle ?? 45,
			contrast: config.contrast ?? 1.0,
			dotColor: config.dotColor ?? "#000000",
			paperColor: config.paperColor ?? "#ffffff",
			smooth: config.smooth ?? true,
			invert: config.invert ?? false,
			cyanAngle: config.cyanAngle ?? 15,
			magentaAngle: config.magentaAngle ?? 75,
			yellowAngle: config.yellowAngle ?? 0,
			blackAngle: config.blackAngle ?? 45,
			opacity: config.opacity ?? 1.0,
		});
	}
}

export type TileOffsetEdgeMode = "wrap" | "clamp" | "transparent" | "mirror";

export interface TileOffsetProps {
	offsetX?: EffectProp<number>;
	offsetY?: EffectProp<number>;
	wrap?: boolean;
	edgeMode?: TileOffsetEdgeMode;
}

export class TileOffset extends Effect<TileOffsetProps> {
	public readonly op = "TileOffset";

	public declare offsetX: number;
	public declare offsetY: number;
	public declare wrap: boolean;
	public declare edgeMode: TileOffsetEdgeMode;

	constructor(config: TileOffsetProps = {}) {
		super({
			...config,
			offsetX: config.offsetX ?? 0,
			offsetY: config.offsetY ?? 0,
			wrap: config.wrap ?? true,
			edgeMode: config.edgeMode ?? "wrap",
		});
	}
}

export interface MotionBlurProps {
	shutterAngle?: EffectProp<number>;
	samples?: EffectProp<number>;
	maxVelocity?: EffectProp<number>;
	shutterCurve?: "box" | "gaussian" | "triangle";
	depthAware?: boolean;
}

export class MotionBlur extends Effect<MotionBlurProps> {
	public readonly op = "MotionBlur";

	public declare shutterAngle: number;
	public declare samples: number;
	public declare maxVelocity: number;
	public declare shutterCurve: "box" | "gaussian" | "triangle";
	public declare depthAware: boolean;

	constructor(config: MotionBlurProps = {}) {
		super({
			...config,
			shutterAngle: config.shutterAngle ?? 180,
			samples: config.samples ?? 16,
			maxVelocity: config.maxVelocity ?? 64,
			shutterCurve: config.shutterCurve ?? "gaussian",
			depthAware: config.depthAware ?? true,
		});
	}
}

export interface SSAOProps {
	radius?: EffectProp<number>;
	bias?: EffectProp<number>;
	intensity?: EffectProp<number>;
	kernelSamples?: EffectProp<number>;
	blurRadius?: EffectProp<number>;
}

export class SSAO extends Effect<SSAOProps> {
	public readonly op = "SSAO";

	public declare radius: number;
	public declare bias: number;
	public declare intensity: number;
	public declare kernelSamples: number;
	public declare blurRadius: number;

	constructor(config: SSAOProps = {}) {
		super({
			...config,
			radius: config.radius ?? 45,
			bias: config.bias ?? 0.025,
			intensity: config.intensity ?? 1.5,
			kernelSamples: config.kernelSamples ?? 16,
			blurRadius: config.blurRadius ?? 4,
		});
	}
}

export interface PBRGlassProps {
	ior?: EffectProp<number>;
	roughness?: EffectProp<number>;
	transmission?: EffectProp<number>;
	dispersion?: EffectProp<number>;
	fresnelPower?: EffectProp<number>;
	tintColor?: EffectProp<string>;
}

export class PBRGlass extends Effect<PBRGlassProps> {
	public readonly op = "PBRGlass";

	public declare ior: number;
	public declare roughness: number;
	public declare transmission: number;
	public declare dispersion: number;
	public declare fresnelPower: number;
	public declare tintColor: string;

	constructor(config: PBRGlassProps = {}) {
		super({
			...config,
			ior: config.ior ?? 1.49,
			roughness: config.roughness ?? 0.15,
			transmission: config.transmission ?? 0.92,
			dispersion: config.dispersion ?? 0.015,
			fresnelPower: config.fresnelPower ?? 5.0,
			tintColor: config.tintColor ?? "#ffffff",
		});
	}
}

export interface DepthOfFieldProps {
	focusDistance?: EffectProp<number>;
	focalLength?: EffectProp<number>;
	aperture?: EffectProp<number>;
	maxBlur?: EffectProp<number>;
	quality?: "low" | "medium" | "high" | "ultra";
}

export class DepthOfField extends Effect<DepthOfFieldProps> {
	public readonly op = "DepthOfField";

	public declare focusDistance: number;
	public declare focalLength: number;
	public declare aperture: number;
	public declare maxBlur: number;
	public declare quality: string;

	constructor(config: DepthOfFieldProps = {}) {
		super({
			...config,
			focusDistance: config.focusDistance ?? 500,
			focalLength: config.focalLength ?? 50,
			aperture: config.aperture ?? 2.8,
			maxBlur: config.maxBlur ?? 16,
			quality: config.quality ?? "high",
		});
	}
}

export interface CropProps {
	cropType?: "rect" | "path";
	leftPercentage?: EffectProp<number>;
	topPercentage?: EffectProp<number>;
	widthPercentage?: EffectProp<number>;
	heightPercentage?: EffectProp<number>;
	roundness?: EffectProp<number>;
	pathPoints?: { x: number; y: number }[];
	mode?: "cropped" | "rest";
}

export class Crop extends Effect<CropProps> {
	public readonly op = "Crop";

	public declare cropType: "rect" | "path";
	public declare leftPercentage: number;
	public declare topPercentage: number;
	public declare widthPercentage: number;
	public declare heightPercentage: number;
	public declare roundness: number;
	public declare pathPoints?: { x: number; y: number }[];
	public declare mode?: "cropped" | "rest";

	constructor(config: CropProps = {}) {
		super({
			cropType: config.cropType ?? "rect",
			leftPercentage: config.leftPercentage ?? 0,
			topPercentage: config.topPercentage ?? 0,
			widthPercentage: config.widthPercentage ?? 100,
			heightPercentage: config.heightPercentage ?? 100,
			roundness: config.roundness ?? 0,
			...config,
		});
	}
}

/**
 * @deprecated The MediaPipe engine was removed (specs/yolov4plan.ts §Phase F).
 * Legacy option shape, mapped onto YOLO by the `MediaPipe` alias class below.
 */
export interface MediaPipeProps {
	enablePoseLandmarks?: boolean;
	enableFaceLandmarks?: boolean;
	enableFaceBlendshapes?: boolean;
	enableSegmentation?: boolean;
	mode?: "passthrough" | "mask" | "matte" | "skeleton";
	delegate?: "CPU" | "GPU";
	modelsDir?: string;
	visionBundle?: unknown;
}

export interface YoloProps {
	enableDetection?: boolean;
	enableSegmentation?: boolean;
	enablePose?: boolean;
	enableClassification?: boolean;
	enableObb?: boolean;
	enableWorld?: boolean;
	prompts?: readonly string[];
	customModel?: CustomModelConfig;
	classes?: readonly string[];
	confidence?: number;
	iouThreshold?: number;
	variant?: "n" | "s" | "m" | "l" | "x";
	imgsz?: number;
	mode?:
		| "passthrough"
		| "mask"
		| "matte"
		| "crop"
		| "skeleton"
		| "boxes"
		| "tracking"
		| "obb";
	delegate?: "CPU" | "GPU";
	modelsDir?: string;
	baseUrl?: string;
	maskThreshold?: number;
	featherRadius?: number;
	/** Grow the person mask into connected colourful/dark foreground (e.g. a dress). */
	keyBackground?: boolean;
	/** Colour-distance threshold for the background key (lower → more growth). Default 70. */
	backgroundKeyThreshold?: number;
	visionBundle?: unknown;
}

export class Yolo extends Effect<YoloProps> {
	public readonly op = "Yolo";

	public declare enableDetection?: boolean;
	public declare enableSegmentation?: boolean;
	public declare enablePose?: boolean;
	public declare enableClassification?: boolean;
	public declare enableObb?: boolean;
	public declare enableWorld?: boolean;
	public declare prompts?: readonly string[];
	public declare customModel?: CustomModelConfig;
	public declare classes?: readonly string[];
	public declare confidence?: number;
	public declare iouThreshold?: number;
	public declare variant?: "n" | "s" | "m" | "l" | "x";
	public declare imgsz?: number;
	public declare mode?: YoloProps["mode"];
	public declare delegate?: "CPU" | "GPU";
	public declare modelsDir?: string;
	public declare baseUrl?: string;
	public declare maskThreshold?: number;
	public declare featherRadius?: number;
	public declare keyBackground?: boolean;
	public declare backgroundKeyThreshold?: number;
	public declare visionBundle?: unknown;

	constructor(config: YoloProps = {}) {
		super({
			enableDetection: config.enableDetection !== false,
			enableSegmentation: config.enableSegmentation === true,
			enablePose: config.enablePose === true,
			enableClassification: config.enableClassification === true,
			enableObb: config.enableObb === true,
			confidence: config.confidence ?? 0.25,
			iouThreshold: config.iouThreshold ?? 0.45,
			variant: config.variant ?? "n",
			imgsz: config.imgsz ?? 640,
			mode: config.mode ?? "passthrough",
			delegate: config.delegate ?? "CPU",
			...config,
		});
	}
}

/**
 * @deprecated Use `Yolo`. Kept as a source-compatible alias that maps the legacy MediaPipe
 * option shape onto the YOLO engine (`op` is `"Yolo"`).
 */
export class MediaPipe extends Yolo {
	constructor(config: MediaPipeProps = {}) {
		super({
			enableDetection: true,
			enablePose: config.enablePoseLandmarks !== false,
			enableSegmentation: config.enableSegmentation === true,
			mode:
				config.mode === "skeleton"
					? "skeleton"
					: (config.mode ?? "passthrough"),
			...(config.delegate !== undefined ? { delegate: config.delegate } : {}),
			...(config.modelsDir !== undefined
				? { modelsDir: config.modelsDir }
				: {}),
			...(config.visionBundle !== undefined
				? { visionBundle: config.visionBundle }
				: {}),
		});
	}
}

export interface Relight3DProps {
	lightType?: "Point" | "Spot" | "Directional" | "Rim";
	intensity?: EffectProp<number>;
	lightPosX?: EffectProp<number>;
	lightPosY?: EffectProp<number>;
	lightPosZ?: EffectProp<number>;
	lightRadius?: EffectProp<number>;
	spotConeAngle?: EffectProp<number>;
	specularRoughness?: EffectProp<number>;
	specularStrength?: EffectProp<number>;
	metallic?: EffectProp<number>;
	ambientIntensity?: EffectProp<number>;
	volumetricDensity?: EffectProp<number>;
	depthScale?: EffectProp<number>;
	depthInvert?: boolean;
	lightColor?: string;
	ambientColor?: string;
	normalMap?: unknown;
}

export class Relight3D extends Effect<Relight3DProps> {
	public readonly op = "Relight3D";

	public declare lightType: Relight3DProps["lightType"];
	public declare intensity: number;
	public declare lightPosX: number;
	public declare lightPosY: number;
	public declare lightPosZ: number;
	public declare lightRadius: number;
	public declare spotConeAngle: number;
	public declare specularRoughness: number;
	public declare specularStrength: number;
	public declare metallic: number;
	public declare ambientIntensity: number;
	public declare volumetricDensity: number;
	public declare depthScale: number;
	public declare depthInvert: boolean;
	public declare lightColor: string;
	public declare ambientColor: string;
	public declare normalMap: unknown;

	constructor(config: Relight3DProps = {}) {
		super({
			lightType: config.lightType ?? "Point",
			intensity: config.intensity ?? 1.0,
			lightPosX: config.lightPosX ?? 0.5,
			lightPosY: config.lightPosY ?? 0.5,
			lightPosZ: config.lightPosZ ?? 0.3,
			lightRadius: config.lightRadius ?? 0.8,
			spotConeAngle: config.spotConeAngle ?? 45,
			specularRoughness: config.specularRoughness ?? 0.35,
			specularStrength: config.specularStrength ?? 0.7,
			metallic: config.metallic ?? 0.0,
			ambientIntensity: config.ambientIntensity ?? 0.4,
			volumetricDensity: config.volumetricDensity ?? 0.2,
			depthScale: config.depthScale ?? 1.0,
			depthInvert: config.depthInvert ?? false,
			lightColor: config.lightColor ?? "#ffffff",
			ambientColor: config.ambientColor ?? "#ffffff",
			normalMap: config.normalMap,
			...config,
		});
	}
}

export interface DeflickerProps {
	blendWeight?: EffectProp<number>;
	disocclusionThreshold?: EffectProp<number>;
	maxMotionPixels?: EffectProp<number>;
	scale?: number;
	windowSize?: number;
}

export class TemporalDeflicker extends Effect<DeflickerProps> {
	public readonly op = "TemporalDeflicker";

	public declare blendWeight: number;
	public declare disocclusionThreshold: number;
	public declare maxMotionPixels: number;
	public declare scale: number;
	public declare windowSize: number;

	constructor(config: DeflickerProps = {}) {
		super({
			blendWeight: config.blendWeight ?? 0.35,
			disocclusionThreshold: config.disocclusionThreshold ?? 0.15,
			maxMotionPixels: config.maxMotionPixels ?? 64.0,
			scale: config.scale ?? 0.5,
			windowSize: config.windowSize ?? 2,
			...config,
		});
	}
}

export interface ModulateProps {
	hue?: EffectProp<number>;
	brightness?: EffectProp<number>;
	contrast?: EffectProp<number>;
	exposure?: EffectProp<number>;
	saturation?: EffectProp<number>;
	sepia?: EffectProp<number>;
}

export class Modulate extends Effect<ModulateProps> {
	public readonly op = "Modulate";

	public declare hue: number;
	public declare brightness: number;
	public declare contrast: number;
	public declare exposure: number;
	public declare saturation: number;
	public declare sepia: number;

	constructor(config: ModulateProps = {}) {
		super({
			hue: config.hue ?? 0,
			brightness: config.brightness ?? 1.0,
			contrast: config.contrast ?? 1.0,
			exposure: config.exposure ?? 0.0,
			saturation: config.saturation ?? 1.0,
			sepia: config.sepia ?? 0.0,
			...config,
		});
	}
}
