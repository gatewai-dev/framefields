/**
 * A small syntax tokenizer for code on screen: enough to colour ts / js,
 * json, bash, python and css the way an editor would. Anything else comes
 * from the user's own highlighter through `tokens`.
 */

export const CODE_LANGS = [
	"ts",
	"js",
	"json",
	"bash",
	"python",
	"css",
	"plain",
] as const;
export type CodeLang = (typeof CODE_LANGS)[number];

export type TokenKind =
	| "plain"
	| "keyword"
	| "string"
	| "number"
	| "comment"
	| "function"
	| "type"
	| "property"
	| "punctuation"
	| "operator";

export interface Token {
	text: string;
	kind?: TokenKind;
	/** An explicit colour wins over `kind`. */
	color?: string;
}

const words = (list: string) => new Set(list.split(/\s+/));

let keywordSets: Record<CodeLang, Set<string>> | undefined;

/** Keyword sets, built on first use (never at import: that would ship to every bundle). */
function keywords(lang: CodeLang): Set<string> {
	keywordSets ??= buildKeywords();
	return keywordSets[lang];
}

const buildKeywords = (): Record<CodeLang, Set<string>> => ({
	ts: words(
		"const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of interface type enum implements public private protected readonly static as satisfies keyof declare true false null undefined this void yield",
	),
	js: words(
		"const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of static true false null undefined this void yield",
	),
	python: words(
		"def class return if elif else for while in not and or import from as with try except finally raise lambda pass break continue None True False self yield async await is global nonlocal",
	),
	bash: words(
		"if then else elif fi for do done case esac function export return in while until local echo cd source exit set unset",
	),
	json: words("true false null"),
	css: words("important"),
	plain: new Set(),
});

interface Rule {
	re: RegExp;
	kind:
		| TokenKind
		| ((match: string, rest: string, before: string) => TokenKind);
}

