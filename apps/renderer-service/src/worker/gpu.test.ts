import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyGpuPlan,
	classifyAdapter,
	findVulkanIcds,
	type GpuProbe,
	gpuFailure,
	planGpu,
	verifyAdapter,
} from "./gpu.js";

const NVIDIA = { vendor: "nvidia" as const, model: "NVIDIA L4" };
const ICDS = {
	hardware: ["/etc/vulkan/icd.d/nvidia_icd.json"],
	software: ["/usr/share/vulkan/icd.d/lvp_icd.x86_64.json"],
};
const probe = (over: Partial<GpuProbe> = {}): GpuProbe => ({
	platform: "linux",
	hardware: NVIDIA,
	icds: ICDS,
	...over,
});

describe("planGpu", () => {
	it("limits Vulkan to the GPU drivers on a GPU machine", () => {
		const plan = planGpu("auto", probe(), {});
		expect(plan).toMatchObject({ expect: "hardware", icds: ICDS.hardware });
		expect(plan.problem).toBeUndefined();
	});

	it("renders on the CPU when the machine has no GPU", () => {
		const plan = planGpu("auto", probe({ hardware: null }), {});
		expect(plan).toMatchObject({ expect: "software" });
		expect(plan.icds).toBeUndefined();
		expect(plan.problem).toBeUndefined();
	});

	it("fails without a GPU when one is required", () => {
		const plan = planGpu("require", probe({ hardware: null }), {});
		expect(plan.problem).toMatch(/no GPU/);
	});

	it("fails when the GPU's Vulkan driver is missing", () => {
		const plan = planGpu(
			"auto",
			probe({ icds: { hardware: [], software: ICDS.software } }),
			{},
		);
		expect(plan.problem).toMatch(/NVIDIA L4 found, but no Vulkan driver/);
		expect(plan.hint).toMatch(/NVIDIA_DRIVER_CAPABILITIES/);
	});

	it("uses only the CPU driver in cpu mode", () => {
		const plan = planGpu("cpu", probe(), {});
		expect(plan).toMatchObject({ expect: "software", icds: ICDS.software });
	});

	it("respects Vulkan driver overrides set by the operator", () => {
		const plan = planGpu(
			"auto",
			probe({ icds: { hardware: [], software: [] } }),
			{
				VK_DRIVER_FILES: "/custom.json",
			},
		);
		expect(plan.problem).toBeUndefined();
		expect(plan.icds).toBeUndefined();
	});

	it("needs no driver list on macOS", () => {
		const plan = planGpu(
			"require",
			{
				platform: "darwin",
				hardware: { vendor: "apple", model: "Metal" },
				icds: { hardware: [], software: [] },
			},
			{},
		);
		expect(plan).toMatchObject({ expect: "hardware" });
		expect(plan.icds).toBeUndefined();
	});
});

describe("findVulkanIcds", () => {
	it("splits GPU and CPU drivers", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "icd-"));
		mkdirSync(dir, { recursive: true });
		const icd = (name: string, lib: string) =>
			writeFileSync(
				path.join(dir, name),
				JSON.stringify({ ICD: { library_path: lib } }),
			);
		icd("nvidia_icd.json", "libGLX_nvidia.so.0");
		icd("lvp_icd.x86_64.json", "/usr/lib/libvulkan_lvp.so");
		icd("radeon_icd.x86_64.json", "/usr/lib/libvulkan_radeon.so");
		writeFileSync(path.join(dir, "README"), "");
		const found = findVulkanIcds([dir]);
		expect(found.hardware.map((f) => path.basename(f))).toEqual([
			"nvidia_icd.json",
			"radeon_icd.x86_64.json",
		]);
		expect(found.software.map((f) => path.basename(f))).toEqual([
			"lvp_icd.x86_64.json",
		]);
	});
});

describe("verifyAdapter", () => {
	const llvmpipe = classifyAdapter({
		vendor: "mesa",
		architecture: "",
		device: "llvmpipe (LLVM 19.1.7, 256 bits)",
		description: "",
	});

	it("recognises CPU adapters", () => {
		expect(llvmpipe.software).toBe(true);
		expect(
			classifyAdapter({ vendor: "nvidia", description: "NVIDIA L4" }).software,
		).toBe(false);
		expect(classifyAdapter({ isFallbackAdapter: true }).software).toBe(true);
	});

	it("fails a GPU machine that ended up on the CPU driver", () => {
		applyGpuPlan({ ...planGpu("auto", probe(), {}), icds: undefined });
		expect(() => verifyAdapter(llvmpipe)).toThrow(
			expect.objectContaining({ code: "GPU_UNAVAILABLE" }),
		);
		expect(gpuFailure()).toMatch(
			/NVIDIA L4 is present but WebGPU picked the CPU/,
		);
	});

	it("accepts the CPU driver on a machine without a GPU", () => {
		applyGpuPlan(planGpu("auto", probe({ hardware: null }), {}));
		expect(() => verifyAdapter(llvmpipe)).not.toThrow();
		expect(gpuFailure()).toBeUndefined();
	});
});
