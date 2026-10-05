// `node:fs/promises` for the browser preview bundle; see fs.ts.
import { promises } from "./fs.js";

export const {
	readFile,
	stat,
	access,
	readdir,
	writeFile,
	appendFile,
	mkdir,
	rm,
	unlink,
	rename,
	copyFile,
	open,
} = promises;
export default promises;
