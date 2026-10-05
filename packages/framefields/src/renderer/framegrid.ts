import fs from "node:fs/promises";
import type { VirtualMediaData } from "@framefields/core";
import { Canvas, loadImage } from "skia-canvas";
import { HeadlessMediaRenderer } from "./index.js";

export interface FrameSamplePoint {
	frame: number;
	timeMs: number;
}

export interface FrameGridOptions {
	/**
	 * Start frame index for sampling (inclusive). Defaults to 0.
	 */
	startFrame?: number;

	/**
	 * End frame index for sampling (inclusive). Defaults to startFrame + 30.
	 */
	endFrame?: number;

	/**
	 * Step interval between sampled frames. Must be >= 1. Defaults to 5.
	 */
	stepFrames?: number;

	/**
	 * Explicit list of frame indices to sample. Overrides startFrame/endFrame/stepFrames.
	 */
	frames?: number[];

	/**
	 * Start time in milliseconds (alternative to startFrame).
	 */
	startMs?: number;

	/**
	 * End time in milliseconds (alternative to endFrame).
	 */
	endMs?: number;

	/**
	 * Step interval in milliseconds (alternative to stepFrames).
	 */
	stepMs?: number;

	/**
	 * Explicit list of timestamps in milliseconds to sample.
	 */
	timesMs?: number[];

	/**
	 * Frames per second override. If omitted, reads from media/composition metadata or defaults to 24.
	 */
	fps?: number;

	/**
	 * Number of columns in the grid. If omitted, calculated automatically to preserve balance.
	 */
	columns?: number;

	/**
	 * Width in pixels for each individual thumbnail cell.
	 * Clamped to [120, 960]. Defaults to 320.
	 */
	cellWidth?: number;

	/**
	 * Explicit height for each cell. If omitted, computed from aspect ratio.
	 */
	cellHeight?: number;

	/**
	 * Gap in pixels between cells. Defaults to 12.
	 */
	gap?: number;

	/**
	 * Outer padding in pixels around the grid. Defaults to 16.
	 */
	padding?: number;

	/**
	 * Background color for the grid canvas. Defaults to "#090a0f".
	 */
	backgroundColor?: string;

	/**
	 * Whether to render frame number & millisecond badges on each cell. Defaults to true.
	 */
	showLabels?: boolean;

	/**
	 * Whether to render the metadata header banner at the top of the grid. Defaults to true.
	 */
	showHeader?: boolean;

	/**
	 * Custom header title text.
	 */
	headerText?: string;

	/**
	 * Optional file path to write the generated grid image directly to disk.
	 */
	outputPath?: string;

	/**
	 * Safety limit for total sampled frames to prevent memory exhaustion or oversized images.
	 * Defaults to 64. Hard maximum is 120.
	 */
	maxFrames?: number;

	/**
	 * Maximum allowed width for the generated image canvas. Defaults to 4096.
	 */
	maxGridWidth?: number;

	/**
	 * Maximum allowed height for the generated image canvas. Defaults to 4096.
	 */
	maxGridHeight?: number;

	/**
	 * Optional shared HeadlessMediaRenderer instance.
	 */
	renderer?: HeadlessMediaRenderer;
}

/**
 * Resolves and validates the list of sample points from the provided options.
 */
