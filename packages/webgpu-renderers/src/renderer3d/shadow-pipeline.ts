/**
 * @file packages/webgpu-renderers/src/renderer3d/shadow-pipeline.ts
 * Directional and Point Light Shadow Map Generator with Percentage Closer Filtering (PCF).
 */

import { type Mat4, Matrix4Math, type Vec3 } from "../math3d/index.js";

export interface ShadowMapOptions {
	resolution?: number;
	pcfRadius?: number;
	pcfSamples?: number;
	bias?: number;
	slopeBias?: number;
}

export class ShadowPipeline {
	public shadowDepthTexture: GPUTexture;
	public shadowDepthView: GPUTextureView;
	public shadowComparisonSampler: GPUSampler;
	public lightViewProjMatrix: Mat4;

	constructor(device: GPUDevice, resolution = 2048) {
		this.lightViewProjMatrix = Matrix4Math.identity();

		this.shadowDepthTexture = device.createTexture({
			label: "shadow-depth-map",
			size: [resolution, resolution, 1],
			format: "depth32float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});

		this.shadowDepthView = this.shadowDepthTexture.createView({
			label: "shadow-depth-view",
		});

		this.shadowComparisonSampler = device.createSampler({
			label: "shadow-pcf-sampler",
			compare: "less-equal",
			magFilter: "linear",
			minFilter: "linear",
		});
	}

	public computeDirectionalLightMatrix(
		lightPos: Vec3,
		targetPos: Vec3,
		orthoSize = 2000,
		near = 10,
		far = 4000,
	): Mat4 {
		const viewMatrix = Matrix4Math.lookAt(lightPos, targetPos, [0, 1, 0]);
		const half = orthoSize * 0.5;
		const projMatrix = Matrix4Math.orthographic(-half, half, -half, half, near, far);
		this.lightViewProjMatrix = Matrix4Math.multiply(projMatrix, viewMatrix);
		return this.lightViewProjMatrix;
	}

	public destroy(): void {
		this.shadowDepthTexture.destroy();
	}
}
