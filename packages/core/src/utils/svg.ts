/**
 * Attempts to parse the width and height of an SVG from its buffer.
 * Falls back to viewBox ratios if explicitly defined sizes are missing.
 */
export function extractSvgDimensions(
	buffer: Buffer,
): { w: number; h: number } | null {
	try {
		const str = buffer.toString("utf-8");
		const match = str.match(/<svg[^>]*>/i);
		if (!match) return null;

		const svgTag = match[0];

		const getAttr = (name: string) => {
			const attrMatch = svgTag.match(
				new RegExp(`${name}=["']([^"']+)["']`, "i"),
			);
			if (!attrMatch) return null;
			const val = parseFloat(attrMatch[1].replace(/[a-z%]/gi, ""));
			return isNaN(val) ? null : val;
		};

		let w = getAttr("width");
		let h = getAttr("height");

		const viewBoxMatch = svgTag.match(/viewBox=["']([^"']+)["']/i);
		if (viewBoxMatch) {
			const parts = viewBoxMatch[1].split(/[\s,]+/).map(parseFloat);
			if (parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
				const vbW = parts[2];
				const vbH = parts[3];

				if (w == null && h == null) {
					w = vbW;
					h = vbH;
				} else if (w != null && h == null) {
					h = w * (vbH / vbW);
				} else if (h != null && w == null) {
					w = h * (vbW / vbH);
				}
			}
		}

		if (w != null && h != null && w > 0 && h > 0) {
			return { w, h };
		}
		return null;
	} catch (error) {
		console.error("Error parsing SVG dimensions", error);
		return null;
	}
}
