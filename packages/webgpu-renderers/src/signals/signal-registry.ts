/// <reference types="webgpu" />

import {
	type AudioSignalComputeConfig,
	AudioSignalComputePipeline,
} from "./audio-signal-compute.js";
import { encodeFloat32ToFloat16 } from "./float16.js";
import { buildWGSLSignalFn } from "./wgsl.js";

export interface SignalRegistryResource {
	type: "1d-buffer" | "2d-texture" | "combined";
	buffer?: GPUBuffer;
	texture?: GPUTexture;
	textureView?: GPUTextureView;
	lastProcessedFrame: number;
	lastFingerprint?: string;
	uniformBuffer?: GPUBuffer;
	bindGroup?: GPUBindGroup;
	isExternal?: boolean;
	duration?: number;
	stats?: { min: number; max: number };
}

export interface MasterAudioEntry {
	texture: GPUTexture;
	textureView: GPUTextureView;
	durationSec: number;
	stats: { min: number; max: number };
	lastFingerprint?: string;
}

interface DeviceSignalResources {
	resources: Map<string, SignalRegistryResource>;
	masterAudioTextures: Map<string, MasterAudioEntry>;
	dummy1x1TextureView: GPUTextureView | null;
	dummyBuffer: GPUBuffer | null;
	pipelineCache: Map<string, GPUComputePipeline | GPURenderPipeline>;
	defaultSampler: GPUSampler | null;
}

function isSamplesArray(val: unknown): val is ArrayLike<number> {
	return (
		Array.isArray(val) ||
		(ArrayBuffer.isView(val) && !(val instanceof DataView))
	);
}

export class SignalRegistry {
	private deviceCache = new WeakMap<GPUDevice, DeviceSignalResources>();
	private statsMap = new Map<string, { min: number; max: number }>();
	private statsListeners = new Map<
		string,
		Set<(stats: { min: number; max: number }) => void>
	>();

	public setStats(nodeId: string, stats: { min: number; max: number }): void {
		this.statsMap.set(nodeId, stats);
		const listeners = this.statsListeners.get(nodeId);
		if (listeners) {
			for (const listener of listeners) {
				listener(stats);
			}
		}
	}

	public getStats(nodeId: string): { min: number; max: number } | undefined {
		return this.statsMap.get(nodeId);
	}

	public onStats(
		nodeId: string,
		listener: (stats: { min: number; max: number }) => void,
	): () => void {
		let set = this.statsListeners.get(nodeId);
		if (!set) {
			set = new Set();
			this.statsListeners.set(nodeId, set);
		}
		set.add(listener);
		const current = this.statsMap.get(nodeId);
		if (current) {
			listener(current);
		}
		return () => {
			set?.delete(listener);
			if (set?.size === 0) {
				this.statsListeners.delete(nodeId);
			}
		};
	}

	/**
	 * Recursively computes a deterministic cache fingerprint for a signal descriptor
	 * and its upstream dependencies (signalA, signalB, and upstream calculated stats).
	 */
	public computeSignalFingerprint(
		sd: unknown,
		depth = 0,
		visited = new Set<unknown>(),
	): string {
		if (sd === null || sd === undefined) return "";
		if (typeof sd === "number") return `num:${sd}`;
		if (typeof sd === "string") return `str:${sd}`;
		if (typeof sd === "boolean") return `bool:${sd}`;
		if (typeof sd !== "object") return "";

		if (visited.has(sd) || depth > 8) {
			const sObj = sd as Record<string, unknown>;
			const refId =
				(sObj.nodeId as string) ||
				((sObj.virtualMedia as { operation?: { nodeId?: string } })?.operation
					?.nodeId as string) ||
				"seen";
			return `ref:${refId}`;
		}
		visited.add(sd);

		const s = sd as Record<string, unknown>;
		const rawSamples = (s.samples ??
			(s.data as Record<string, unknown>)?.samples) as
			| Array<number>
			| Float32Array
			| undefined;

		const nodeId =
			(typeof s.nodeId === "string" ? s.nodeId : undefined) ||
			(typeof (s.virtualMedia as { operation?: { nodeId?: string } })?.operation
				?.nodeId === "string"
				? (s.virtualMedia as { operation?: { nodeId?: string } }).operation
						?.nodeId
				: undefined);

		// Include upstream stats for dependencies so changes in upstream stats invalidate downstream nodes
		let upstreamStats: { min: number; max: number } | undefined;
		if (depth > 0 && nodeId) {
			upstreamStats = this.getStats(nodeId);
		}

		const cfg = s.signalConfig as Record<string, unknown> | undefined;

		const operation =
			s.operation ??
			cfg?.operation ??
			(s.config as Record<string, unknown> | undefined)?.operation ??
			(s.data as Record<string, unknown> | undefined)?.operation;

		const parts = {
			type: s.type,
			op: s.op,
			operation,
			bValue:
				s.bValue ??
				cfg?.bValue ??
				(s.config as Record<string, unknown> | undefined)?.bValue ??
				(s.data as Record<string, unknown> | undefined)?.bValue,
			value: s.value,
			inMin: s.inMin ?? cfg?.inMin,
			inMax: s.inMax ?? cfg?.inMax,
			outMin: s.outMin ?? cfg?.outMin,
			outMax: s.outMax ?? cfg?.outMax,
			clampMin: s.clampMin ?? cfg?.clampMin,
			clampMax: s.clampMax ?? cfg?.clampMax,
			exponent: s.exponent ?? cfg?.exponent,
			edge0: s.edge0 ?? cfg?.edge0,
			edge1: s.edge1 ?? cfg?.edge1,
			customWGSL:
				s.customWGSL || s.fnBody || s.wgsl || cfg?.customWGSL || cfg?.fnBody,
			amplitude: s.amplitude,
			frequency: s.frequency,
			phase: s.phase,
			offset: s.offset,
			fnParams: s.fnParams,
			sourceUrl: s.sourceUrl ?? s.url,
			extractionMode: s.extractionMode,
			channel: s.channel,
			nodeId,
			samplesLen: rawSamples?.length,
			sample0: rawSamples?.[0],
			sampleMid:
				rawSamples && rawSamples.length > 1
					? rawSamples[Math.floor(rawSamples.length / 2)]
					: undefined,
			sampleLast:
				rawSamples && rawSamples.length > 2
					? rawSamples[rawSamples.length - 1]
					: undefined,
			upstreamStats: upstreamStats
				? `${upstreamStats.min}:${upstreamStats.max}`
				: undefined,
			sigA: s.signalA
				? this.computeSignalFingerprint(s.signalA, depth + 1, visited)
				: undefined,
			sigB: s.signalB
				? this.computeSignalFingerprint(s.signalB, depth + 1, visited)
				: undefined,
		};

		return JSON.stringify(parts);
	}

	private getDeviceResources(device: GPUDevice): DeviceSignalResources {
		let res = this.deviceCache.get(device);
		if (!res) {
			res = {
				resources: new Map(),
				masterAudioTextures: new Map(),
				dummy1x1TextureView: null,
				dummyBuffer: null,
				pipelineCache: new Map(),
				defaultSampler: null,
			};
			this.deviceCache.set(device, res);
		}
		return res;
	}

