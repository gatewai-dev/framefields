/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
	registerVisionModel,
	VISION_MODELS,
	type VisionCompute,
	type VisionModelDescriptor,
} from "@framefields/vision";

/**
 * SAM model registry. Every file is pinned to an immutable Hugging Face revision with its
 * exact size and SHA-256; the shared `VisionModelStore` verifies both after download.
 * Nothing here touches the network: the descriptors are registered into the vision
 * registry on first tracker creation so `@framefields/vision` never lists SAM weights.
 */

/** SAM 2.1 checkpoints with a pinned video export. */
export type Sam2Model = "tiny" | "small";

export type Sam2Graph =
	| "vision_encoder"
	| "mask_decoder"
	| "memory_encoder"
	| "memory_attention"
	| "pointer_tpos";

export type Sam2ModelKey = `sam2.1-${Sam2Model}-${Sam2Graph | "constants"}`;

/**
 * Diffusion Studio's fp16 video exports of Meta SAM 2.1 (Apache-2.0). Tiny is built for
 * speed at 512² (32×32 features); Small runs SAM 2's native 1024² (64×64), resolving small
 * objects, thin structures and identity after cuts better at roughly 4× the encoder and
 * 16× the memory-attention work.
 */
export const SAM2_EXPORTS: Readonly<
	Record<
		Sam2Model,
		{ repo: string; revision: string; size: number; name: string }
	>
> = {
	tiny: {
		repo: "diffusionstudio/sam2.1-tiny-video-onnx-fp16",
		revision: "66673b5db39371b7dd7847f4d3bc0d4f4179b79e",
		size: 512,
		name: "Hiera Tiny",
	},
	small: {
		repo: "diffusionstudio/sam2.1-small-video-onnx-fp16",
		revision: "927ecec6e6ae2727d0af7720eefdb07f2efe4689",
		size: 1024,
		name: "Hiera Small",
	},
};

/** Weight formats published for the SAM 3 tracker's image encoder. */
export type Sam3Precision = "fp16" | "q4f16" | "q4";

/**
 * The encoder precision each backend runs fastest. Measured on an M1 Pro (one 1008² frame):
 * WebGPU fp16 3.65 s, q4f16 4.43 s, q4 6.63 s, int8 140 s (its ops fall back to the CPU);
 * fp16 is also the closest to full precision. On WebGPU, 4-bit weights are dequantized
 * before every matmul, so they only save memory. CUDA runs fp16 on tensor cores. CPUs have
 * no fast fp16 path, so they get fp32-activation q4.
 */
export const SAM3_ENCODER: Readonly<Record<VisionCompute, Sam3Precision>> = {
	webgpu: "fp16",
	cuda: "fp16",
	cpu: "q4",
};

export type Sam3ModelKey =
	| `sam3-vision_encoder-${Sam3Precision}`
	| `sam3-vision_encoder-${Sam3Precision}-data`
	| "sam3-mask_decoder"
	| "sam3-memory_encoder"
	| "sam3-memory_attention"
	| "sam3-support"
	| "sam3-support-data"
	| "sam3-text-vision_encoder"
	| "sam3-text-vision_encoder-data"
	| "sam3-text-encoder"
	| "sam3-text-decoder"
	| "sam3-tokenizer"
	| "sam3-tokenizer-config";

export type SamModelKey = Sam2ModelKey | Sam3ModelKey;

export const SAM_LICENSE = "Meta SAM License";

const hf = (repo: string, revision: string, path: string): string =>
	`https://huggingface.co/${repo}/resolve/${revision}/${path}`;

type Pin = readonly [path: string, bytes: number, sha256: string];

const sam2 = (
	model: Sam2Model,
	graph: Sam2Graph | "constants",
	[path, bytes, sha256]: Pin,
): VisionModelDescriptor => {
	const { repo, revision, size, name } = SAM2_EXPORTS[model];
	const key: Sam2ModelKey = `sam2.1-${model}-${graph}`;
	return {
		key,
		family: "sam2",
		filename: `${key}${path.slice(path.lastIndexOf("."))}`,
		url: hf(repo, revision, path),
		bytes,
		sha256,
		input: [size, size],
		source: `Meta SAM 2.1 ${name} (Apache-2.0), Diffusion Studio ${size}px fp16 video export`,
		license: "Apache-2.0",
	};
};

