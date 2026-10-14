import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RenderError } from "../errors.js";

/**
 * GPU selection (PLAN.md §8.7). framefields renders through WebGPU (Dawn),
 * which on Linux runs on Vulkan. The image also ships Mesa's CPU Vulkan
 * driver (lavapipe) so a machine without a GPU can still render. Without
 * care, a GPU machine whose Vulkan driver isn't mounted would silently render
 * on the CPU too, so:
 *
 * - auto (default): a machine with a GPU must render on it (Vulkan is limited
 *   to the GPU drivers); a machine without one renders on the CPU.
 * - require: always the GPU; a machine without one fails.
 * - cpu: always the CPU driver.
 */
type GpuMode = "auto" | "require" | "cpu";

export interface GpuHardware {
	vendor: "nvidia" | "amd" | "intel" | "apple";
	/** Model name when the driver reports one. */
	model: string;
}

interface GpuPlan {
	mode: GpuMode;
	hardware: GpuHardware | null;
	/** What the rendering adapter must be. */
	expect: "hardware" | "software";
	/** Vulkan drivers (ICD manifests) to limit the loader to, if any. */
	icds?: string[];
	/** Why this machine can't render as configured. */
	problem?: string;
	hint?: string;
}

/** The adapter framefields renders on (framefields' describeGpu shape). */
export interface GpuAdapter {
	vendor: string;
	architecture: string;
	device: string;
	description: string;
	software: boolean;
}

export interface GpuProbe {
	platform: NodeJS.Platform;
	hardware: GpuHardware | null;
	icds: { hardware: string[]; software: string[] };
}

const ICD_DIRS = [
	"/etc/vulkan/icd.d",
	"/usr/share/vulkan/icd.d",
	"/usr/local/share/vulkan/icd.d",
];
const SOFTWARE_ICD = /lvp|lavapipe|swiftshader/i;
const SOFTWARE_ADAPTER =
	/llvmpipe|lavapipe|softpipe|swiftshader|\bwarp\b|software/i;
const PCI_VENDORS: Record<string, GpuHardware["vendor"]> = {
	"0x10de": "nvidia",
	"0x1002": "amd",
	"0x8086": "intel",
};

