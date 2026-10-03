const GLOBAL_WEBGPU_REGISTRY_KEY = Symbol.for("gatewai.webgpuRegistry");
const GLOBAL_ANALYSIS_STORE_KEY = Symbol.for("gatewai.videoAnalysisStore");

export async function resolveVideoSignalValue(
	_device: GPUDevice,
	ctx: any,
	encoder: GPUCommandEncoder,
	sd: any,
	frame: number,
	fps: number,
	drawChild: any,
): Promise<number> {
	if (!sd || sd.type !== "generator" || !sd.nodeType) return 0.0;

	const g = globalThis as any;
	const webgpuRegistry = g[GLOBAL_WEBGPU_REGISTRY_KEY];
	if (!webgpuRegistry) return 0.0;

	const renderer = webgpuRegistry.get(sd.nodeType);
	if (!renderer) return 0.0;

	const key = `${sd.nodeId}-${frame}`;
	const analysisStore = g[GLOBAL_ANALYSIS_STORE_KEY];

	if (!analysisStore || !analysisStore.has(key)) {
		const virtualMedia = {
			type: "layer" as const,
			operation: {
				id: sd.nodeId,
				op: sd.nodeType,
				smoothing: sd.smoothing,
				gain: sd.gain,
				offset: sd.offset,
				inputs: {},
			},
			children: sd.input ? [sd.input] : [],
		};

		const props = {
			renderId: sd.nodeId,
			virtualMedia,
			frame,
			fps,
			containerWidth: 256,
			containerHeight: 256,
		};

		const dummyPass = {
			end: () => {},
		} as any as GPURenderPassEncoder;

		await renderer({
			ctx,
			encoder,
			pass: dummyPass,
			targetView: null as any,
			targetTexture: null as any,
			targetWidth: 256,
			targetHeight: 256,
			props,
			drawChild,
		});
	}

	if (!analysisStore) return 0.0;
	const cached = analysisStore.get(key);
	if (!cached) return 0.0;

	const rawVal = cached[sd.channel] ?? 0.0;
	return rawVal * sd.gain + sd.offset;
}
