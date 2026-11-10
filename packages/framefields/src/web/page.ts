import type { WebBundleManifest } from "./types.js";

/**
 * The page a web bundle opens on (`index.html`): queues exports of the film
 * on this device and lists them. An app embedding the bundle drives it with
 * `window.framefieldsEnqueue(options)` (returns the render's id),
 * `framefieldsCancel(id)`, `framefieldsQueue()` and `framefieldsExport(options)`;
 * with a `framefields` WKScriptMessageHandler installed every queue event
 * (`{ type, text, id, render }`) is posted to it.
 */
export function webBundlePage(manifest: WebBundleManifest): string {
	const title = escapeHtml(manifest.title);
	const seconds = (manifest.frameCount / manifest.fps).toFixed(1);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --fg: #16161a; --muted: #6b6b73; --line: #d9d9d4; --accent: #1f5eff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e0f12; --fg: #ececf0; --muted: #8d8d96; --line: #2a2b31; --accent: #6f95ff; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 -apple-system, system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.meta { color: var(--muted); margin: 0 0 20px; font-variant-numeric: tabular-nums; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-bottom: 16px; }
label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
select, input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; min-width: 96px; }
button { font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 9px 16px; }
button[disabled] { opacity: 0.5; }
ol { padding-left: 20px; font-variant-numeric: tabular-nums; } li { margin: 6px 0; } li button { padding: 3px 10px; font-weight: 500; }
#status { color: var(--muted); min-height: 1.5em; font-variant-numeric: tabular-nums; }
video { width: 100%; margin-top: 16px; border-radius: 8px; background: #000; }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p class="meta">${manifest.width}×${manifest.height} · ${manifest.fps} fps · ${seconds} s · ${manifest.frameCount} frames</p>
<div class="row">
<label>Codec <select id="codec"><option value="h264">H.264</option><option value="hevc">HEVC</option></select></label>
<label>Quality <select id="quality"><option value="very_high">Very high</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
<label>Chunk (s) <input id="chunk" type="number" min="2" value="20"></label>
<button id="go">Add to queue</button>
</div>
<ol id="queue"></ol>
<p id="status"></p>
</main>
<script type="module">
import { openBundle } from "./engine/web.mjs";
const $ = (id) => document.getElementById(id);
const native = window.webkit?.messageHandlers?.framefields;
// Every message is { type, text, ... }: queue events as they are, plus errors.
const post = (message) => native?.postMessage(JSON.parse(JSON.stringify(message)));
const name = ${JSON.stringify(manifest.title)};
const bundle = openBundle(new URL("./", location.href));
bundle.catch((err) => { $("status").textContent = String(err); post({ type: "error", text: String(err) }); });

const urls = new Map();
async function draw(queue) {
	const items = [];
	for (const r of queue.list().reverse()) {
		let line = r.options.codec ?? "h264";
		line += " · " + (r.options.quality ?? "very_high") + " · " + r.status;
		if (r.status === "rendering" && r.progress) line += " · " + r.progress.message + (r.progress.etaSec ? " · " + Math.ceil(r.progress.etaSec) + " s left" : "");
		if (r.status === "failed") line += " · " + r.error;
		let extra = "";
		if (r.status === "done") {
			if (!urls.has(r.id)) { const file = await queue.file(r.id); if (file) urls.set(r.id, URL.createObjectURL(file)); }
			const url = urls.get(r.id);
			if (url) extra = ' · <a download="' + name + '.mp4" href="' + url + '">Save</a> (' + (r.result.bytes / 1e6).toFixed(1) + " MB, " + (r.result.elapsedMs / 1000).toFixed(0) + " s)";
		}
		const cancel = r.status === "queued" || r.status === "rendering" ? ' <button data-cancel="' + r.id + '">Cancel</button>' : "";
		items.push("<li>" + line.replace(/[<>&]/g, "") + extra + cancel + "</li>");
	}
	$("queue").innerHTML = items.join("");
}

bundle.then((b) => {
	b.queue.subscribe((event) => { post(event); void draw(b.queue); });
	void draw(b.queue);
	$("queue").onclick = (e) => { const id = e.target?.dataset?.cancel; if (id) void b.queue.cancel(id); };
});

/** For an app: enqueue a render; its events arrive at the message handler. */
window.framefieldsEnqueue = async (options = {}) => (await bundle).queue.enqueue(options);
window.framefieldsCancel = async (id) => (await bundle).queue.cancel(id);
window.framefieldsQueue = async () => (await bundle).queue.list();
/** Renders and waits (a queue of one): resolves with the result. */
window.framefieldsExport = async (options = {}) => (await bundle).exportVideo(options);
$("go").onclick = () => window.framefieldsEnqueue({ codec: $("codec").value, quality: $("quality").value, chunkSec: Number($("chunk").value) || 20 }).catch((err) => { $("status").textContent = String(err); });
</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);
}
