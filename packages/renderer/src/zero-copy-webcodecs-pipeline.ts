import { VideoSample, type VideoSampleSource } from "mediabunny";
import {
	DmaStagingRing,
	type VideoColorSpaceConfig,
} from "./dma-staging-ring.js";

export interface ZeroCopyWebCodecsPipelineOptions {
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly videoSource: VideoSampleSource;
	readonly ringCapacity?: number;
	readonly colorSpace?: VideoColorSpaceConfig;
	readonly directCanvasSource?: unknown;
}

export interface WebCodecsPipelineStats {
	readonly totalFramesEnqueued: number;
	readonly totalFramesEncoded: number;
	readonly averageGpuSubmitTimeMs: number;
	readonly averageEncodeTimeMs: number;
	readonly averageCycleTimeMs: number;
	readonly maxCycleTimeMs: number;
	readonly minCycleTimeMs: number;
	readonly throughputFps: number;
	readonly ringCapacity: number;
	readonly isDirectZeroCopy: boolean;
}

/**
 * High-performance hardware video encoding pipeline integrating WebGPU textures with WebCodecs.
 *
 * Provides:
 * 1. Direct hardware acceleration when running with WebCodecs / OffscreenCanvas.
 * 2. Pipelined asynchronous double-buffered DMA staging ring for headless Node.js (Dawn native),
 *    allowing GPU Frame i+1 rendering to overlap concurrently with Frame i hardware encoding.
 */
export class ZeroCopyWebCodecsPipeline {
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly ringCapacity: number;

	private readonly device: GPUDevice;
	private readonly videoSource: VideoSampleSource;
	private readonly stagingRing: DmaStagingRing;
	private readonly colorSpace?: VideoColorSpaceConfig;
	private readonly directCanvasSource?: unknown;

	private readonly inFlightFrames: number[] = [];
	private readonly cycleStartTimes = new Map<number, number>();

	private totalFramesEnqueued = 0;
	private totalFramesEncoded = 0;
	private totalGpuSubmitTimeMs = 0;
	private totalEncodeTimeMs = 0;
	private totalCycleTimeMs = 0;
	private maxCycleTimeMs = 0;
	private minCycleTimeMs = Number.POSITIVE_INFINITY;
	private pipelineStartTime = 0;

	constructor(device: GPUDevice, options: ZeroCopyWebCodecsPipelineOptions) {
		this.device = device;
		this.width = options.width;
		this.height = options.height;
		this.fps = options.fps;
		this.videoSource = options.videoSource;
		this.ringCapacity = Math.max(2, options.ringCapacity ?? 2);
		this.colorSpace = options.colorSpace;
		this.directCanvasSource = options.directCanvasSource;

		this.stagingRing = new DmaStagingRing(device, {
			width: this.width,
			height: this.height,
			capacity: this.ringCapacity,
		});

		this.pipelineStartTime = performance.now();
	}

	/**
	 * Returns true if direct zero-copy from an OffscreenCanvas or texture is active.
	 */
	canDirectZeroCopy(): boolean {
		return (
			this.directCanvasSource !== undefined && this.directCanvasSource !== null
		);
	}

	/**
	 * Enqueues a rendered GPU texture frame into the pipeline.
	 *
	 * Uses double-buffered DMA staging: if the staging ring has reached capacity,
	 * the oldest in-flight frame is asynchronously consumed and added to the video encoder
	 * before staging the new frame, guaranteeing constant bounded VRAM usage and zero GPU stalls.
	 */
	async enqueueFrame(
		frameIndex: number,
		targetTexture: GPUTexture,
		encoder: GPUCommandEncoder,
	): Promise<void> {
		const cycleStartTime = performance.now();

		// Backpressure: if ring is full, drain the oldest in-flight frame first
		if (this.inFlightFrames.length >= this.ringCapacity) {
			const oldestFrame = this.inFlightFrames.shift();
			if (oldestFrame !== undefined) {
				await this.consumeAndEncode(oldestFrame);
			}
		}

		if (this.canDirectZeroCopy()) {
			// Direct zero-copy hardware path (Chromium / Electron)
			const gpuStart = performance.now();
			this.device.queue.submit([encoder.finish()]);
			this.totalGpuSubmitTimeMs += performance.now() - gpuStart;

			this.cycleStartTimes.set(frameIndex, cycleStartTime);
			this.totalFramesEnqueued++;
			await this.consumeAndEncode(frameIndex);
		} else {
			// Pipelined DMA staging ring path (Dawn Native)
			await this.stagingRing.prepareSlot(frameIndex);
			this.stagingRing.stageTexture(encoder, targetTexture, frameIndex);

			const gpuStart = performance.now();
			this.device.queue.submit([encoder.finish()]);
			this.totalGpuSubmitTimeMs += performance.now() - gpuStart;

			this.stagingRing.scheduleMap(frameIndex);
			this.inFlightFrames.push(frameIndex);
			this.cycleStartTimes.set(frameIndex, cycleStartTime);
			this.totalFramesEnqueued++;
		}
	}

