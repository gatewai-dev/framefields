import { LitElement, type PropertyValues } from "lit";
import type { PreviewApp } from "../app.js";

/**
 * An element of the preview page: renders from the page's `PreviewApp` and
 * again whenever it changes. Rendered into the light DOM, so the page's one
 * stylesheet applies and the player finds its canvas by id.
 */
export class PreviewElement extends LitElement {
	static override properties = { app: { attribute: false } };
	declare app: PreviewApp | undefined;
	#off: (() => void) | undefined;

	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#subscribe();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#off?.();
		this.#off = undefined;
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		if (changed.has("app")) this.#subscribe();
	}

	#subscribe(): void {
		this.#off?.();
		this.#off = this.app?.subscribe(() => this.requestUpdate());
	}
}
