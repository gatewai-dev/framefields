import type { TrackedObject } from "@gitframes/core";
import type { PosePerson } from "../types.js";
import { computeIoU, type PixelBox } from "./temporal-object-tracker.js";

export function getPersonBoundingBox(person: PosePerson): PixelBox {
	if (
		person.boundingBox &&
		person.boundingBox.width > 0 &&
		person.boundingBox.height > 0
	) {
		return {
			originX: person.boundingBox.originX,
			originY: person.boundingBox.originY,
			width: person.boundingBox.width,
			height: person.boundingBox.height,
		};
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let validCount = 0;

	for (const kp of person.keypoints) {
		if (kp.visibility > 0.1) {
			validCount++;
			if (kp.x < minX) minX = kp.x;
			if (kp.y < minY) minY = kp.y;
			if (kp.x > maxX) maxX = kp.x;
			if (kp.y > maxY) maxY = kp.y;
		}
	}

	if (validCount === 0 || minX >= maxX || minY >= maxY) {
		return {
			originX: person.boundingBox?.originX ?? 0,
			originY: person.boundingBox?.originY ?? 0,
			width: person.boundingBox?.width ?? 0,
			height: person.boundingBox?.height ?? 0,
		};
	}

	return {
		originX: minX,
		originY: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/**
 * Matches detected pose people with active person tracks using greedy bipartite IoU.
 *
 * Annotates each person with the matched trackId.
 */
export function matchPoseToTracks(
	people: readonly PosePerson[],
	trackedObjects: readonly TrackedObject[],
	minIoU = 0.15,
): PosePerson[] {
	if (people.length === 0) return [];

	const personTracks = trackedObjects.filter(
		(o) => o.category.toLowerCase() === "person" && o.active,
	);

	if (personTracks.length === 0) {
		return [...people];
	}

	// Calculate candidate pairings by IoU
	const candidateMatches: {
		personIdx: number;
		trackId: number;
		iou: number;
	}[] = [];

	for (let p = 0; p < people.length; p++) {
		const person = people[p];
		if (person.trackId !== undefined) continue;

		const pBox = getPersonBoundingBox(person);
		const isNormalized = pBox.width <= 1.05 && pBox.height <= 1.05;
		for (const trk of personTracks) {
			const targetBox: PixelBox =
				isNormalized && trk.boundingBox.normalizedWidth > 0
					? {
							originX: trk.boundingBox.normalizedX,
							originY: trk.boundingBox.normalizedY,
							width: trk.boundingBox.normalizedWidth,
							height: trk.boundingBox.normalizedHeight,
						}
					: trk.boundingBox;
			const iou = computeIoU(pBox, targetBox);
			if (iou >= minIoU) {
				candidateMatches.push({ personIdx: p, trackId: trk.trackId, iou });
			}
		}
	}

	// Sort by IoU descending
	candidateMatches.sort((a, b) => b.iou - a.iou);

	const assignedPeople = new Set<number>();
	const assignedTracks = new Set<number>();
	const personTrackMap = new Map<number, number>();

	for (const match of candidateMatches) {
		if (
			assignedPeople.has(match.personIdx) ||
			assignedTracks.has(match.trackId)
		) {
			continue;
		}
		assignedPeople.add(match.personIdx);
		assignedTracks.add(match.trackId);
		personTrackMap.set(match.personIdx, match.trackId);
	}

	// Single person & single track fallback
	if (
		people.length === 1 &&
		personTracks.length === 1 &&
		!personTrackMap.has(0) &&
		people[0].trackId === undefined
	) {
		personTrackMap.set(0, personTracks[0].trackId);
	}

	return people.map((person, idx) => {
		if (person.trackId !== undefined) return person;
		const trackId = personTrackMap.get(idx);
		return trackId !== undefined ? { ...person, trackId } : person;
	});
}
