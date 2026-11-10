import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import {
	clampFrame,
	framePercent,
	markLanes,
	rulerTicks,
	timecode,
} from "../format.js";
import { AUDIO_LABEL } from "../soundtrack.js";
import { PreviewElement } from "./base.js";

/** Bars of the waveform are this far apart, in CSS px. */
const BAR_STEP = 3;

/**
 * The film's time: a ruler, the soundtrack's waveform, a mark per note and
 * the playhead. Click or drag to seek.
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

	override connectedCallback(): void {
		super.connectedCallback();
		this.updateComplete.then(() => {
			const inner = this.#inner();
			if (inner) this.#resize.observe(inner);
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#resize.disconnect();
	}

	override render() {
		const app = this.app;
		const meta = app?.meta;
		const frameCount = meta?.frameCount ?? 1;
		const fps = meta?.fps ?? 30;
		const hover =
			this.#hoverX === null
				? null
				: this.#frameAt(this.#hoverX / Math.max(1, this.#width));
		return html`<div
			class="timeline"
			aria-label="Timeline"
			@pointerdown=${this.#down}
			@pointermove=${this.#move}
			@pointerleave=${this.#leave}
			@pointerup=${this.#end}
			@pointercancel=${this.#end}
		>
			<div class="tl-inner">
				<div class="ruler">
					${
						meta
							? rulerTicks((frameCount - 1) / fps, this.#width).map(
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
				<div class="note-marks">${this.#marks()}</div>
				<div class="wave-lane">
					<canvas></canvas>
					${this.#waveState()}
				</div>
				<div
					class="hover-line"
					style=${styleMap(
						this.#hoverX === null
							? {}
							: { display: "block", left: `${this.#hoverX}px` },
					)}
				></div>
				<div
					class="hover-time"
					style=${styleMap(
						this.#hoverX === null
							? {}
							: { display: "block", left: `${this.#hoverX}px` },
					)}
				>
					${hover === null ? "" : timecode(hover, fps)}
				</div>
				<div
					class="playhead"
					style="left:${framePercent(app?.frame ?? 0, frameCount)}%"
				></div>
			</div>
		</div>`;
	}

	protected override updated(): void {
		this.#drawWave(false);
	}

	#inner(): HTMLElement | null {
		return this.querySelector(".tl-inner");
	}

	#marks() {
		const app = this.app;
		const meta = app?.meta;
		if (!app || !meta) return nothing;
		return markLanes(app.notes, meta.frameCount, this.#width).map(
			({ note: n, lane, left }) => html`<button
				class="note-mark ${n.done ? "done" : ""} ${lane ? "stacked" : ""}"
				style="left:${left}%;top:${4 + lane * 15}px"
				title="${n.id} · ${timecode(n.frame, meta.fps)} · ${n.text}"
				@pointerdown=${(e: Event) => e.stopPropagation()}
				@click=${(e: Event) => {
					e.stopPropagation();
					app.goToNote(n.id);
				}}
			>
				${n.id}
			</button>`,
		);
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
		const canvas = this.querySelector<HTMLCanvasElement>(".wave-lane canvas");
		if (!app || !canvas) return;
		const audio = app.soundtrack;
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		const key = `${audio.peaksVersion}:${w}x${h}@${dpr}:${app.meta?.frameCount}:${audio.durationSec}`;
		if (!force && key === this.#drawn) return;
		this.#drawn = key;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const peaks = audio.peaks;
		const meta = app.meta;
		if (!peaks?.length || !meta) return;
		const videoSec = Math.max(1e-6, (meta.frameCount - 1) / meta.fps);
		const audioSec = audio.durationSec ?? videoSec;
		const spanPx = Math.min(1, audioSec / videoSec) * w;
		const mid = h / 2;
		ctx.fillStyle = getComputedStyle(document.documentElement)
			.getPropertyValue("--wave")
			.trim();
		for (let x = 0; x < spanPx; x += BAR_STEP) {
			const v = Math.max(
				peaks[Math.floor((x / spanPx) * peaks.length)] || 0,
				0.015,
			);
			const bh = Math.max(1, Math.sqrt(v) * (h - 8));
			ctx.fillRect(x, mid - bh / 2, 2, bh);
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
	};
}
