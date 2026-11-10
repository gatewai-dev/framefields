import { html, nothing } from "lit";
import { type PositionMode, positionText } from "../format.js";
import { readPref, writePref } from "../prefs.js";
import { AUDIO_LABEL } from "../soundtrack.js";
import { PreviewElement } from "./base.js";
import { offlineChip } from "./header.js";
import * as icon from "./icons.js";

const MODES: readonly PositionMode[] = ["time", "frames"];

/**
 * Frame stepping, play/pause, the position (as time or frames: click to
 * switch), the frame rate reached, notes, and sound.
 */
export class PreviewTransport extends PreviewElement {
	#mode: PositionMode = readPref("position", MODES, "time");

	override render() {
		const app = this.app;
		const playing = !!app?.playing;
		const playLabel = playing ? "Pause" : "Play";
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
			${this.#position()} ${this.#fps()}
			<span class="grow"></span>
			${app?.embedded ? offlineChip(app) : nothing}
			${app?.notesOn ? this.#notesButton() : nothing}
			<ff-notes-panel .app=${app}></ff-notes-panel>
			${this.#sound()}
		</div>`;
	}

	/** Mode the position readout shows; persisted per viewer. */
	get positionMode(): PositionMode {
		return this.#mode;
	}

	#position() {
		const app = this.app;
		const fps = app?.meta?.fps ?? 30;
		const frame = app?.frame ?? 0;
		const last = app?.lastFrame ?? 0;
		const { now, end } = positionText(this.#mode, frame, last, fps);
		const other = this.#mode === "time" ? "frames" : "time";
		const label = `${this.#mode === "time" ? `Time ${now} of ${end}` : `Frame ${now} of ${end}`}. Click to show ${other}.`;
		return html`<button
			class="position tnum"
			title="Click to show ${other}"
			aria-label=${label}
			@click=${() => {
				this.#mode = other;
				writePref("position", other);
				this.requestUpdate();
			}}
		>
			<span class="now">${now}</span><span class="dim"> / ${end}</span>
		</button>`;
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
		const label = `Notes: ${open} open of ${app.notes.length}`;
		return html`<button
			class="btn notes-btn"
			title=${label}
			aria-label=${label}
			aria-haspopup="dialog"
			aria-expanded=${String(app.panelOpen)}
			@click=${() => app.setPanel(!app.panelOpen)}
		>
			${icon.notes}
			<span class="badge ${open > 0 ? "open" : ""}">${open || app.notes.length}</span>
		</button>`;
	}

	/**
	 * The speaker toggles mute; its slider opens on hover or focus (always
	 * shown at wide widths). When there's no sound, or it failed, the speaker
	 * is crossed out and says why; while it mixes it waits.
	 */
	#sound() {
		const audio = this.app?.soundtrack;
		if (!audio) return nothing;
		const usable = audio.usable;
		const isMuted = audio.muted;
		const problem =
			audio.state === "none"
				? "No audio in this composition"
				: audio.state === "error"
					? `Audio failed${audio.error ? `: ${audio.error}` : ""}`
					: null;
		const label =
			problem ??
			(usable ? (isMuted ? "Unmute" : "Mute") : `${AUDIO_LABEL[audio.state]}…`);
		const level = (isMuted ? 0 : audio.volume) * 100;
		return html`<div class="volume ${usable ? "usable" : ""} ${problem ? "problem" : ""}">
			<button
				class="icon-btn"
				title=${label}
				aria-label=${label}
				aria-disabled=${String(!usable)}
				@click=${() => {
					if (usable) audio.setMuted(!audio.muted);
				}}
			>
				${problem || isMuted ? icon.muted : icon.volume}
			</button>
			${
				usable
					? html`<span class="slider-wrap"><input
							class="slider"
							type="range"
							min="0"
							max="1"
							step="0.01"
							.value=${String(audio.volume)}
							style="--level:${level}%"
							aria-label="Volume"
							@input=${(e: Event) =>
								audio.setVolume(Number((e.target as HTMLInputElement).value))}
						/></span>`
					: nothing
			}
		</div>`;
	}
}
