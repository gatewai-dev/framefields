/**
 * The preview page's elements. `defineElements` registers them (once); the
 * modules themselves have no side effects.
 */
import { PreviewHeader } from "./header.js";
import { PreviewNoteEditor } from "./note-editor.js";
import { PreviewNotesPanel } from "./notes-panel.js";
import { PreviewPage } from "./preview.js";
import { PreviewStage } from "./stage.js";
import { PreviewTimeline } from "./timeline.js";
import { PreviewTransport } from "./transport.js";

export {
	PreviewHeader,
	PreviewStage,
	PreviewTransport,
	PreviewTimeline,
	PreviewNotesPanel,
	PreviewNoteEditor,
	PreviewPage,
};

const ELEMENTS = {
	"ff-header": PreviewHeader,
	"ff-stage": PreviewStage,
	"ff-transport": PreviewTransport,
	"ff-timeline": PreviewTimeline,
	"ff-notes-panel": PreviewNotesPanel,
	"ff-note-editor": PreviewNoteEditor,
	"ff-preview": PreviewPage,
} as const;

export function defineElements(
	registry: CustomElementRegistry = customElements,
): void {
	for (const [tag, element] of Object.entries(ELEMENTS)) {
		if (!registry.get(tag)) registry.define(tag, element);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"ff-header": PreviewHeader;
		"ff-stage": PreviewStage;
		"ff-transport": PreviewTransport;
		"ff-timeline": PreviewTimeline;
		"ff-notes-panel": PreviewNotesPanel;
		"ff-note-editor": PreviewNoteEditor;
		"ff-preview": PreviewPage;
	}
}
