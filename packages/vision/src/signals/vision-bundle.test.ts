/// <reference types="webgpu" />
import {
	type FrameContext,
	frameSignal,
	type TrackedObject,
} from "@framefields/core";
import { describe, expect, it } from "vitest";
import type {
	InstanceMask,
	LandmarkCoordinateSignals,
	PoseResult,
} from "../types.js";
import { VisionBundle } from "./vision-bundle.js";

const ctx = (frame: number): FrameContext => ({
	frame,
	fps: 24,
	time: frame / 24,
	duration: 10 / 24,
	durationMs: 10 / 24 / 1000,
	progress: 0,
	deltaTime: 1 / 24,
});

function track(
	id: number,
	category: string,
	x: number,
	y: number,
	w: number,
	h: number,
	score = 0.9,
): TrackedObject {
	return {
		trackId: id,
		category,
		score,
		boundingBox: {
			originX: x,
			originY: y,
			width: w,
			height: h,
			normalizedX: x / 100,
			normalizedY: y / 100,
			normalizedWidth: w / 100,
			normalizedHeight: h / 100,
		},
		centerX: x + w / 2,
		centerY: y + h / 2,
		normalizedCenterX: (x + w / 2) / 100,
		normalizedCenterY: (y + h / 2) / 100,
		velocity: { vx: 2, vy: 0 },
		speed: 2,
		age: 5,
		hits: 5,
		active: true,
		isCoasting: false,
	};
}

function poseResult(score = 0.8): PoseResult {
	const keypoints = Array.from({ length: 17 }, (_, i) => ({
		x: 0.1 + i * 0.02,
		y: 0.3 + i * 0.01,
		visibility: 0.9,
	}));
	return {
		people: [
			{
				score,
				boundingBox: track(0, "person", 0, 0, 50, 100).boundingBox,
				keypoints,
			},
		],
	};
}

function mask(
	trackId: number,
	category: string,
	area: number,
	width = 100,
	height = 100,
): InstanceMask {
	return {
		category,
		mask: new Uint8Array(width * height),
		width,
		height,
		area,
		coverage: area / (width * height),
		detectionIndex: trackId,
		trackId,
	};
}

