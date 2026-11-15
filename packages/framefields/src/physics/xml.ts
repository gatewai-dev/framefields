/**
 * Just enough of the DOM's XML parsing for Steel's robot loaders (MJCF,
 * URDF) outside a browser: Node has no `DOMParser`, and they read a document
 * through `documentElement`, `children`, `tagName`, `attributes`,
 * `getAttribute` and `hasAttribute`. Browsers keep their own.
 */

/** One attribute as the DOM lists it. */
interface XmlAttribute {
	name: string;
	value: string;
}

/** An element as the loaders read it. */
export class XmlElement {
	readonly children: XmlElement[] = [];
	readonly attributes: XmlAttribute[] = [];
	textContent = "";

	constructor(
		readonly tagName: string,
		readonly parentElement: XmlElement | null,
	) {}

	getAttribute(name: string): string | null {
		return this.attributes.find((a) => a.name === name)?.value ?? null;
	}

	hasAttribute(name: string): boolean {
		return this.attributes.some((a) => a.name === name);
	}
}

/** A parsed document: its root, and `querySelector` by tag name. */
export class XmlDocument {
	constructor(readonly documentElement: XmlElement) {}

	querySelector(tag: string): XmlElement | null {
		const find = (el: XmlElement): XmlElement | null =>
			el.tagName === tag
				? el
				: el.children.reduce<XmlElement | null>(
						(hit, c) => hit ?? find(c),
						null,
					);
		return find(this.documentElement);
	}
}

const ENTITIES: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};

const decode = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
		if (ref[0] !== "#") return ENTITIES[ref] ?? whole;
		const code =
			ref[1] === "x" || ref[1] === "X"
				? Number.parseInt(ref.slice(2), 16)
				: Number.parseInt(ref.slice(1), 10);
		return String.fromCodePoint(code);
	});

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
/** A comment, CDATA, processing instruction or doctype; or a tag. */
const TOKEN =
	/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gi;

/** Parses well-formed XML; malformed input throws, naming where. */
export function parseXml(text: string): XmlDocument {
	const open: XmlElement[] = [];
	let root: XmlElement | null = null;
	let at = 0;
	const addText = (s: string) => {
		for (const el of open) el.textContent += s;
	};
	for (const m of text.matchAll(TOKEN)) {
		const between = text.slice(at, m.index);
		if (between.includes("<"))
			throw new Error(`XML: unreadable markup near offset ${at}`);
		addText(decode(between));
		at = m.index + m[0].length;
		if (m[1] !== undefined) addText(m[1]);
		const [, , closing, tag, attrs, selfClosing] = m;
		if (!tag) continue;
		if (closing) {
			const el = open.pop();
			if (el?.tagName !== tag)
				throw new Error(
					`XML: </${tag}> closes <${el?.tagName ?? "nothing"}> at offset ${m.index}`,
				);
			continue;
		}
		const parent = open.at(-1) ?? null;
		if (!parent && root)
			throw new Error(`XML: a second root <${tag}> at offset ${m.index}`);
		const el = new XmlElement(tag, parent);
		for (const a of attrs.matchAll(ATTRIBUTE))
			el.attributes.push({ name: a[1], value: decode(a[3] ?? a[4] ?? "") });
		if (parent) parent.children.push(el);
		else root = el;
		if (!selfClosing) open.push(el);
	}
	if (text.slice(at).includes("<"))
		throw new Error(`XML: unreadable markup near offset ${at}`);
	if (open.length)
		throw new Error(`XML: <${open.at(-1)?.tagName}> never closes`);
	if (!root) throw new Error("XML: no root element");
	return new XmlDocument(root);
}

/** `DOMParser` for XML, as `new DOMParser().parseFromString(text, type)` uses it. */
export class XmlParser {
	parseFromString(text: string, _type: string): XmlDocument {
		return parseXml(text);
	}
}

/** Gives a runtime without `DOMParser` (Node) this one. */
export function ensureXmlParser(): void {
	if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === "undefined")
		Object.assign(globalThis, { DOMParser: XmlParser });
}
