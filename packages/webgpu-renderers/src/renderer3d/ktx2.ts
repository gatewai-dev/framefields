import {
	KTX2_IDENTIFIER,
	parseKtx2,
	transcodeKtx2,
} from "@forgeax/engine-codec";

export function isKtx2(bytes: Uint8Array): boolean {
	return (
		bytes.length >= KTX2_IDENTIFIER.length &&
		KTX2_IDENTIFIER.every((byte, i) => bytes[i] === byte)
	);
}

/** Transcodes Basis KTX2 to portable RGBA8 mip levels for any WebGPU device. */
export async function decodeKtx2(
	bytes: Uint8Array,
): Promise<{ width: number; height: number; levels: Uint8Array[] }> {
	const parsed = await parseKtx2(bytes);
	if (!parsed.ok) throw new Error(`KTX2 parse failed: ${parsed.error.code}`);
	const { pixelDepth, layerCount, faceCount } = parsed.value.header;
	if (pixelDepth > 1 || layerCount > 1 || faceCount !== 1)
		throw new Error("Only 2D KTX2 textures are supported");
	const decoded = await transcodeKtx2(parsed.value, "rgba8unorm");
	if (!decoded.ok)
		throw new Error(`KTX2 transcode failed: ${decoded.error.code}`);
	const { width, height, mips } = decoded.value;
	if (
		!mips.length ||
		mips.some(
			(mip, i) =>
				mip.level !== i ||
				mip.width !== Math.max(1, width >> i) ||
				mip.height !== Math.max(1, height >> i) ||
				mip.data.length !== mip.width * mip.height * 4,
		)
	) {
		throw new Error("KTX2 transcoder returned an invalid mip chain");
	}
	return { width, height, levels: mips.map((mip) => mip.data) };
}
