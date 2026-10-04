#!/usr/bin/env node
// Keeps the agent plugin version in lockstep with the released `gitframes` package.
//
// Runs after `changeset version` (see `version:packages`), so every release bumps the
// version in all three plugin manifests. Clients compare that version to decide when
// to update, so a stale one leaves users on old skills.
//
// Dependency-free on purpose, like validate-agent-plugin.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
	"plugins/gitframes/plugin.json",
	"plugins/gitframes/.claude-plugin/plugin.json",
	"plugins/gitframes/.codex-plugin/plugin.json",
];

const { version } = JSON.parse(
	readFileSync(join(repoRoot, "packages/gitframes/package.json"), "utf8"),
);

for (const manifest of MANIFESTS) {
	const path = join(repoRoot, manifest);
	const source = readFileSync(path, "utf8");
	// Replace the value in place so the file's formatting and key order survive.
	const updated = source.replace(
		/("version"\s*:\s*)"[^"]*"/,
		`$1${JSON.stringify(version)}`,
	);
	if (updated === source && JSON.parse(source).version !== version)
		throw new Error(`${manifest}: no "version" field to update`);
	writeFileSync(path, updated);
	console.log(`${manifest} → ${version}`);
}
