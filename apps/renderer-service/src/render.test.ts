import "reflect-metadata";
import { HeadlessMediaRenderer } from "@framefields/renderer";
import fs from "fs/promises";
import { describe, expect, it } from "vitest";
import { hasActiveJobs, jobs } from "./job-processor.js";

describe("HeadlessMediaRenderer", () => {
	it("should render a paint red rect frame", async () => {
		const renderer = new HeadlessMediaRenderer();

		const virtualMedia = {
			metadata: {
				width: 1920,
				height: 1080,
				fps: 24,
				durationMs: 1000,
			},
			operation: {
				op: "Paint",
				dataType: "Video",
				backgroundColor: "#FF0000",
				timeline: {
					startFrame: 0,
					segments: [{ startSec: 0, endSec: 1 }],
				},
			},
			children: [],
		};

		console.log("Rendering frame...");
		const buffer = await renderer.renderImage(virtualMedia as any, 5, 24);
		await fs.writeFile("test_red_out.png", buffer);
		console.log("Done test_red_out.png, size:", buffer.length);
		expect(buffer.length).toBeGreaterThan(8159);
	});
});

describe("Job Processor API", () => {
	it("should manage job status properly", () => {
		expect(hasActiveJobs()).toBe(false);

		jobs.set("test-job", {
			id: "test-job",
			status: "IN_QUEUE",
		});

		expect(hasActiveJobs()).toBe(true);

		jobs.set("test-job", {
			id: "test-job",
			status: "COMPLETED",
		});

		expect(hasActiveJobs()).toBe(false);
	});
});
