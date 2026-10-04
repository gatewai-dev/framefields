#!/usr/bin/env node
// Structural validator for the gitframes agent plugin.
//
// The plugin lives in plugins/gitframes/ so installs ship only the skills, not the engine
// (users get the engine from npm). Every client discovers the same skills from there:
//   plugin.json                 portable Agent Plugins 1.0 manifest (closed field set)
//   .claude-plugin/plugin.json  Claude Code manifest
//   skills/<name>/SKILL.md      the skills themselves
//   README.md, LICENSE          required by Anthropic's plugin directory
//
// Enforces the rules we depend on from:
//   - Agent Plugins 1.0.0 (portable manifest, fixed component locations, path containment)
//   - Agent Skills (SKILL.md frontmatter: name matches directory, description limits)
//   - Claude Code plugins (overlay manifest, marketplace schema)
//
// Dependency-free on purpose: `node scripts/validate-agent-plugin.mjs` runs from CI without an install.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(repoRoot, "plugins", "gitframes");
const PLUGIN_NAME = "gitframes";
const MARKETPLACE_NAME = "gitframes-plugins";
const AGENT_PLUGINS_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const SKILL_NAMES = [
	"gitframes",
	"gitframes-compose",
	"gitframes-effects",
	"gitframes-render",
];
const PORTABLE_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);
// Agent Plugins §5.4 / https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Marketplace names Anthropic refuses to load (plugins-reference / plugin-marketplaces).
const CLAUDE_RESERVED = new Set([
	"claude-code-marketplace",
	"claude-code-plugins",
	"claude-plugins-official",
	"claude-plugins-community",
	"claude-community",
	"anthropic-marketplace",
	"anthropic-plugins",
	"agent-skills",
	"anthropic-agent-skills",
	"knowledge-work-plugins",
]);

const checks = [];
const errors = [];
const ok = (msg) => checks.push(msg);
const fail = (msg) => errors.push(msg);

const rel = (p) => relative(repoRoot, p);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function insideRepo(p) {
	const r = rel(resolve(repoRoot, p));
	return r !== "" && !r.startsWith("..") && !r.includes(`..${sep}`);
}

/** Minimal frontmatter reader: top-level scalars only (the spec's `metadata` map is not needed by these checks). */
function parseFrontmatter(file) {
	const text = readFileSync(file, "utf8");
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match) return null;
	const fields = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
		if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
	}
	return { fields, body: text.slice(match[0].length) };
}

function checkManifests() {
	const portableFile = join(PLUGIN_DIR, "plugin.json");
	if (!existsSync(portableFile)) {
		fail(
			"plugin.json is missing (portable Agent Plugins manifest must sit at the plugin root)",
		);
		return;
	}
	const portable = readJson(portableFile);
	for (const key of Object.keys(portable)) {
		if (!PORTABLE_FIELDS.has(key))
			fail(
				`plugin.json: unknown top-level field "${key}" — the portable schema is closed`,
			);
	}
	if (portable.$schema !== AGENT_PLUGINS_SCHEMA)
		fail(`plugin.json: $schema must be exactly ${AGENT_PLUGINS_SCHEMA}`);
	if (!portable.name || !NAME_RE.test(portable.name))
		fail(
			`plugin.json: name "${portable.name}" violates the Agent Plugins name pattern`,
		);
	if (portable.name !== PLUGIN_NAME)
		fail(`plugin.json: name must be "${PLUGIN_NAME}"`);
	if (!portable.description) fail("plugin.json: description is missing");
	if (!SEMVER_RE.test(portable.version ?? ""))
		fail(`plugin.json: version "${portable.version}" is not semver`);
	ok(
		`portable plugin.json (${Object.keys(portable).length} fields, closed schema)`,
	);

	const claudeFile = join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
	if (!existsSync(claudeFile)) {
		fail(`${rel(claudeFile)} is missing`);
		return;
	}

	const claude = readJson(claudeFile);
	if (claude.name !== PLUGIN_NAME)
		fail(`.claude-plugin/plugin.json: name must be "${PLUGIN_NAME}"`);
	if (!claude.version)
		fail(
			".claude-plugin/plugin.json: version is required (it gates plugin updates)",
		);
	if (!claude.description)
		fail(".claude-plugin/plugin.json: description is required");
	ok("claude overlay manifest");

	// Version drift means one client serves a stale skill set while another is current.
	if (portable.version !== claude.version)
		fail(
			`version mismatch between plugin.json (${portable.version}) and .claude-plugin/plugin.json (${claude.version})`,
		);
	else
		ok(`version pinned consistently at ${portable.version} in both manifests`);
	if (claude.icon && !existsSync(join(PLUGIN_DIR, claude.icon)))
		fail(`.claude-plugin/plugin.json: icon ${claude.icon} does not exist`);
	for (const file of ["README.md", "LICENSE"]) {
		if (!existsSync(join(PLUGIN_DIR, file)))
			fail(
				`${rel(join(PLUGIN_DIR, file))} is missing (the plugin directory requires it)`,
			);
	}
	// The plugin ships to users as-is: no lockfile or package.json, or installs run npm.
	for (const file of ["package.json", "package-lock.json", "pnpm-lock.yaml"]) {
		if (existsSync(join(PLUGIN_DIR, file)))
			fail(`${rel(join(PLUGIN_DIR, file))} must not ship with the plugin`);
	}
}

