// Fails when the package source, docs or build output depend on or disclose the upstream SDK / hosts.
// Note: Model endpoint identifiers (e.g. "fal-ai/flux/schnell") are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
// `--dist` also scans the build output; the build script passes it right after building.
const scan = ["src", "README.md", "package.json"];
if (process.argv.includes("--dist")) scan.push("dist");
// Encoded so this file does not match itself.
const names = [
	"ZmFs",
	"ZmFsLWFp",
	"ZmFsX2Fp",
	"Ynl0ZXBsdXM=",
	"Ynl0ZXBsdXNlcw==",
	"dm9sY2Vz",
].map((b) => atob(b));
const pattern = new RegExp(`\\b(${names.join("|")})\\b|\\.${names[0]}\\.`, "i");

function* files(path) {
	let stat;
	try {
		stat = statSync(path);
	} catch {
		return;
	}
	if (!stat.isDirectory()) {
		yield path;
		return;
	}
	for (const entry of readdirSync(path)) yield* files(join(path, entry));
}

const hits = [];
for (const target of scan) {
	for (const file of files(join(root, target))) {
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, i) => {
				// Strip permitted model names, prefixes and target paths before scanning
				const stripped = line
					.replace(
						/(?:run|queue|storage)?\/?fal(?:-ai)?\/[a-zA-Z0-9_\-./]+/gi,
						"",
					)
					.replace(/fal(?:-ai)?\//gi, "");
				if (pattern.test(stripped))
					hits.push(`${relative(root, file)}:${i + 1}`);
			});
	}
}

if (hits.length) {
	console.error(
		`Upstream provider leak in @framefields/ai:\n  ${hits.join("\n  ")}`,
	);
	process.exit(1);
}
process.exit(0);
