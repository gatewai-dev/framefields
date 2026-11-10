/**
 * The preview page's entry, bundled with its styles into `main.js` and
 * `main.css` (see `buildPage` in ../bundle.ts). The project's own bundle,
 * loaded after this, announces the player the page drives.
 */
import "./styles/base.css";
import "./styles/header.css";
import "./styles/stage.css";
import "./styles/transport.css";
import "./styles/timeline.css";
import "./styles/note-editor.css";
import { PreviewApp } from "./app.js";
import { connectEmbedder } from "./channel.js";
import { defineElements } from "./components/index.js";
import { forwardConsole } from "./report.js";

defineElements();
const app = new PreviewApp();
forwardConsole(console, app.report);
// In a frame, the embedding app hears what happens and can drive the page.
if (window.parent !== window) connectEmbedder(app, window.parent);
const page =
	document.querySelector("ff-preview") ??
	document.body.appendChild(document.createElement("ff-preview"));
page.app = app;
app.start().catch((err: unknown) => app.showError(err));
