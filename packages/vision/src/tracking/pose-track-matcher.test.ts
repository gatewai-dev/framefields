import type { TrackedObject } from "@gitframes/core";
import { describe, expect, it } from "vitest";
import type { PosePerson } from "../types.js";
import { matchPoseToTracks } from "./pose-track-matcher.js";

function makePersonTrack(
	trackId: number,
	originX: number,
	originY: number,
	width: number,
	height: number,
	active = true,
): TrackedObject {
	return {
		trackId,
		category: "person",
		score: 0.9,
		boundingBox: {
			originX,
			originY,
			width,
			height,
			normalizedX: originX / 1000,
			normalizedY: originY / 1000,
			normalizedWidth: width / 1000,
			normalizedHeight: height / 1000,
		},
		centerX: originX + width / 2,
		centerY: originY + height / 2,
		normalizedCenterX: (originX + width / 2) / 1000,
		normalizedCenterY: (originY + height / 2) / 1000,
		velocity: { vx: 0, vy: 0 },
		speed: 0,
		age: 10,
		hits: 10,
		active,
		isCoasting: false,
	};
}

function makePosePerson(
	originX: number,
	originY: number,
	width: number,
	height: number,
): PosePerson {
	const keypoints = Array.from({ length: 17 }, () => ({
		x: (originX + width / 2) / 1000,
		y: (originY + height / 2) / 1000,
		visibility: 0.9,
	}));
	return {
		score: 0.88,
		boundingBox: {
			originX,
			originY,
			width,
			height,
			normalizedX: originX / 1000,
			normalizedY: originY / 1000,
			normalizedWidth: width / 1000,
			normalizedHeight: height / 1000,
		},
		keypoints,
	};
}

describe("matchPoseToTracks", () => {
	it("associates 2 people with their corresponding tracks by IoU", () => {
		const trackA = makePersonTrack(10, 100, 100, 50, 150);
		const trackB = makePersonTrack(20, 500, 100, 50, 150);

		// Person 0 is near track B, Person 1 is near track A
		const personNearB = makePosePerson(505, 105, 48, 145);
		const personNearA = makePosePerson(98, 98, 52, 152);

		const matched = matchPoseToTracks(
			[personNearB, personNearA],
			[trackA, trackB],
		);

		expect(matched[0].trackId).toBe(20);
		expect(matched[1].trackId).toBe(10);
	});

	it("keeps identities locked during crossing paths via bipartite matching", () => {
		// Actor 1 moving right (now at 300), Actor 2 moving left (now at 320)
		const track1 = makePersonTrack(1, 300, 100, 60, 160);
		const track2 = makePersonTrack(2, 330, 100, 60, 160);

		const pose1 = makePosePerson(295, 95, 62, 165);
		const pose2 = makePosePerson(335, 102, 58, 158);

		const matched = matchPoseToTracks([pose1, pose2], [track1, track2]);

		expect(matched[0].trackId).toBe(1);
		expect(matched[1].trackId).toBe(2);
	});

	it("preserves trackId on existing annotated people", () => {
		const trackA = makePersonTrack(1, 100, 100, 50, 50);
		const poseA: PosePerson = {
			...makePosePerson(100, 100, 50, 50),
			trackId: 999, // explicitly assigned
		};

		const matched = matchPoseToTracks([poseA], [trackA]);
		expect(matched[0].trackId).toBe(999);
	});
});
