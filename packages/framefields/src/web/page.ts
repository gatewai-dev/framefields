import type { WebBundleManifest } from "./types.js";

/**
 * The page a web bundle opens on (`index.html`): exports the film on this
 * device and shows the result. An app embedding the bundle can drive it
 * instead: `window.framefieldsExport(options)` starts an export, and with a
 * `framefields` WKScriptMessageHandler installed every progress update and
 * the result (or error) is posted to it.
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
progress { width: 100%; height: 6px; accent-color: var(--accent); }
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
<button id="go">Export MP4</button>
</div>
<progress id="bar" max="1" value="0"></progress>
<p id="status"></p>
<div id="out"></div>
</main>
<script type="module">
import { openBundle } from "./engine/web.mjs";
const $ = (id) => document.getElementById(id);
const native = window.webkit?.messageHandlers?.framefields;
const post = (message) => native?.postMessage(message);
const bundle = openBundle(new URL("./", location.href));
bundle.catch((err) => { $("status").textContent = String(err); post({ type: "error", message: String(err) }); });

async function run(options = {}) {
	const b = await bundle;
	$("go").disabled = true;
	$("out").textContent = "";
	try {
		const result = await b.exportVideo({
			...options,
			onProgress(p) {
				$("bar").value = p.totalFrames ? p.frames / p.totalFrames : 0;
				$("status").textContent = p.message + (p.etaSec ? " · " + Math.ceil(p.etaSec) + " s left" : "");
				post({ type: "progress", ...p });
			},
		});
		const url = URL.createObjectURL(result.file);
		const name = ${JSON.stringify(`${manifest.title}.mp4`)};
		$("out").innerHTML = '<a download="' + name + '" href="' + url + '">Save ' + name + "</a> · " + (result.file.size / 1e6).toFixed(1) + " MB in " + (result.elapsedMs / 1000).toFixed(1) + ' s<video controls playsinline src="' + url + '"></video>';
		post({ type: "done", jobId: result.jobId, frames: result.frames, durationSec: result.durationSec, bytes: result.file.size, elapsedMs: result.elapsedMs, chunks: result.chunks });
		return result;
	} catch (err) {
		$("status").textContent = String(err);
		post({ type: "error", message: String(err) });
		throw err;
	} finally {
		$("go").disabled = false;
	}
}
window.framefieldsExport = run;
$("go").onclick = () => run({ codec: $("codec").value, quality: $("quality").value, chunkSec: Number($("chunk").value) || 20 }).catch(() => {});
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