const sam3 =
	(repo: string, revision: string) =>
	(
		key: Sam3ModelKey,
		filename: string,
		[path, bytes, sha256]: Pin,
	): VisionModelDescriptor => ({
		key,
		family: "sam3",
		filename,
		url: hf(repo, revision, path),
		bytes,
		sha256,
		input: [1008, 1008],
		source: `Meta SAM 3 (${SAM_LICENSE}), pinned ${repo} ONNX export`,
		license: SAM_LICENSE,
	});

const tracker = sam3(
	"onnx-community/sam3-tracker-ONNX",
	"429305c8a5b3de597243d919a07e4e6bdcd00ef7",
);
/** The tracker encoder at `precision`: its graph and the weights file the graph names. */
function encoder(
	precision: Sam3Precision,
	[graphBytes, graphSha]: readonly [number, string],
	[dataBytes, dataSha]: readonly [number, string],
): VisionModelDescriptor[] {
	const { graph, data } = sam3EncoderFiles(precision);
	return [
		tracker(`sam3-vision_encoder-${precision}`, `sam3-${graph}`, [
			`onnx/${graph}`,
			graphBytes,
			graphSha,
		]),
		tracker(`sam3-vision_encoder-${precision}-data`, `sam3-${data}`, [
			`onnx/${data}`,
			dataBytes,
			dataSha,
		]),
	];
}

/** File names of the encoder at `precision`; the graph refers to its weights by `data`. */
export function sam3EncoderFiles(precision: Sam3Precision): {
	graph: string;
	data: string;
} {
	const graph = `vision_encoder_${precision}.onnx`;
	return { graph, data: `${graph}_data` };
}

const video = sam3(
	"jax-image-tools/sam3-video-onnx",
	"e942689a73d942f83c69b5965881cb3a0f6153ba",
);
const support = sam3(
	"RamRom/sam3-onnx",
	"68ce2746e903966a88549cdd08ab554ff9162db0",
);
const text = sam3(
	"danilobukvic/sam3-text-onnx",
	"fe8f8e123bfa42d4e57d14fa2f4928a4c60f4665",
);
const SUPPORT_GRAPH =
	"bundles/sam3-base-video-tracking-ortcuda-v2/graphs/base_tracker_preview_single1.onnx";

