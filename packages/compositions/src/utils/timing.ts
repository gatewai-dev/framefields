export function framesToSeconds(frames: number, fps: number): number {
	return frames / fps;
}

export function secondsToFrames(seconds: number, fps: number): number {
	return Math.round(seconds * fps);
}

export function formatTimecode(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 100);
	return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
