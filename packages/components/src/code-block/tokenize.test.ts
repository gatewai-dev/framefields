import { describe, expect, it } from "vitest";
import { type Token, tokenize } from "./tokenize.js";

const kinds = (line: Token[] | undefined) =>
	(line ?? []).filter((t) => t.text.trim()).map((t) => [t.text.trim(), t.kind]);

describe("tokenizer", () => {
	it("ts: keywords, calls, types, strings, numbers, comments", () => {
		const [line] = tokenize(
			"const comp = new Composition({ fps: 30 }); // go",
			"ts",
		);
		expect(kinds(line)).toEqual([
			["const", "keyword"],
			["comp", "plain"],
			["=", "operator"],
			["new", "keyword"],
			["Composition", "function"],
			["({", "punctuation"],
			["fps", "plain"],
			[":", "punctuation"],
			["30", "number"],
			["});", "punctuation"],
			["// go", "comment"],
		]);
		expect(kinds(tokenize('x.render("a")', "ts")[0])).toContainEqual([
			"render",
			"function",
		]);
		expect(kinds(tokenize("a.b", "ts")[0])).toContainEqual(["b", "property"]);
	});

	it("carries block comments and template strings across lines", () => {
		const lines = tokenize("/* one\ntwo */ x\nconst s = `a\nb`;", "ts");
		expect(kinds(lines[1])[0]).toEqual(["two */", "comment"]);
		expect(kinds(lines[1])[1]).toEqual(["x", "plain"]);
		expect(kinds(lines[3])[0]).toEqual(["b`", "string"]);
	});

	it("json keys are properties, values are strings / numbers / keywords", () => {
		expect(
			kinds(tokenize('{ "a": "b", "n": 2, "t": true }', "json")[0]),
		).toEqual([
			["{", "punctuation"],
			['"a"', "property"],
			[":", "punctuation"],
			['"b"', "string"],
			[",", "punctuation"],
			['"n"', "property"],
			[":", "punctuation"],
			["2", "number"],
			[",", "punctuation"],
			['"t"', "property"],
			[":", "punctuation"],
			["true", "keyword"],
			["}", "punctuation"],
		]);
	});

	it("bash: programs, flags, variables", () => {
		expect(
			kinds(tokenize('pnpm add -D framefields | grep "x" # note', "bash")[0]),
		).toEqual([
			["pnpm", "function"],
			["add", "plain"],
			["-D", "property"],
			["framefields", "plain"],
			["|", "operator"],
			["grep", "function"],
			['"x"', "string"],
			["# note", "comment"],
		]);
		expect(kinds(tokenize("echo $HOME", "bash")[0])).toEqual([
			["echo", "keyword"],
			["$HOME", "type"],
		]);
	});

	it("python and css", () => {
		expect(
			kinds(tokenize('def go(x): return f"{x}"  # hi', "python")[0]),
		).toEqual([
			["def", "keyword"],
			["go", "function"],
			["(", "punctuation"],
			["x", "plain"],
			["):", "punctuation"],
			["return", "keyword"],
			['f"{x}"', "string"],
			["# hi", "comment"],
		]);
		expect(
			kinds(tokenize(".a { color: #fff; margin: 4px }", "css")[0]),
		).toContainEqual(["color", "property"]);
		expect(
			kinds(tokenize(".a { color: #fff; margin: 4px }", "css")[0]),
		).toContainEqual(["#fff", "number"]);
	});
});
