import { nanoid } from "nanoid";

/**
 * Generates a unique ID using nanoid.
 * This function is cross-platform compatible (Node.js and Browser).
 *
 * @param size - Optional size of the ID (default is 21)
 * @returns A unique string ID
 */
export const generateId = (size?: number): string => {
	return nanoid(size);
};
