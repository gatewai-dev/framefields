/**
 * A component's props as documentation: name, a short type, default and
 * whether it's required come from its zod schema; the description comes from
 * the JSDoc comment above the prop in `index.ts` (zod drops comments, so the
 * source is read with the TypeScript parser).
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";

export interface PropDoc {
	name: string;
	/** A TypeScript-like summary: `number`, `"bar" | "tag"`, `string[]` … */
	type: string;
	required: boolean;
	default?: unknown;
	description?: string;
}

interface JsonSchema {
	type?: string | string[];
	enum?: unknown[];
	const?: unknown;
	items?: JsonSchema;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	default?: unknown;
}

/** Docs for every prop in `shape`, in declaration order. */
export function propDocs(
	shape: Record<string, z.ZodType>,
	descriptions: Record<string, string> = {},
): PropDoc[] {
	return Object.entries(shape).map(([name, schema]) => {
		const json = z.toJSONSchema(schema, {
			unrepresentable: "any",
			io: "input",
		}) as JsonSchema;
		const doc: PropDoc = {
			name,
			type: typeOf(json),
			required: !schema.safeParse(undefined).success,
		};
		if (json.default !== undefined) doc.default = json.default;
		const description = descriptions[name] ?? schema.description;
		if (description) doc.description = description;
		return doc;
	});
}

function typeOf(s: JsonSchema, depth = 0): string {
	if (s.const !== undefined) return JSON.stringify(s.const);
	if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
	const union = s.anyOf ?? s.oneOf;
	if (union)
		return [...new Set(union.map((u) => typeOf(u, depth + 1)))].join(" | ");
	const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
	if (t === "integer") return "number";
	if (t === "array")
		return s.items ? `${wrap(typeOf(s.items, depth + 1))}[]` : "unknown[]";
	if (t === "object") {
		if (!s.properties || depth > 0) return "object";
		const keys = Object.keys(s.properties);
		return `{ ${keys.join(", ")} }`;
	}
	return t ?? "unknown";
}

const wrap = (t: string) => (t.includes(" ") ? `(${t})` : t);

/**
 * JSDoc text above each prop of the `props: () => ({ … })` object in a
 * component's source (or of the members of interface `iface`), by prop name.
 */
export function propComments(
	file: string,
	iface?: string,
): Record<string, string> {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const out: Record<string, string> = {};
	const visit = (node: ts.Node) => {
		if (iface && ts.isInterfaceDeclaration(node) && node.name.text === iface) {
			for (const member of node.members) {
				const text = jsDoc(member, source);
				if (text && member.name) out[member.name.getText(source)] = text;
			}
			return;
		}
		if (
			!iface &&
			ts.isPropertyAssignment(node) &&
			node.name.getText(source) === "props" &&
			ts.isArrowFunction(node.initializer)
		) {
			let body: ts.Node = node.initializer.body;
			while (ts.isParenthesizedExpression(body)) body = body.expression;
			if (ts.isObjectLiteralExpression(body)) {
				for (const prop of body.properties) {
					const text = jsDoc(prop, source);
					if (text && prop.name) out[prop.name.getText(source)] = text;
				}
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return out;
}

function jsDoc(node: ts.Node, source: ts.SourceFile): string | undefined {
	const ranges = ts.getLeadingCommentRanges(
		source.getFullText(),
		node.getFullStart(),
	);
	const last = ranges?.filter((r) =>
		source
			.getFullText()
			.slice(r.pos, r.pos + 3)
			.startsWith("/**"),
	);
	const range = last?.[last.length - 1];
	if (!range) return undefined;
	return source
		.getFullText()
		.slice(range.pos + 3, range.end - 2)
		.split("\n")
		.map((l) => l.replace(/^\s*\*\s?/, "").trim())
		.filter(Boolean)
		.join(" ");
}
