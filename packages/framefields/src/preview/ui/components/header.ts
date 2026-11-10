import { html } from "lit";
import { timecode } from "../format.js";
import { AUDIO_LABEL } from "../soundtrack.js";
import { PreviewElement } from "./base.js";
import { logo } from "./icons.js";

/** The top bar: the film's title and size, and the soundtrack's (or server's) state. */
export class PreviewHeader extends PreviewElement {
	override render() {
		const app = this.app;
		const meta = app?.meta;
		return html`<header class="top">
			<svg class="logo" viewBox="0 0 512 512" aria-label="framefields" role="img">${logo}</svg>
			<span class="sep" aria-hidden="true"></span>
			<h1>${meta?.title ?? "framefields preview"}</h1>
			<span class="grow"></span>
			<span class="spec tnum"
				>${meta ? `${meta.width}×${meta.height} · ${meta.fps} fps · ${timecode(meta.frameCount - 1, meta.fps)}` : ""}</span
			>
			${this.#chip()}
		</header>`;
	}

	#chip() {
		const app = this.app;
		const audio = app?.soundtrack;
		if (app?.offline) {
			return html`<span
				class="chip"
				data-state="offline"
				role="status"
				aria-live="polite"
				title="The preview command isn't running. This tab reconnects when it starts again."
				><span class="dot"></span><span>Preview stopped</span></span
			>`;
		}
		const state = audio?.state ?? "mixing";
		const busy = state === "mixing" || state === "loading";
		return html`<span
			class="chip"
			data-state=${state}
			role="status"
			aria-live="polite"
			title=${audio?.error ?? ""}
			><span class=${busy ? "spinner" : "dot"}></span
			><span>${AUDIO_LABEL[state]}</span></span
		>`;
	}
}
