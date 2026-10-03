import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const cameraParallax3DConfig = configBuilder()
	.field(
		"motionPreset",
		z
			.enum([
				"Custom",
				"DollyZoom",
				"Orbit",
				"FlyThrough",
				"HandheldShake",
				"RackFocus",
			])
			.default("DollyZoom"),
		{
			bindable: false,
			label: "Motion Preset",
		},
	)
	.field("panX", z.number().min(-1.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Pan X Signal",
		description:
			"Horizontal camera pan angle / position offset (-1.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("panY", z.number().min(-1.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Pan Y Signal",
		description:
			"Vertical camera tilt angle / position offset (-1.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("dollyZ", z.number().min(-1.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Dolly Z Signal",
		description:
			"Camera forward/backward zoom position (-1.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("fov", z.number().min(15.0).max(120.0).default(50.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "FOV Signal",
		description:
			"Camera Field of View in degrees (15° to 120°). Can be modulated by a static number or dynamic signal.",
	})
	.field("parallaxAmount", z.number().min(0.0).max(2.0).default(0.6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Parallax Amount Signal",
		description:
			"Strength of 3D spatial displacement depth relief. Can be modulated by a static number or dynamic signal.",
	})
	.field("dofAperture", z.number().min(0.0).max(1.0).default(0.3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Aperture Signal",
		description:
			"Lens aperture size / Circle of Confusion bokeh blur radius. Can be modulated by a static number or dynamic signal.",
	})
	.field("focusPlane", z.number().min(0.0).max(1.0).default(0.4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Focus Plane Signal",
		description:
			"Focal plane depth in scene (0.0=foreground, 1.0=background). Can be modulated by a static number or dynamic signal.",
	})
	.field("edgeDilation", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Edge Dilation Signal",
		description:
			"Inpainting border bleed to eliminate border occlusion tearing.",
	})
	.field("depthInvert", z.boolean().default(false), {
		bindable: false,
		label: "Invert Depth",
		description: "Invert depth polarity (white = near vs black = near).",
	})
	.build();

export const CameraParallax3DNodeConfigSchema = cameraParallax3DConfig.schema;

export type CameraParallax3DNodeConfig = z.infer<
	typeof CameraParallax3DNodeConfigSchema
>;

/** Canonical default config — single source of truth for metadata, reset, and fallbacks. */
export const DEFAULT_CAMERA_PARALLAX_3D_CONFIG: CameraParallax3DNodeConfig =
	CameraParallax3DNodeConfigSchema.parse({
		motionPreset: "DollyZoom",
		panX: 0.0,
		panY: 0.0,
		dollyZ: 0.0,
		fov: 50.0,
		parallaxAmount: 0.6,
		dofAperture: 0.3,
		focusPlane: 0.4,
		edgeDilation: 0.5,
		depthInvert: false,
	});

export const CameraParallax3DResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type CameraParallax3DResult = z.infer<
	typeof CameraParallax3DResultSchema
>;

export const CAMERA_PARALLAX_3D_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
