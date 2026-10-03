import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg-sanitize.js";

const clean = (input: string) => sanitizeSvg(input).toString("utf-8");

describe("sanitizeSvg", () => {
	it("keeps benign SVG intact", () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f00"/></svg>';
		expect(clean(svg)).toContain("<svg");
		expect(clean(svg)).toContain("<rect");
	});

	it("strips <script> blocks", () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`;
		expect(clean(svg)).not.toContain("script");
		expect(clean(svg)).not.toContain("alert");
	});

	it("strips event handlers", () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="steal()"/></svg>';
		expect(clean(svg)).not.toContain("onload");
		expect(clean(svg)).not.toContain("onclick");
		expect(clean(svg)).not.toContain("alert");
	});

	it("strips javascript: URLs", () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>hi</text></a></svg>';
		const out = clean(svg);
		expect(out).not.toContain("javascript:");
		expect(out).toContain("<a");
	});

	it("removes HTML-embedding <foreignObject>", () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="evil"></iframe></foreignObject><rect/></svg>`;
		const out = clean(svg);
		expect(out).not.toContain("foreignObject");
		expect(out).not.toContain("iframe");
		expect(out).toContain("<rect");
	});

	it("throws on empty output", () => {
		expect(() => sanitizeSvg("<svg></svg>")).not.toThrow();
		expect(() => sanitizeSvg("")).toThrow();
	});
});