const C_LIKE: Rule[] = [
	{ re: /\/\/.*/y, kind: "comment" },
	{ re: /\/\*.*?(\*\/|$)/y, kind: "comment" },
	{ re: /`(?:[^`\\]|\\.)*(`|$)/y, kind: "string" },
	{ re: /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/y, kind: "string" },
	{
		re: /\b\d[\d_]*(\.\d+)?([eE][+-]?\d+)?n?\b|\b0x[\da-fA-F]+\b/y,
		kind: "number",
	},
];

/** Identifier kinds shared by most languages. */
function ident(lang: CodeLang) {
	return (word: string, rest: string, before: string): TokenKind => {
		if (keywords(lang).has(word)) return "keyword";
		if (/^\s*\(/.test(rest)) return "function";
		if (/^[A-Z]/.test(word)) return "type";
		if (/\.\s*$/.test(before)) return "property";
		return "plain";
	};
}

function rulesFor(lang: CodeLang): Rule[] {
	const id = { re: /[A-Za-z_$][\w$]*/y, kind: ident(lang) };
	const punct = { re: /[{}()[\];,.:]/y, kind: "punctuation" as const };
	const op = { re: /[=+\-*/%<>!&|?^~@]+/y, kind: "operator" as const };
	switch (lang) {
		case "ts":
		case "js":
			return [...C_LIKE, id, punct, op];
		case "json":
			return [
				{
					re: /"(?:[^"\\]|\\.)*"/y,
					kind: (_m, rest) => (/^\s*:/.test(rest) ? "property" : "string"),
				},
				C_LIKE[4] as Rule,
				id,
				punct,
			];
		case "python":
			return [
				{ re: /#.*/y, kind: "comment" },
				{ re: /("""|''').*?(\1|$)/y, kind: "string" },
				{
					re: /[rbfRBF]?("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)/y,
					kind: "string",
				},
				C_LIKE[4] as Rule,
				{ re: /@[\w.]+/y, kind: "function" },
				id,
				punct,
				op,
			];
		case "bash":
			return [
				{ re: /#.*/y, kind: "comment" },
				{ re: /"(?:[^"\\]|\\.)*"?|'[^']*'?/y, kind: "string" },
				{ re: /\$\{?[\w@#?*]+\}?/y, kind: "type" },
				{ re: /--?[\w-]+/y, kind: "property" },
				{ re: /\b\d+\b/y, kind: "number" },
				{
					re: /[A-Za-z_][\w./-]*/y,
					// The first word of a command is the program.
					kind: (word, _rest, before) => {
						if (keywords("bash").has(word)) return "keyword";
						const b = before.trimEnd();
						return b === "" || /[|;&(]$/.test(b) ? "function" : "plain";
					},
				},
				{ re: /[|&;<>()=]+/y, kind: "operator" },
			];
		case "css":
			return [
				{ re: /\/\*.*?(\*\/|$)/y, kind: "comment" },
				{ re: /"[^"]*"?|'[^']*'?/y, kind: "string" },
				{ re: /@[\w-]+/y, kind: "keyword" },
				{ re: /#[\da-fA-F]{3,8}\b/y, kind: "number" },
				{ re: /-?\d*\.?\d+(px|em|rem|%|vh|vw|s|ms|deg|fr)?/y, kind: "number" },
				{
					re: /[\w-]+/y,
					kind: (_w, rest) =>
						/^\s*:(?!:)/.test(rest)
							? "property"
							: /^\s*\(/.test(rest)
								? "function"
								: "plain",
				},
				{ re: /[{}();:,>+~]/y, kind: "punctuation" },
			];
		case "plain":
			return [];
	}
}

/**
 * Tokens per line. Block comments, template literals and triple-quoted
 * strings carry across lines.
 */
export function tokenize(code: string, lang: CodeLang): Token[][] {
	const lines = code.split("\n");
	if (lang === "plain") return lines.map((l) => (l ? [{ text: l }] : []));
	const rules = rulesFor(lang);
	/** The closing delimiter of a construct still open from a previous line. */
	let open: { close: RegExp; kind: TokenKind } | null = null;

	return lines.map((line) => {
		const out: Token[] = [];
		const push = (text: string, kind: TokenKind) => {
			const last = out[out.length - 1];
			if (last && last.kind === kind) last.text += text;
			else out.push({ text, kind });
		};
		let i = 0;
		if (open) {
			const m = open.close.exec(line);
			const end = m ? m.index + m[0].length : line.length;
			push(line.slice(0, end), open.kind);
			i = end;
			if (m) open = null;
		}
		while (i < line.length) {
			const ws = /\s+/y;
			ws.lastIndex = i;
			const space = ws.exec(line);
			if (space) {
				push(space[0], "plain");
				i += space[0].length;
				continue;
			}
			let matched = false;
			for (const rule of rules) {
				rule.re.lastIndex = i;
				const m = rule.re.exec(line);
				if (!m || m[0].length === 0) continue;
				const text = m[0];
				const kind =
					typeof rule.kind === "function"
						? rule.kind(text, line.slice(i + text.length), line.slice(0, i))
						: rule.kind;
				push(text, kind);
				// A construct that runs off the end of the line continues on the next.
				if (kind === "comment" && text.startsWith("/*") && !text.endsWith("*/"))
					open = { close: /\*\//, kind };
				else if (
					kind === "string" &&
					text.startsWith("`") &&
					(text.length === 1 || !text.endsWith("`"))
				)
					open = { close: /(?<!\\)`/, kind };
				else if (
					kind === "string" &&
					/^("""|''')/.test(text) &&
					(text.length < 6 || !text.endsWith(text.slice(0, 3)))
				)
					open = { close: new RegExp(text.slice(0, 3)), kind };
				i += text.length;
				matched = true;
				break;
			}
			if (!matched) {
				push(line[i] as string, "plain");
				i++;
			}
		}
		return out;
	});
}