describe("VisionBundle", () => {
	it("named pose landmarks mirror the primary person's COCO-17 keypoints", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		const res = poseResult();
		bundle.setPoseResult(2, res);

		frameSignal.set(2);
		const nose = bundle.poseLandmarks.nose.screenX.get();
		expect(nose).toBeCloseTo(res.people[0].keypoints[0].x * 100, 5);
		// numeric proxy access matches named access
		expect(
			(
				bundle.poseLandmarks as unknown as Record<
					number,
					LandmarkCoordinateSignals
				>
			)[0].screenX.get(),
		).toBeCloseTo(nose, 5);
		const leftShoulder = bundle.poseLandmarks.leftShoulder.screenY.get();
		expect(leftShoulder).toBeCloseTo(res.people[0].keypoints[5].y * 100, 5);
	});

	it("pose signals fall back to neutral when nobody is detected", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		frameSignal.set(3);
		expect(bundle.poseLandmarks.nose.x.get()).toBe(0.5);
		expect(bundle.poseLandmarks.nose.screenX.get()).toBe(50);
	});

	it("objects signals expose tracked state, categories and kinematics", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		const person = track(1, "person", 10, 20, 30, 40);
		const car = track(2, "car", 50, 50, 20, 10, 0.7);
		bundle.setObjectResult(0, { objects: [person, car], rawDetections: [] });

		frameSignal.set(0);
		expect(bundle.objects.count.get()).toBe(2);
		expect(bundle.objects.getActiveTracks(0)).toHaveLength(2);
		expect(bundle.objects.detectedCategories).toEqual(["car", "person"]);
		expect(bundle.objects.hasCategory("person").get()).toBe(1.0);
		expect(bundle.objects.hasCategory("dog").get()).toBe(0.0);

		const byCat = bundle.objects.byCategory("person");
		expect(byCat.category).toBe("person");
		expect(byCat.center.screenX.get()).toBe(25);
		expect(byCat.bounds.screenWidth.get()).toBe(30);
		expect(byCat.kinematics.speed.get()).toBe(2);
		expect(byCat.trackId).toBe(1);

		const primary = bundle.objects.primary;
		expect(primary.trackId).toBe(1); // highest score
	});

	it("classes surface per-category count/maxConfidence/present with stable identity", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		bundle.setObjectResult(0, {
			objects: [
				track(1, "person", 0, 0, 10, 10, 0.8),
				track(2, "person", 20, 20, 30, 30, 0.95),
				track(3, "car", 50, 50, 10, 10, 0.6),
			],
			rawDetections: [],
		});

		frameSignal.set(0);
		const person = bundle.classes.get("person");
		expect(bundle.classes.get("person")).toBe(person); // stable identity
		expect(person.count.get()).toBe(2);
		expect(person.present.get()).toBe(1.0);
		expect(person.maxConfidence.get()).toBeCloseTo(0.95, 5);
		expect(bundle.classes.names).toEqual(["car", "person"]);
		expect(bundle.classes.get("dog").present.get()).toBe(0.0);
	});

	it("masks subject = largest instance, person preferred", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		bundle.setObjectResult(0, {
			objects: [
				track(1, "car", 10, 10, 30, 30),
				track(3, "person", 10, 10, 30, 30),
			],
			rawDetections: [],
		});
		bundle.setMaskResult(0, [
			mask(1, "car", 500),
			mask(2, "person", 400),
			mask(3, "person", 700),
		]);

		frameSignal.set(0);
		expect(bundle.masks.subject.trackId).toBe(3);
		expect(bundle.masks.subject.category).toBe("person");
		expect(bundle.masks.subject.coverage.get()).toBeCloseTo(0.07, 5);
		expect(bundle.masks.subject.solidity.get()).toBeGreaterThan(0);
		expect(bundle.masks.count.get()).toBe(3);

		// per-track access
		expect(bundle.masks.get(1).category).toBe("car");
	});

	it("segmentation mirrors subject + holds the stencil texture", () => {
		const bundle = new VisionBundle({ totalFrames: 10 });
		bundle.setMaskResult(1, [mask(5, "person", 900)]);
		frameSignal.set(1);
		expect(bundle.segmentation.subject.trackId).toBe(5);
		expect(bundle.segmentation.humanSilhouette.trackId).toBe(5);
		expect(bundle.segmentation.instanceMasks.get(5).trackId).toBe(5);
		const stencil = {} as GPUTexture;
		bundle.setStencilTexture(stencil);
		expect(bundle.segmentation.stencilTexture).toBe(stencil);
	});

	it("tensors are well-formed and frame-scoped", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		bundle.setPoseResult(0, poseResult());
		bundle.setObjectResult(0, {
			objects: [track(1, "person", 10, 10, 20, 20)],
			rawDetections: [],
		});
		bundle.setMaskResult(0, [mask(1, "person", 150)]);

		const poseTensor = bundle.poseLandmarksTensor.get(ctx(0));
		expect(poseTensor.shape).toEqual([17, 3]);
		expect(poseTensor.data).toHaveLength(51);
		expect(poseTensor.data[0]).toBeCloseTo(0.1, 5);

		const objTensor = bundle.objectsTensor.get(ctx(0));
		expect(objTensor.shape).toEqual([16, 8]);
		expect(objTensor.data[0]).toBe(1.0); // active
		expect(objTensor.data[2]).toBe(20); // centerX

		const maskTensor = bundle.masksTensor.get(ctx(0));
		expect(maskTensor.shape).toEqual([16, 2]);
		expect(maskTensor.data[0]).toBeCloseTo(0.015, 5);

		const hist = bundle.classes.histogram.get(ctx(0));
		expect(hist.shape).toEqual([80]);
		expect(hist.data[0]).toBe(1); // person at index 0

		// top-level convenience mirror
		const topHist = bundle.histogramTensor.get(ctx(0));
		expect(topHist.shape).toEqual([80]);
		expect(topHist.data[0]).toBe(1);
	});

	it("clamps out-of-range frame reads to neutral values (no crash)", () => {
		const bundle = new VisionBundle({ totalFrames: 10 });
		frameSignal.set(47); // beyond cache
		expect(bundle.objects.count.get()).toBe(0);
		expect(bundle.masks.subject.coverage.get()).toBe(0);
	});

	it("summary() snapshots objects/classes/masks for a frame", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 100,
			height: 100,
		});
		bundle.setObjectResult(0, {
			objects: [
				track(1, "person", 10, 20, 30, 40),
				track(2, "car", 50, 50, 20, 10, 0.7),
			],
			rawDetections: [],
		});
		bundle.setMaskResult(0, [mask(1, "person", 500), mask(2, "car", 200)]);

		const snap = bundle.summary(0);
		expect(snap.frame).toBe(0);
		expect(snap.objects).toHaveLength(2);
		expect(snap.objects[0]).toMatchObject({
			trackId: 1,
			category: "person",
			active: true,
			center: [25, 40],
		});
		expect(snap.classes).toEqual(["car", "person"]);
		expect(snap.masks).toEqual({ person: 1, car: 1 });
	});

	it("cache lookback retains masks across intermediate frames", () => {
		const bundle = new VisionBundle({
			totalFrames: 15,
			width: 100,
			height: 100,
		});
		const m = mask(1, "person", 500);
		bundle.setMaskResult(2, [m]);

		// Exactly at frame 2
		expect(bundle.getMaskResult(2)).toHaveLength(1);

		// Intermediate query at frame 5 (lookback <= 8 frames)
		expect(bundle.getMaskResult(5)).toHaveLength(1);
		expect(bundle.getMaskResult(5)[0].category).toBe("person");

		// Intermediate query at frame 12 (> 8 frames back from 2) falls back to empty defaults
		expect(bundle.getMaskResult(12)).toHaveLength(0);
	});

	it("track.pose exposes per-track landmark signals and kinematics", () => {
		const bundle = new VisionBundle({
			totalFrames: 10,
			width: 1000,
			height: 1000,
			fps: 24,
		});

		const leadTrack = track(1, "person", 100, 100, 100, 300);
		const backupTrack = track(2, "person", 600, 100, 100, 300);
		bundle.setObjectResult(0, {
			objects: [leadTrack, backupTrack],
			rawDetections: [],
		});
		bundle.setObjectResult(1, {
			objects: [leadTrack, backupTrack],
			rawDetections: [],
		});

		// Create keypoints for lead dancer at frame 0 and frame 1
		// Lead dancer has right hand raised (wrist y < shoulder y)
		const leadKeypointsF0 = Array.from({ length: 17 }, () => ({
			x: 0.15,
			y: 0.25,
			visibility: 0.9,
		}));
		leadKeypointsF0[5] = { x: 0.12, y: 0.2, visibility: 0.9 }; // leftShoulder
		leadKeypointsF0[6] = { x: 0.18, y: 0.2, visibility: 0.9 }; // rightShoulder
		leadKeypointsF0[10] = { x: 0.2, y: 0.1, visibility: 0.9 }; // rightWrist (y=0.1 < shoulder y=0.2 -> hand raised!)
		leadKeypointsF0[11] = { x: 0.13, y: 0.4, visibility: 0.9 }; // leftHip
		leadKeypointsF0[12] = { x: 0.17, y: 0.4, visibility: 0.9 }; // rightHip

		const leadKeypointsF1 = Array.from({ length: 17 }, () => ({
			x: 0.15,
			y: 0.25,
			visibility: 0.9,
		}));
		leadKeypointsF1[5] = { x: 0.12, y: 0.2, visibility: 0.9 };
		leadKeypointsF1[6] = { x: 0.18, y: 0.2, visibility: 0.9 };
		leadKeypointsF1[10] = { x: 0.25, y: 0.1, visibility: 0.9 }; // rightWrist moved 0.05 right (+50px)
		leadKeypointsF1[11] = { x: 0.13, y: 0.4, visibility: 0.9 };
		leadKeypointsF1[12] = { x: 0.17, y: 0.4, visibility: 0.9 };

		// Backup dancer has hand down
		const backupKeypointsF0 = Array.from({ length: 17 }, () => ({
			x: 0.65,
			y: 0.25,
			visibility: 0.9,
		}));
		backupKeypointsF0[0] = { x: 0.65, y: 0.15, visibility: 0.95 }; // nose
		backupKeypointsF0[5] = { x: 0.62, y: 0.2, visibility: 0.9 };
		backupKeypointsF0[6] = { x: 0.68, y: 0.2, visibility: 0.9 };
		backupKeypointsF0[10] = { x: 0.7, y: 0.35, visibility: 0.9 }; // rightWrist down

		const backupKeypointsF1 = Array.from({ length: 17 }, () => ({
			x: 0.65,
			y: 0.25,
			visibility: 0.9,
		}));
		backupKeypointsF1[0] = { x: 0.65, y: 0.15, visibility: 0.95 };
		backupKeypointsF1[5] = { x: 0.62, y: 0.2, visibility: 0.9 };
		backupKeypointsF1[6] = { x: 0.68, y: 0.2, visibility: 0.9 };
		backupKeypointsF1[10] = { x: 0.7, y: 0.35, visibility: 0.9 };

		const poseResF0: PoseResult = {
			people: [
				{
					trackId: 1,
					score: 0.9,
					boundingBox: leadTrack.boundingBox,
					keypoints: leadKeypointsF0,
				},
				{
					trackId: 2,
					score: 0.9,
					boundingBox: backupTrack.boundingBox,
					keypoints: backupKeypointsF0,
				},
			],
		};

		const poseResF1: PoseResult = {
			people: [
				{
					trackId: 1,
					score: 0.9,
					boundingBox: leadTrack.boundingBox,
					keypoints: leadKeypointsF1,
				},
				{
					trackId: 2,
					score: 0.9,
					boundingBox: backupTrack.boundingBox,
					keypoints: backupKeypointsF1,
				},
			],
		};

		bundle.setPoseResult(0, poseResF0);
		bundle.setPoseResult(1, poseResF1);

		const leadDancer = bundle.objects.get(1);
		const backupDancer = bundle.objects.get(2);

		frameSignal.set(0);
		expect(leadDancer.pose.hasPose.get()).toBe(1.0);
		expect(backupDancer.pose.hasPose.get()).toBe(1.0);

		// Pin targets
		expect(leadDancer.pose.rightWrist.screenX.get()).toBeCloseTo(200, 1);
		expect(backupDancer.pose.nose.screenX.get()).toBeCloseTo(650, 1);

		// Kinematics: handRaised
		expect(leadDancer.pose.handRaised.get()).toBe(1.0);
		expect(backupDancer.pose.handRaised.get()).toBe(0.0);

		// Kinematics: bodyTiltAngle (upright ~ 0)
		expect(leadDancer.pose.bodyTiltAngle.get()).toBeCloseTo(0, 2);

		// Kinematics: wristSpeed at frame 1
		frameSignal.set(1);
		// Moved 0.05 * 1000 = 50px across 1 frame @ 24fps -> 50 * 24 = 1200 px/s
		expect(leadDancer.pose.wristSpeed.get()).toBeCloseTo(1200, 1);
	});
});