export function resolveSamplePoints(
	options: FrameGridOptions,
	defaultFps = 24,
	durationMs?: number,
): { samples: FrameSamplePoint[]; fps: number } {
	const fps = options.fps ?? defaultFps;
	if (fps <= 0) {
		throw new Error(`[FrameGrid] Invalid fps: ${fps}. Must be > 0.`);
	}

	const samples: FrameSamplePoint[] = [];

	if (Array.isArray(options.frames) && options.frames.length > 0) {
		for (const f of options.frames) {
			if (typeof f !== "number" || f < 0 || !Number.isFinite(f)) {
				throw new Error(`[FrameGrid] Invalid frame index in frames list: ${f}`);
			}
			samples.push({
				frame: Math.round(f),
				timeMs: Math.round((f / fps) * 1000),
			});
		}
	} else if (Array.isArray(options.timesMs) && options.timesMs.length > 0) {
		for (const ms of options.timesMs) {
			if (typeof ms !== "number" || ms < 0 || !Number.isFinite(ms)) {
				throw new Error(`[FrameGrid] Invalid timestamp in timesMs list: ${ms}`);
			}
			samples.push({
				frame: Math.round((ms / 1000) * fps),
				timeMs: Math.round(ms),
			});
		}
	} else if (
		options.startMs !== undefined ||
		options.endMs !== undefined ||
		options.stepMs !== undefined
	) {
		const startMs = options.startMs ?? 0;
		const endMs = options.endMs ?? durationMs ?? startMs + 1000;
		const stepMs = options.stepMs ?? Math.round((5 / fps) * 1000);

		if (startMs < 0 || endMs < startMs) {
			throw new Error(
				`[FrameGrid] Invalid millisecond range: startMs=${startMs}, endMs=${endMs}. startMs must be <= endMs.`,
			);
		}
		if (stepMs <= 0) {
			throw new Error(`[FrameGrid] Invalid stepMs: ${stepMs}. Must be > 0.`);
		}

		for (let ms = startMs; ms <= endMs; ms += stepMs) {
			samples.push({
				frame: Math.round((ms / 1000) * fps),
				timeMs: Math.round(ms),
			});
		}
	} else {
		const startFrame = options.startFrame ?? 0;
		const endFrame =
			options.endFrame ??
			(durationMs
				? Math.min(startFrame + 30, Math.floor((durationMs / 1000) * fps))
				: startFrame + 30);
		const stepFrames = options.stepFrames ?? 5;

		if (startFrame < 0 || endFrame < startFrame) {
			throw new Error(
				`[FrameGrid] Invalid frame range: startFrame=${startFrame}, endFrame=${endFrame}. startFrame must be <= endFrame.`,
			);
		}
		if (stepFrames <= 0) {
			throw new Error(
				`[FrameGrid] Invalid stepFrames: ${stepFrames}. Must be > 0.`,
			);
		}

		for (let f = startFrame; f <= endFrame; f += stepFrames) {
			samples.push({
				frame: Math.round(f),
				timeMs: Math.round((f / fps) * 1000),
			});
		}
	}

	const maxFramesLimit = Math.min(options.maxFrames ?? 64, 120);
	if (samples.length > maxFramesLimit) {
		throw new Error(
			`[FrameGrid] Requested ${samples.length} frames exceeds the safety threshold of ${maxFramesLimit}. ` +
				`Increase stepFrames/stepMs or narrow the start/end range to prevent oversized images.`,
		);
	}

	if (samples.length === 0) {
		throw new Error("[FrameGrid] Zero frames were resolved for sampling.");
	}

	return { samples, fps };
}

/**
 * Computes grid layout dimensions, ensuring resulting canvas does not exceed size limits.
 */
export function computeGridLayout(
	numSamples: number,
	aspectRatio: number,
	options: FrameGridOptions,
): {
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
	totalWidth: number;
	totalHeight: number;
	headerHeight: number;
	gap: number;
	padding: number;
} {
	const gap = options.gap ?? 12;
	const padding = options.padding ?? 16;
	const showHeader = options.showHeader ?? true;
	const headerHeight = showHeader ? 54 : 0;
	const maxGridWidth = options.maxGridWidth ?? 4096;
	const maxGridHeight = options.maxGridHeight ?? 4096;

	let columns = options.columns;
	if (!columns || columns <= 0) {
		if (numSamples <= 4) columns = numSamples;
		else if (numSamples <= 9) columns = 3;
		else if (numSamples <= 16) columns = 4;
		else if (numSamples <= 25) columns = 5;
		else columns = 6;
	}
	columns = Math.min(columns, numSamples);
	const rows = Math.ceil(numSamples / columns);

	let cellWidth = Math.max(120, Math.min(options.cellWidth ?? 320, 960));
	let cellHeight =
		options.cellHeight ??
		Math.round(cellWidth / (aspectRatio > 0 ? aspectRatio : 16 / 9));

	let totalWidth = columns * cellWidth + (columns - 1) * gap + padding * 2;
	let totalHeight =
		rows * cellHeight + (rows - 1) * gap + padding * 2 + headerHeight;

	// Downscale thumbnail size if the unconstrained canvas exceeds max dimensions
	if (totalWidth > maxGridWidth || totalHeight > maxGridHeight) {
		const scaleFactor = Math.min(
			(maxGridWidth - (columns - 1) * gap - padding * 2) /
				(columns * cellWidth),
			(maxGridHeight - (rows - 1) * gap - padding * 2 - headerHeight) /
				(rows * cellHeight),
		);

		if (scaleFactor < 0.25) {
			throw new Error(
				`[FrameGrid] Cannot fit ${numSamples} cells (${columns}x${rows}) into max dimensions ` +
					`[${maxGridWidth}x${maxGridHeight}]. Reduce cell count or decrease cellWidth.`,
			);
		}

		cellWidth = Math.max(100, Math.floor(cellWidth * scaleFactor));
		cellHeight = Math.round(
			cellWidth / (aspectRatio > 0 ? aspectRatio : 16 / 9),
		);

		totalWidth = columns * cellWidth + (columns - 1) * gap + padding * 2;
		totalHeight =
			rows * cellHeight + (rows - 1) * gap + padding * 2 + headerHeight;
	}

	return {
		columns,
		rows,
		cellWidth,
		cellHeight,
		totalWidth,
		totalHeight,
		headerHeight,
		gap,
		padding,
	};
}

