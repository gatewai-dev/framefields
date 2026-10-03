/**
 * Minimal SVG sanitizer.
 *
 * Strips active content (scripts, event handlers, javascript: URLs,
 * HTML-embedding elements) from untrusted SVG uploads before they are stored
 * and served. Served SVGs live inline at the API origin, so any executable
 * content would become stored XSS.
 */
export function sanitizeSvg(input: Buffer | string): Buffer {
	let xml = Buffer.isBuffer(input) ? input.toString("utf-8") : input;

	// Comments can hide nested payloads from regex passes.
	xml = xml.replace(/<!--[\s\S]*?-->/g, "");

	// Any <script>…</script> or self-closing <script/>.
	xml = xml.replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "");
	xml = xml.replace(/<\s*script\b[^>]*\/\s*>/gi, "");

	// <foreignObject> can embed arbitrary HTML (and therefore scripts).
	xml = xml.replace(
		/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi,
		"",
	);

	// Event handler attributes: onload="…", onclick=….
	xml = xml.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");

	// URL attributes that reference scripts: javascript:, vbscript:, data:.
	xml = xml.replace(
		/(\s+(?:xlink:)?href\s*=\s*["'])(javascript|vbscript|data):[^"']*(["'])/gi,
		"$1$3",
	);
	xml = xml.replace(/\s+formaction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");

	// Data URIs in image or use elements are acceptable for images only.
	xml = xml.replace(
		/(\s+(?:data|href)\s*=\s*["']data:)(?!image\/)([^"']*)(["'])/gi,
		"$1image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=$3",
	);

	const result = Buffer.from(xml, "utf-8");
	if (result.length === 0) {
		throw new Error("SVG sanitizer produced empty output");
	}
	return result;
}