	/**
	 * Drains all remaining in-flight frames in the pipeline, ensuring every enqueued
	 * frame has been encoded and added to the video sample source.
	 */
	async drain(): Promise<void> {
		while (this.inFlightFrames.length > 0) {
			const frameIndex = this.inFlightFrames.shift();
			if (frameIndex !== undefined) {
				await this.consumeAndEncode(frameIndex);
			}
		}
	}

	/**
	 * Returns runtime throughput, latency, and pipeline statistics.
	 */
	getStats(): WebCodecsPipelineStats {
		const totalElapsedMs = performance.now() - this.pipelineStartTime;
		const throughputFps =
			totalElapsedMs > 0
				? (this.totalFramesEncoded / totalElapsedMs) * 1000
				: 0;
		const avgSubmit =
			this.totalFramesEnqueued > 0
				? this.totalGpuSubmitTimeMs / this.totalFramesEnqueued
				: 0;
		const avgEncode =
			this.totalFramesEncoded > 0
				? this.totalEncodeTimeMs / this.totalFramesEncoded
				: 0;
		const avgCycle =
			this.totalFramesEncoded > 0
				? this.totalCycleTimeMs / this.totalFramesEncoded
				: 0;

		return {
			totalFramesEnqueued: this.totalFramesEnqueued,
			totalFramesEncoded: this.totalFramesEncoded,
			averageGpuSubmitTimeMs: avgSubmit,
			averageEncodeTimeMs: avgEncode,
			averageCycleTimeMs: avgCycle,
			maxCycleTimeMs: this.maxCycleTimeMs,
			minCycleTimeMs: Number.isFinite(this.minCycleTimeMs)
				? this.minCycleTimeMs
				: 0,
			throughputFps,
			ringCapacity: this.ringCapacity,
			isDirectZeroCopy: this.canDirectZeroCopy(),
		};
	}

	/**
	 * Destroys the pipeline and releases all staging buffers.
	 */
	destroy(): void {
		this.inFlightFrames.length = 0;
		this.cycleStartTimes.clear();
		this.stagingRing.destroy();
	}

	private async consumeAndEncode(frameIndex: number): Promise<void> {
		const encodeStart = performance.now();
		const timestampUs = (frameIndex / this.fps) * 1_000_000;

		if (this.canDirectZeroCopy()) {
			const sample = new VideoSample(this.directCanvasSource as never, {
				duration: 1 / this.fps,
				timestamp: frameIndex / this.fps,
			});
			try {
				await this.videoSource.add(sample);
			} finally {
				sample.close();
			}
		} else {
			const vf = await this.stagingRing.readFrameToVideoFrame(
				frameIndex,
				timestampUs,
				this.colorSpace,
			);
			try {
				const sample = new VideoSample(vf, {
					duration: 1 / this.fps,
					timestamp: frameIndex / this.fps,
				});
				try {
					await this.videoSource.add(sample);
				} finally {
					sample.close();
				}
			} finally {
				vf.close();
			}
		}

		const now = performance.now();
		this.totalEncodeTimeMs += now - encodeStart;
		this.totalFramesEncoded++;

		const cycleStart = this.cycleStartTimes.get(frameIndex);
		if (cycleStart !== undefined) {
			const cycleDuration = now - cycleStart;
			this.cycleStartTimes.delete(frameIndex);
			this.totalCycleTimeMs += cycleDuration;
			if (cycleDuration > this.maxCycleTimeMs) {
				this.maxCycleTimeMs = cycleDuration;
			}
			if (cycleDuration < this.minCycleTimeMs) {
				this.minCycleTimeMs = cycleDuration;
			}
		}
	}
}