export type FrameGridRenderable = {
	toVirtualMedia(): VirtualMediaData;
	renderFrame(options: {
		frame?: number;
		atMs?: number;
		fps?: number;
		renderer?: HeadlessMediaRenderer;
	}): Promise<Buffer>;
	fps?: number;
	durationMs?: number;
	width?: number;
	height?: number;
};

/**
 * Renders a sequence of frames from a Composition or Media pipeline into a unified image grid (contact sheet).
 * Ideal for visual inspection of kinetic motion, transitions, easing, and layout stability.
 */
export async function renderFrameGrid(
	target: FrameGridRenderable,
	options: FrameGridOptions = {},
): Promise<Buffer> {
	const defaultFps = target.fps ?? 24;
	const durationMs = target.durationMs;
	const { samples, fps } = resolveSamplePoints(options, defaultFps, durationMs);

	const compWidth = target.width ?? 1920;
	const compHeight = target.height ?? 1080;
	const aspectRatio =
		compWidth > 0 && compHeight > 0 ? compWidth / compHeight : 16 / 9;

	const layout = computeGridLayout(samples.length, aspectRatio, options);
	const renderer = options.renderer ?? new HeadlessMediaRenderer();

	// Render each frame sequentially to manage GPU resources cleanly
	const frameBuffers: Buffer[] = [];
	for (const sample of samples) {
		const buf = await target.renderFrame({
			frame: sample.frame,
			atMs: sample.timeMs,
			fps,
			renderer,
		});
		frameBuffers.push(buf);
	}

	// Composite into a single grid canvas using skia-canvas
	const canvas = new Canvas(layout.totalWidth, layout.totalHeight);
	const ctx = canvas.getContext("2d");

	// Fill background
	ctx.fillStyle = options.backgroundColor ?? "#090a0f";
	ctx.fillRect(0, 0, layout.totalWidth, layout.totalHeight);

	// Header banner
	if (options.showHeader !== false && layout.headerHeight > 0) {
		const title =
			options.headerText ??
			`FrameGrid Conformance Review | Frames ${samples[0].frame}–${samples[samples.length - 1].frame} (Count: ${samples.length})`;
		const subtitle = `${compWidth}×${compHeight} @ ${fps} FPS | Cell: ${layout.cellWidth}×${layout.cellHeight}px | Step: ${
			options.stepFrames
				? `${options.stepFrames}f`
				: options.stepMs
					? `${options.stepMs}ms`
					: "Custom"
		}`;

		ctx.fillStyle = "#f8fafc";
		ctx.font = "bold 15px sans-serif";
		ctx.fillText(title, layout.padding, layout.padding + 18);

		ctx.fillStyle = "#94a3b8";
		ctx.font = "12px sans-serif";
		ctx.fillText(subtitle, layout.padding, layout.padding + 36);

		// Subtle divider line
		ctx.strokeStyle = "#1e2433";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(layout.padding, layout.padding + 46);
		ctx.lineTo(layout.totalWidth - layout.padding, layout.padding + 46);
		ctx.stroke();
	}

	const showLabels = options.showLabels ?? true;

	// Draw each sampled cell
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		const col = i % layout.columns;
		const row = Math.floor(i / layout.columns);

		const x = layout.padding + col * (layout.cellWidth + layout.gap);
		const y =
			layout.padding +
			layout.headerHeight +
			row * (layout.cellHeight + layout.gap);

		const img = await loadImage(frameBuffers[i]);
		ctx.drawImage(img, x, y, layout.cellWidth, layout.cellHeight);

		// Subtle cell border
		ctx.strokeStyle = "#262b3d";
		ctx.lineWidth = 1;
		ctx.strokeRect(x, y, layout.cellWidth, layout.cellHeight);

		// Sleek metadata pill badge
		if (showLabels) {
			const label = `F:${sample.frame} • ${sample.timeMs}ms`;

			ctx.font = "bold 11px sans-serif";
			const textWidth = ctx.measureText(label).width;
			const badgeW = textWidth + 14;
			const badgeH = 20;
			const badgeX = x + 6;
			const badgeY = y + 6;

			// Badge backdrop
			ctx.fillStyle = "#090a0fee";
			ctx.beginPath();
			ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
			ctx.fill();

			// Badge border
			ctx.strokeStyle = "#6366f155";
			ctx.lineWidth = 1;
			ctx.stroke();

			// Badge text
			ctx.fillStyle = "#e2e8f0";
			ctx.fillText(label, badgeX + 7, badgeY + 14);
		}
	}

	const gridBuffer = await canvas.toBuffer("png");

	if (options.outputPath) {
		await fs.writeFile(options.outputPath, gridBuffer);
	}

	return gridBuffer;
}
