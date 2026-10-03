import { z } from "zod";
import type { DataType } from "../base.js";

export const DATA_TYPE_EXTENSIONS: Record<DataType, string> = {
	Image: "png",
	Video: "mp4",
	Audio: "mp3",
	Text: "txt",
	Number: "txt",
	Boolean: "txt",
	SVG: "svg",
	Caption: "srt",
	Lottie: "json",
	// TODO: Add support for all 3D file formats
	ThreeD: "glb",
	GIF: "gif",
	Signal: "txt",
	LUT: "cube",
};

// MIME type mapping
export const MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	pdf: "application/pdf",
	json: "application/json",
	txt: "text/plain",
	srt: "text/srt",
	aac: "audio/aac",
	flac: "audio/flac",
};

// Shared Enums and Constants
export const COMPOSITE_OPERATIONS = [
	// Basic Compositing
	"source-over",
	"source-in",
	"source-out",
	"source-atop",
	"destination-over",
	"destination-in",
	"destination-out",
	"destination-atop",
	"lighter",
	"copy",
	"xor",

	// Blending Modes
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
] as const;

export const GlobalCompositeOperation = z.enum(COMPOSITE_OPERATIONS);

type ZodSchemaType = z.ZodType<any, any, any>;

// biome-ignore lint/complexity/noStaticOnlyClass: Required
export class ConfigSchemaRegistry {
	private static schemas = new Map<string, ZodSchemaType>();

	static register(type: string, schema: ZodSchemaType) {
		ConfigSchemaRegistry.schemas.set(type, schema);
	}

	static get(type: string): ZodSchemaType | undefined {
		return ConfigSchemaRegistry.schemas.get(type);
	}

	static clear() {
		ConfigSchemaRegistry.schemas.clear();
	}
}
