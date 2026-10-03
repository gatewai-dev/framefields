import type { FileData, VirtualMediaData } from "../types/index.js";

/**
 * Gets a stable object for hashing/fingerprinting by sorting keys and skipping volatile fields.
 */
function getStableData(data: any): any {
	if (typeof data !== "object" || data === null) return data;
	if (Array.isArray(data)) return data.map(getStableData);

	const result: any = {};
	const keys = Object.keys(data).sort();
	for (const key of keys) {
		const val = data[key];
		// Skip volatile fields entirely for fingerprinting
		if (
			key === "createdAt" ||
			key === "updatedAt" ||
			key === "dataUrl" ||
			key === "filePath"
		)
			continue;
		if (typeof val === "string" && val.startsWith("blob:")) continue;

		// For entities, we only care about the ID if it exists
		if (key === "entity" && val && typeof val === "object" && val.id) {
			result.entity = { id: val.id };
			continue;
		}

		result[key] = getStableData(val);
	}
	return result;
}

/**
 * Generates a fingerprint for the given data.
 */
export function getFingerprint(data: unknown): string {
	const stableData = getStableData(data);
	const str = JSON.stringify(stableData);
	if (str.length === 0) return "0";

	const getHash = (seed: number) => {
		let h1 = 0xdeadbeef ^ seed;
		let h2 = 0x41c6ce57 ^ seed;
		for (let i = 0; i < str.length; i++) {
			const ch = str.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822519);
		h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489917);
		h1 = h1 ^ (h1 >>> 16);
		h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822519);
		h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489917);
		h2 = h2 ^ (h2 >>> 16);
		return (
			(h1 >>> 0).toString(36).padStart(7, "0") +
			(h2 >>> 0).toString(36).padStart(7, "0")
		);
	};

	return getHash(0) + getHash(1);
}

/**
 * Generates a version-aware fingerprint for render caching.
 * Includes app version so cached renders are invalidated on version bumps.
 */
export function getRenderFingerprint(
	data: unknown,
	appVersion: string,
	extra?: Record<string, unknown>,
): string {
	return getFingerprint({ __v: appVersion, data, ...extra });
}

/**
 * Checks if data is VirtualMediaData.
 */
export function isVirtualMediaData(data: any): data is VirtualMediaData {
	return (
		typeof data === "object" &&
		data !== null &&
		"metadata" in data &&
		"operation" in data &&
		"children" in data
	);
}

/**
 * Checks if the virtual media is just a raw source without any significant operations
 * that would require a rendering step (like transformations, trimming, or effects).
 */
export function hasOnlySingleSource(data: any): boolean {
	if (!isVirtualMediaData(data)) return false;

	// For source operation, ensure no children and no modifications
	if (data.operation.op === "source") {
		if (data.children && data.children.length > 0) return false;

		const op = data.operation as any;
		const hasModifications =
			(op.volume !== undefined && op.volume !== 1) ||
			(op.opacity !== undefined && op.opacity !== 1) ||
			(op.startFrame !== undefined && op.startFrame !== 0) ||
			(op.timeline &&
				((op.timeline.startFrame !== undefined &&
					op.timeline.startFrame !== 0) ||
					(op.timeline.segments && op.timeline.segments.length > 0)));

		return !hasModifications;
	}

	// All compose operations are considered as not only source
	if (data.operation.op === "compose") {
		return false;
	}

	// A layer with exactly one child can be considered "only source" if it has no transformations
	if (data.operation.op === "layer" && data.children.length === 1) {
		const op = data.operation as any;
		const hasModifications =
			(op.x !== undefined && op.x !== 0) ||
			(op.y !== undefined && op.y !== 0) ||
			(op.rotation !== undefined && op.rotation !== 0) ||
			(op.scale !== undefined && op.scale !== 1) ||
			(op.opacity !== undefined && op.opacity !== 1) ||
			(op.volume !== undefined && op.volume !== 1) ||
			op.zIndex !== undefined ||
			op.blendMode !== undefined ||
			op.filters !== undefined ||
			op.transitionIn !== undefined ||
			op.transitionOut !== undefined ||
			(op.animations && op.animations.length > 0) ||
			op.trimStart !== undefined ||
			op.trimEnd !== undefined ||
			op.speed !== undefined ||
			op.backgroundColor !== undefined ||
			op.borderColor !== undefined ||
			op.borderWidth !== undefined ||
			op.strokeRadius !== undefined;

		if (!hasModifications) {
			return hasOnlySingleSource(data.children[0]);
		}
	}

	return false;
}

/**
 * Finds the source asset in a virtual media tree.
 */
export function findSourceAsset(vm: VirtualMediaData): FileData | null {
	if (vm.operation.op === "source") return vm.operation.source;
	if (vm.children && vm.children.length > 0) {
		return findSourceAsset(vm.children[0]);
	}
	return null;
}
