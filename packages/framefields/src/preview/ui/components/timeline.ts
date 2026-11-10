import { html, nothing } from "lit";
import {
	clampFrame,
	framePercent,
	markLanes,
	rulerTicks,
	timecode,
} from "../format.js";
import { AUDIO_LABEL } from "../soundtrack.js";
import { PreviewElement } from "./base.js";
import { waveformPath } from "./waveform.js";

/** Width of the time labels on the ruler (the playhead's and the pointer's). */
const LABEL_W = 64;

/**
 * The film's time: a ruler, a lane of note markers, the soundtrack's
 * waveform and the playhead with its time. Click or drag to scrub; the
 * keyboard works from anywhere on the page (see `PreviewApp.key`).
 */
export class PreviewTimeline extends PreviewElement {
	#width = 800;
	#hoverX: number | null = null;
	#dragging = false;
	#drawn = "";
	#resize = new ResizeObserver(() => {
		const width = this.#inner()?.clientWidth;
		if (width && width !== this.#width) {
			this.#width = width;
			this.requestUpdate();
		}
		this.#drawWave(true);
	});

	// The waveform's colours come from the theme: redraw when it flips.
	#scheme = window.matchMedia?.("(prefers-color-scheme: light)");
	#recolor = () => this.#drawWave(true);

	override connectedCallback(): void {
		super.connectedCallback();
		this.#scheme?.addEventListener("change", this.#recolor);
		this.updateComplete.then(() => {
			const inner = this.#inner();
			if (inner) this.#resize.observe(inner);
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#resize.disconnect();
		this.#scheme?.removeEventListener("change", this.#recolor);
	}

	override render() {
		const app = this.app;
		const meta = app?.meta;
		const frameCount = meta?.frameCount ?? 1;
		const fps = meta?.fps ?? 30;
		const frame = app?.frame ?? 0;
		const at = framePercent(frame, frameCount);
		const durationSec = (frameCount - 1) / fps;
		return html`<div
			class="timeline"
			role="slider"
			tabindex="0"
			aria-label="Timeline"
			aria-valuemin="0"
			aria-valuemax=${durationSec.toFixed(3)}
			aria-valuenow=${(frame / fps).toFixed(3)}
			aria-valuetext="${timecode(frame, fps)}, frame ${frame}"
			@pointerdown=${this.#down}
			@pointermove=${this.#move}
			@pointerleave=${this.#leave}
			@pointerup=${this.#end}
			@pointercancel=${this.#end}
		>
			<div class="tl-inner" style="--track-w:${this.#width}px">
				<div class="ruler">
					${
						meta
							? rulerTicks(durationSec, this.#width).map(
									(t) =>
										html`<div
											class="tick ${t.major ? "major" : ""}"
											style="left:${t.left}%"
										>
											${t.label ? html`<span>${t.label}</span>` : nothing}
										</div>`,
								)
							: nothing
					}
				</div>
				${this.#marks()}
				<div class="wave">
					<canvas class="wave-base"></canvas>
					<div class="wave-played" style="width:${at}%">
						<canvas></canvas>
					</div>
					${this.#waveState()}
				</div>
				${this.#hover(fps)}
				<div class="playhead" style="left:${at}%"></div>
				<div class="playhead-time" style="left:${this.#labelX((at / 100) * this.#width)}px">
					${timecode(frame, fps)}
				</div>
			</div>
		</div>`;
	}

	protected override updated(): void {
		this.#drawWave(false);
	}

	#inner(): HTMLElement | null {
		return this.querySelector(".tl-inner");
	}

	/** A label's centre, kept inside the track. */
	#labelX(x: number): number {
		const half = LABEL_W / 2;
		return Math.max(half, Math.min(Math.max(half, this.#width - half), x));
	}

	#hover(fps: number) {
		const x = this.#hoverX;
		if (x === null || this.#dragging) return nothing;
		const f = this.#frameAt(x / Math.max(1, this.#width));
		return html`<div class="hover-line" style="left:${x}px"></div>
			<div class="hover-time" style="left:${this.#labelX(x)}px">
				${timecode(f, fps)}
			</div>`;
	}

	#marks() {
		const app = this.app;
		const meta = app?.meta;
		if (!app?.notesOn || !meta) return nothing;
		const marks = markLanes(app.notes, meta.frameCount, this.#width);
		const lanes = Math.max(1, ...marks.map((m) => m.lane + 1));
		return html`<div class="marks" style="--lanes:${lanes}">
			${marks.map(({ note: n, lane, left }) => {
				const cls = [
					"note-mark",
					n.done ? "done" : "",
					n.id === app.openId ? "active" : "",
				];
				return html`<button
					class=${cls.join(" ")}
					style="left:${left}%;top:${lane * 20}px"
					title="${n.id} · ${timecode(n.frame, meta.fps)} · ${n.text}"
					aria-label="Note ${n.id} at ${timecode(n.frame, meta.fps)}"
					@pointerdown=${(e: Event) => e.stopPropagation()}
					@click=${(e: Event) => {
						e.stopPropagation();
						app.goToNote(n.id);
					}}
				>
					${n.id}
				</button>`;
			})}
		</div>`;
	}

	#waveState() {
		const state = this.app?.soundtrack.state ?? "mixing";
		if (state === "ready") return nothing;
		const busy = state === "mixing" || state === "loading";
		const text =
			state === "none"
				? "No audio in this composition"
				: state === "error"
					? "Audio could not be mixed"
					: AUDIO_LABEL[state];
		return html`<div class="wave-state ${busy ? "shimmer" : ""}">
			${busy ? html`<span class="spinner"></span>` : nothing}${text}
		</div>`;
	}

	/** Redraws the waveform when its peaks, size or the film changed. */
	#drawWave(force: boolean): void {
		const app = this.app;
		const base = this.querySelector<HTMLCanvasElement>(".wave-base");
		const played = this.querySelector<HTMLCanvasElement>(".wave-played canvas");
		if (!app || !base || !played) return;
		const audio = app.soundtrack;
		const dpr = window.devicePixelRatio || 1;
		const w = this.#width;
		const h = base.clientHeight;
		const key = `${audio.peaksVersion}:${w}x${h}@${dpr}:${app.meta?.frameCount}:${audio.durationSec}`;
		if (!force && key === this.#drawn) return;
		this.#drawn = key;
		const meta = app.meta;
		const peaks = audio.peaks;
		const videoSec = meta
			? Math.max(1e-6, (meta.frameCount - 1) / meta.fps)
			: 1;
		const span = Math.min(1, (audio.durationSec ?? videoSec) / videoSec) * w;
		const styles = getComputedStyle(this);
		for (const [canvas, color] of [
			[base, styles.getPropertyValue("--wave")],
			[played, styles.getPropertyValue("--wave-played")],
		] as const) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			const ctx = canvas.getContext("2d");
			if (!ctx) continue;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);
			if (!peaks?.length || !meta) continue;
			ctx.fillStyle = color.trim();
			ctx.fill(new Path2D(waveformPath(peaks, span, h)));
		}
	}

	#frameAt(fraction: number): number {
		const frameCount = this.app?.meta?.frameCount ?? 1;
		return clampFrame(
			Math.min(1, Math.max(0, fraction)) * (frameCount - 1),
			frameCount,
		);
	}

	#fractionAt(clientX: number): number {
		const r = this.#inner()?.getBoundingClientRect();
		return r ? (clientX - r.left) / r.width : 0;
	}

	#down = (e: PointerEvent) => {
		if (!this.app?.meta || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		this.#dragging = true;
		void this.app.seek(this.#frameAt(this.#fractionAt(e.clientX)));
	};

	#move = (e: PointerEvent) => {
		const app = this.app;
		if (!app?.meta) return;
		const r = this.#inner()?.getBoundingClientRect();
		if (!r) return;
		this.#hoverX = Math.min(r.width, Math.max(0, e.clientX - r.left));
		const f = this.#frameAt(this.#fractionAt(e.clientX));
		if (this.#dragging && f !== app.frame) void app.seek(f);
		this.requestUpdate();
	};

	#leave = () => {
		this.#hoverX = null;
		this.requestUpdate();
	};

	#end = () => {
		this.#dragging = false;
		this.requestUpdate();
	};
}
