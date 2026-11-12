/**
 * Materials from other tools: OpenPBR Surface 1.1 (the surface model
 * MaterialX standardizes, Academy Software Foundation) and Autodesk Standard
 * Surface parameters mapped onto framefields' surface props, and a reader
 * for `.mtlx` documents that use them.
 *
 * Parameter names are the specs' own (snake_case), so a material can be
 * copied from Blender, Houdini, Maya or Substance as written. Colors in
 * those specs are linear; framefields colors are display (sRGB) CSS colors,
 * so they are converted.
 */
import type { Primitive3DNodeOptions } from "./shapes3d.js";

type Color3 = readonly [number, number, number];

/** OpenPBR Surface 1.1 parameters framefields shades (others are reported, not dropped silently). */
export interface OpenPbrSurface {
	base_weight?: number;
	base_color?: Color3;
	base_metalness?: number;
	specular_weight?: number;
	specular_roughness?: number;
	specular_roughness_anisotropy?: number;
	specular_ior?: number;
	transmission_weight?: number;
	transmission_color?: Color3;
	subsurface_weight?: number;
	subsurface_color?: Color3;
	coat_weight?: number;
	coat_roughness?: number;
	fuzz_weight?: number;
	fuzz_color?: Color3;
	fuzz_roughness?: number;
	thin_film_weight?: number;
	/** Micrometres, as OpenPBR measures it (0.5 = 500 nm). */
	thin_film_thickness?: number;
	thin_film_ior?: number;
	/** Nits. */
	emission_luminance?: number;
	emission_color?: Color3;
	geometry_opacity?: number;
}

/** Autodesk Standard Surface parameters with an OpenPBR counterpart. */
export interface StandardSurface {
	base?: number;
	base_color?: Color3;
	metalness?: number;
	specular?: number;
	specular_roughness?: number;
	specular_IOR?: number;
	specular_anisotropy?: number;
	transmission?: number;
	transmission_color?: Color3;
	subsurface?: number;
	subsurface_color?: Color3;
	coat?: number;
	coat_roughness?: number;
	sheen?: number;
	sheen_color?: Color3;
	sheen_roughness?: number;
	/** Nanometres, as Standard Surface measures it. */
	thin_film_thickness?: number;
	thin_film_IOR?: number;
	emission?: number;
	emission_color?: Color3;
	opacity?: Color3;
}

/** The surface props an OpenPBR material becomes; spread them into a `Layer3D` builder or a model. */
export type OpenPbrMaterial = Pick<
	Primitive3DNodeOptions,
	| "color"
	| "metallic"
	| "roughness"
	| "material"
	| "ior"
	| "opacity"
	| "emissive"
	| "emissiveIntensity"
	| "clearcoat"
	| "clearcoatRoughness"
	| "anisotropy"
	| "subsurface"
	| "subsurfaceColor"
	| "sheen"
	| "sheenColor"
	| "sheenRoughness"
	| "iridescence"
	| "texture"
>;

/**
 * Display white in nits: SDR reference white (ITU-R BT.709 practice). An
 * emission of this luminance is emissiveIntensity 1; brighter blooms.
 */
const REFERENCE_WHITE_NITS = 100;

function clamp01(v: number): number {
	return Math.min(1, Math.max(0, v));
}

