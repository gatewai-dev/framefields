import { describe, expect, it } from "vitest";
import type { FnParam, SignalNodeConfig } from "./types.js";
import { buildUniformBufferLayout, buildWGSLSignalFn } from "./wgsl.js";

describe("wgsl signal generator helpers", () => {
	describe("buildWGSLSignalFn", () => {
		it("should compile a valid config with basic signature and body", () => {
			const config: SignalNodeConfig = {
				fnBody: "return 1.0;",
				fnOutputType: "f32",
			};
			const result = buildWGSLSignalFn(config, "testNode");

			expect(result.name).toBe("signal_testNode");
			expect(result.outputType).toBe("f32");
			expect(result.signature).toContain("fn signal_testNode");
			expect(result.signature).toContain("-> f32");
			expect(result.valid).toBe(true);
			expect(result.wgsl).toContain("const PI:");
			expect(result.wgsl).toContain("return 1.0;");
		});

		it("should sanitize nodeId to be a valid WGSL identifier", () => {
			const config: SignalNodeConfig = {
				fnBody: "return 0.5;",
				fnOutputType: "f32",
			};
			const result = buildWGSLSignalFn(config, "my-invalid.node@id!");
			expect(result.name).toBe("signal_my_invalid_node_id_");
		});

		it("should identify missing return statements and append fallbacks for f32", () => {
			const config: SignalNodeConfig = {
				fnBody: "let a = 1.0;",
				fnOutputType: "f32",
			};
			const result = buildWGSLSignalFn(config, "node");

			expect(result.valid).toBe(false);
			expect(result.validationWarning).toBe(
				"Function body has no return statement.",
			);
			expect(result.wgsl).toContain("return 0.0;");
		});

		it("should append fallback return statement for vec2f output type", () => {
			const config: SignalNodeConfig = {
				fnBody: "let a = vec2<f32>(1.0);",
				fnOutputType: "vec2f",
			};
			const result = buildWGSLSignalFn(config, "node");

			expect(result.valid).toBe(false);
			expect(result.wgsl).toContain("return vec2<f32>(0.0);");
		});

		it("should append fallback return statement for vec3f output type", () => {
			const config: SignalNodeConfig = {
				fnBody: "let a = vec3<f32>(1.0);",
				fnOutputType: "vec3f",
			};
			const result = buildWGSLSignalFn(config, "node");

			expect(result.valid).toBe(false);
			expect(result.wgsl).toContain("return vec3<f32>(0.0);");
		});

		it("should append fallback return statement for vec4f output type", () => {
			const config: SignalNodeConfig = {
				fnBody: "let a = vec4<f32>(1.0);",
				fnOutputType: "vec4f",
			};
			const result = buildWGSLSignalFn(config, "node");

			expect(result.valid).toBe(false);
			expect(result.wgsl).toContain("return vec4<f32>(0.0);");
		});

		it("should warn when returning vecNf but the output type is f32", () => {
			const config: SignalNodeConfig = {
				fnBody: "return vec3f(1.0, 2.0, 3.0);",
				fnOutputType: "f32",
			};
			const result = buildWGSLSignalFn(config, "node");

			expect(result.valid).toBe(false);
			expect(result.validationWarning).toBe(
				"Returning vec3f but output type is f32.",
			);
		});

		it("should handle custom parameters in the signature", () => {
			const params: FnParam[] = [
				{ name: "speed", type: "f32", defaultValue: 1.0 },
				{ name: "colorOffset", type: "vec3f", defaultValue: 0.0 },
			];
			const config: SignalNodeConfig = {
				fnBody: "return speed;",
				fnOutputType: "f32",
				fnParams: params,
			};
			const result = buildWGSLSignalFn(config, "customNode");

			expect(result.signature).toContain("speed: f32");
			expect(result.signature).toContain("colorOffset: vec3f");
			expect(result.params).toEqual(params);
		});

		it("should dynamically generate WGSL if baseType is triangle", () => {
			const config: SignalNodeConfig = {
				baseType: "triangle",
				amplitude: 2,
				frequency: 5,
			};
			const result = buildWGSLSignalFn(config, "testNode");
			expect(result.wgsl).toContain("u.amplitude * (2.0 * abs");
			expect(result.valid).toBe(true);
		});

		it("should dynamically generate WGSL with gates and envelopes", () => {
			const config: SignalNodeConfig = {
				baseType: "sine",
				gateEnabled: true,
				gateStartFrame: 10,
				gateEndFrame: 90,
				gateIdleValue: -1.0,
				envelopeEnabled: true,
				envelopeFamily: "sine",
				envelopeMode: "in_out",
				envelopePattern: "bell",
			};
			const result = buildWGSLSignalFn(config, "testNode");
			expect(result.wgsl).toContain("frame < 10u");
			expect(result.wgsl).toContain("frame > 90u");
			expect(result.wgsl).toContain("val = -1.00000");
			expect(result.wgsl).toContain("Time Envelope");
		});

		it("should fallback to parsing visual builder state header comment if baseType is custom or missing", () => {
			const comment = [
				"/* SIGNAL_BUILDER_STATE:",
				JSON.stringify({
					base: { enabled: true, type: "sawtooth" },
					fm: { enabled: true, amplitude: 1.5, frequency: 2.0 },
					envelope: {
						enabled: true,
						family: "expo",
						mode: "in",
						pattern: "ramp_down",
						cycles: 2,
						useFrame: true,
					},
					gate: { enabled: true, startFrame: 5, endFrame: 50, idleValue: 0.5 },
				}),
				"*/",
				"return 0.0;",
			].join("\n");
			const config: SignalNodeConfig = {
				fnBody: comment,
			};
			const result = buildWGSLSignalFn(config, "testNode");
			expect(result.wgsl).toContain(
				"u.amplitude * (2.0 * (t_mod * u.frequency",
			);
			expect(result.wgsl).toContain("Frequency Modulation");
			expect(result.wgsl).toContain("frame < 5u");
			expect(result.wgsl).toContain("frame > 50u");
		});
	});

	describe("buildUniformBufferLayout", () => {
		it("should return null if there are no custom params", () => {
			const fn = buildWGSLSignalFn({ fnBody: "return 1.0;" }, "node");
			const layout = buildUniformBufferLayout(fn);
			expect(layout).toBeNull();
		});

		it("should build struct, bindings, and calculate byte sizes correctly for each type", () => {
			const params: FnParam[] = [
				{ name: "p_f32", type: "f32", defaultValue: 0 },
				{ name: "p_i32", type: "i32", defaultValue: 0 },
				{ name: "p_u32", type: "u32", defaultValue: 0 },
				{ name: "p_vec2f", type: "vec2f", defaultValue: 0 },
				{ name: "p_vec3f", type: "vec3f", defaultValue: 0 },
				{ name: "p_vec4f", type: "vec4f", defaultValue: 0 },
			];
			const fn = buildWGSLSignalFn(
				{
					fnBody: "return 1.0;",
					fnParams: params,
				},
				"myNode",
			);

			const layout = buildUniformBufferLayout(fn, 1, 3);
			expect(layout).not.toBeNull();
			if (!layout) return;

			expect(layout.structWGSL).toContain("struct SignalParams_signal_myNode");
			expect(layout.structWGSL).toContain("p_f32: f32,");
			expect(layout.structWGSL).toContain("p_i32: i32,");
			expect(layout.structWGSL).toContain("p_u32: u32,");
			expect(layout.structWGSL).toContain("p_vec2f: vec2f,");
			expect(layout.structWGSL).toContain("p_vec3f: vec3f,");
			expect(layout.structWGSL).toContain("p_vec4f: vec4f,");

			expect(layout.bindingWGSL).toBe(
				"@group(1) @binding(3) var<uniform> signal_params: SignalParams_signal_myNode;",
			);

			// Expected sizes:
			// f32: 4
			// i32: 4
			// u32: 4
			// vec2f: 8
			// vec3f: 16 (padded)
			// vec4f: 16
			// Total: 4 + 4 + 4 + 8 + 16 + 16 = 52 bytes
			expect(layout.byteSize).toBe(52);
		});
	});
});
