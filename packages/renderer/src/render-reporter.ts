import { rendererLogger } from "./logger.js";

/**
 * Stages of `renderVideo`, in order. Audio-only renders skip "render";
 * "convert" runs only for GIF output.
 */
export type RenderPhase =
	| "prepare"
	| "render"
	| "audio"
	| "audio-encode"
	| "mux"
	| "convert"
	| "done";

/** Progress reported by `renderVideo({ onProgress })`. */
export interface RenderProgress {
	/**
	 * "prepare" loads fonts and warms the pipeline, "render" draws and encodes
	 * frames, "audio" mixes the soundtrack, "audio-encode" encodes it, "mux"
	 * writes the container, "convert" makes the GIF, "done" is the last event.
	 */
	phase: RenderPhase;
	/** Frames finished so far (1-based); `totalFrames` once frames are done. */
	frame: number;
	totalFrames: number;
	/** Time since the render started. */
	elapsedMs: number;
	/** Share of the current phase done (0–1), when it can be measured. */
	phaseProgress?: number;
	/** Frames per second so far ("render" only). */
	fps?: number;
	/** Estimated seconds until the frames are done ("render" only). */
	etaSec?: number;
	/** What the phase is working on, e.g. "3/7 sources: music.mp3". */
	detail?: string;
}

interface ReporterLog {
	info(obj: object, msg: string): void;
	debug(obj: object, msg: string): void;
	warn(obj: object, msg: string): void;
	error(obj: object, msg: string): void;
}

interface RenderReporterOptions {
	renderId: string;
	totalFrames: number;
	onProgress?: (progress: RenderProgress) => void;
	/** Percent step between frame log lines (default 10). */
	milestonePercent?: number;
	log?: ReporterLog;
	now?: () => number;
}

const LOG_PREFIX = "[HeadlessWebGPURenderer]";
/** A milestone reached sooner than this after the last line is not logged. */
const MIN_LOG_GAP_MS = 1000;
/**
 * Quiet time before the first "still …" line of a phase. Each one doubles it
 * up to the cap, so a long phase adds a few lines rather than one a minute.
 */
const HEARTBEAT_FIRST_MS = 10_000;
const HEARTBEAT_MAX_MS = 5 * 60_000;

const ACTIVITY: Record<RenderPhase, string> = {
	prepare: "preparing",
	render: "rendering",
	audio: "mixing audio",
	"audio-encode": "encoding audio",
	mux: "muxing",
	convert: "converting to GIF",
	done: "finishing",
};

/**
 * Reports a render's progress to the log and to `onProgress`.
 *
 * The log stays short whatever the length of the film, so it fits an agent's
 * context: one line per phase, frame lines only at percent milestones, and a
 * "still …" line when a phase goes quiet, backing off from 10 s to 5 min.
 * `onProgress` gets every update; the "still …" lines are log-only, so a stall
 * detector fed by `onProgress` still sees a hang.
 */
export class RenderReporter {
	private readonly renderId: string;
	private readonly totalFrames: number;
	private readonly onProgress?: (progress: RenderProgress) => void;
	private readonly milestonePercent: number;
	private readonly log: ReporterLog;
	private readonly now: () => number;
	private readonly startedAt: number;
	private readonly phaseMs = new Map<RenderPhase, number>();

	private phase: RenderPhase = "prepare";
	private phaseStartedAt: number;
	private frame = 0;
	private phaseProgress?: number;
	private detail?: string;
	private lastMilestone = 0;
	/** Last phase or milestone line; "still …" lines don't count. */
	private lastLogAt: number;
	private heartbeatMs = HEARTBEAT_FIRST_MS;
	private heartbeat?: ReturnType<typeof setTimeout>;

	constructor(options: RenderReporterOptions) {
		this.renderId = options.renderId;
		this.totalFrames = options.totalFrames;
		this.onProgress = options.onProgress;
		this.milestonePercent = options.milestonePercent ?? 10;
		this.log = options.log ?? rendererLogger;
		this.now = options.now ?? (() => performance.now());
		this.startedAt = this.now();
		this.phaseStartedAt = this.startedAt;
		this.lastLogAt = this.startedAt;
	}

	/** Starts a phase: logs `message` and emits a progress event. */
	stage(phase: RenderPhase, message: string, fields: object = {}): void {
		this.closePhase();
		this.phase = phase;
		this.phaseProgress = undefined;
		this.detail = undefined;
		this.heartbeatMs = HEARTBEAT_FIRST_MS;
		if (phase !== "render" && phase !== "prepare")
			this.frame = this.totalFrames;
		this.info(message, fields);
		this.emit();
	}

	/** Records a finished frame; logs at each milestone. */
	frameDone(frame: number): void {
		this.frame = frame;
		const percent = (frame / this.totalFrames) * 100;
		const milestone =
			frame >= this.totalFrames
				? 100
				: Math.floor(percent / this.milestonePercent) * this.milestonePercent;
		const { fps, etaSec } = this.rate();
		if (milestone > this.lastMilestone) {
			this.lastMilestone = milestone;
			if (milestone === 100 || this.now() - this.lastLogAt >= MIN_LOG_GAP_MS) {
				const tail =
					milestone === 100
						? `in ${formatDuration(this.now() - this.phaseStartedAt)}`
						: `eta ${formatDuration(etaSec * 1000)}`;
				this.info(
					`Rendered ${milestone}% (${frame}/${this.totalFrames} frames) · ${fps.toFixed(1)} fps · ${tail}`,
					{ fps: round1(fps), etaSec },
				);
			}
		}
		this.emit({ fps: round1(fps), etaSec });
	}

