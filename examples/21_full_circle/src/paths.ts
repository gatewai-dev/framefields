import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const ASSETS = path.resolve(HERE, "../assets");
export const OUTPUT = path.resolve(HERE, "../output");
export const asset = (file: string) => path.join(ASSETS, file);
export const font = (file: string) => path.join(ROOT, "assets/fonts", file);
