import { describe, expect, it } from "vitest";
import {
	chipsForLayer,
	getPresetDetails,
	materializePreset,
} from "./presets.js";

describe("Compositor Presets", () => {
	it("should return correct details for standard preset types", () => {
		expect(getPresetDetails("fade-in")).toEqual({
			kind: "entrance",
			label: "Fade In",
		});
		expect(getPresetDetails("fade-out")).toEqual({
			kind: "exit",
			label: "Fade Out",
		});
		expect(getPresetDetails("pulse")).toEqual({
			kind: "emphasis",
			label: "Pulse",
		});
	});

	it("should materialize fade-in preset correctly", () => {
		const base = {
			x: 100,
			y: 200,
			scale: 1.5,
			rotation: 45,
			opacity: 0.8,
			durationFrames: 100,
		};

		const tracks = materializePreset(base, "fade-in", {
			width: 1920,
			height: 1080,
			fps: 24,
			presetGroupId: "fade-in-group",
		});
		expect(tracks).toHaveLength(1);
		expect(tracks[0].prop).toBe("opacity");
		expect(tracks[0].keyframes).toHaveLength(2);
		expect(tracks[0].keyframes[0].frame).toBe(0);
		expect(tracks[0].keyframes[0].value).toBe(0);
		expect(tracks[0].keyframes[0].presetGroupId).toBe("fade-in-group");
		expect(tracks[0].keyframes[1].frame).toBe(24); // default duration matches fps (24)
		expect(tracks[0].keyframes[1].value).toBe(0.8); // layerBase.opacity
		expect(tracks[0].keyframes[1].ease).toEqual({ name: "none", dir: "out" });
	});

	it("should materialize slide-in-left preset correctly", () => {
		const base = {
			x: 100,
			y: 200,
			scale: 1.5,
			rotation: 45,
			opacity: 0.8,
			durationFrames: 100,
		};

		const tracks = materializePreset(base, "slide-in-left", {
			width: 1920,
			height: 1080,
			fps: 24,
			presetGroupId: "slide-left-group",
		});
		expect(tracks).toHaveLength(1);
		expect(tracks[0].prop).toBe("x");
		expect(tracks[0].keyframes).toHaveLength(2);
		expect(tracks[0].keyframes[0].value).toBe(100 - 1920); // x - width
		expect(tracks[0].keyframes[1].value).toBe(100); // base.x
	});

	it("should derive chips from layer keyframes correctly", () => {
		const layer = {
			animation: {
				tracks: [
					{
						id: "track-1",
						prop: "opacity" as const,
						keyframes: [
							{ id: "kf-1", frame: 0, value: 0, presetGroupId: "fade-in_123" },
							{
								id: "kf-2",
								frame: 24,
								value: 1,
								ease: { name: "none" as const, dir: "out" as const },
								presetGroupId: "fade-in_123",
							},
						],
					},
					{
						id: "track-2",
						prop: "scale" as const,
						keyframes: [
							{ id: "kf-3", frame: 48, value: 1, presetGroupId: "pulse_456" },
							{
								id: "kf-4",
								frame: 60,
								value: 1.2,
								ease: { name: "sine" as const, dir: "inOut" as const },
								presetGroupId: "pulse_456",
							},
						],
					},
				],
			},
		};

		const chips = chipsForLayer(layer);
		expect(chips).toHaveLength(2);

		const fadeInChip = chips.find((c) => c.presetType === "fade-in");
		expect(fadeInChip).toBeDefined();
		expect(fadeInChip?.kind).toBe("entrance");
		expect(fadeInChip?.durationFrames).toBe(24);
		expect(fadeInChip?.ease).toEqual({ name: "none", dir: "out" });

		const pulseChip = chips.find((c) => c.presetType === "pulse");
		expect(pulseChip).toBeDefined();
		expect(pulseChip?.kind).toBe("emphasis");
		expect(pulseChip?.durationFrames).toBe(12);
	});

	it("should materialize text animation presets (typewriter, word-reveal, line-reveal, karaoke)", () => {
		const base = {
			x: 0,
			y: 0,
			scale: 1,
			rotation: 0,
			opacity: 1,
			durationFrames: 60,
		};

		for (const preset of [
			"typewriter",
			"word-reveal",
			"line-reveal",
			"karaoke",
		]) {
			const tracks = materializePreset(base, preset, {
				width: 1920,
				height: 1080,
				fps: 30,
				presetGroupId: `${preset}_grp`,
			});
			expect(tracks).toHaveLength(1);
			expect(tracks[0].prop).toBe("text");
			expect(tracks[0].keyframes).toHaveLength(2);
			expect(tracks[0].keyframes[0].value).toBe(0);
			expect(tracks[0].keyframes[0].frame).toBe(0);
			expect(tracks[0].keyframes[1].value).toBe(1);
			expect(tracks[0].keyframes[1].frame).toBe(30);
			expect(tracks[0].keyframes[1].presetType).toBe(preset);

			const details = getPresetDetails(preset);
			expect(details.kind).toBe("entrance");
		}
	});

	it("should materialize modern motion presets (tracking-expand, blur-reveal, kinetic-wave, slice-wipe)", () => {
		const base = {
			x: 100,
			y: 200,
			scale: 1,
			rotation: 0,
			opacity: 1,
			width: 400,
			height: 300,
			durationFrames: 60,
		};

		// Tracking expand
		const teTracks = materializePreset(base, "tracking-expand", {
			width: 1920,
			height: 1080,
			fps: 30,
		});
		expect(teTracks).toHaveLength(1);
		expect(teTracks[0].prop).toBe("letterSpacing");
		expect(teTracks[0].keyframes[1].value).toBe(24);

		// Blur reveal
		const brTracks = materializePreset(base, "blur-reveal", {
			width: 1920,
			height: 1080,
			fps: 30,
		});
		expect(brTracks).toHaveLength(1);
		expect(brTracks[0].prop).toBe("opacity");
		expect(brTracks[0].keyframes[0].value).toBe(0);
		expect(brTracks[0].keyframes[1].value).toBe(1);

		// Kinetic wave
		const kwTracks = materializePreset(base, "kinetic-wave", {
			width: 1920,
			height: 1080,
			fps: 30,
		});
		expect(kwTracks).toHaveLength(1);
		expect(kwTracks[0].prop).toBe("y");
		expect(kwTracks[0].repeat).toBe(3);
		expect(kwTracks[0].yoyo).toBe(true);

		// Slice wipe
		const swTracks = materializePreset(base, "slice-wipe", {
			width: 1920,
			height: 1080,
			fps: 30,
		});
		expect(swTracks).toHaveLength(1);
		expect(swTracks[0].prop).toBe("x");
		expect(swTracks[0].keyframes[0].value).toBe(100 - 400);
		expect(swTracks[0].keyframes[1].value).toBe(100);
	});
});

