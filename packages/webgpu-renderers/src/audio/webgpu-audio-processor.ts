import { isSignal, type VirtualMediaData } from "@framefields/core";
import { shaderStore } from "../shader-store.js";
import { signalRegistry } from "../signals/signal-registry.js";

export interface AudioSignalBinding {
	parameterName: string;
	signalNodeId: string;
	signalFnName: string;
}

export interface CachedPipelineAndState {
	pipeline: GPUComputePipeline;
	stateBuffer: GPUBuffer;
	activeSignalsKey: string;
	inputBuffer?: GPUBuffer;
	outputBuffer?: GPUBuffer;
	uniformBuffer?: GPUBuffer;
	allocatedSamples?: number;
	allocatedChannels?: number;
	allocatedUniformsFloatCount?: number;
	_reverbStateInitialized?: boolean;
}

interface AudioOperation extends Record<string, unknown> {
	op: string;
	id?: string;
	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem?: {
				type: string;
				data?: {
					type?: string;
					nodeId?: string;
					value?: number;
					offset?: number;
					amplitude?: number;
					frequency?: number;
					phase?: number;
					array?: number[];
					customWGSL?: string;
					wgsl?: string;
					signalFnName?: string;
					name?: string;
					outputType?: string;
					fnParams?: any[];
				};
			};
		}
	>;
}

