import fs from "node:fs";
import path from "node:path";
import { type Composition, PersonTrack } from "framefields";
import { DANCER, H, TRACK_CACHE, W } from "./theme.js";

/**
 * The dancer's pose and silhouette for every frame, placed in composition
 * pixels. Tracking runs once (about 30 s) and is cached in output/.
 */
export async function performer(comp: Composition): Promise<PersonTrack> {
	if (!fs.existsSync(DANCER)) {
		throw new Error(
			`Missing ${DANCER}. Generate it with \`pnpm assets\` in examples/19_framefields_film.`,
		);
	}
	let track: PersonTrack;
	if (fs.existsSync(TRACK_CACHE)) {
		track = PersonTrack.fromJSON(
			JSON.parse(fs.readFileSync(TRACK_CACHE, "utf8")),
		);
	} else {
		console.log("Tracking the dancer (pose + silhouette)…");
		track = await comp.trackPerson(DANCER, {
			onProgress: (f, n) => f % 40 === 0 && console.log(`  ${f}/${n}`),
		});
		fs.mkdirSync(path.dirname(TRACK_CACHE), { recursive: true });
		fs.writeFileSync(TRACK_CACHE, JSON.stringify(track.toJSON()));
	}
	return track.place({ width: W, height: H, fit: "cover" });
}
