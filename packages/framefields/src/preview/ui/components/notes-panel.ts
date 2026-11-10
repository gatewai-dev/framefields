import { html } from "lit";
import { byFrame, openNotesText, timecode } from "../format.js";
import { PreviewElement } from "./base.js";
import * as icon from "./icons.js";

/** Every note, by time: go to one, mark it done, or copy the open ones for a chat. */
export class PreviewNotesPanel extends PreviewElement {
	#copied = false;

	override render() {
		const app = this.app;
		if (!app) return html``;
		const fps = app.meta?.fps ?? 30;
		const notes = [...app.notes].sort(byFrame);
		return html`<div
			class="notes-panel ${app.panelOpen ? "on" : ""}"
			role="dialog"
			aria-label="Notes"
		>
			<div class="np-head">
				<h2>Notes</h2>
				<span class="grow"></span>
				<button
					class="btn"
					title="Copy the open notes, to paste into a chat"
					?disabled=${app.openCount === 0}
					@click=${this.#copy}
				>
					${icon.copy}<span>${this.#copied ? "Copied" : "Copy"}</span>
				</button>
				<button
					class="btn x-btn"
					title="Close"
					aria-label="Close"
					@click=${() => app.setPanel(false)}
				>
					${icon.close}
				</button>
			</div>
			<div class="np-list">
				${
					notes.length
						? notes.map((n) => {
								const label = n.done ? "Reopen" : "Mark done";
								return html`<div
									class="note-row ${n.done ? "done" : ""}"
									@click=${() => app.goToNote(n.id)}
								>
									<span class="badge ${n.done ? "done" : ""}">${n.id}</span>
									<div>
										<div class="when tnum">
											${timecode(n.frame, fps)} · frame ${n.frame}
										</div>
										<div class="text">${n.text}</div>
									</div>
									<button
										class="check ${n.done ? "on" : ""}"
										title=${label}
										aria-label=${label}
										@click=${(e: Event) => {
											e.stopPropagation();
											app.setDone(n.id, !n.done);
										}}
									>
										${icon.check}
									</button>
								</div>`;
							})
						: html`<div class="np-empty">
								Pause and click the picture to pin a note to that spot and
								moment. Drag to mark an area.
							</div>`
				}
			</div>
		</div>`;
	}

	#copy = async () => {
		const app = this.app;
		if (!app?.meta) return;
		const text = openNotesText(app.meta.title, app.notes, app.meta.fps);
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// No clipboard API (or no permission): copy through a selection.
			const t = document.createElement("textarea");
			t.value = text;
			document.body.append(t);
			t.select();
			const ok = document.execCommand("copy");
			t.remove();
			if (!ok) return;
		}
		this.#copied = true;
		this.requestUpdate();
		setTimeout(() => {
			this.#copied = false;
			this.requestUpdate();
		}, 1600);
	};
}