const yieldToMain = (): Promise<void> => {
	if (typeof window === "undefined") {
		return Promise.resolve();
	}
	const sched = (globalThis as any).scheduler as
		| { yield?: () => Promise<void> }
		| undefined;
	return typeof sched?.yield === "function"
		? sched.yield()
		: new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export class WebGPUAudioProcessor {
	private static devicePipelineCache = new WeakMap<
		GPUDevice,
		Map<string, CachedPipelineAndState>
	>();

	private static getDeviceCache(
		device: GPUDevice,
	): Map<string, CachedPipelineAndState> {
		let cache = WebGPUAudioProcessor.devicePipelineCache.get(device);
		if (!cache) {
			cache = new Map();
			WebGPUAudioProcessor.devicePipelineCache.set(device, cache);
		}
		return cache;
	}

	public static getCache(
		device: GPUDevice,
		renderId: string | undefined,
		nodeId: string,
		activeSignalsKey = "",
		stateFloatCount = 1,
	): CachedPipelineAndState | undefined {
		const cacheKey = `${renderId ?? "global"}_${nodeId}_${activeSignalsKey}_${stateFloatCount}`;
		const deviceCache = WebGPUAudioProcessor.devicePipelineCache.get(device);
		return deviceCache?.get(cacheKey);
	}

	public static clearCache(renderId: string, device?: GPUDevice): void {
		if (!device) return;
		const cache = WebGPUAudioProcessor.devicePipelineCache.get(device);
		if (!cache) return;
		const prefix = `${renderId}_`;
		for (const [key, cached] of cache.entries()) {
			if (key.startsWith(prefix)) {
				cached.stateBuffer.destroy();
				cached.inputBuffer?.destroy();
				cached.outputBuffer?.destroy();
				cached.uniformBuffer?.destroy();
				cache.delete(key);
			}
		}
	}

	public static async process(
		device: GPUDevice,
		nodeId: string,
		channels: Float32Array[],
		_sampleRate: number,
		virtualMedia: VirtualMediaData,
		frame: number,
		fps: number,
		shaderTemplate: (params: {
			customSignalWGSL: string;
			makeupGainModulation: string;
		}) => string,
		getUniforms: (t: number) => number[],
		uniformsFloatCount: number,
		stateFloatCount = 1,
		renderId?: string,
		isStatic = false,
		elapsedMs?: number,
		durationMs?: number,
		initialState?: Float32Array,
		stateUpdate?: Float32Array,
		paramOrder?: string[],
	): Promise<void> {
		const numChannels = channels.length;
		if (numChannels === 0) return;
		const numSamples = channels[0].length;
		if (numSamples === 0) return;

		const elapsedSeconds =
			elapsedMs !== undefined ? elapsedMs / 1000 : frame / fps;
		const durationSeconds = durationMs !== undefined ? durationMs / 1000 : 0;

		// 1. Resolve Active Signal Bindings
		const activeBindings: AudioSignalBinding[] = [];
		let makeupGainModulation = "";
		let customSignalWGSL = "";
		const signalBuffers: GPUBuffer[] = [];
		const signalBufferMap = new Map<string, GPUBuffer>();

		const op = virtualMedia.operation as AudioOperation | undefined;

		if (op?.inputs) {
			for (const inputEntry of Object.values(op.inputs)) {
				if (
					inputEntry?.connectionValid &&
					inputEntry.outputItem &&
					inputEntry.outputItem.type === "Signal"
				) {
					const sd = inputEntry.outputItem.data;
					if (sd) {
						await signalRegistry.ensureAudioSourcesExtracted(
							device,
							sd,
							fps,
							renderId,
						);
					}
				}
			}

			// Iterate over op flat entries since config parameters are flatly appended on the operation
			for (const [key, val] of Object.entries(op)) {
				if (key.endsWith("HandleId") && val) {
					const handleId = val as string;
					const inputEntry = op.inputs[handleId];
					if (
						inputEntry?.connectionValid &&
						inputEntry.outputItem &&
						inputEntry.outputItem.type === "Signal"
					) {
						const sd = inputEntry.outputItem.data;
						if (sd) {
							const paramName = key.replace("HandleId", "");

							if (isStatic) {
								activeBindings.push({
									parameterName: paramName,
									signalNodeId: sd.nodeId ?? "sig",
									signalFnName: sd.signalFnName ?? sd.name ?? "sig_fn",
								});

								// Query SignalRegistry to evaluate the 1D buffer on-demand
								const commandEncoder = device.createCommandEncoder();
								const buf = signalRegistry.getOrCreate1DBuffer(
									device,
									commandEncoder,
									sd.nodeId ?? "sig",
									elapsedSeconds,
									durationSeconds,
									sd,
									numSamples,
									_sampleRate,
									renderId,
									frame,
									fps,
								);
								device.queue.submit([commandEncoder.finish()]);
								signalBufferMap.set(paramName, buf);
								if (!paramOrder) {
									signalBuffers.push(buf);
								}
							} else {
								const signalNodeId = sd.nodeId;
								if (signalNodeId) {
									const registered = shaderStore.get(signalNodeId, renderId);
									if (registered) {
										activeBindings.push({
											parameterName: paramName,
											signalNodeId,
											signalFnName: registered.name,
										});

										customSignalWGSL += `\n${registered.wgsl}`;

										const paramVals: string[] = [];
										for (const p of registered.fnParams) {
											const v = p.defaultValue;
											paramVals.push(
												v % 1 === 0 ? `${v.toFixed(1)}f` : `${v}f`,
											);
										}

										const tElapsedExpr = `(${elapsedSeconds.toFixed(6)}f + f32(index) / u.sampleRate)`;
										const durationExpr = `${durationSeconds.toFixed(6)}f`;

										// Base args passed to dynamic signal (aligning with wgsl.ts signature)
										// index, numSamples, and frame refer to local u32 variables inside compute pass
										const args = [
											"t",
											"0.0",
											"0.0",
											"0.0",
											"index",
											"numSamples",
											"frame",
											"vec4<f32>(0.0)",
											tElapsedExpr,
											durationExpr,
											...paramVals,
										];

										if (paramName === "makeupGain") {
											makeupGainModulation += `
			let sigVal_${signalNodeId} = ${registered.name}(${args.join(", ")});
			dynamicMakeupGain = dynamicMakeupGain + sigVal_${signalNodeId};
											`;
										}
									}
								}
							}
						}
					}
				}
			}
		}

		const fullShaderCode = shaderTemplate(
			isStatic
				? { customSignalWGSL: "", makeupGainModulation: "" }
				: { customSignalWGSL, makeupGainModulation },
		);

		const hasBinding = (idx: number) =>
			new RegExp(`@binding\\s*\\(\\s*${idx}\\s*\\)`).test(fullShaderCode);

		const createdBuffers: GPUBuffer[] = [];

		if (isStatic && paramOrder && paramOrder.length > 0) {
			for (const p of paramOrder) {
				if (signalBufferMap.has(p)) continue;
				const directVal =
					op?.[p] ?? (op?.signals as Record<string, unknown> | undefined)?.[p];
				if (isSignal(directVal)) {
					const signalData = new Float32Array(numSamples);
					const durationSec =
						durationSeconds > 0 ? durationSeconds : numSamples / _sampleRate;
					for (let s = 0; s < numSamples; s++) {
						const t = elapsedSeconds + s / _sampleRate;
						const f = t * fps;
						const progress = durationSec > 0 ? t / durationSec : 0;
						signalData[s] =
							Number(
								directVal.get({
									frame: f,
									fps,
									time: t,
									duration: durationSec * fps,
									durationMs: durationSec * 1000,
									progress,
									deltaTime: 1 / _sampleRate,
								}),
							) || 0;
					}
					const buf = device.createBuffer({
						size: Math.max(16, Math.ceil(signalData.byteLength / 16) * 16),
						usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
						mappedAtCreation: true,
						label: `audio_direct_signal_${nodeId}_${p}`,
					});
					new Float32Array(buf.getMappedRange()).set(signalData);
					buf.unmap();
					signalBufferMap.set(p, buf);
					createdBuffers.push(buf);
					activeBindings.push({
						parameterName: p,
						signalNodeId: `direct_${p}`,
						signalFnName: "direct_sig",
					});
				}
			}
		}

		if (isStatic) {
			if (paramOrder && paramOrder.length > 0) {
				for (let i = 0; i < paramOrder.length; i++) {
					const p = paramOrder[i];
					const buf = signalBufferMap.get(p);
					if (buf) {
						signalBuffers.push(buf);
					} else if (hasBinding(4 + i)) {
						signalBuffers.push(signalRegistry.getDummyBuffer(device));
					}
				}
			} else if (signalBuffers.length === 0 && hasBinding(4)) {
				// If no signal buffers populated in static mode but the shader expects them, bind dummy
				signalBuffers.push(signalRegistry.getDummyBuffer(device));
			}
		}

		const activeSignalsKey = activeBindings
			.map((b) => `${b.parameterName}:${b.signalNodeId}`)
			.join(",");

		// 2. Fetch or Create Cached Stateless Pipeline and State Buffer
		const cacheKey = `${renderId ?? "global"}_${nodeId}_${activeSignalsKey}_${stateFloatCount}`;
		const deviceCache = WebGPUAudioProcessor.getDeviceCache(device);
		let cached = deviceCache.get(cacheKey);

		if (!cached) {
			const shaderModule = device.createShaderModule({
				label: `audio_shader_${nodeId}.wgsl`,
				code: fullShaderCode,
			});

			const pipeline = device.createComputePipeline({
				label: `AudioComputePipeline_${nodeId}`,
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});

			// Persistent state buffer across blocks
			const stateBuffer = device.createBuffer({
				size: stateFloatCount * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
				label: `audio_state_${nodeId}`,
			});

			const initialData = new Float32Array(stateFloatCount);
			if (initialState) {
				initialData.set(initialState, 0);
			}
			if (stateUpdate) {
				initialData.set(stateUpdate, 0);
			}

			device.queue.writeBuffer(
				stateBuffer,
				0,
				initialData as unknown as GPUAllowSharedBufferSource,
			);

			cached = {
				pipeline,
				stateBuffer,
				activeSignalsKey,
			};
			deviceCache.set(cacheKey, cached);
		} else {
			if (stateUpdate) {
				device.queue.writeBuffer(
					cached.stateBuffer,
					0,
					stateUpdate as unknown as GPUAllowSharedBufferSource,
				);
			}
		}

		// 3. Process in chunks to prevent GPU driver timeout (TDR) and browser freezing
		const CHUNK_SIZE = 65536;

		try {
			for (let offset = 0; offset < numSamples; offset += CHUNK_SIZE) {
				const chunkSamples = Math.min(CHUNK_SIZE, numSamples - offset);

				// Determine if we can reuse the cached storage and uniform buffers
				const canReuse =
					cached.inputBuffer &&
					cached.outputBuffer &&
					cached.uniformBuffer &&
					cached.allocatedSamples &&
					cached.allocatedSamples >= chunkSamples &&
					cached.allocatedChannels &&
					cached.allocatedChannels >= numChannels &&
					cached.allocatedUniformsFloatCount &&
					cached.allocatedUniformsFloatCount >= uniformsFloatCount;

				let inputBuffer: GPUBuffer;
				let outputBuffer: GPUBuffer;
				let uniformBuffer: GPUBuffer;

				if (canReuse) {
					inputBuffer = cached.inputBuffer!;
					outputBuffer = cached.outputBuffer!;
					uniformBuffer = cached.uniformBuffer!;
				} else {
					const allocSamples = Math.max(chunkSamples, CHUNK_SIZE);
					const allocChannels = numChannels;
					const allocUniforms = uniformsFloatCount;

					const freshInput = device.createBuffer({
						size: allocChannels * allocSamples * 4,
						usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
						label: `audio_input_temp_${nodeId}_chunk_${offset}`,
					});

					const freshOutput = device.createBuffer({
						size: allocChannels * allocSamples * 4,
						usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
						label: `audio_output_temp_${nodeId}_chunk_${offset}`,
					});

					const freshUniform = device.createBuffer({
						size: allocUniforms * 4,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
						label: `audio_uniforms_temp_${nodeId}_chunk_${offset}`,
					});

					inputBuffer = freshInput;
					outputBuffer = freshOutput;
					uniformBuffer = freshUniform;

					cached.inputBuffer?.destroy();
					cached.outputBuffer?.destroy();
					cached.uniformBuffer?.destroy();

					cached.inputBuffer = freshInput;
					cached.outputBuffer = freshOutput;
					cached.uniformBuffer = freshUniform;
					cached.allocatedSamples = allocSamples;
					cached.allocatedChannels = allocChannels;
					cached.allocatedUniformsFloatCount = allocUniforms;
				}

				// stagingBuffer is ALWAYS allocated fresh for this chunk to prevent reuse/mapping bugs
				const stagingBuffer = device.createBuffer({
					size: numChannels * chunkSamples * 4,
					usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
					label: `audio_staging_temp_${nodeId}_chunk_${offset}`,
				});

				const entries: GPUBindGroupEntry[] = [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: { buffer: inputBuffer } },
					{ binding: 2, resource: { buffer: outputBuffer } },
					{ binding: 3, resource: { buffer: cached.stateBuffer } },
				];

				if (isStatic) {
					for (let i = 0; i < signalBuffers.length; i++) {
						const bindingIndex = 4 + i;
						if (hasBinding(bindingIndex)) {
							const sigBuf = signalBuffers[i];
							if (sigBuf.size >= (offset + chunkSamples) * 4) {
								entries.push({
									binding: bindingIndex,
									resource: {
										buffer: sigBuf,
										offset: offset * 4,
										size: chunkSamples * 4,
									},
								});
							} else {
								entries.push({
									binding: bindingIndex,
									resource: {
										buffer: sigBuf,
										offset: 0,
										size: sigBuf.size,
									},
								});
							}
						}
					}
				}

				const bindGroup = device.createBindGroup({
					layout: cached.pipeline.getBindGroupLayout(0),
					entries,
				});

				// Upload Input Channels
				const flatInput = new Float32Array(numChannels * chunkSamples);
				for (let c = 0; c < numChannels; c++) {
					flatInput.set(
						channels[c].subarray(offset, offset + chunkSamples),
						c * chunkSamples,
					);
				}
				device.queue.writeBuffer(
					inputBuffer,
					0,
					flatInput as unknown as GPUAllowSharedBufferSource,
				);

				// Compute uniforms for this chunk
				const chunkBaseTime = frame / fps + offset / _sampleRate;
				const uniforms = getUniforms(chunkBaseTime);

				// Replace numSamples with chunkSamples inside the uniforms array
				let numSamplesIndex = -1;
				for (let i = uniforms.length - 2; i >= 0; i--) {
					if (uniforms[i] === numSamples && uniforms[i + 1] === numChannels) {
						numSamplesIndex = i;
						break;
					}
				}
				if (numSamplesIndex === -1) {
					numSamplesIndex = uniforms.indexOf(numSamples);
				}
				if (numSamplesIndex !== -1) {
					uniforms[numSamplesIndex] = chunkSamples;
				}

				device.queue.writeBuffer(
					uniformBuffer,
					0,
					new Float32Array(uniforms) as unknown as GPUAllowSharedBufferSource,
				);

				// Execute Compute Pass and Copy to Staging
				const commandEncoder = device.createCommandEncoder({
					label: `audio_encoder_${nodeId}_chunk_${offset}`,
				});
				const passEncoder = commandEncoder.beginComputePass({
					label: `audio_pass_${nodeId}_chunk_${offset}`,
				});
				passEncoder.setPipeline(cached.pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.dispatchWorkgroups(1);
				passEncoder.end();

				commandEncoder.copyBufferToBuffer(
					outputBuffer,
					0,
					stagingBuffer,
					0,
					numChannels * chunkSamples * 4,
				);

				device.queue.submit([commandEncoder.finish()]);

				// Map & Read back
				await stagingBuffer.mapAsync(GPUMapMode.READ);
				const mappedRange = new Float32Array(stagingBuffer.getMappedRange());

				for (let c = 0; c < numChannels; c++) {
					channels[c].set(
						mappedRange.subarray(c * chunkSamples, (c + 1) * chunkSamples),
						offset,
					);
				}

				stagingBuffer.unmap();

				await yieldToMain();
			}
		} finally {
			for (const b of createdBuffers) {
				b.destroy();
			}
		}
	}
}
