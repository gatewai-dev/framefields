import { describe, expect, it, vi } from "vitest";
import { Composition, Layer, Media } from "./index.js";

describe("Layer.lottie & unsupported format handling", () => {
	it("resolves Layer.lottie with relative path into a Lottie source operation", () => {
		const comp = new Composition({ width: 400, height: 400, fps: 30 });
		comp.add(Layer.lottie("assets/spinner.json", { width: 200, height: 200 }));

		const vm = comp.toVirtualMedia();
		expect(vm.children).toHaveLength(1);

		const layer = vm.children?.[0];
		expect(layer).toBeDefined();
		const op = layer?.operation as Record<string, unknown>;
		expect(op.kind).toBe("media");
		expect(op.dataType).toBe("Lottie");
		expect(layer?.children).toHaveLength(1);

		const sourceOp = layer?.children?.[0]?.operation as Record<string, unknown>;
		expect(sourceOp.op).toBe("source");
		expect(sourceOp.dataType).toBe("Lottie");
		expect(sourceOp.url).toBe("assets/spinner.json");
	});

	it("creates Media.lottie with Lottie dataType", () => {
		const media = Media.lottie("animation.json");
		expect(media.virtualMedia.operation.dataType).toBe("Lottie");
		expect(media.virtualMedia.operation.op).toBe("source");
	});

	it("warns when Layer.image is called with a Lottie .json file", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			Layer.image("animation.json");
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"is a Lottie vector animation, not a static image. Use Layer.lottie(",
				),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("warns when Layer.image is called with a .lottie archive", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			Layer.image("badge.lottie");
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"is a Lottie vector animation, not a static image. Use Layer.lottie(",
				),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("comp.lint() flags Layer.image with .json as unsupported_image_format", () => {
		const comp = new Composition({ width: 1920, height: 1080 });
		comp.add(Layer.image("hero-animation.json"));

		const diagnostics = comp.lint();
		const issue = diagnostics.find(
			(d) => d.code === "unsupported_image_format",
		);
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("error");
		expect(issue?.message).toContain("Use Layer.lottie() instead");
	});

	it("comp.lint() does not flag valid Layer.lottie", () => {
		const comp = new Composition({ width: 1920, height: 1080 });
		comp.add(Layer.lottie("hero-animation.json"));

		const diagnostics = comp.lint();
		const issue = diagnostics.find(
			(d) => d.code === "unsupported_image_format",
		);
		expect(issue).toBeUndefined();
	});
});