function safeList(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function nvidiaModel(): string {
	for (const gpu of safeList("/proc/driver/nvidia/gpus")) {
		try {
			const info = readFileSync(
				path.join("/proc/driver/nvidia/gpus", gpu, "information"),
				"utf8",
			);
			const model = /^Model:\s*(.+)$/m.exec(info)?.[1]?.trim();
			if (model) return model;
		} catch {}
	}
	return "NVIDIA GPU";
}

/** Finds a GPU this process can use (device nodes present, not just listed in /sys). */
function detectGpuHardware(
	platform: NodeJS.Platform = process.platform,
): GpuHardware | null {
	if (platform === "darwin") return { vendor: "apple", model: "Metal" };
	if (platform !== "linux") return null;
	if (existsSync("/dev/nvidiactl") || existsSync("/dev/nvidia0")) {
		return { vendor: "nvidia", model: nvidiaModel() };
	}
	// AMD/Intel: needs a render node; /sys lists host GPUs even when the
	// container wasn't given one.
	if (!safeList("/dev/dri").some((n) => n.startsWith("renderD"))) return null;
	for (const card of safeList("/sys/class/drm")) {
		if (!/^card\d+$/.test(card)) continue;
		try {
			const id = readFileSync(
				path.join("/sys/class/drm", card, "device/vendor"),
				"utf8",
			).trim();
			const vendor = PCI_VENDORS[id];
			if (vendor) return { vendor, model: `${vendor.toUpperCase()} GPU` };
		} catch {}
	}
	return null;
}

/** Vulkan driver manifests, split into GPU and CPU drivers. */
export function findVulkanIcds(dirs = ICD_DIRS): GpuProbe["icds"] {
	const hardware: string[] = [];
	const software: string[] = [];
	for (const dir of dirs) {
		for (const name of safeList(dir).sort()) {
			if (!name.endsWith(".json")) continue;
			const file = path.join(dir, name);
			let library = "";
			try {
				library = String(
					JSON.parse(readFileSync(file, "utf8"))?.ICD?.library_path ?? "",
				);
			} catch {}
			(SOFTWARE_ICD.test(name) || SOFTWARE_ICD.test(library)
				? software
				: hardware
			).push(file);
		}
	}
	return { hardware, software };
}

export function probeGpu(): GpuProbe {
	return {
		platform: process.platform,
		hardware: detectGpuHardware(),
		icds:
			process.platform === "linux"
				? findVulkanIcds()
				: { hardware: [], software: [] },
	};
}

/**
 * Decides where to render. `env` is checked for Vulkan driver overrides an
 * operator already set; those are respected as they are.
 */
export function planGpu(
	mode: GpuMode,
	probe: GpuProbe,
	env: NodeJS.ProcessEnv = process.env,
): GpuPlan {
	const { hardware, icds } = probe;
	const linux = probe.platform === "linux";
	const overridden = Boolean(env.VK_DRIVER_FILES || env.VK_ICD_FILENAMES);
	const limit = (files: string[]) =>
		linux && !overridden && files.length ? files : undefined;

	if (mode === "cpu") {
		if (linux && !overridden && icds.software.length === 0) {
			return {
				mode,
				hardware,
				expect: "software",
				problem: "FF_GPU=cpu but no CPU Vulkan driver is installed.",
				hint: "Install mesa-vulkan-drivers (lavapipe).",
			};
		}
		return { mode, hardware, expect: "software", icds: limit(icds.software) };
	}

	if (hardware) {
		if (linux && !overridden && icds.hardware.length === 0) {
			return {
				mode,
				hardware,
				expect: "hardware",
				problem: `${hardware.model} found, but no Vulkan driver for it.`,
				hint:
					hardware.vendor === "nvidia"
						? "Run with the NVIDIA container runtime and NVIDIA_DRIVER_CAPABILITIES including graphics (the image sets graphics,utility,video,compute)."
						: "Install the GPU's Vulkan driver (mesa-vulkan-drivers covers AMD and Intel).",
			};
		}
		return {
			mode,
			hardware,
			expect: "hardware",
			icds: limit(icds.hardware),
		};
	}

	if (mode === "require") {
		return {
			mode,
			hardware,
			expect: "hardware",
			problem: "FF_GPU=require but this machine has no GPU.",
			hint: "Run on a GPU machine, or set FF_GPU=auto to allow CPU rendering.",
		};
	}
	return { mode, hardware, expect: "software" };
}

let active: GpuPlan | undefined;
let adapter: GpuAdapter | undefined;
let adapterProblem: string | undefined;

/** Limits Vulkan to the planned drivers. Must run before the engine loads. */
export function applyGpuPlan(plan: GpuPlan): void {
	active = plan;
	adapter = undefined;
	adapterProblem = undefined;
	if (plan.icds) {
		const files = plan.icds.join(path.delimiter);
		process.env.VK_DRIVER_FILES = files;
		process.env.VK_ICD_FILENAMES = files; // Vulkan loaders before 1.3.207
	}
}

export function classifyAdapter(info: {
	vendor?: unknown;
	architecture?: unknown;
	device?: unknown;
	description?: unknown;
	isFallbackAdapter?: unknown;
}): GpuAdapter {
	const out = {
		vendor: String(info.vendor ?? ""),
		architecture: String(info.architecture ?? ""),
		device: String(info.device ?? ""),
		description: String(info.description ?? ""),
	};
	return {
		...out,
		software:
			info.isFallbackAdapter === true ||
			SOFTWARE_ADAPTER.test(
				`${out.vendor} ${out.architecture} ${out.device} ${out.description}`,
			),
	};
}

/**
 * The adapter the engine renders on: framefields' describeGpu() where the
 * project's version has it, else the adapter WebGPU picks with the same
 * options framefields uses.
 */
export async function describeAdapter(mod: {
	describeGpu?: () => Promise<GpuAdapter>;
}): Promise<GpuAdapter | undefined> {
	if (typeof mod.describeGpu === "function") return mod.describeGpu();
	const gpu = (
		globalThis as {
			navigator?: { gpu?: { requestAdapter(o?: object): Promise<unknown> } };
		}
	).navigator?.gpu;
	if (!gpu) return undefined;
	const found = (await gpu.requestAdapter({
		powerPreference: "high-performance",
	})) as { info?: Record<string, unknown>; isFallbackAdapter?: unknown } | null;
	if (!found) return undefined;
	return classifyAdapter({
		isFallbackAdapter: found.isFallbackAdapter,
		...found.info,
	});
}

function adapterName(a: GpuAdapter): string {
	return a.description || a.device || a.architecture || a.vendor || "unknown";
}

/**
 * Checks the engine's adapter against the plan. A GPU machine that ended up
 * on the CPU driver fails with GPU_UNAVAILABLE and the worker reports itself
 * unhealthy, so a scheduler (RunPod) replaces it.
 */
export function verifyAdapter(found: GpuAdapter | undefined): void {
	adapter = found;
	const plan = active;
	if (!plan || !found) return;
	if (plan.expect === "hardware" && found.software) {
		adapterProblem = `${plan.hardware?.model ?? "A GPU"} is present but WebGPU picked the CPU driver (${adapterName(found)}).`;
		throw new RenderError("GPU_UNAVAILABLE", adapterProblem, {
			phase: "render",
			hint: "Check the GPU's Vulkan driver (vulkaninfo --summary). FF_GPU=cpu renders on the CPU on purpose.",
		});
	}
}

/** Boot or adapter problem that makes this worker unable to render. */
export function gpuFailure(): string | undefined {
	return active?.problem ?? adapterProblem;
}

/** GPU state for /health. */
export function gpuStatus() {
	return {
		mode: active?.mode ?? null,
		hardware: active?.hardware?.model ?? null,
		renderer: gpuFailure()
			? null
			: (adapter ? adapter.software : active?.expect === "software")
				? "cpu"
				: "gpu",
		adapter: adapter
			? { name: adapterName(adapter), software: adapter.software }
			: null,
	};
}
