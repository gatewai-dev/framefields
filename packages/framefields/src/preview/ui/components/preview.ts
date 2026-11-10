import { html } from "lit";
import { PreviewElement } from "./base.js";

/**
 * The whole page: header, picture, transport and timeline, and the note
 * popover, all drawn from the page's `PreviewApp` (set as `.app`).
 */
export class PreviewPage extends PreviewElement {
	override connectedCallback(): void {
		super.connectedCallback();
		document.addEventListener("pointerdown", this.#outside);
		document.addEventListener("keydown", this.#escape);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		document.removeEventListener("pointerdown", this.#outside);
		document.removeEventListener("keydown", this.#escape);
	}

	override render() {
		const app = this.app;
		return html`<ff-header .app=${app}></ff-header>
			<main class="player" aria-label="Player">
				<ff-stage .app=${app}></ff-stage>
				<ff-transport .app=${app}></ff-transport>
				<ff-timeline .app=${app}></ff-timeline>
			</main>
			<ff-note-editor .app=${app}></ff-note-editor>`;
	}

	// A press outside the popover closes it (a draft only while it's empty),
	// and outside the notes panel closes that.
	#outside = (e: PointerEvent) => {
		const app = this.app;
		const target = e.target as Element | null;
		if (!app || !target) return;
		const pop = this.querySelector(".pop");
		const stage = this.querySelector("ff-stage");
		const inPop = !!pop?.contains(target) || !!stage?.contains(target);
		if (
			pop?.classList.contains("on") &&
			!inPop &&
			!target.closest(".note-mark, .note-row")
		) {
			if (app.openId != null) app.closePop();
			else if (app.draft && !app.draft.text.trim()) app.cancelDraft();
		}
		const panel = this.querySelector(".notes-panel");
		const button = this.querySelector(".notes-btn");
		if (app.panelOpen && !panel?.contains(target) && !button?.contains(target))
			app.setPanel(false);
	};

	#escape = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || !this.app) return;
		if (this.app.openId != null) this.app.closePop();
		this.app.setPanel(false);
	};
}