/** Linear RGB as a CSS hex color (display-encoded, as framefields colors are). */
export function linearToCss(c: Color3): string {
	const encode = (v: number) => {
		const x = clamp01(v);
		const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
		return Math.round(s * 255)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${encode(c[0])}${encode(c[1])}${encode(c[2])}`;
}

const scale = (c: Color3, k: number): Color3 => [c[0] * k, c[1] * k, c[2] * k];

/** The lobes framefields has for the coat, fuzz, subsurface and thin film. */
function layers(p: OpenPbrSurface): OpenPbrMaterial {
	const out: OpenPbrMaterial = {};
	if (p.coat_weight) {
		out.clearcoat = clamp01(p.coat_weight);
		out.clearcoatRoughness = clamp01(p.coat_roughness ?? 0);
	}
	if (p.fuzz_weight) {
		out.sheen = clamp01(p.fuzz_weight);
		out.sheenColor = linearToCss(p.fuzz_color ?? [1, 1, 1]);
		out.sheenRoughness = clamp01(p.fuzz_roughness ?? 0.5);
	}
	if (p.subsurface_weight) {
		out.subsurface = clamp01(p.subsurface_weight);
		out.subsurfaceColor = linearToCss(p.subsurface_color ?? [0.8, 0.8, 0.8]);
	}
	if (p.thin_film_weight) {
		out.iridescence = {
			intensity: clamp01(p.thin_film_weight),
			thickness: (p.thin_film_thickness ?? 0.5) * 1000,
			ior: p.thin_film_ior ?? 1.4,
		};
	}
	return out;
}

/**
 * An OpenPBR Surface as framefields surface props:
 * `Layer3D.sphere({ radius: 90, ...openPBR({ base_color: [0.6, 0.05, 0.02], coat_weight: 1 }) })`.
 * Base color × weight is the color; transmission above one half makes it
 * glass (frosted when rough); emission is read against a 100-nit white.
 */
export function openPBR(p: OpenPbrSurface): OpenPbrMaterial {
	const base = scale(p.base_color ?? [0.8, 0.8, 0.8], p.base_weight ?? 1);
	const roughness = clamp01(p.specular_roughness ?? 0.3);
	const transmissive = (p.transmission_weight ?? 0) > 0.5;
	const out: OpenPbrMaterial = {
		color: linearToCss(
			transmissive ? (p.transmission_color ?? [1, 1, 1]) : base,
		),
		metallic: clamp01(p.base_metalness ?? 0),
		roughness,
		...layers(p),
	};
	if (transmissive) {
		out.material = roughness > 0.1 ? "frosted" : "glass";
		out.ior = p.specular_ior ?? 1.5;
	}
	if (p.specular_roughness_anisotropy) {
		out.anisotropy = clamp01(p.specular_roughness_anisotropy);
	}
	const nits = p.emission_luminance ?? 0;
	if (nits > 0) {
		out.emissive = linearToCss(p.emission_color ?? [1, 1, 1]);
		out.emissiveIntensity = nits / REFERENCE_WHITE_NITS;
	}
	if (p.geometry_opacity !== undefined && p.geometry_opacity < 1) {
		out.opacity = clamp01(p.geometry_opacity);
	}
	return out;
}

/** Standard Surface parameters as their OpenPBR equivalents. */
export function standardToOpenPbr(s: StandardSurface): OpenPbrSurface {
	const opacity = s.opacity
		? (s.opacity[0] + s.opacity[1] + s.opacity[2]) / 3
		: undefined;
	return {
		base_weight: s.base,
		base_color: s.base_color,
		base_metalness: s.metalness,
		specular_weight: s.specular,
		specular_roughness: s.specular_roughness,
		specular_ior: s.specular_IOR,
		specular_roughness_anisotropy: s.specular_anisotropy,
		transmission_weight: s.transmission,
		transmission_color: s.transmission_color,
		subsurface_weight: s.subsurface,
		subsurface_color: s.subsurface_color,
		coat_weight: s.coat,
		coat_roughness: s.coat_roughness,
		fuzz_weight: s.sheen,
		fuzz_color: s.sheen_color,
		fuzz_roughness: s.sheen_roughness,
		thin_film_weight: s.thin_film_thickness ? 1 : undefined,
		thin_film_thickness: s.thin_film_thickness
			? s.thin_film_thickness / 1000
			: undefined,
		thin_film_ior: s.thin_film_IOR,
		// Standard Surface emission is a weight on a color; 1 is display white.
		emission_luminance: s.emission
			? s.emission * REFERENCE_WHITE_NITS
			: undefined,
		emission_color: s.emission_color,
		geometry_opacity: opacity,
	};
}

/** Autodesk Standard Surface as framefields surface props. */
export function standardSurface(s: StandardSurface): OpenPbrMaterial {
	return openPBR(standardToOpenPbr(s));
}

// ── .mtlx ──────────────────────────────────────────────────────────────

interface XmlElement {
	tag: string;
	attrs: Record<string, string>;
	children: XmlElement[];
}

function decodeEntities(v: string): string {
	return v
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** MaterialX documents are elements and attributes only: a small tag reader covers them. */
function parseXml(xml: string): XmlElement {
	const root: XmlElement = { tag: "#root", attrs: {}, children: [] };
	const stack: XmlElement[] = [root];
	const source = xml
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\?[\s\S]*?\?>/g, "");
	const tag =
		/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
	for (let m = tag.exec(source); m; m = tag.exec(source)) {
		const [, closing, name, attrText, selfClosing] = m;
		const parent = stack[stack.length - 1] as XmlElement;
		if (closing) {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of (attrText ?? "").matchAll(
			/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
		)) {
			attrs[a[1] as string] = decodeEntities(a[2] ?? a[3] ?? "");
		}
		const el: XmlElement = { tag: name as string, attrs, children: [] };
		parent.children.push(el);
		if (!selfClosing) stack.push(el);
	}
	return root;
}

/** One material of a `.mtlx` document, ready to spread into a builder. */
export interface MtlxMaterial {
	name: string;
	/** The shading model it came from. */
	surface: "open_pbr_surface" | "standard_surface";
	props: OpenPbrMaterial;
	/** Inputs framefields does not apply (connected maps other than base color, unknown parameters). */
	unsupported: string[];
}

const SURFACES = new Set(["open_pbr_surface", "standard_surface"]);

/** Inputs whose value framefields reads, by surface. */
const KNOWN: Record<MtlxMaterial["surface"], Set<string>> = {
	open_pbr_surface: new Set([
		"base_weight",
		"base_color",
		"base_metalness",
		"specular_weight",
		"specular_roughness",
		"specular_roughness_anisotropy",
		"specular_ior",
		"transmission_weight",
		"transmission_color",
		"subsurface_weight",
		"subsurface_color",
		"coat_weight",
		"coat_roughness",
		"fuzz_weight",
		"fuzz_color",
		"fuzz_roughness",
		"thin_film_weight",
		"thin_film_thickness",
		"thin_film_ior",
		"emission_luminance",
		"emission_color",
		"geometry_opacity",
	]),
	standard_surface: new Set([
		"base",
		"base_color",
		"metalness",
		"specular",
		"specular_roughness",
		"specular_IOR",
		"specular_anisotropy",
		"transmission",
		"transmission_color",
		"subsurface",
		"subsurface_color",
		"coat",
		"coat_roughness",
		"sheen",
		"sheen_color",
		"sheen_roughness",
		"thin_film_thickness",
		"thin_film_IOR",
		"emission",
		"emission_color",
		"opacity",
	]),
};

function parseValue(type: string, value: string): number | Color3 | undefined {
	const parts = value.split(",").map((v) => Number(v.trim()));
	if (parts.some((v) => !Number.isFinite(v))) return undefined;
	if (type === "float") return parts[0];
	if (type === "color3" || type === "vector3")
		return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
	return undefined;
}

function joinPath(base: string | undefined, file: string): string {
	if (!base || /^([a-z]+:|\/)/i.test(file)) return file;
	return `${base.replace(/\/+$/, "")}/${file}`;
}

interface Scope {
	nodes: Map<string, XmlElement>;
	graphs: Map<string, XmlElement>;
	prefix: string;
}

/** The image file an input reads through `nodename` or `nodegraph` + `output`, if any. */
function connectedImage(input: XmlElement, scope: Scope): string | undefined {
	let node: XmlElement | undefined;
	let prefix = scope.prefix;
	if (input.attrs.nodename) {
		node = scope.nodes.get(input.attrs.nodename);
	} else if (input.attrs.nodegraph) {
		const graph = scope.graphs.get(input.attrs.nodegraph);
		const outputName = input.attrs.output;
		const output = graph?.children.find(
			(c) => c.tag === "output" && (!outputName || c.attrs.name === outputName),
		);
		node = graph?.children.find((c) => c.attrs.name === output?.attrs.nodename);
		prefix = graph?.attrs.fileprefix ?? prefix;
	}
	if (!node || (node.tag !== "image" && node.tag !== "tiledimage"))
		return undefined;
	const file = node.children.find((c) => c.attrs.name === "file")?.attrs.value;
	return file ? `${node.attrs.fileprefix ?? prefix}${file}` : undefined;
}

function readSurface(
	shader: XmlElement,
	scope: Scope,
	baseDir?: string,
): Omit<MtlxMaterial, "name"> {
	const surface = shader.tag as MtlxMaterial["surface"];
	const values: Record<string, number | Color3> = {};
	const unsupported: string[] = [];
	let texture: string | undefined;
	for (const input of shader.children.filter((c) => c.tag === "input")) {
		const name = input.attrs.name as string;
		if (input.attrs.nodename || input.attrs.nodegraph) {
			const image = connectedImage(input, scope);
			if (name === "base_color" && image) texture = joinPath(baseDir, image);
			else
				unsupported.push(
					`${name} (connected to ${input.attrs.nodename ?? input.attrs.nodegraph})`,
				);
			continue;
		}
		const value = parseValue(input.attrs.type ?? "", input.attrs.value ?? "");
		if (!KNOWN[surface].has(name) || value === undefined) {
			unsupported.push(name);
			continue;
		}
		values[name] = value;
	}
	const props =
		surface === "open_pbr_surface"
			? openPBR(values as OpenPbrSurface)
			: standardSurface(values as StandardSurface);
	if (texture) {
		// The map carries the color; the factor stays as its tint.
		props.texture = texture;
	}
	return { surface, props, unsupported };
}

/**
 * The `open_pbr_surface` and `standard_surface` materials of a MaterialX
 * document, by material name (the `surfacematerial`, or the shader node when
 * a document has none). Constant inputs map as `openPBR` maps them; a base
 * color connected to an `image` / `tiledimage` node becomes `texture`, its
 * file resolved against `baseDir` (the document's folder). Anything else is
 * listed in `unsupported`. Read the file yourself:
 * `parseMtlx(await fs.readFile("chair.mtlx", "utf8"), { baseDir: "assets" })`.
 */
export function parseMtlx(
	xml: string,
	options: { baseDir?: string } = {},
): Record<string, MtlxMaterial> {
	const doc = parseXml(xml).children.find((c) => c.tag === "materialx");
	if (!doc) throw new Error("parseMtlx: no <materialx> element");
	const scope: Scope = {
		nodes: new Map(),
		graphs: new Map(),
		prefix: doc.attrs.fileprefix ?? "",
	};
	for (const c of doc.children) {
		if (c.tag === "nodegraph") scope.graphs.set(c.attrs.name as string, c);
		else if (c.attrs.name) scope.nodes.set(c.attrs.name, c);
	}
	const out: Record<string, MtlxMaterial> = {};
	const used = new Set<string>();
	for (const m of doc.children.filter((c) => c.tag === "surfacematerial")) {
		const ref = m.children.find((c) => c.attrs.name === "surfaceshader")?.attrs
			.nodename;
		const shader = ref ? scope.nodes.get(ref) : undefined;
		if (!shader || !SURFACES.has(shader.tag)) continue;
		used.add(ref as string);
		out[m.attrs.name as string] = {
			name: m.attrs.name as string,
			...readSurface(shader, scope, options.baseDir),
		};
	}
	for (const c of doc.children) {
		if (SURFACES.has(c.tag) && !used.has(c.attrs.name as string)) {
			out[c.attrs.name as string] = {
				name: c.attrs.name as string,
				...readSurface(c, scope, options.baseDir),
			};
		}
	}
	return out;
}
