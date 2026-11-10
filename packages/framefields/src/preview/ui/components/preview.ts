import { html, nothing } from "lit";
import { PreviewElement } from "./base.js";

/** Where keys belong to what has focus, not to the page. */
const TYPING = "input, textarea, select, [contenteditable]";

/**
 * The whole page: header, picture, transport and timeline, and the note
 * popover, all drawn from the page's `PreviewApp` (set as `.app`).
 * Embedded (`?embed=1`) it drops the header: the app shows the project.
 */
export class PreviewPage extends PreviewElement {
	override connectedCallback(): void {
		super.connectedCallback();
		document.addEventListener("pointerdown", this.#outside);
		document.addEventListener("keydown", this.#keydown);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		document.removeEventListener("pointerdown", this.#outside);
		document.removeEventListener("keydown", this.#keydown);
	}

	override render() {
		const app = this.app;
		document.documentElement.toggleAttribute("data-embed", !!app?.embedded);
		return html`${app?.embedded ? nothing : html`<ff-header .app=${app}></ff-header>`}
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

	#keydown = (e: KeyboardEvent) => {
		const app = this.app;
		if (!app) return;
		if (e.key === "Escape") {
			if (app.openId != null) app.closePop();
			app.setPanel(false);
			return;
		}
		const target = e.target as Element | null;
		if (e.metaKey || e.ctrlKey || e.altKey || target?.closest(TYPING)) return;
		// A focused button takes Space and Enter itself.
		if (target?.closest("button") && (e.key === " " || e.key === "Enter"))
			return;
		if (app.key(e)) e.preventDefault();
	};
}