function checkSkills() {
	const skillsDir = join(PLUGIN_DIR, "skills");
	if (!existsSync(skillsDir)) {
		fail(
			"skills/ is missing at the plugin root — every client discovers skills from there",
		);
		return;
	}
	if (existsSync(join(PLUGIN_DIR, "SKILL.md"))) {
		fail(
			"no SKILL.md at the plugin root — Claude Code would load it as an extra skill",
		);
	}
	const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
		d.isDirectory(),
	);
	if (dirs.length === 0) fail("skills/ has no skill directories");
	const names = dirs.map((d) => d.name).sort();
	if (names.join() !== [...SKILL_NAMES].sort().join()) {
		fail(
			`skills/ must contain exactly ${[...SKILL_NAMES].sort().join(", ")} — found ${names.join(", ")}`,
		);
	}
	for (const entry of dirs) {
		const file = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(file)) {
			fail(`skills/${entry.name}: SKILL.md is missing`);
			continue;
		}
		const fm = parseFrontmatter(file);
		if (!fm) {
			fail(`skills/${entry.name}: SKILL.md has no YAML frontmatter`);
			continue;
		}
		const { name, description } = fm.fields;
		if (!name || !NAME_RE.test(name) || name.length > 64)
			fail(
				`skills/${entry.name}: invalid name "${name}" (lowercase alnum + single hyphens, <=64)`,
			);
		if (name !== entry.name)
			fail(
				`skills/${entry.name}: frontmatter name "${name}" must equal the directory name`,
			);
		if (!description) fail(`skills/${entry.name}: description is required`);
		else if (description.length > 1024)
			fail(
				`skills/${entry.name}: description is ${description.length} chars (max 1024)`,
			);
		else if (!/gitframes/i.test(description))
			fail(
				`skills/${entry.name}: description never mentions gitframes — hosts match on it`,
			);
		if (fm.body.trim().length < 400)
			fail(`skills/${entry.name}: body is too thin to carry a workflow`);
		ok(
			`skill ${name} (description ${description?.length ?? 0} chars, body ${fm.body.trim().length} chars)`,
		);
	}
}

