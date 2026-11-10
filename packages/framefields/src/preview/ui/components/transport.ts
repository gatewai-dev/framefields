import { html, nothing } from "lit";
import { timecode } from "../format.js";
import { PreviewElement } from "./base.js";
import { statusChip } from "./header.js";
import * as icon from "./icons.js";

/** Frame stepping, play/pause, the time, the frame rate reached, notes and sound. */
export class PreviewTransport extends PreviewElement {
	override render() {
		const app = this.app;
		const fps = app?.meta?.fps ?? 30;
		const playing = !!app?.playing;
		const audio = app?.soundtrack;
		const usable = !!audio?.usable;
		const isMuted = !!audio?.muted;
		const playLabel = playing ? "Pause" : "Play";
		const muteLabel = isMuted ? "Unmute" : "Mute";
		return html`<div class="transport">
			<button
				class="icon-btn"
				title="Previous frame"
				aria-label="Previous frame"
				@click=${() => app?.step(-1)}
			>
				${icon.prev}
			</button>
			<button
				class="play-btn ${app?.stalled ? "loading" : ""}"
				title=${playLabel}
				aria-label=${playLabel}
				?disabled=${!app?.player}
				@click=${() => app?.togglePlay()}
			>
				${playing ? icon.pause : icon.play}${icon.spin}
			</button>
			<button
				class="icon-btn"
				title="Next frame"
				aria-label="Next frame"
				@click=${() => app?.step(1)}
			>
				${icon.next}
			</button>
			<div class="timecode tnum">
				<span class="now">${timecode(app?.frame ?? 0, fps)}</span><span class="dim">/</span
				><span class="dim">${timecode(app?.lastFrame ?? 0, fps)}</span>
				<span class="frame">frame ${app?.frame ?? 0}</span>
			</div>
			${this.#fps()}
			<span class="grow"></span>
			${
				// Embedded there is no header: say so here when sound isn't ready.
				app?.embedded && (app.offline || app.soundtrack.state !== "ready")
					? statusChip(app)
					: nothing
			}
			${app?.notesOn ? this.#notesButton() : nothing}
			<ff-notes-panel .app=${app}></ff-notes-panel>
			<button
				class="icon-btn"
				title=${muteLabel}
				aria-label=${muteLabel}
				?disabled=${!usable}
				@click=${() => audio?.setMuted(!audio.muted)}
			>
				${isMuted ? icon.muted : icon.volume}
			</button>
			<input
				class="slider"
				type="range"
				min="0"
				max="1"
				step="0.01"
				.value=${String(audio?.volume ?? 0.9)}
				style="--level:${(isMuted ? 0 : (audio?.volume ?? 0.9)) * 100}%"
				aria-label="Volume"
				?disabled=${!usable}
				@input=${(e: Event) =>
					audio?.setVolume(Number((e.target as HTMLInputElement).value))}
			/>
		</div>`;
	}

	// Distinct frames shown per second while playing; the last playback's while paused.
	#fps() {
		const app = this.app;
		const r = app?.fps;
		if (!r || (r.state === "paused" && r.fps === null)) return nothing;
		const title =
			(r.state === "paused"
				? "Frame rate the last playback reached"
				: "Frame rate playback reaches") +
			(app?.meta ? `; the film runs at ${app.meta.fps} fps` : "");
		return html`<span class="fps tnum" role="status" title=${title}
			>${r.fps === null ? "… fps" : `${r.fps.toFixed(1)} fps`}</span
		>`;
	}

	#notesButton() {
		const app = this.app;
		if (!app) return nothing;
		const open = app.openCount;
		return html`<button
			class="btn notes-btn"
			title="${open} open of ${app.notes.length}"
			aria-haspopup="dialog"
			aria-expanded=${String(app.panelOpen)}
			@click=${() => app.setPanel(!app.panelOpen)}
		>
			${icon.notes}<span class="label">Notes</span>
			<span class="badge ${open > 0 ? "open" : ""}">${open || app.notes.length}</span>
		</button>`;
	}
}