	/** Updates what the current phase is doing; shown in "still …" lines. */
	update(detail: string | undefined, phaseProgress?: number): void {
		this.detail = detail;
		this.phaseProgress = phaseProgress;
		this.emit();
	}

	/** Logs the summary and emits the "done" event. */
	finish(fields: { bytes?: number } = {}): void {
		this.closePhase();
		this.phase = "done";
		this.frame = this.totalFrames;
		this.stopHeartbeat();
		const total = this.now() - this.startedAt;
		const parts = [...this.phaseMs].map(
			([phase, ms]) => `${phase} ${formatDuration(ms)}`,
		);
		const size =
			fields.bytes !== undefined ? ` (${formatBytes(fields.bytes)})` : "";
		this.log.info(
			{
				renderId: this.renderId,
				phase: "done",
				elapsedMs: Math.round(total),
				phaseMs: Object.fromEntries(
					[...this.phaseMs].map(([phase, ms]) => [phase, Math.round(ms)]),
				),
				...fields,
			},
			`${LOG_PREFIX} Done in ${formatDuration(total)}${size}: ${parts.join(" · ")}`,
		);
		this.emit();
	}

	/** Logs which phase the render stopped in. */
	fail(error: unknown, aborted: boolean): void {
		this.stopHeartbeat();
		const elapsed = formatDuration(this.now() - this.startedAt);
		const fields = {
			renderId: this.renderId,
			phase: this.phase,
			frame: this.frame,
			totalFrames: this.totalFrames,
			elapsedMs: Math.round(this.now() - this.startedAt),
		};
		if (aborted) {
			this.log.warn(
				fields,
				`${LOG_PREFIX} Aborted while ${ACTIVITY[this.phase]} after ${elapsed}`,
			);
		} else {
			this.log.error(
				{ ...fields, err: error },
				`${LOG_PREFIX} Failed while ${ACTIVITY[this.phase]} after ${elapsed}`,
			);
		}
	}

	/** Stops the "still …" timer. Safe to call more than once. */
	dispose(): void {
		this.stopHeartbeat();
	}

	private closePhase(): void {
		const now = this.now();
		this.phaseMs.set(
			this.phase,
			(this.phaseMs.get(this.phase) ?? 0) + (now - this.phaseStartedAt),
		);
		this.phaseStartedAt = now;
	}

	private rate(): { fps: number; etaSec: number } {
		const seconds = Math.max(0.001, (this.now() - this.phaseStartedAt) / 1000);
		const fps = this.frame / seconds;
		const etaSec = Math.round(
			(this.totalFrames - this.frame) / Math.max(fps, 0.001),
		);
		return { fps, etaSec };
	}

	private info(message: string, fields: object = {}): void {
		this.log.info(
			{
				renderId: this.renderId,
				phase: this.phase,
				frame: this.frame,
				totalFrames: this.totalFrames,
				...fields,
			},
			`${LOG_PREFIX} ${message}`,
		);
		this.lastLogAt = this.now();
		this.armHeartbeat();
	}

	private emit(extra: Partial<RenderProgress> = {}): void {
		this.onProgress?.({
			phase: this.phase,
			frame: this.frame,
			totalFrames: this.totalFrames,
			elapsedMs: Math.round(this.now() - this.startedAt),
			...(this.phaseProgress !== undefined && {
				phaseProgress: this.phaseProgress,
			}),
			...(this.detail !== undefined && { detail: this.detail }),
			...extra,
		});
	}

	private armHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeat = setTimeout(() => this.beat(), this.heartbeatMs);
		// Never keeps the process alive on its own.
		this.heartbeat.unref?.();
	}

	private beat(): void {
		const inPhase = formatDuration(this.now() - this.phaseStartedAt);
		let what = "";
		if (this.phase === "render") {
			what = ` (frame ${this.frame}/${this.totalFrames})`;
		} else if (this.detail || this.phaseProgress !== undefined) {
			const pct =
				this.phaseProgress !== undefined
					? `${Math.floor(this.phaseProgress * 100)}%`
					: "";
			what = ` (${[pct, this.detail].filter(Boolean).join(", ")})`;
		}
		this.log.info(
			{
				renderId: this.renderId,
				phase: this.phase,
				frame: this.frame,
				totalFrames: this.totalFrames,
			},
			`${LOG_PREFIX} Still ${ACTIVITY[this.phase]}${what}, ${inPhase} in this phase`,
		);
		this.heartbeatMs = Math.min(this.heartbeatMs * 2, HEARTBEAT_MAX_MS);
		this.armHeartbeat();
	}

	private stopHeartbeat(): void {
		if (this.heartbeat) clearTimeout(this.heartbeat);
		this.heartbeat = undefined;
	}
}

/** "4.2s", "2m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
	const s = Math.max(0, ms) / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const total = Math.round(s);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const sec = total % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	return `${m}m ${String(sec).padStart(2, "0")}s`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