function checkMarketplace(file) {
	if (!existsSync(file)) {
		fail(`${rel(file)} is missing`);
		return;
	}
	const catalog = readJson(file);
	if (catalog.name !== MARKETPLACE_NAME)
		fail(`${rel(file)}: marketplace name must be "${MARKETPLACE_NAME}"`);
	if (CLAUDE_RESERVED.has(catalog.name))
		fail(`${rel(file)}: marketplace name is reserved by Anthropic`);
	if (!catalog.owner?.name) fail(`${rel(file)}: owner.name is required`);
	if (!Array.isArray(catalog.plugins) || catalog.plugins.length === 0) {
		fail(`${rel(file)}: plugins[] is empty`);
		return;
	}
	for (const entry of catalog.plugins) {
		if (!entry.name || !NAME_RE.test(entry.name))
			fail(`${rel(file)}: entry name "${entry.name}" is not kebab-case`);
		const source = entry.source;
		if (typeof source !== "string" || !source.startsWith("./")) {
			fail(
				`${rel(file)}: entry "${entry.name}" needs a "./"-prefixed path source`,
			);
			continue;
		}
		const dir = resolve(repoRoot, source);
		if (!insideRepo(source)) {
			fail(`${rel(file)}: entry "${entry.name}" escapes the repo root`);
			continue;
		}
		if (!existsSync(dir)) {
			fail(
				`${rel(file)}: entry "${entry.name}" points at missing directory ${source}`,
			);
			continue;
		}
		const manifest = join(dir, ".claude-plugin", "plugin.json");
		if (!existsSync(manifest))
			fail(
				`${rel(file)}: entry "${entry.name}" is not a Claude Code plugin (${rel(manifest)} missing)`,
			);
		for (const skillPath of entry.skills ?? []) {
			if (!existsSync(resolve(dir, skillPath)))
				fail(
					`${rel(file)}: entry "${entry.name}" lists missing skill ${skillPath}`,
				);
		}
		ok(`marketplace entry ${entry.name} -> ${source}`);
	}
}

/** Zero-install discovery while working in this repo: Claude Code reads .claude/skills/, other agents .agents/skills/. */
function checkSymlinks() {
	for (const root of [join(".agents", "skills"), join(".claude", "skills")]) {
		const dir = join(repoRoot, root);
		if (!existsSync(dir)) {
			fail(`${root} is missing`);
			continue;
		}
		for (const name of SKILL_NAMES) {
			const link = join(root, name);
			const path = join(repoRoot, link);
			if (!existsSync(path)) {
				fail(`${link}: dangling symlink`);
				continue;
			}
			const target = realpathSync(path);
			const expected = join(PLUGIN_DIR, "skills", name);
			if (!statSync(target).isDirectory())
				fail(`${link}: must point at a directory`);
			else if (!existsSync(join(target, "SKILL.md")))
				fail(`${link}: target has no SKILL.md`);
			else if (target !== expected)
				fail(`${link}: must point at ${rel(expected)} (found ${rel(target)})`);
			else ok(`${link} -> ${rel(expected)}`);
		}
	}
}

/** The effects catalog is generated; drift must fail the check. */
function checkEffectsCatalog() {
	const generator = join(repoRoot, "scripts", "sync-effects-catalog.mjs");
	if (!existsSync(generator)) {
		fail("scripts/sync-effects-catalog.mjs is missing");
		return;
	}
	const run = spawnSync(process.execPath, [generator, "--check"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	if (run.status !== 0)
		fail(
			`effects catalog is out of date — run \`pnpm run sync:effects-catalog\`\n${run.stdout}${run.stderr}`,
		);
	else
		ok("effects catalog matches the generated and hand-written effect classes");
}

/** The effect classes are generated from the node packages; drift must fail the check. */
function checkGeneratedEffects() {
	const generator = join(repoRoot, "scripts", "generate-effects.mts");
	if (!existsSync(generator)) {
		fail("scripts/generate-effects.mts is missing");
		return;
	}
	const run = spawnSync(
		process.execPath,
		["--conditions", "development", "--import", "tsx", generator, "--check"],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	if (run.status !== 0)
		fail(
			`generated effects are out of date — run \`pnpm run generate:effects\`\n${run.stdout}${run.stderr}`,
		);
	else ok("generated effects match the node schemas");
}

checkManifests();
checkSkills();
checkSymlinks();
checkGeneratedEffects();
checkEffectsCatalog();
checkMarketplace(join(repoRoot, ".claude-plugin", "marketplace.json"));

for (const line of checks) console.log(`✓ ${line}`);
for (const line of errors) console.error(`✗ ${line}`);
console.log(`\n${checks.length} checks passed, ${errors.length} failed`);
process.exit(errors.length === 0 ? 0 : 1);
