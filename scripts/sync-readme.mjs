#!/usr/bin/env node
// npm renders the README that sits beside the package's package.json, while
// GitHub shows the repo root's. Keep one source of truth: generate
// packages/gitframes/README.md from the root README, rewriting its relative
// asset and repository links to absolute GitHub URLs so images and links
// resolve on npmjs.com (which serves the file with no repo context).
//
// Run by the package's `prepack` (npm and pnpm both run it) and by `pnpm build`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "README.md");
const target = join(repoRoot, "packages", "gitframes", "README.md");

const pkg = JSON.parse(
	readFileSync(join(repoRoot, "packages", "gitframes", "package.json"), "utf8"),
);
const repo = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
	pkg.repository?.url ?? pkg.repository ?? "",
);
if (!repo) throw new Error("gitframes: no GitHub repository URL to link to");
const REPO = `https://github.com/${repo[1]}/${repo[2]}`;
const REF = "main";
const RAW = `https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/${REF}/`;
const BLOB = `${REPO}/blob/${REF}/`;

// A path inside the repo: not a URL, protocol-relative, anchor or mailto.
const isRelative = (url) =>
	!!url &&
	!/^[a-z][a-z0-9+.-]*:/i.test(url) &&
	!url.startsWith("//") &&
	!url.startsWith("#");

const clean = (url) => url.replace(/^\.?\//, "");

function rewrite(markdown) {
	return (
		markdown
			.replace(
				/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi,
				(m, pre, quote, url) =>
					isRelative(url) ? `${pre}${quote}${RAW}${clean(url)}${quote}` : m,
			)
			.replace(/(<a\b[^>]*?\bhref=)(["'])([^"']+)\2/gi, (m, pre, quote, url) =>
				isRelative(url) ? `${pre}${quote}${BLOB}${clean(url)}${quote}` : m,
			)
			.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, pre, url, post) =>
				isRelative(url) ? `${pre}${RAW}${clean(url)}${post}` : m,
			)
			// Any remaining `](target)` is a link, including badge links whose text
			// is itself an image (`[![alt](img)](target)`).
			.replace(/(\]\()([^)\s]+)(\))/g, (m, pre, url, post) =>
				isRelative(url) ? `${pre}${BLOB}${clean(url)}${post}` : m,
			)
	);
}

const readme = readFileSync(source, "utf8");
const generated = `<!-- Generated from README.md by scripts/sync-readme.mjs. Edit that file, not this one. -->\n\n${rewrite(readme)}`;
writeFileSync(target, generated);
console.log(
	`packages/gitframes/README.md ← README.md (${generated.length} bytes)`,
);