	public getSampler(device: GPUDevice): GPUSampler {
		const dr = this.getDeviceResources(device);
		if (dr.defaultSampler) return dr.defaultSampler;
		dr.defaultSampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});
		return dr.defaultSampler;
	}

	/**
	 * Clears frame resources. Typically called on renderId reset or context destruction.
	 */
	public clear(renderId: string, device?: GPUDevice): void {
		if (!device) return;
		const dr = this.deviceCache.get(device);
		if (!dr) return;
		const prefix = `${renderId}:`;
		for (const [key, resource] of dr.resources.entries()) {
			if (key.startsWith(prefix)) {
				resource.buffer?.destroy();
				resource.texture?.destroy();
				resource.uniformBuffer?.destroy();
				dr.resources.delete(key);
			}
		}
		for (const [key, entry] of dr.masterAudioTextures.entries()) {
			if (key.startsWith(prefix)) {
				entry.texture.destroy();
				dr.masterAudioTextures.delete(key);
			}
		}
	}

	public getDummy1x1TextureView(device: GPUDevice): GPUTextureView {
		const dr = this.getDeviceResources(device);
		if (dr.dummy1x1TextureView) return dr.dummy1x1TextureView;

		const texture = device.createTexture({
			size: [1, 1, 1],
			format: "rgba16float",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			label: "dummy_1x1_signal_texture",
		});

		device.queue.writeTexture(
			{ texture },
			new Uint16Array([0x0000, 0x0000, 0x0000, 0x3c00]),
			{ bytesPerRow: 8, rowsPerImage: 1 },
			[1, 1, 1],
		);

		dr.dummy1x1TextureView = texture.createView();
		return dr.dummy1x1TextureView;
	}

	public getDummyBuffer(device: GPUDevice): GPUBuffer {
		const dr = this.getDeviceResources(device);
		if (dr.dummyBuffer) return dr.dummyBuffer;

		dr.dummyBuffer = device.createBuffer({
			size: 256,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			label: "dummy_signal_buffer",
		});
		return dr.dummyBuffer;
	}

	public registerBuffer(
		device: GPUDevice,
		nodeId: string,
		buffer: GPUBuffer,
		renderId?: string,
	): void {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const existing =
			dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);
		const entry: SignalRegistryResource = {
			...existing,
			type: existing?.texture ? "combined" : "1d-buffer",
			buffer,
			lastProcessedFrame: -1,
			isExternal: true,
		};
		dr.resources.set(key, entry);
		if (renderId) {
			dr.resources.set(`global:${nodeId}`, entry);
		}
	}

	public registerTexture(
		device: GPUDevice,
		nodeId: string,
		texture: GPUTexture,
		textureView: GPUTextureView,
		renderId?: string,
		duration?: number,
	): void {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const existing =
			dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);
		const entry: SignalRegistryResource = {
			...existing,
			type: existing?.buffer ? "combined" : "2d-texture",
			texture,
			textureView,
			lastProcessedFrame: -1,
			isExternal: true,
			duration: duration !== undefined ? duration : existing?.duration,
		};
		dr.resources.set(key, entry);
		if (renderId) {
			dr.resources.set(`global:${nodeId}`, entry);
		}
	}

	public getMasterTextureView(
		device: GPUDevice,
		nodeId: string,
		renderId?: string,
	): GPUTextureView | undefined {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		return (
			dr.masterAudioTextures.get(key)?.textureView ??
			dr.masterAudioTextures.get(`global:${nodeId}`)?.textureView ??
			dr.masterAudioTextures.get(`${renderId ?? "global"}:${baseId}`)
				?.textureView ??
			dr.masterAudioTextures.get(`global:${baseId}`)?.textureView ??
			dr.resources.get(key)?.textureView ??
			dr.resources.get(`global:${nodeId}`)?.textureView ??
			dr.resources.get(`${renderId ?? "global"}:${baseId}`)?.textureView ??
			dr.resources.get(`global:${baseId}`)?.textureView
		);
	}

	public getMasterTexture(
		device: GPUDevice,
		nodeId: string,
		renderId?: string,
	): GPUTexture | undefined {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		return (
			dr.masterAudioTextures.get(key)?.texture ??
			dr.masterAudioTextures.get(`global:${nodeId}`)?.texture ??
			dr.masterAudioTextures.get(`${renderId ?? "global"}:${baseId}`)
				?.texture ??
			dr.masterAudioTextures.get(`global:${baseId}`)?.texture ??
			dr.resources.get(key)?.texture ??
			dr.resources.get(`global:${nodeId}`)?.texture ??
			dr.resources.get(`${renderId ?? "global"}:${baseId}`)?.texture ??
			dr.resources.get(`global:${baseId}`)?.texture
		);
	}

	private channelSamplesMap = new Map<
		string,
		{
			primary?: Float32Array;
			beat?: Float32Array;
			bass?: Float32Array;
			energy?: Float32Array;
		}
	>();

	public setChannelSamples(
		nodeId: string,
		samples: {
			primary?: Float32Array;
			beat?: Float32Array;
			bass?: Float32Array;
			energy?: Float32Array;
		},
		renderId?: string,
	): void {
		const key = `${renderId ?? "global"}:${nodeId}`;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		this.channelSamplesMap.set(key, samples);
		this.channelSamplesMap.set(`global:${nodeId}`, samples);
		if (baseId !== nodeId) {
			this.channelSamplesMap.set(`${renderId ?? "global"}:${baseId}`, samples);
			this.channelSamplesMap.set(`global:${baseId}`, samples);
		}
	}

	public getChannelSamples(
		nodeId: string,
		channel = "primary",
		renderId?: string,
	): Float32Array | undefined {
		const key = `${renderId ?? "global"}:${nodeId}`;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		const entry =
			this.channelSamplesMap.get(key) ??
			this.channelSamplesMap.get(`global:${nodeId}`) ??
			this.channelSamplesMap.get(`${renderId ?? "global"}:${baseId}`) ??
			this.channelSamplesMap.get(`global:${baseId}`);
		if (!entry) return undefined;
		const ch = channel as "primary" | "beat" | "bass" | "energy";
		return entry[ch] ?? entry.primary;
	}

	public getDuration(
		device: GPUDevice,
		nodeId: string,
		renderId?: string,
	): number | undefined {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const res = dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);
		if (res?.duration !== undefined) return res.duration;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		const master =
			dr.masterAudioTextures.get(key) ??
			dr.masterAudioTextures.get(`global:${nodeId}`) ??
			dr.masterAudioTextures.get(`${renderId ?? "global"}:${baseId}`) ??
			dr.masterAudioTextures.get(`global:${baseId}`);
		return master?.durationSec;
	}

	private extractionPromises = new Map<string, Promise<void>>();

	public has(device: GPUDevice, nodeId: string, renderId?: string): boolean {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const baseId = nodeId.replace(/_(beat|bass|energy)$/, "");
		return (
			dr.resources.has(key) ||
			dr.resources.has(`global:${nodeId}`) ||
			dr.masterAudioTextures.has(key) ||
			dr.masterAudioTextures.has(`global:${nodeId}`) ||
			dr.masterAudioTextures.has(`${renderId ?? "global"}:${baseId}`) ||
			dr.masterAudioTextures.has(`global:${baseId}`)
		);
	}

	/**
	 * Recursively scans a signal descriptor (and upstream signalA/signalB trees)
	 * for any audio sources and ensures they have been decoded and extracted.
	 */
	public async ensureAudioSourcesExtracted(
		device: GPUDevice,
		sd: unknown,
		fps = 24,
		renderId?: string,
		visited = new Set<unknown>(),
	): Promise<void> {
		if (!sd || typeof sd !== "object" || visited.has(sd)) return;
		visited.add(sd);

		const s = sd as Record<string, unknown>;

		if (s.signalA) {
			await this.ensureAudioSourcesExtracted(
				device,
				s.signalA,
				fps,
				renderId,
				visited,
			);
		}
		if (s.signalB && typeof s.signalB === "object") {
			await this.ensureAudioSourcesExtracted(
				device,
				s.signalB,
				fps,
				renderId,
				visited,
			);
		}

		const isAudioExtractor = Boolean(
			s.extractionMode ||
				s.op === "AudioSignalExtractor" ||
				(s.virtualMedia as { operation?: { op?: string } })?.operation?.op ===
					"AudioSignalExtractor",
		);

		if (isAudioExtractor) {
			let sourceUrl: string | undefined =
				(s.sourceUrl as string) ||
				((s.virtualMedia as { operation?: { sourceUrl?: string } })?.operation
					?.sourceUrl as string);

			if (!sourceUrl && s.virtualMedia) {
				const vm = s.virtualMedia as {
					operation?: { sourceUrl?: string; url?: string };
					children?: Array<{
						operation?: { sourceUrl?: string; url?: string };
					}>;
				};
				sourceUrl =
					vm.operation?.sourceUrl ||
					vm.operation?.url ||
					vm.children?.[0]?.operation?.sourceUrl ||
					vm.children?.[0]?.operation?.url;
			}

			const targetId =
				(s.nodeId as string) ||
				((s.virtualMedia as { operation?: { nodeId?: string } })?.operation
					?.nodeId as string);

			if (sourceUrl && targetId) {
				await this.extractFromAudioSource(
					device,
					sourceUrl,
					s as AudioSignalComputeConfig,
					targetId,
					fps,
					renderId,
				);
			}
		}
	}

	public async extractFromAudioSource(
		device: GPUDevice,
		sourceUrl: string,
		config: AudioSignalComputeConfig = {},
		nodeId: string,
		fps = 24,
		renderId?: string,
	): Promise<void> {
		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		const configFingerprint = JSON.stringify({
			sourceUrl,
			mode: config.extractionMode,
			sens: config.sensitivity,
			att: config.attackMs,
			rel: config.releaseMs,
			smooth: config.smoothing,
			curve: config.curve,
			beatThresh: config.beatThreshold,
			noiseFloor: config.noiseFloorDb,
			dynRange: config.dynamicRangeDb,
			beatDecay: config.beatDecayMs,
			fps,
		});

		const existing =
			dr.masterAudioTextures.get(key) ??
			dr.masterAudioTextures.get(`global:${nodeId}`);
		if (existing?.lastFingerprint === configFingerprint) {
			return;
		}

		if (this.extractionPromises.has(key)) {
			await this.extractionPromises.get(key);
			return;
		}

		const promise = (async () => {
			try {
				let channels: Float32Array[] = [];
				let sampleRate = 44100;

				if (typeof window !== "undefined") {
					const AudioCtx =
						window.AudioContext ||
						(window as unknown as { webkitAudioContext?: typeof AudioContext })
							.webkitAudioContext;
					if (AudioCtx) {
						let fetchUrl = sourceUrl;
						if (fetchUrl.startsWith("file://")) {
							fetchUrl = fetchUrl.replace(/^file:\/\//, "");
						}
						if (
							fetchUrl.startsWith("/") &&
							!fetchUrl.startsWith("/@fs/") &&
							!fetchUrl.startsWith("/api/")
						) {
							fetchUrl = `/@fs${fetchUrl}`;
						}

						const ctx = new AudioCtx();
						try {
							const res = await fetch(fetchUrl);
							if (!res.ok) throw new Error(`HTTP ${res.status}`);
							const ab = await res.arrayBuffer();
							const decoded = await ctx.decodeAudioData(ab);
							sampleRate = decoded.sampleRate;
							for (let c = 0; c < decoded.numberOfChannels; c++) {
								channels.push(new Float32Array(decoded.getChannelData(c)));
							}
						} finally {
							void ctx.close();
						}
					}
				} else {
					try {
						const fs = await import("node:fs");
						const cleanPath = sourceUrl.replace(/^file:\/\//, "");
						if (fs.existsSync(cleanPath)) {
							const buf = fs.readFileSync(cleanPath);
							const numChannels = buf.readUInt16LE(22);
							sampleRate = buf.readUInt32LE(24);
							const bitsPerSample = buf.readUInt16LE(34);
							let offset = 12;
							while (offset < buf.length - 8) {
								const id = buf.toString("ascii", offset, offset + 4);
								const size = buf.readUInt32LE(offset + 4);
								if (id === "data") {
									offset += 8;
									break;
								}
								offset += 8 + size;
							}
							const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
							const totalFrames = Math.floor(
								(buf.length - offset) / (numChannels * bytesPerSample),
							);
							channels = [];
							for (let c = 0; c < numChannels; c++) {
								channels.push(new Float32Array(totalFrames));
							}
							if (bitsPerSample === 16) {
								for (let i = 0; i < totalFrames; i++) {
									for (let c = 0; c < numChannels; c++) {
										const sampleOffset = offset + (i * numChannels + c) * 2;
										if (sampleOffset + 2 <= buf.length) {
											channels[c][i] = buf.readInt16LE(sampleOffset) / 32768.0;
										}
									}
								}
							} else if (bitsPerSample === 32) {
								for (let i = 0; i < totalFrames; i++) {
									for (let c = 0; c < numChannels; c++) {
										const sampleOffset = offset + (i * numChannels + c) * 4;
										if (sampleOffset + 4 <= buf.length) {
											channels[c][i] = buf.readFloatLE(sampleOffset);
										}
									}
								}
							}
						}
					} catch (_) {}
				}

				if (channels.length === 0 || channels[0].length === 0) {
					return;
				}

				const numAudioSamples = channels[0].length;
				const durationSec = numAudioSamples / sampleRate;

				const signals = await AudioSignalComputePipeline.extractFeatures(
					device,
					channels,
					sampleRate,
					fps,
					config,
					512,
				);

				const targetNodeIds = new Set<string>();
				if (nodeId) targetNodeIds.add(nodeId);
				const cfgNodeId = (config as { nodeId?: string })?.nodeId;
				if (cfgNodeId) targetNodeIds.add(cfgNodeId);

				for (const id of targetNodeIds) {
					const baseId = id.replace(/_(beat|bass|energy)$/, "");
					const entry: MasterAudioEntry = {
						texture: signals.texture,
						textureView: signals.textureView,
						durationSec,
						stats: signals.stats.primary,
						lastFingerprint: configFingerprint,
					};
					dr.masterAudioTextures.set(
						`${renderId ?? "global"}:${baseId}`,
						entry,
					);
					dr.masterAudioTextures.set(`global:${baseId}`, entry);
					dr.masterAudioTextures.set(`${renderId ?? "global"}:${baseId}_beat`, {
						...entry,
						stats: signals.stats.beat,
					});
					dr.masterAudioTextures.set(`global:${baseId}_beat`, {
						...entry,
						stats: signals.stats.beat,
					});
					dr.masterAudioTextures.set(`${renderId ?? "global"}:${baseId}_bass`, {
						...entry,
						stats: signals.stats.bass,
					});
					dr.masterAudioTextures.set(`global:${baseId}_bass`, {
						...entry,
						stats: signals.stats.bass,
					});
					dr.masterAudioTextures.set(
						`${renderId ?? "global"}:${baseId}_energy`,
						{
							...entry,
							stats: signals.stats.energy,
						},
					);
					dr.masterAudioTextures.set(`global:${baseId}_energy`, {
						...entry,
						stats: signals.stats.energy,
					});
					if (id !== baseId) {
						dr.masterAudioTextures.set(`${renderId ?? "global"}:${id}`, entry);
						dr.masterAudioTextures.set(`global:${id}`, entry);
					}

					this.registerBuffer(device, baseId, signals.primaryBuffer, renderId);
					this.setStats(baseId, signals.stats.primary);

					this.registerBuffer(
						device,
						`${baseId}_beat`,
						signals.beatBuffer,
						renderId,
					);
					this.setStats(`${baseId}_beat`, signals.stats.beat);

					this.registerBuffer(
						device,
						`${baseId}_bass`,
						signals.bassBuffer,
						renderId,
					);
					this.setStats(`${baseId}_bass`, signals.stats.bass);

					this.registerBuffer(
						device,
						`${baseId}_energy`,
						signals.energyBuffer,
						renderId,
					);
					this.setStats(`${baseId}_energy`, signals.stats.energy);
					if (signals.channelSamples) {
						this.setChannelSamples(baseId, signals.channelSamples, renderId);
					}
				}

				const updatedRes =
					dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);
				if (updatedRes) {
					updatedRes.lastFingerprint = configFingerprint;
				}
			} catch (err) {
				console.warn(
					`[SignalRegistry] Failed to extract audio signal from ${sourceUrl}:`,
					err,
				);
			} finally {
				this.extractionPromises.delete(key);
			}
		})();

		this.extractionPromises.set(key, promise);
		await promise;
	}

	/**
	 * Resolves or creates a 1D GPUBuffer for a time-varying signal.
	 * If not evaluated yet for the current frame, it dispatches the generator compute pass.
	 */
	public getOrCreate1DBuffer(
		device: GPUDevice,
		_encoder: GPUCommandEncoder | null,
		nodeId: string,
		elapsedTime: number,
		duration: number,
		sd: any,
		numSamples: number,
		sampleRate: number,
		renderId?: string,
		frame?: number,
		fps?: number,
	): GPUBuffer {
		let normalizedSd = sd;
		if (sd && !sd.customWGSL && !sd.wgsl && sd.fnBody) {
			const fnRes = buildWGSLSignalFn(sd, nodeId);
			normalizedSd = {
				...sd,
				customWGSL: fnRes.wgsl,
				signalFnName: fnRes.name,
				fnOutputType: fnRes.outputType,
				outputType: fnRes.outputType,
			};
		}

		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		let res = dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);

		const bufferSize = numSamples * 4;

		if (res?.isExternal && res.buffer && res.buffer.size === bufferSize) {
			return res.buffer;
		}

		if (!res || !res.buffer || res.buffer.size < bufferSize) {
			if (res?.buffer && !res.isExternal) {
				res.buffer.destroy();
			}
			const buffer = device.createBuffer({
				size: bufferSize,
				usage:
					GPUBufferUsage.STORAGE |
					GPUBufferUsage.COPY_DST |
					GPUBufferUsage.COPY_SRC,
				label: `signal_1d_buffer_${nodeId}`,
			});
			res = {
				...res,
				type: res?.texture ? "combined" : "1d-buffer",
				buffer,
				lastProcessedFrame: -1,
			};
			dr.resources.set(key, res);
		}

		const rawSamples = normalizedSd?.samples ?? normalizedSd?.data?.samples;
		const fingerprint = normalizedSd
			? this.computeSignalFingerprint(normalizedSd)
			: "";

		const cacheFrame = frame !== undefined ? frame : elapsedTime;

		if (
			res.lastProcessedFrame === cacheFrame &&
			res.lastFingerprint === fingerprint
		) {
			return res.buffer!;
		}

		if (res.lastFingerprint !== fingerprint) {
			res.bindGroup = undefined;
		}

		// Update last processed frame and fingerprint
		res.lastProcessedFrame = cacheFrame;
		res.lastFingerprint = fingerprint;

		// 1. Populate buffer from samples array with timebase
		if (isSamplesArray(rawSamples) && rawSamples.length > 0) {
			const flat = new Float32Array(numSamples);
			const total = rawSamples.length;
			const srcFps = Number(normalizedSd?.fps) || 24;
			for (let i = 0; i < numSamples; i++) {
				const t = elapsedTime + i / sampleRate;
				const sIdx = Math.min(total - 1, Math.max(0, Math.round(t * srcFps)));
				flat[i] = Number(rawSamples[sIdx]) || 0;
			}
			device.queue.writeBuffer(res.buffer!, 0, flat);
		}
		// 2. Generator compute path
		else if (
			normalizedSd?.type === "generator" &&
			(normalizedSd.customWGSL || normalizedSd.fnBody)
		) {
			const signalEncoder = device.createCommandEncoder({
				label: `signal_1d_encoder_${nodeId}`,
			});
			this.dispatch1DGenerator(
				device,
				signalEncoder,
				res,
				elapsedTime,
				duration,
				normalizedSd,
				numSamples,
				sampleRate,
				frame,
				fps,
			);
			device.queue.submit([signalEncoder.finish()]);
		}
		// 3. Audio Extractor path via WebGPU compute
		else if (
			normalizedSd?.type === "audio_extractor" ||
			normalizedSd?.extractionMode !== undefined
		) {
			const masterTex = this.getMasterTexture(device, nodeId, renderId);
			if (masterTex) {
				const channel =
					normalizedSd.channel === "beat" || nodeId.endsWith("_beat")
						? 1
						: normalizedSd.channel === "bass" || nodeId.endsWith("_bass")
							? 2
							: normalizedSd.channel === "energy" || nodeId.endsWith("_energy")
								? 3
								: 0;
				const effectiveDuration =
					this.getDuration(device, nodeId, renderId) ??
					(typeof normalizedSd.durationMs === "number"
						? normalizedSd.durationMs / 1000
						: duration);
				const signalEncoder = device.createCommandEncoder({
					label: `signal_1d_audio_encoder_${nodeId}`,
				});
				this.dispatch1DAudioSignal(
					device,
					signalEncoder,
					res,
					masterTex,
					channel,
					elapsedTime,
					effectiveDuration,
					numSamples,
					sampleRate,
				);
				device.queue.submit([signalEncoder.finish()]);
			} else {
				const val = Number(normalizedSd?.offset ?? 0.0);
				const flat = new Float32Array(numSamples).fill(val);
				device.queue.writeBuffer(res.buffer!, 0, flat);
			}
		}
		// 4. Signal Math compute path
		else if (normalizedSd?.type === "signal_math") {
			const sigAId = normalizedSd.signalA?.nodeId ?? `${nodeId}_a`;
			const bufA = this.getOrCreate1DBuffer(
				device,
				_encoder,
				sigAId,
				elapsedTime,
				duration,
				normalizedSd.signalA,
				numSamples,
				sampleRate,
				renderId,
				frame,
				fps,
			);

			const hasB =
				normalizedSd.signalB &&
				typeof normalizedSd.signalB === "object" &&
				(normalizedSd.signalB as Record<string, unknown>).type !== undefined;
			const sigBId = hasB
				? ((normalizedSd.signalB as Record<string, unknown>).nodeId ??
					`${nodeId}_b`)
				: `${nodeId}_b_dummy`;
			const bufB = hasB
				? this.getOrCreate1DBuffer(
						device,
						_encoder,
						sigBId as string,
						elapsedTime,
						duration,
						normalizedSd.signalB,
						numSamples,
						sampleRate,
						renderId,
						frame,
						fps,
					)
				: this.getDummyBuffer(device);

			const bVal = resolveSignalBValue(normalizedSd as Record<string, unknown>);
			const signalEncoder = device.createCommandEncoder({
				label: `signal_1d_math_encoder_${nodeId}`,
			});
			this.dispatch1DMathSignal(
				device,
				signalEncoder,
				res,
				bufA,
				bufB,
				Boolean(hasB),
				bVal,
				normalizedSd as Record<string, unknown>,
				elapsedTime,
				duration,
				numSamples,
				sampleRate,
				frame,
				fps,
			);
			device.queue.submit([signalEncoder.finish()]);
		}
		// 5. Signal Gate compute path
		else if (
			normalizedSd?.type === "gate" ||
			normalizedSd?.op === "SignalGate" ||
			(normalizedSd?.signalConfig as Record<string, unknown> | undefined)
				?.type === "gate" ||
			(normalizedSd?.signalConfig as Record<string, unknown> | undefined)
				?.op === "SignalGate"
		) {
			const source =
				normalizedSd.sourceSignal ??
				(normalizedSd.signalConfig as Record<string, unknown> | undefined)
					?.sourceSignal ??
				normalizedSd.signal;
			const sigInId =
				(source as Record<string, unknown> | undefined)?.nodeId ??
				`${nodeId}_in`;
			const bufIn = this.getOrCreate1DBuffer(
				device,
				_encoder,
				sigInId as string,
				elapsedTime,
				duration,
				source,
				numSamples,
				sampleRate,
				renderId,
				frame,
				fps,
			);

			const signalEncoder = device.createCommandEncoder({
				label: `signal_1d_gate_encoder_${nodeId}`,
			});
			this.dispatch1DGateSignal(
				device,
				signalEncoder,
				res,
				bufIn,
				normalizedSd as Record<string, unknown>,
				elapsedTime,
				duration,
				numSamples,
				sampleRate,
				frame,
				fps,
			);
			device.queue.submit([signalEncoder.finish()]);
		}
		// 6. Fallback
		else {
			const val = Number(normalizedSd?.offset ?? 0.0);
			const flat = new Float32Array(numSamples).fill(val);
			device.queue.writeBuffer(res.buffer!, 0, flat);
		}

		return res.buffer!;
	}

	/**
	 * Resolves or creates a 2D GPUTextureView for spatial modulation.
	 * If not evaluated yet for the current frame, it dispatches the generator render pass.
	 */
	public getOrCreate2DTextureView(
		device: GPUDevice,
		_encoder: GPUCommandEncoder | null,
		nodeId: string,
		elapsedTime: number,
		duration: number,
		sd: any,
		width: number,
		_height: number,
		renderId?: string,
		frame?: number,
		fps?: number,
	): GPUTextureView {
		let normalizedSd = sd;
		if (sd && !sd.customWGSL && !sd.wgsl && sd.fnBody) {
			const fnRes = buildWGSLSignalFn(sd, nodeId);
			normalizedSd = {
				...sd,
				customWGSL: fnRes.wgsl,
				signalFnName: fnRes.name,
				fnOutputType: fnRes.outputType,
				outputType: fnRes.outputType,
			};
		}

		const dr = this.getDeviceResources(device);
		const key = `${renderId ?? "global"}:${nodeId}`;
		let res = dr.resources.get(key) ?? dr.resources.get(`global:${nodeId}`);

		const masterAudio =
			dr.masterAudioTextures.get(key) ??
			dr.masterAudioTextures.get(`global:${nodeId}`) ??
			dr.masterAudioTextures.get(
				`${renderId ?? "global"}:${nodeId.replace(/_(beat|bass|energy)$/, "")}`,
			) ??
			dr.masterAudioTextures.get(
				`global:${nodeId.replace(/_(beat|bass|energy)$/, "")}`,
			);

		if (res?.isExternal && res.textureView && !masterAudio) {
			return res.textureView;
		}

		const targetWidth = res?.texture
			? res.texture.width
			: Math.max(16, width > 0 ? width : 256);
		const targetHeight = 1;

		if (!res || !res.texture) {
			const texture = device.createTexture({
				size: [targetWidth, targetHeight, 1],
				format: "rgba16float",
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.RENDER_ATTACHMENT |
					GPUTextureUsage.COPY_DST,
				label: `signal_2d_texture_${nodeId}`,
			});
			res = {
				...res,
				type: res?.buffer ? "combined" : "2d-texture",
				texture,
				textureView: texture.createView(),
				lastProcessedFrame: -1,
			};
			dr.resources.set(key, res);
			if (renderId) {
				dr.resources.set(`global:${nodeId}`, res);
			}
		}

		const rawSamples = normalizedSd?.samples ?? normalizedSd?.data?.samples;
		const fingerprint = normalizedSd
			? this.computeSignalFingerprint(normalizedSd)
			: "";

		const cacheFrame = frame !== undefined ? frame : elapsedTime;

		if (
			res.lastProcessedFrame === cacheFrame &&
			res.lastFingerprint === fingerprint
		) {
			return res.textureView!;
		}

		if (res.lastFingerprint !== fingerprint) {
			res.bindGroup = undefined;
		}

		// Update last processed frame and fingerprint
		res.lastProcessedFrame = cacheFrame;
		res.lastFingerprint = fingerprint;

		// Populate texture
		if (masterAudio) {
			let channel = 0;
			if (typeof normalizedSd?.channel === "number") {
				channel = normalizedSd.channel;
			} else if (nodeId.endsWith("_beat")) {
				channel = 1;
			} else if (nodeId.endsWith("_bass")) {
				channel = 2;
			} else if (nodeId.endsWith("_energy")) {
				channel = 3;
			}
			const signalEncoder = device.createCommandEncoder({
				label: `audio_signal_2d_encoder_${nodeId}`,
			});
			this.dispatch2DAudioSignal(
				device,
				signalEncoder,
				res,
				masterAudio,
				channel,
				elapsedTime,
				duration > 0 ? duration : masterAudio.durationSec,
				frame,
				fps,
			);
			device.queue.submit([signalEncoder.finish()]);
			return res.textureView!;
		} else if (isSamplesArray(rawSamples) && rawSamples.length > 0) {
			const flat = new Float32Array(targetWidth * targetHeight * 4);
			const total = rawSamples.length;
			const baseTime =
				frame !== undefined && fps !== undefined && fps > 0
					? frame / fps
					: elapsedTime;
			for (let i = 0; i < targetWidth; i++) {
				const u = targetWidth > 1 ? i / (targetWidth - 1) : 0.5;
				const t = baseTime + (u - 0.5) * 2.0;
				const tNorm =
					duration > 0 ? Math.min(1.0, Math.max(0.0, t / duration)) : 0.5;
				const sIdx = Math.min(
					total - 1,
					Math.max(0, Math.round(tNorm * (total - 1))),
				);
				const val = Number(rawSamples[sIdx]) || 0;
				for (let row = 0; row < targetHeight; row++) {
					const idx = (row * targetWidth + i) * 4;
					flat[idx] = val;
					flat[idx + 1] = val;
					flat[idx + 2] = val;
					flat[idx + 3] = val;
				}
			}
			const halfFlat = encodeFloat32ToFloat16(flat);
			device.queue.writeTexture(
				{ texture: res.texture! },
				halfFlat,
				{
					bytesPerRow: targetWidth * 8,
					rowsPerImage: targetHeight,
				},
				[targetWidth, targetHeight, 1],
			);
			return res.textureView!;
		} else if (
			normalizedSd &&
			(normalizedSd.type === "signal_math" ||
				normalizedSd.op === "SignalMath" ||
				Boolean(normalizedSd.operation) ||
				Boolean(
					(normalizedSd.signalConfig as Record<string, unknown> | undefined)
						?.operation,
				))
		) {
			const signalEncoder = device.createCommandEncoder({
				label: `signal_math_2d_encoder_${nodeId}`,
			});
			this.dispatch2DSignalMath(
				device,
				signalEncoder,
				res,
				nodeId,
				normalizedSd,
				elapsedTime,
				duration,
				targetWidth,
				frame,
				fps,
				renderId,
			);
			device.queue.submit([signalEncoder.finish()]);
			return res.textureView!;
		} else if (
			normalizedSd &&
			(normalizedSd.type === "gate" ||
				normalizedSd.op === "SignalGate" ||
				(normalizedSd.signalConfig as Record<string, unknown> | undefined)
					?.type === "gate" ||
				(normalizedSd.signalConfig as Record<string, unknown> | undefined)
					?.op === "SignalGate")
		) {
			const signalEncoder = device.createCommandEncoder({
				label: `signal_gate_2d_encoder_${nodeId}`,
			});
			this.dispatch2DSignalGate(
				device,
				signalEncoder,
				res,
				nodeId,
				normalizedSd,
				elapsedTime,
				duration,
				targetWidth,
				frame,
				fps,
				renderId,
			);
			device.queue.submit([signalEncoder.finish()]);
			return res.textureView!;
		} else if (
			normalizedSd &&
			normalizedSd.type === "generator" &&
			(normalizedSd.customWGSL || normalizedSd.fnBody)
		) {
			const signalEncoder = device.createCommandEncoder({
				label: `signal_2d_encoder_${nodeId}`,
			});
			this.dispatch2DGenerator(
				device,
				signalEncoder,
				res,
				elapsedTime,
				duration,
				normalizedSd,
				targetWidth,
				targetHeight,
				frame,
				fps,
			);
			device.queue.submit([signalEncoder.finish()]);
		} else {
			// fallback
			const val = Number(normalizedSd?.offset ?? 0.0);
			const flat = new Float32Array(targetWidth * targetHeight * 4);
			for (let i = 0; i < targetWidth * targetHeight; i++) {
				flat[i * 4] = val;
				flat[i * 4 + 1] = val;
				flat[i * 4 + 2] = val;
				flat[i * 4 + 3] = 1.0;
			}
			const halfFlat = encodeFloat32ToFloat16(flat);
			device.queue.writeTexture(
				{ texture: res.texture! },
				halfFlat,
				{
					bytesPerRow: targetWidth * 8,
					rowsPerImage: targetHeight,
				},
				[targetWidth, targetHeight, 1],
			);
		}

		return res.textureView!;
	}

	private dispatch1DGenerator(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		elapsedTime: number,
		duration: number,
		sd: any,
		numSamples: number,
		sampleRate: number,
		frame?: number,
		fps?: number,
	): void {
		const customWGSL = sd.customWGSL ?? sd.wgsl ?? "";
		const signalFnName = sd.signalFnName ?? sd.name ?? "signal_fn";
		const outputType = sd.fnOutputType ?? sd.outputType ?? "f32";

		const dr = this.getDeviceResources(device);
		const shaderKey = `1d_${sd.nodeId}_${customWGSL}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPUComputePipeline
			| undefined;

		if (!pipeline) {
			const fnParams = sd.fnParams ?? [];
			const paramVals: string[] = [];
			for (const p of fnParams) {
				const val = p.defaultValue;
				paramVals.push(val % 1 === 0 ? `${val.toFixed(1)}f` : `${val}f`);
			}

			const args = [
				"t",
				"progress",
				"0.0",
				"0.0",
				"idx",
				"u.numSamples",
				"u.frame",
				"vec4<f32>(progress, 0.5, 0.5, 1.0)",
				"u.t_elapsed",
				"u.duration",
				...paramVals,
			];
			let callExpr = `${signalFnName}(${args.join(", ")})`;
			if (
				outputType === "vec2f" ||
				outputType === "vec3f" ||
				outputType === "vec4f"
			) {
				callExpr = `${callExpr}.x`;
			}

			const shaderCode = `
struct GeneratorUniforms {
    sampleRate : f32,
    baseTime   : f32,
    frame      : u32,
    numSamples : u32,
    amplitude  : f32,
    frequency  : f32,
    phase      : f32,
    offset     : f32,
    t_elapsed  : f32,
    duration   : f32,
    pad1       : f32,
    pad2       : f32,
};

@group(0) @binding(0) var<uniform> u : GeneratorUniforms;
@group(0) @binding(1) var<storage, read_write> outSignal : array<f32>;

${customWGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.numSamples) { return; }

    let progress = f32(idx) / f32(u.numSamples - 1u);
    let t = u.baseTime + f32(idx) / u.sampleRate;
    
    // Evaluate custom signal
    let val = ${callExpr};
    outSignal[idx] = val;
}
			`;

			const shaderModule = device.createShaderModule({
				label: `signal_1d_generator_${sd.nodeId}.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createComputePipeline({
				label: `Signal1DComputePipeline_${sd.nodeId}`,
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		// Update Uniforms
		const baseTime =
			frame !== undefined && fps !== undefined && fps > 0
				? frame / fps
				: elapsedTime;
		const uFrame = frame !== undefined ? frame : 0;
		const uniformBufferData = new ArrayBuffer(12 * 4);
		const f32View = new Float32Array(uniformBufferData);
		const u32View = new Uint32Array(uniformBufferData);

		f32View[0] = sampleRate;
		f32View[1] = baseTime;
		u32View[2] = uFrame;
		u32View[3] = numSamples;
		f32View[4] = sd.amplitude ?? 1.0;
		f32View[5] = sd.frequency ?? 1.0;
		f32View[6] = sd.phase ?? 0.0;
		f32View[7] = sd.offset ?? 0.0;
		f32View[8] = elapsedTime;
		f32View[9] = duration;
		f32View[10] = 0.0; // pad1
		f32View[11] = 0.0; // pad2

		if (!res.uniformBuffer) {
			res.uniformBuffer = device.createBuffer({
				size: uniformBufferData.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				label: `signal_1d_uniform_buffer_${sd.nodeId}`,
			});
		}
		device.queue.writeBuffer(res.uniformBuffer, 0, uniformBufferData);

		if (!res.bindGroup) {
			res.bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: res.uniformBuffer } },
					{ binding: 1, resource: { buffer: res.buffer! } },
				],
			});
		}

		const pass = encoder.beginComputePass({
			label: `signal_1d_compute_pass_${sd.nodeId}`,
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, res.bindGroup);
		const workgroups = Math.ceil(numSamples / 64);
		pass.dispatchWorkgroups(workgroups);
		pass.end();
	}

	private dispatch1DAudioSignal(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		masterTex: GPUTexture,
		channel: number,
		elapsedTime: number,
		duration: number,
		numSamples: number,
		sampleRate: number,
	): void {
		const dr = this.getDeviceResources(device);
		const shaderKey = "audio_signal_1d";
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPUComputePipeline
			| undefined;

		const sampler = this.getSampler(device);

		if (!pipeline) {
			const shaderCode = `
struct Audio1DUniforms {
    sampleRate : f32,
    baseTime   : f32,
    duration   : f32,
    numSamples : u32,
    channel    : u32,
    pad1       : f32,
    pad2       : f32,
    pad3       : f32,
};

@group(0) @binding(0) var<uniform> u : Audio1DUniforms;
@group(0) @binding(1) var masterTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var<storage, read_write> outSignal : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.numSamples) { return; }

    let t = u.baseTime + f32(idx) / u.sampleRate;
    var t_norm = 0.5f;
    if (u.duration > 0.0f) {
        t_norm = clamp(t / u.duration, 0.0f, 1.0f);
    }

    let s = textureSampleLevel(masterTex, samp, vec2<f32>(t_norm, 0.5f), 0.0f);
    var val = s.r;
    if (u.channel == 1u) {
        val = s.g;
    } else if (u.channel == 2u) {
        val = s.b;
    } else if (u.channel == 3u) {
        val = s.a;
    }

    outSignal[idx] = val;
}
`;
			const shaderModule = device.createShaderModule({
				code: shaderCode,
				label: "dispatch1DAudioSignal_module",
			});

			pipeline = device.createComputePipeline({
				label: "dispatch1DAudioSignal_pipeline",
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		// Uniform buffer (8 floats = 32 bytes)
		const uData = new ArrayBuffer(8 * 4);
		const fView = new Float32Array(uData);
		const uView = new Uint32Array(uData);
		fView[0] = sampleRate;
		fView[1] = elapsedTime;
		fView[2] = duration > 0 ? duration : 1.0;
		uView[3] = numSamples;
		uView[4] = channel;

		const uBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "audio_1d_uniform_buffer",
		});
		device.queue.writeBuffer(uBuffer, 0, uData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uBuffer } },
				{ binding: 1, resource: masterTex.createView() },
				{ binding: 2, resource: sampler },
				{ binding: 3, resource: { buffer: res.buffer! } },
			],
		});

		const pass = encoder.beginComputePass({
			label: "audio_1d_compute_pass",
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(numSamples / 64));
		pass.end();
	}

	private dispatch1DMathSignal(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		bufA: GPUBuffer,
		bufB: GPUBuffer,
		hasSignalB: boolean,
		bValue: number,
		sd: Record<string, unknown>,
		elapsedTime: number,
		duration: number,
		numSamples: number,
		sampleRate: number,
		frame?: number,
		_fps?: number,
	): void {
		const dr = this.getDeviceResources(device);
		const operation = (sd.operation as string) ?? "add";
		const customWGSL = (sd.customWGSL as string) ?? (sd.wgsl as string) ?? "";
		const shaderKey = `1d_math_${operation}_${hasSignalB}_${customWGSL}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPUComputePipeline
			| undefined;

		if (!pipeline) {
			const { evalExpr, extraFn } = buildSignalMathExpression(
				operation,
				customWGSL,
			);

			const shaderCode = `
struct MathUniforms {
    bValue    : f32,
    inMin     : f32,
    inMax     : f32,
    outMin    : f32,
    outMax    : f32,
    clampMin  : f32,
    clampMax  : f32,
    exponent  : f32,
    edge0     : f32,
    edge1     : f32,
    a_min     : f32,
    a_max     : f32,
    baseTime  : f32,
    duration  : f32,
    sampleRate: f32,
    numSamples: u32,
    hasB      : f32,
    frame     : u32,
    pad1      : f32,
    pad2      : f32,
};

@group(0) @binding(0) var<uniform> u : MathUniforms;
@group(0) @binding(1) var<storage, read> bufA : array<f32>;
@group(0) @binding(2) var<storage, read> bufB : array<f32>;
@group(0) @binding(3) var<storage, read_write> outSignal : array<f32>;

const PI:  f32 = ${Math.PI}f;
const TAU: f32 = ${Math.PI * 2}f;
const E:   f32 = ${Math.E}f;

${extraFn}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.numSamples) { return; }

    let a = bufA[idx];
    var b = u.bValue;
    if (u.hasB > 0.5f) {
        b = bufB[idx];
    }
    let a_min = u.a_min;
    let a_max = u.a_max;
    let inMin = u.inMin;
    let inMax = u.inMax;
    let outMin = u.outMin;
    let outMax = u.outMax;
    let clampMin = u.clampMin;
    let clampMax = u.clampMax;
    let exponent = u.exponent;
    let edge0 = u.edge0;
    let edge1 = u.edge1;
    let t = u.baseTime + f32(idx) / u.sampleRate;
    var t_norm = 0.5f;
    if (u.duration > 0.0f) {
        t_norm = clamp(t / u.duration, 0.0f, 1.0f);
    }
    let frame = u.frame;

    let val = ${evalExpr};
    outSignal[idx] = val;
}
`;
			const shaderModule = device.createShaderModule({
				label: `signal_1d_math_${operation}.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createComputePipeline({
				label: `Signal1DMathPipeline_${operation}`,
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		// Uniform buffer (20 floats = 80 bytes, aligned to 256)
		const uData = new ArrayBuffer(Math.max(80, 256));
		const fView = new Float32Array(uData);
		const uView = new Uint32Array(uData);

		fView[0] = bValue;
		fView[1] = Number(sd.inMin) || 0.0;
		fView[2] = Number(sd.inMax) || 1.0;
		fView[3] = Number(sd.outMin) || 0.0;
		fView[4] = Number(sd.outMax) || 1.0;
		fView[5] = Number(sd.clampMin) || 0.0;
		fView[6] = Number(sd.clampMax) || 1.0;
		fView[7] = Number(sd.exponent) || 2.0;
		fView[8] = Number(sd.edge0) || 0.0;
		fView[9] = Number(sd.edge1) || 1.0;
		fView[10] = Number(sd.aMin ?? sd.inMin) || 0.0;
		fView[11] = Number(sd.aMax ?? sd.inMax) || 1.0;
		fView[12] = elapsedTime;
		fView[13] = duration > 0 ? duration : 1.0;
		fView[14] = sampleRate;
		uView[15] = numSamples;
		fView[16] = hasSignalB ? 1.0 : 0.0;
		uView[17] = frame !== undefined ? Math.max(0, Math.floor(frame)) : 0;

		const uBuffer = device.createBuffer({
			size: Math.max(80, 256),
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "math_1d_uniform_buffer",
		});
		device.queue.writeBuffer(uBuffer, 0, uData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uBuffer } },
				{ binding: 1, resource: { buffer: bufA } },
				{ binding: 2, resource: { buffer: bufB } },
				{ binding: 3, resource: { buffer: res.buffer! } },
			],
		});

		const pass = encoder.beginComputePass({
			label: "math_1d_compute_pass",
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(numSamples / 64));
		pass.end();
	}

	private dispatch2DGenerator(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		elapsedTime: number,
		duration: number,
		sd: any,
		_width: number,
		_height: number,
		frame?: number,
		fps?: number,
	): void {
		const customWGSL = sd.customWGSL ?? sd.wgsl ?? "";
		const signalFnName = sd.signalFnName ?? sd.name ?? "signal_fn";

		const dr = this.getDeviceResources(device);
		const shaderKey = `2d_${sd.nodeId}_${customWGSL}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPURenderPipeline
			| undefined;

		if (!pipeline) {
			const fnParams = sd.fnParams ?? [];
			const paramVals: string[] = [];
			for (const p of fnParams) {
				const val = p.defaultValue;
				paramVals.push(val % 1 === 0 ? `${val.toFixed(1)}f` : `${val}f`);
			}

			const tExpr = "u.baseTime + (in.uv.x - 0.5) * 2.0";
			const tElapsedExpr = "u.t_elapsed + (in.uv.x - 0.5) * 2.0";

			const args = [
				tExpr,
				"in.uv.x",
				"1.0 - in.uv.y",
				"0.0",
				"0u",
				"1u",
				"u.frame",
				"vec4<f32>(in.uv.x, 1.0 - in.uv.y, 0.5, 1.0)",
				tElapsedExpr,
				"u.duration",
				...paramVals,
			];
			const callExpr = `${signalFnName}(${args.join(", ")})`;
			const returnExpr = `let val = f32(${callExpr}); return vec4<f32>(val, val, val, val);`;

			const shaderCode = `
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

struct GeneratorUniforms {
    baseTime   : f32,
    frame      : u32,
    amplitude  : f32,
    frequency  : f32,
    phase      : f32,
    offset     : f32,
    t_elapsed  : f32,
    duration   : f32,
};

@group(0) @binding(0) var<uniform> u : GeneratorUniforms;

${customWGSL}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    ${returnExpr}
}
			`;

			const shaderModule = device.createShaderModule({
				label: `signal_2d_generator_${sd.nodeId}.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createRenderPipeline({
				label: `Signal2DPipeline_${sd.nodeId}`,
				layout: "auto",
				vertex: {
					module: shaderModule,
					entryPoint: "vs",
				},
				fragment: {
					module: shaderModule,
					entryPoint: "fs",
					targets: [{ format: "rgba16float" }],
				},
				primitive: { topology: "triangle-strip" },
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		// Update Uniforms
		const baseTime =
			frame !== undefined && fps !== undefined && fps > 0
				? frame / fps
				: elapsedTime;
		const uFrame = frame !== undefined ? frame : 0;
		const uniformBufferData = new ArrayBuffer(8 * 4);
		const f32View = new Float32Array(uniformBufferData);
		const u32View = new Uint32Array(uniformBufferData);

		f32View[0] = baseTime;
		u32View[1] = uFrame;
		f32View[2] = sd.amplitude ?? 1.0;
		f32View[3] = sd.frequency ?? 1.0;
		f32View[4] = sd.phase ?? 0.0;
		f32View[5] = sd.offset ?? 0.0;
		f32View[6] = elapsedTime;
		f32View[7] = duration;

		if (!res.uniformBuffer || res.uniformBuffer.size < 256) {
			res.uniformBuffer = device.createBuffer({
				size: 256,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				label: `signal_2d_uniform_buffer_${sd.nodeId}`,
			});
			res.bindGroup = undefined;
		}
		device.queue.writeBuffer(res.uniformBuffer, 0, uniformBufferData);

		if (!res.bindGroup) {
			res.bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: { buffer: res.uniformBuffer } }],
			});
		}

		const pass = encoder.beginRenderPass({
			label: `signal_2d_render_pass_${sd.nodeId}`,
			colorAttachments: [
				{
					view: res.textureView!,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(pipeline);
		pass.setBindGroup(0, res.bindGroup);
		pass.draw(4);
		pass.end();
	}

	private dispatch2DAudioSignal(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		masterAudio: MasterAudioEntry,
		channel: number,
		elapsedTime: number,
		duration: number,
		frame?: number,
		fps?: number,
	): void {
		const dr = this.getDeviceResources(device);
		const shaderKey = "audio_signal_2d";
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPURenderPipeline
			| undefined;

		const sampler = this.getSampler(device);

		if (!pipeline) {
			const shaderCode = `
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

struct AudioUniforms {
    baseTime : f32,
    duration : f32,
    channel  : u32,
    pad      : f32,
};

@group(0) @binding(0) var<uniform> u : AudioUniforms;
@group(0) @binding(1) var masterTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let t = u.baseTime + (in.uv.x - 0.5) * 2.0;
    var t_norm = 0.5;
    if (u.duration > 0.0) {
        t_norm = clamp(t / u.duration, 0.0, 1.0);
    }
    let s = textureSampleLevel(masterTex, samp, vec2<f32>(t_norm, 0.5), 0.0);
    if (u.channel == 1u) {
        return vec4<f32>(s.g, s.g, s.g, s.g);
    } else if (u.channel == 2u) {
        return vec4<f32>(s.b, s.b, s.b, s.b);
    } else if (u.channel == 3u) {
        return vec4<f32>(s.a, s.a, s.a, s.a);
    }
    return s;
}
`;
			const shaderModule = device.createShaderModule({
				code: shaderCode,
				label: "dispatch2DAudioSignal_module",
			});

			pipeline = device.createRenderPipeline({
				label: "dispatch2DAudioSignal_pipeline",
				layout: "auto",
				vertex: {
					module: shaderModule,
					entryPoint: "vs",
				},
				fragment: {
					module: shaderModule,
					entryPoint: "fs",
					targets: [{ format: "rgba16float" }],
				},
				primitive: { topology: "triangle-strip" },
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		const baseTime =
			frame !== undefined && fps !== undefined && fps > 0
				? frame / fps
				: elapsedTime;

		const effectiveDuration =
			duration > 0 ? duration : (masterAudio.durationSec ?? 0.0);

		const uniformBufferData = new ArrayBuffer(4 * 4);
		const f32View = new Float32Array(uniformBufferData);
		const u32View = new Uint32Array(uniformBufferData);

		f32View[0] = baseTime;
		f32View[1] = effectiveDuration;
		u32View[2] = channel;
		f32View[3] = 0.0;

		if (!res.uniformBuffer || res.uniformBuffer.size < 256) {
			res.uniformBuffer = device.createBuffer({
				size: 256,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				label: "audio_signal_2d_uniform_buffer",
			});
			res.bindGroup = undefined;
		}
		device.queue.writeBuffer(res.uniformBuffer, 0, uniformBufferData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: res.uniformBuffer } },
				{ binding: 1, resource: masterAudio.textureView },
				{ binding: 2, resource: sampler },
			],
		});

		const pass = encoder.beginRenderPass({
			label: "audio_signal_2d_render_pass",
			colorAttachments: [
				{
					view: res.textureView!,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(4);
		pass.end();
	}

	private dispatch2DSignalMath(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		nodeId: string,
		sd: any,
		elapsedTime: number,
		duration: number,
		width: number,
		frame?: number,
		fps?: number,
		renderId?: string,
	): void {
		const cfg = sd.signalConfig as Record<string, unknown> | undefined;
		const operation = sd.operation ?? cfg?.operation ?? "remap";
		const customWGSL = sd.customWGSL ?? cfg?.customWGSL ?? "";
		const dr = this.getDeviceResources(device);
		const shaderKey = `math_${nodeId}_${operation}_${customWGSL}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPURenderPipeline
			| undefined;

		const sigANodeId =
			(sd.signalA?.nodeId as string | undefined) ||
			(sd.signalA?.virtualMedia?.operation?.nodeId as string | undefined);

		const sigBNodeId =
			sd.signalB && typeof sd.signalB === "object"
				? (sd.signalB.nodeId as string | undefined) ||
					(sd.signalB.virtualMedia?.operation?.nodeId as string | undefined)
				: undefined;

		const hasSignalB = Boolean(sigBNodeId);

		const viewA = sigANodeId
			? this.getOrCreate2DTextureView(
					device,
					encoder,
					sigANodeId,
					elapsedTime,
					duration,
					sd.signalA,
					width,
					1,
					renderId,
					frame,
					fps,
				)
			: this.getDummy1x1TextureView(device);

		const viewB = sigBNodeId
			? this.getOrCreate2DTextureView(
					device,
					encoder,
					sigBNodeId,
					elapsedTime,
					duration,
					sd.signalB,
					width,
					1,
					renderId,
					frame,
					fps,
				)
			: this.getDummy1x1TextureView(device);

		const sampler = this.getSampler(device);

		if (!pipeline) {
			const { evalExpr, extraFn } = buildSignalMathExpression(
				operation,
				customWGSL,
			);

			const shaderCode = `
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

struct MathUniforms {
    bValue    : f32,
    inMin     : f32,
    inMax     : f32,
    outMin    : f32,
    outMax    : f32,
    clampMin  : f32,
    clampMax  : f32,
    exponent  : f32,
    edge0     : f32,
    edge1     : f32,
    a_min     : f32,
    a_max     : f32,
    t         : f32,
    t_norm    : f32,
    frame     : u32,
    hasB      : f32,
};

@group(0) @binding(0) var<uniform> u : MathUniforms;
@group(0) @binding(1) var texA : texture_2d<f32>;
@group(0) @binding(2) var texB : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

const PI:  f32 = ${Math.PI}f;
const TAU: f32 = ${Math.PI * 2}f;
const E:   f32 = ${Math.E}f;

${extraFn}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let a = textureSampleLevel(texA, samp, in.uv, 0.0).r;
    var b = u.bValue;
    if (u.hasB > 0.5) {
        b = textureSampleLevel(texB, samp, in.uv, 0.0).r;
    }
    let a_min = u.a_min;
    let a_max = u.a_max;
    let inMin = u.inMin;
    let inMax = u.inMax;
    let outMin = u.outMin;
    let outMax = u.outMax;
    let clampMin = u.clampMin;
    let clampMax = u.clampMax;
    let exponent = u.exponent;
    let edge0 = u.edge0;
    let edge1 = u.edge1;
    let t = u.t;
    let t_norm = u.t_norm;
    let frame = u.frame;

    var val: f32 = ${evalExpr};
    return vec4<f32>(val, val, val, val);
}
`;

			const shaderModule = device.createShaderModule({
				label: `signal_math_${nodeId}.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createRenderPipeline({
				label: `SignalMathPipeline_${nodeId}`,
				layout: "auto",
				vertex: {
					module: shaderModule,
					entryPoint: "vs",
				},
				fragment: {
					module: shaderModule,
					entryPoint: "fs",
					targets: [{ format: "rgba16float" }],
				},
				primitive: { topology: "triangle-strip" },
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		// Stats calculation and broadcast
		const statsA = sigANodeId ? this.getStats(sigANodeId) : undefined;
		const aMin = statsA?.min ?? 0.0;
		const aMax = statsA?.max ?? 1.0;
		const statsB = sigBNodeId ? this.getStats(sigBNodeId) : undefined;

		const stats = computeSignalMathStats(
			operation,
			aMin,
			aMax,
			sd as Record<string, unknown>,
			hasSignalB,
			statsB,
		);
		this.setStats(nodeId, stats);
		if (sd.nodeId && sd.nodeId !== nodeId) {
			this.setStats(sd.nodeId, stats);
		}

		// Uniform buffer (16 * 4 bytes = 64 bytes)
		const uData = new ArrayBuffer(16 * 4);
		const fView = new Float32Array(uData);
		const uView = new Uint32Array(uData);

		const baseTime =
			frame !== undefined && fps !== undefined && fps > 0
				? frame / fps
				: elapsedTime;

		fView[0] = resolveSignalBValue(sd as Record<string, unknown>);
		fView[1] = sd.inMin ?? cfg?.inMin ?? 0.0;
		fView[2] = sd.inMax ?? cfg?.inMax ?? 1.0;
		fView[3] = sd.outMin ?? cfg?.outMin ?? 0.0;
		fView[4] = sd.outMax ?? cfg?.outMax ?? 1.0;
		fView[5] = sd.clampMin ?? cfg?.clampMin ?? 0.0;
		fView[6] = sd.clampMax ?? cfg?.clampMax ?? 1.0;
		fView[7] = sd.exponent ?? cfg?.exponent ?? 2.0;
		fView[8] = sd.edge0 ?? cfg?.edge0 ?? 0.0;
		fView[9] = sd.edge1 ?? cfg?.edge1 ?? 1.0;
		fView[10] = aMin;
		fView[11] = aMax;
		fView[12] = baseTime;
		fView[13] = duration > 0 ? baseTime / duration : 0.0;
		uView[14] = frame ?? 0;
		fView[15] = hasSignalB ? 1.0 : 0.0;

		if (!res.uniformBuffer || res.uniformBuffer.size < 256) {
			res.uniformBuffer = device.createBuffer({
				size: 256,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				label: `signal_math_uniform_${nodeId}`,
			});
			res.bindGroup = undefined;
		}
		device.queue.writeBuffer(res.uniformBuffer, 0, uData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: res.uniformBuffer } },
				{ binding: 1, resource: viewA },
				{ binding: 2, resource: viewB },
				{ binding: 3, resource: sampler },
			],
		});

		const pass = encoder.beginRenderPass({
			label: `signal_math_pass_${nodeId}`,
			colorAttachments: [
				{
					view: res.textureView!,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(4);
		pass.end();
	}

	private dispatch2DSignalGate(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		nodeId: string,
		sd: any,
		elapsedTime: number,
		duration: number,
		width: number,
		frame?: number,
		fps?: number,
		renderId?: string,
	): void {
		const cfg = sd.signalConfig as Record<string, unknown> | undefined;
		const threshold = Number(sd.threshold ?? cfg?.threshold ?? 0.5);
		const mode = (sd.mode ?? cfg?.mode ?? "gate") as string;
		const invert = Boolean(sd.invert ?? cfg?.invert ?? false);
		const holdFrames = Math.max(1, Number(sd.holdFrames ?? cfg?.holdFrames ?? 4));

		const source = (sd.sourceSignal ?? cfg?.sourceSignal ?? sd.signal) as
			| Record<string, unknown>
			| undefined;
		const vm = source?.virtualMedia as Record<string, unknown> | undefined;
		const op = vm?.operation as Record<string, unknown> | undefined;
		const sigInNodeId =
			(source?.nodeId as string | undefined) ||
			(op?.nodeId as string | undefined);

		const viewIn = sigInNodeId
			? this.getOrCreate2DTextureView(
					device,
					encoder,
					sigInNodeId,
					elapsedTime,
					duration,
					source,
					width,
					1,
					renderId,
					frame,
					fps,
				)
			: this.getDummy1x1TextureView(device);

		const sampler = this.getSampler(device);
		const dr = this.getDeviceResources(device);
		const shaderKey = `gate_2d_${mode}_${invert}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPURenderPipeline
			| undefined;

		if (!pipeline) {
			const shaderCode = `
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

struct GateUniforms {
    threshold  : f32,
    mode       : u32,
    invert     : f32,
    holdFrames : u32,
    dx         : f32,
    pad0       : f32,
    pad1       : f32,
    pad2       : f32,
};

@group(0) @binding(0) var<uniform> u : GateUniforms;
@group(0) @binding(1) var texIn : texture_2d<f32>;
@group(0) @binding(2) var samp  : sampler;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    var high: f32 = 0.0f;

    if (u.mode == 0u) {
        let a = textureSampleLevel(texIn, samp, in.uv, 0.0).r;
        high = select(0.0f, 1.0f, a >= u.threshold);
    } else if (u.mode == 1u) {
        let steps = min(u.holdFrames, 32u);
        for (var i = 0u; i < steps; i = i + 1u) {
            let uv_cur = in.uv.x - f32(i) * u.dx;
            if (uv_cur >= 0.0f) {
                let cur = textureSampleLevel(texIn, samp, vec2<f32>(uv_cur, in.uv.y), 0.0).r;
                let prev = textureSampleLevel(texIn, samp, vec2<f32>(max(0.0f, uv_cur - u.dx), in.uv.y), 0.0).r;
                if (cur >= u.threshold && prev < u.threshold) {
                    high = 1.0f;
                    break;
                }
            }
        }
    } else {
        var count = 0u;
        let max_scan = 128u;
        for (var i = 0u; i < max_scan; i = i + 1u) {
            let uv_cur = in.uv.x - f32(i) * u.dx;
            if (uv_cur < 0.0f) { break; }
            let cur = textureSampleLevel(texIn, samp, vec2<f32>(uv_cur, in.uv.y), 0.0).r;
            let prev = textureSampleLevel(texIn, samp, vec2<f32>(max(0.0f, uv_cur - u.dx), in.uv.y), 0.0).r;
            if (cur >= u.threshold && prev < u.threshold) {
                count = count + 1u;
            }
        }
        high = select(0.0f, 1.0f, (count % 2u) == 1u);
    }

    if (u.invert > 0.5f) {
        high = 1.0f - high;
    }
    return vec4<f32>(high, high, high, 1.0f);
}
`;
			const shaderModule = device.createShaderModule({
				label: `signal_gate_${nodeId}.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createRenderPipeline({
				label: `SignalGatePipeline_${nodeId}`,
				layout: "auto",
				vertex: {
					module: shaderModule,
					entryPoint: "vs",
				},
				fragment: {
					module: shaderModule,
					entryPoint: "fs",
					targets: [{ format: "rgba16float" }],
				},
				primitive: { topology: "triangle-strip" },
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		const uData = new ArrayBuffer(256);
		const fView = new Float32Array(uData);
		const uView = new Uint32Array(uData);

		fView[0] = threshold;
		uView[1] = mode === "trigger" ? 1 : mode === "toggle" ? 2 : 0;
		fView[2] = invert ? 1.0 : 0.0;
		uView[3] = holdFrames;
		fView[4] = 1.0 / Math.max(1, width);

		if (!res.uniformBuffer || res.uniformBuffer.size < 256) {
			res.uniformBuffer = device.createBuffer({
				size: 256,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				label: `signal_gate_uniform_${nodeId}`,
			});
			res.bindGroup = undefined;
		}
		device.queue.writeBuffer(res.uniformBuffer, 0, uData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: res.uniformBuffer } },
				{ binding: 1, resource: viewIn },
				{ binding: 2, resource: sampler },
			],
		});

		const pass = encoder.beginRenderPass({
			label: `signal_gate_pass_${nodeId}`,
			colorAttachments: [
				{
					view: res.textureView!,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(4);
		pass.end();

		this.setStats(nodeId, { min: 0.0, max: 1.0 });
	}

	private dispatch1DGateSignal(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		res: SignalRegistryResource,
		bufIn: GPUBuffer,
		sd: Record<string, unknown>,
		_elapsedTime: number,
		_duration: number,
		numSamples: number,
		sampleRate: number,
		_frame?: number,
		fps?: number,
	): void {
		const dr = this.getDeviceResources(device);
		const cfg = sd.signalConfig as Record<string, unknown> | undefined;
		const threshold = Number(sd.threshold ?? cfg?.threshold ?? 0.5);
		const mode = (sd.mode ?? cfg?.mode ?? "gate") as string;
		const invert = Boolean(sd.invert ?? cfg?.invert ?? false);
		const holdFrames = Math.max(1, Number(sd.holdFrames ?? cfg?.holdFrames ?? 4));
		const debounceMs = Number(sd.debounceMs ?? cfg?.debounceMs ?? 100);
		const debounceSamples = Math.max(
			1,
			Math.round((debounceMs / 1000) * sampleRate),
		);
		const effectiveFps = fps ?? 24;
		const holdSamples = Math.max(
			1,
			Math.round((holdFrames / effectiveFps) * sampleRate),
		);

		const shaderKey = `1d_gate_${mode}_${threshold}_${invert}`;
		let pipeline = dr.pipelineCache.get(shaderKey) as
			| GPUComputePipeline
			| undefined;

		if (!pipeline) {
			const shaderCode = `
struct Gate1DUniforms {
    threshold       : f32,
    mode            : u32,
    invert          : f32,
    holdSamples     : u32,
    debounceSamples : u32,
    numSamples      : u32,
    pad0            : f32,
    pad1            : f32,
};

@group(0) @binding(0) var<uniform> u : Gate1DUniforms;
@group(0) @binding(1) var<storage, read> bufIn : array<f32>;
@group(0) @binding(2) var<storage, read_write> outSignal : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.numSamples) { return; }

    var high: f32 = 0.0f;
    if (u.mode == 0u) {
        let cur = bufIn[idx];
        high = select(0.0f, 1.0f, cur >= u.threshold);
    } else if (u.mode == 1u) {
        let max_scan = min(idx, u.holdSamples);
        for (var i = 0u; i <= max_scan; i = i + 1u) {
            let cur_idx = idx - i;
            let cur = bufIn[cur_idx];
            var prev = 0.0f;
            if (cur_idx > 0u) {
                prev = bufIn[cur_idx - 1u];
            }
            if (cur >= u.threshold && prev < u.threshold) {
                high = 1.0f;
                break;
            }
        }
    } else {
        var count = 0u;
        var last_trigger = 0u;
        var has_triggered = false;
        for (var i = 0u; i <= idx; i = i + 1u) {
            let cur = bufIn[i];
            var prev = 0.0f;
            if (i > 0u) {
                prev = bufIn[i - 1u];
            }
            if (cur >= u.threshold && prev < u.threshold) {
                if (!has_triggered || (i - last_trigger) >= u.debounceSamples) {
                    count = count + 1u;
                    last_trigger = i;
                    has_triggered = true;
                }
            }
        }
        high = select(0.0f, 1.0f, (count % 2u) == 1u);
    }

    if (u.invert > 0.5f) {
        high = 1.0f - high;
    }
    outSignal[idx] = high;
}
`;
			const shaderModule = device.createShaderModule({
				label: `signal_1d_gate.wgsl`,
				code: shaderCode,
			});

			pipeline = device.createComputePipeline({
				label: `Signal1DGatePipeline_${mode}`,
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});

			dr.pipelineCache.set(shaderKey, pipeline);
		}

		const uData = new ArrayBuffer(256);
		const fView = new Float32Array(uData);
		const uView = new Uint32Array(uData);

		fView[0] = threshold;
		uView[1] = mode === "trigger" ? 1 : mode === "toggle" ? 2 : 0;
		fView[2] = invert ? 1.0 : 0.0;
		uView[3] = holdSamples;
		uView[4] = debounceSamples;
		uView[5] = numSamples;

		const uniformBuffer = device.createBuffer({
			size: 256,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "gate_1d_uniform",
		});
		device.queue.writeBuffer(uniformBuffer, 0, uData);

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: bufIn } },
				{ binding: 2, resource: { buffer: res.buffer! } },
			],
		});

		const pass = encoder.beginComputePass({
			label: "gate_1d_compute_pass",
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(numSamples / 64));
		pass.end();
	}
}

function buildSignalMathExpression(
	operation: string,
	customWGSL: string,
): { evalExpr: string; extraFn: string } {
	switch (operation) {
		case "remap":
			return {
				evalExpr:
					"mix(u.outMin, u.outMax, clamp((a - u.inMin) / max(1e-5, u.inMax - u.inMin), 0.0, 1.0))",
				extraFn: "",
			};
		case "normalize":
			return {
				evalExpr:
					"clamp((a - u.a_min) / max(1e-5, u.a_max - u.a_min), 0.0, 1.0)",
				extraFn: "",
			};
		case "add":
			return { evalExpr: "a + b", extraFn: "" };
		case "subtract":
			return { evalExpr: "a - b", extraFn: "" };
		case "multiply":
			return { evalExpr: "a * b", extraFn: "" };
		case "divide":
			return {
				evalExpr: "a / select(b, 1e-5, abs(b) < 1e-5)",
				extraFn: "",
			};
		case "invert":
			return { evalExpr: "1.0 - a", extraFn: "" };
		case "clamp":
			return { evalExpr: "clamp(a, u.clampMin, u.clampMax)", extraFn: "" };
		case "power":
			return { evalExpr: "pow(max(0.0, a), u.exponent)", extraFn: "" };
		case "smoothstep":
			return { evalExpr: "smoothstep(u.edge0, u.edge1, a)", extraFn: "" };
		case "custom":
			return {
				extraFn: `\nfn user_signal_calc(a: f32, b: f32, a_min: f32, a_max: f32, t: f32, t_norm: f32, frame: u32) -> f32 {\n${customWGSL}\n}\n`,
				evalExpr: "user_signal_calc(a, b, a_min, a_max, t, t_norm, frame)",
			};
		default:
			return { evalExpr: "a", extraFn: "" };
	}
}

function resolveSignalBValue(sd: Record<string, unknown>): number {
	if (typeof sd.signalB === "number" && !Number.isNaN(sd.signalB)) {
		return sd.signalB;
	}
	if (
		sd.signalB &&
		typeof sd.signalB === "object" &&
		typeof (sd.signalB as Record<string, unknown>).value === "number" &&
		!Number.isNaN((sd.signalB as Record<string, unknown>).value)
	) {
		return (sd.signalB as Record<string, unknown>).value as number;
	}
	if (typeof sd.bValue === "number" && !Number.isNaN(sd.bValue)) {
		return sd.bValue;
	}
	const cfg = sd.signalConfig as Record<string, unknown> | undefined;
	if (typeof cfg?.bValue === "number" && !Number.isNaN(cfg.bValue)) {
		return cfg.bValue;
	}
	return 1.0;
}

function computeSignalMathStats(
	operation: string,
	aMin: number,
	aMax: number,
	sd: Record<string, unknown>,
	hasSignalB: boolean,
	statsB?: { min: number; max: number },
): { min: number; max: number } {
	const cfg = sd.signalConfig as Record<string, unknown> | undefined;
	switch (operation) {
		case "remap": {
			const outMin = Number(sd.outMin ?? cfg?.outMin ?? 0.0);
			const outMax = Number(sd.outMax ?? cfg?.outMax ?? 1.0);
			return {
				min: Math.min(outMin, outMax),
				max: Math.max(outMin, outMax),
			};
		}
		case "normalize":
			return { min: 0.0, max: 1.0 };
		case "invert":
			return { min: 1.0 - aMax, max: 1.0 - aMin };
		case "clamp": {
			const clampMin = Number(sd.clampMin ?? cfg?.clampMin ?? 0.0);
			const clampMax = Number(sd.clampMax ?? cfg?.clampMax ?? 1.0);
			return {
				min: clampMin,
				max: clampMax,
			};
		}
		case "power": {
			const exp = Number(sd.exponent ?? cfg?.exponent ?? 2.0);
			return {
				min: Math.max(0, aMin) ** exp,
				max: Math.max(0, aMax) ** exp,
			};
		}
		case "add": {
			if (hasSignalB && statsB) {
				return { min: aMin + statsB.min, max: aMax + statsB.max };
			}
			const b = hasSignalB ? 0.0 : resolveSignalBValue(sd);
			return { min: aMin + b, max: aMax + b };
		}
		case "subtract": {
			if (hasSignalB && statsB) {
				return { min: aMin - statsB.max, max: aMax - statsB.min };
			}
			const b = hasSignalB ? 0.0 : resolveSignalBValue(sd);
			return { min: aMin - b, max: aMax - b };
		}
		case "multiply": {
			if (hasSignalB && statsB) {
				const vals = [
					aMin * statsB.min,
					aMin * statsB.max,
					aMax * statsB.min,
					aMax * statsB.max,
				];
				return { min: Math.min(...vals), max: Math.max(...vals) };
			}
			const b = hasSignalB ? 1.0 : resolveSignalBValue(sd);
			return {
				min: Math.min(aMin * b, aMax * b),
				max: Math.max(aMin * b, aMax * b),
			};
		}
		case "divide": {
			if (hasSignalB && statsB) {
				const safeMin = Math.abs(statsB.min) < 1e-5 ? 1e-5 : statsB.min;
				const safeMax = Math.abs(statsB.max) < 1e-5 ? 1e-5 : statsB.max;
				const vals = [
					aMin / safeMin,
					aMin / safeMax,
					aMax / safeMin,
					aMax / safeMax,
				];
				return { min: Math.min(...vals), max: Math.max(...vals) };
			}
			const b = hasSignalB ? 1.0 : resolveSignalBValue(sd);
			const safeB = Math.abs(b) < 1e-5 ? 1e-5 : b;
			return {
				min: Math.min(aMin / safeB, aMax / safeB),
				max: Math.max(aMin / safeB, aMax / safeB),
			};
		}
		default:
			return { min: 0.0, max: 1.0 };
	}
}

export const signalRegistry = new SignalRegistry();
