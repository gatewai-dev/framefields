// Writes schemas/project.v1.json, the JSON Schema for framefields.json, from
// the zod schema in src/project so editors validate the manifest. Runs after
// tsdown, against the built module.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
	MANIFEST_SCHEMA_URL,
	projectManifestSchema,
} from "../dist/project/index.mjs";

const schema = {
	...z.toJSONSchema(projectManifestSchema, { io: "input" }),
	$id: MANIFEST_SCHEMA_URL,
	title: "framefields.json",
	description:
		"Framefields project manifest: the project's compositions, by stable id.",
};

mkdirSync("schemas", { recursive: true });
writeFileSync(
	"schemas/project.v1.json",
	`${JSON.stringify(schema, null, "\t")}\n`,
);
console.log("schemas/project.v1.json");
