import { html, nothing } from "lit";
import type { PreviewApp } from "../app.js";
import { timecode } from "../format.js";
import { PreviewElement } from "./base.js";
import { logo } from "./icons.js";

/**
 * Shown only when something is wrong with the page itself: the preview
 * command stopped. Sound problems are on the speaker button.
 */
export function offlineChip(app: PreviewApp | undefined) {
	if (!app?.offline) return nothing;
	return html`<span
		class="chip"
		data-state="offline"
		role="status"
		aria-live="polite"
		title="The preview command isn't running. This tab reconnects when it starts again."
		><span class="dot"></span><span>Preview stopped</span></span
	>`;
}

/** The top bar: the brand, the film's title and size. Not shown embedded. */
export class PreviewHeader extends PreviewElement {
	override render() {
		const app = this.app;
		const meta = app?.meta;
		return html`<header class="top">
			<svg class="logo" viewBox="0 0 512 512" aria-label="framefields" role="img">${logo}</svg>
			<h1>${meta?.title ?? "framefields preview"}</h1>
			<span class="grow"></span>
			<span class="spec tnum"
				>${meta ? `${meta.width}×${meta.height} · ${meta.fps} fps · ${timecode(meta.frameCount - 1, meta.fps)}` : ""}</span
			>
			${offlineChip(app)}
		</header>`;
	}
}
