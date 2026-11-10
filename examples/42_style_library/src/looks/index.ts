import type { Reference } from "../frame.js";
import { blueprint } from "./blueprint.js";
import { collage } from "./collage.js";
import { keynote } from "./keynote.js";
import { motion } from "./motion.js";

/** One reference per look in the style library. */
export const REFERENCES: Reference[] = [blueprint, collage, keynote, motion];
