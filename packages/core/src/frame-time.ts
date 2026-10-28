/** Frame windows are half-open: [startFrame, startFrame + durationFrames). */
export function frameCount(durationMs: number, fps: number): number {
	assertFps(fps);
	if (!Number.isFinite(durationMs) || durationMs <= 0)
		throw new Error("durationMs must be finite and positive");
	const count = Math.max(1, Math.round((durationMs / 1000) * fps));
	if (!Number.isSafeInteger(count))
		throw new Error("Duration exceeds the safe frame range");
	return count;
}

export function assertFps(fps: number): void {
	if (!Number.isFinite(fps) || fps <= 0)
		throw new Error(`Invalid fps: ${fps}. Must be finite and > 0.`);
}

/** Resolve once, before hooks or rendering. atMs takes precedence over frame. */
export function resolveFrameRequest(
	request: { frame?: number; atMs?: number },
	fps: number,
): { frame: number; timeMs: number } {
	assertFps(fps);
	if (
		request.atMs !== undefined &&
		(!Number.isFinite(request.atMs) || request.atMs < 0)
	)
		throw new Error("atMs must be finite and nonnegative");
	const frame =
		request.atMs !== undefined
			? Math.round((request.atMs / 1000) * fps)
			: (request.frame ?? 0);
	if (!Number.isSafeInteger(frame) || frame < 0)
		throw new Error(
			`Invalid frame index: ${frame}. Must be a nonnegative safe integer.`,
		);
	const timeMs = (frame / fps) * 1000;
	if (!Number.isFinite(timeMs))
		throw new Error("Frame timestamp exceeds the finite range");
	return { frame, timeMs };
}
