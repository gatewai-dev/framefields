import { debugLog } from "../debug-log.js";

const SLUGGISH_HEADER_DATA = "SLUGGISH";
/** v2 adds a glyph id to every record, so shaped (unmapped) glyphs round-trip. */
const SLUGGISH_HEADER_DATA_V2 = "SLUGGIS2";
const TEXTURE_WIDTH = 4096;

export interface SlugCodePoint {
	/** Unicode code point, -1 for .notdef, or -2 for a glyph no code point maps to. */
	codePoint: number;
	/** The font's glyph id; shaping output refers to glyphs by this. */
	glyphId?: number;
	width: number;
	height: number;
	advanceWidth: number;
	bearingX: number;
	bearingY: number;
	bandCount: number;
	bandDimX: number;
	bandDimY: number;
	bandsTexCoordX: number;
	bandsTexCoordY: number;
}

export interface SlugFont {
	codePoints: Map<number, SlugCodePoint>;
	/** The same glyphs keyed by glyph id (shaped text looks glyphs up here). */
	glyphs?: Map<number, SlugCodePoint>;
	curvesTex: GPUTexture;
	bandsTex: GPUTexture;
	ascender: number;
	descender: number;
	lineGap: number;
	unitsPerEm: number;
	fontFamily?: string;
	hasTrueWeight?: boolean;
	weight?: number;
}

/** `SlugCodePoint.codePoint` of a glyph that only shaping reaches. */
export const UNMAPPED_CODE_POINT = -2;

export class SlugLoader {
	static parse(device: GPUDevice, buffer: ArrayBuffer): SlugFont {
		const startTime = performance.now();
		const dataView = new DataView(buffer);
		let offset = 0;

		// Verify Header Validate
		const headerBytes = new Uint8Array(buffer, offset, 8);
		let headerStr = "";
		for (let i = 0; i < 8; i++) {
			headerStr += String.fromCharCode(headerBytes[i]);
		}
		const isV2 = headerStr === SLUGGISH_HEADER_DATA_V2;
		if (headerStr !== SLUGGISH_HEADER_DATA && !isV2) {
			throw new Error(
				`Invalid header found (${headerStr} instead of ${SLUGGISH_HEADER_DATA_V2})`,
			);
		}
		offset += 8;

		const codePointCount = isV2
			? dataView.getUint32(offset, true)
			: dataView.getUint16(offset, true);
		offset += isV2 ? 4 : 2;

		const codePoints = new Map<number, SlugCodePoint>();
		const glyphs = new Map<number, SlugCodePoint>();
		for (let i = 0; i < codePointCount; i++) {
			const cp: SlugCodePoint = {
				codePoint: isV2
					? dataView.getInt32(offset, true)
					: dataView.getUint32(offset, true),
				width: dataView.getUint32(offset + 4, true),
				height: dataView.getUint32(offset + 8, true),
				advanceWidth: dataView.getUint32(offset + 12, true),
				bearingX: dataView.getInt32(offset + 16, true),
				bearingY: dataView.getInt32(offset + 20, true),
				bandCount: dataView.getUint32(offset + 24, true),
				bandDimX: dataView.getUint32(offset + 28, true),
				bandDimY: dataView.getUint32(offset + 32, true),
				bandsTexCoordX: dataView.getUint16(offset + 36, true),
				bandsTexCoordY: dataView.getUint16(offset + 38, true),
			};
			if (isV2) {
				cp.glyphId = dataView.getUint32(offset + 40, true);
				glyphs.set(cp.glyphId, cp);
			}
			if (cp.codePoint !== UNMAPPED_CODE_POINT)
				codePoints.set(cp.codePoint, cp);
			offset += isV2 ? 44 : 40;
		}

		const curvesTexWidth = dataView.getUint16(offset, true);
		offset += 2;
		const curvesTexHeight = dataView.getUint16(offset, true);
		offset += 2;
		const curvesTexBytes = dataView.getUint32(offset, true);
		offset += 4;

		if (
			curvesTexWidth === 0 ||
			curvesTexHeight === 0 ||
			curvesTexBytes === 0 ||
			curvesTexWidth !== TEXTURE_WIDTH
		) {
			throw new Error("Invalid curves texture dimensions");
		}

		const curvesTexels = curvesTexWidth * curvesTexHeight;
		const curvesData = new Float32Array(curvesTexels * 4); // RGBA32F
		const curvesBuffer = buffer.slice(offset, offset + curvesTexBytes);
		const incomingCurvesData = new Float32Array(curvesBuffer);
		curvesData.set(incomingCurvesData);
		offset += curvesTexBytes;

		const bandsTexWidth = dataView.getUint16(offset, true);
		offset += 2;
		const bandsTexHeight = dataView.getUint16(offset, true);
		offset += 2;
		const bandsTexBytes = dataView.getUint32(offset, true);
		offset += 4;

		if (
			bandsTexWidth === 0 ||
			bandsTexHeight === 0 ||
			bandsTexBytes === 0 ||
			bandsTexWidth !== TEXTURE_WIDTH
		) {
			throw new Error("Invalid bands texture dimensions");
		}

		const bandsTexels = bandsTexWidth * bandsTexHeight;
		const bandsData = new Uint32Array(bandsTexels * 2); // RG32UI
		const bandsBuffer = buffer.slice(offset, offset + bandsTexBytes);
		const incomingBandsData = new Uint32Array(bandsBuffer);
		bandsData.set(incomingBandsData);
		offset += bandsTexBytes;

		let ascender = 0;
		let descender = 0;
		let lineGap = 0;
		let unitsPerEm = 0;
		if (offset + 16 <= buffer.byteLength) {
			ascender = dataView.getInt32(offset, true);
			offset += 4;
			descender = dataView.getInt32(offset, true);
			offset += 4;
			lineGap = dataView.getInt32(offset, true);
			offset += 4;
			unitsPerEm = dataView.getInt32(offset, true);
			offset += 4;
		}

		// Create WebGPU textures
		const curvesTex = device.createTexture({
			label: "SlugCurvesTexture",
			size: [curvesTexWidth, curvesTexHeight],
			format: "rgba32float",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture(
			{ texture: curvesTex },
			curvesData,
			{ bytesPerRow: curvesTexWidth * 16 },
			[curvesTexWidth, curvesTexHeight],
		);

		const bandsTex = device.createTexture({
			label: "SlugBandsTexture",
			size: [bandsTexWidth, bandsTexHeight],
			format: "rg32uint",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture(
			{ texture: bandsTex },
			bandsData,
			{ bytesPerRow: bandsTexWidth * 8 },
			[bandsTexWidth, bandsTexHeight],
		);

		const elapsed = performance.now() - startTime;
		debugLog(
			`[SlugLoader] Parsed slug binary (${codePoints.size} glyphs) in ${elapsed.toFixed(2)}ms`,
		);

		return {
			codePoints,
			glyphs: isV2 ? glyphs : undefined,
			curvesTex,
			bandsTex,
			ascender,
			descender,
			lineGap,
			unitsPerEm,
		};
	}
}