export const SAM_MODELS: readonly VisionModelDescriptor[] = [
	sam2("tiny", "constants", [
		"constants.json",
		9781,
		"67583810f4b80b762285377a5cc1066bbe19cdf8ef7fc87ff6aa78fc79830ef2",
	]),
	sam2("tiny", "vision_encoder", [
		"onnx/vision_encoder.onnx",
		58385353,
		"24e9ccf5994be5c8dd93ebe771a4cc4f8bb122d0524555ac3ba4e7141710b133",
	]),
	sam2("tiny", "mask_decoder", [
		"onnx/mask_decoder.onnx",
		8898805,
		"6bc158b0d028777ca2e25203ece0f27429c436de39a5c7fe301b3858d6059789",
	]),
	sam2("tiny", "memory_encoder", [
		"onnx/memory_encoder.onnx",
		2807753,
		"8b2bb6810444cee684ef938b7464c5645653f236014f5497c3db3654818cc7ce",
	]),
	sam2("tiny", "memory_attention", [
		"onnx/memory_attention.onnx",
		13029470,
		"67c4e4da01bc7f501b88294bb19a8200362915ece04e9d7e367a437658f342c9",
	]),
	sam2("tiny", "pointer_tpos", [
		"onnx/pointer_tpos.onnx",
		34228,
		"3ab5bfce40ed01208301b2d8f596b9c9f7f493dcd7e09ef01ec22e5be3694bd7",
	]),
	sam2("small", "constants", [
		"constants.json",
		9820,
		"09397f7251c159b64a2d581cc3ea0dbb3cf720c2e60777cb14e244405ed1c305",
	]),
	sam2("small", "vision_encoder", [
		"onnx/vision_encoder.onnx",
		83679474,
		"fb570036f5afac59ef20848958b075c84da746e333efd863104d94604652efc4",
	]),
	sam2("small", "mask_decoder", [
		"onnx/mask_decoder.onnx",
		8910345,
		"999b3b47bf2e924d522ed6cc011fa2c9b651754cc07895eb0da16a28a5ce7c4d",
	]),
	sam2("small", "memory_encoder", [
		"onnx/memory_encoder.onnx",
		2807884,
		"f36324e383dbf21fcd549169aedf698db00c307fd9a49538c0e5f0aa168e4f99",
	]),
	sam2("small", "memory_attention", [
		"onnx/memory_attention.onnx",
		16175204,
		"6666be8ca502b5c16e9a113d3d3934996d32f27e93bee5e66a8317fcceec9985",
	]),
	sam2("small", "pointer_tpos", [
		"onnx/pointer_tpos.onnx",
		34228,
		"f9c1b36e0aa9dc6b7c05b02a8fdaa17cc671d967ffcacc14fcd3177e65ec25e9",
	]),
	...encoder(
		"fp16",
		[
			1263005,
			"f8c52be6de99124bb17f25792054406abc482ce3502166f948d5c5849cd14d02",
		],
		[
			934729728,
			"4b021a4d3068c9e9153f2f2fcc9e6d280156228671c00ab6c2ddfa737da7f151",
		],
	),
	...encoder(
		"q4f16",
		[
			1307816,
			"4b96732adab3d7d70ac0964ce540a61fad097fbc10c9b27612f47d676877cefc",
		],
		[
			295622656,
			"d1d60808376dbd48e34cf89feaee708c13abed229f2398ab512149db34fdab07",
		],
	),
	...encoder(
		"q4",
		[
			1320396,
			"b80cb1cb6ab80efe646ad49ffa11d398af76e8912eb966971932ef2d8e7fe11b",
		],
		[
			368954368,
			"be632cacb4a82ef8be28285e49821b9dd7f96e3231cb90df631890f367110555",
		],
	),
	video("sam3-mask_decoder", "sam3-mask_decoder.onnx", [
		"mask_decoder.onnx",
		17809322,
		"4dff9a588828eeceba4285be85fb9c2a0306447ad642d02b1d8f6bfff1f19af9",
	]),
	video("sam3-memory_encoder", "sam3-memory_encoder.onnx", [
		"memory_encoder.onnx",
		5587704,
		"78146118c2f91073489926bb587a81f129c391b2e0d1dba3aede6fbaa699498f",
	]),
	video("sam3-memory_attention", "sam3-memory_attention.onnx", [
		"memory_attention.onnx",
		34592488,
		"8b24dc20acbb485b81f0e67ed0980b747aaa836707ccff4567a87e59c0ca1c24",
	]),
	support("sam3-support", "sam3-base_tracker_preview_single1.onnx", [
		SUPPORT_GRAPH,
		3064674,
		"d80c1958175d5de6ca72f5b95d24d853dbdb511e0851d5918a4dcf7ed000f3ea",
	]),
	support("sam3-support-data", "sam3-base_tracker_preview_single1.onnx.data", [
		`${SUPPORT_GRAPH}.data`,
		63668224,
		"618f62fbac368e863ee295526efd84ca768fb9914c7e1a5d9f1fb0f28837dda1",
	]),
	text("sam3-text-vision_encoder", "sam3-vision_encoder_int4_fp16attn.onnx", [
		"vision_encoder_int4_fp16attn.onnx",
		5216609,
		"9d148134938a6a284a829733774d3b1356a706a3397bb1d4be240bf041e3ac0e",
	]),
	text(
		"sam3-text-vision_encoder-data",
		"sam3-vision_encoder_int4_fp16attn.onnx.data",
		[
			"vision_encoder_int4_fp16attn.onnx.data",
			292836352,
			"b89c9156064e926761f29be3f87b160fd34f4c93f1de46593295d155621829a2",
		],
	),
	text("sam3-text-encoder", "sam3-text_encoder_int8.onnx", [
		"text_encoder_int8.onnx",
		357021801,
		"c0baf8a4165ecc4039bee9389903723e74a68d617d685a4f1dbfc21c58bb4121",
	]),
	text("sam3-text-decoder", "sam3-decoder_int8.onnx", [
		"decoder_int8.onnx",
		26804694,
		"d721e7b643bb3ee2c48a59d520401c035c702cfbb13cb7f50fa103f0beb27af8",
	]),
	text("sam3-tokenizer", "sam3-tokenizer.json", [
		"tokenizer.json",
		3642073,
		"6d9109cc838977f3ca94a379eec36aecc7c807e1785cd729660ca2fc0171fb35",
	]),
	text("sam3-tokenizer-config", "sam3-tokenizer_config.json", [
		"tokenizer_config.json",
		799,
		"39670ad98457fe8f14ca59f6bb74591e9fc850974380a63993e5b8ffc865baa2",
	]),
];

/** Registers the SAM descriptors into the shared vision registry (idempotent). */
export function ensureSamModelsRegistered(): void {
	for (const descriptor of SAM_MODELS) {
		if (!VISION_MODELS[descriptor.key]) registerVisionModel(descriptor);
	}
}
