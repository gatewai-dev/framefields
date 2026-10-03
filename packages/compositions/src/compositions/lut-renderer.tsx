/// <reference types="webgpu" />

import {
	ensureDevice,
	lutStore,
	lutViewerWgsl,
} from "@gitframes/webgpu-renderers";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LutRendererProps {
	renderId: string;
	src: string;
	viewportWidth: number;
	viewportHeight: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Precision viewport-marker brackets, like a professional camera viewfinder.
 */
const CornerBrackets: React.FC = () => {
	const positions = [
		{ style: { top: 10, left: 10 }, rotate: "0deg" },
		{ style: { top: 10, right: 10 }, rotate: "90deg" },
		{ style: { bottom: 10, right: 10 }, rotate: "180deg" },
		{ style: { bottom: 10, left: 10 }, rotate: "270deg" },
	] as const;

	return (
		<>
			{positions.map((p, i) => (
				<svg
					key={i}
					width={14}
					height={14}
					viewBox="0 0 14 14"
					fill="none"
					style={{
						position: "absolute",
						...p.style,
						transform: `rotate(${p.rotate})`,
						opacity: 0.22,
						pointerEvents: "none",
					}}
				>
					<path
						d="M1 11 L1 1 L11 1"
						stroke="white"
						strokeWidth="1.5"
						strokeLinecap="square"
					/>
				</svg>
			))}
		</>
	);
};

/**
 * Animated loading state — a pulsing orbit rings + scanning grid aesthetic,
 * evoking a scope warming up to render the color space.
 */
const LoadingOverlay: React.FC = () => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			background: "#0d0d0f",
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 16,
		}}
	>
		{/* Concentric orbit rings */}
		<div style={{ position: "relative", width: 52, height: 52 }}>
			{([0, 1, 2] as const).map((i) => (
				<div
					key={i}
					style={{
						position: "absolute",
						inset: `${i * 9}px`,
						borderRadius: "50%",
						border: "1px solid rgba(255,255,255,0.12)",
						animation: `lutPulse ${1.6 + i * 0.35}s ease-in-out infinite`,
						animationDelay: `${i * 0.25}s`,
					}}
				/>
			))}
			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div
					style={{
						width: 5,
						height: 5,
						borderRadius: "50%",
						background: "rgba(255,255,255,0.35)",
						animation: "lutPulse 1.1s ease-in-out infinite",
					}}
				/>
			</div>
		</div>

		<span
			style={{
				fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
				fontSize: "9.5px",
				letterSpacing: "0.14em",
				color: "rgba(255,255,255,0.18)",
				textTransform: "uppercase" as const,
			}}
		>
			Initialising LUT
		</span>
	</div>
);

/**
 * Error state — minimal, icon-anchored, no heavy red backgrounds.
 */
const ErrorOverlay: React.FC<{ message: string }> = ({ message }) => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			background: "#0d0d0f",
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			padding: "2rem",
			gap: 10,
		}}
	>
		<div
			style={{
				width: 38,
				height: 38,
				borderRadius: "50%",
				border: "1px solid rgba(239,68,68,0.2)",
				background: "rgba(239,68,68,0.04)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<circle
					cx="7"
					cy="7"
					r="6"
					stroke="rgba(239,68,68,0.4)"
					strokeWidth="1"
				/>
				<path
					d="M7 3.5V7.5M7 9.5H7.01"
					stroke="rgba(239,68,68,0.55)"
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			</svg>
		</div>
		<span
			style={{
				fontFamily:
					"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
				fontSize: "11.5px",
				fontWeight: 500,
				color: "rgba(255,255,255,0.35)",
				letterSpacing: "-0.01em",
			}}
		>
			Render unavailable
		</span>
		<span
			style={{
				fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
				fontSize: "9px",
				color: "rgba(255,255,255,0.14)",
				textAlign: "center",
				maxWidth: 220,
				lineHeight: 1.65,
				letterSpacing: "0.01em",
			}}
		>
			{message}
		</span>
	</div>
);

// ─── Keyframe styles injected once ────────────────────────────────────────────

const STYLES = `
  @keyframes lutPulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.85; }
  }
  @keyframes lutFadeUp {
    from { opacity: 0; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .lut-hud-item {
    transition: opacity 0.22s ease;
  }
  .lut-viewport:not(:hover) .lut-hud-item {
    opacity: 0;
  }
  .lut-viewport:hover .lut-hud-item {
    opacity: 1;
  }
  .lut-reset-btn:hover {
    background: rgba(255,255,255,0.1) !important;
    color: rgba(255,255,255,0.65) !important;
  }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

export const LutRenderer: React.FC<LutRendererProps> = ({
	src,
	viewportWidth,
	viewportHeight,
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [isDragging, setIsDragging] = useState(false);
	const [zoomDisplay, setZoomDisplay] = useState(2.2);

	// Orbit camera state
	const rotationRef = useRef<[number, number]>([0.5, -0.4]);
	const zoomRef = useRef<number>(2.2);
	const isDraggingRef = useRef(false);
	const lastMousePosRef = useRef<[number, number]>([0, 0]);
	const lastTouchRef = useRef<[number, number]>([0, 0]);

	const lutName =
		src
			.split("/")
			.pop()
			?.replace(/\.[^.]+$/, "")
			.toUpperCase() ?? "LUT";

	const handleReset = useCallback(() => {
		rotationRef.current = [0.5, -0.4];
		zoomRef.current = 2.2;
		setZoomDisplay(2.2);
	}, []);

	// Ref refs for dynamic asset swap
	const currentLutRef = useRef<any>(null);
	const latestSrcRef = useRef(src);
	latestSrcRef.current = src;

	// ─── WebGPU Initialisation (Once on mount / canvas ready) ───────────────────
	useEffect(() => {
		let active = true;
		let cleanupWebGPU: (() => void) | undefined;

		async function initWebGPU() {
			try {
				const canvas = canvasRef.current;
				if (!canvas) return;

				// Use the shared singleton device so LUT GPU resources from
				// the composition renderer (e.g. ExtractLUT) are directly usable.
				const device = await ensureDevice();
				if (!active) return;

				const context = canvas.getContext("webgpu");
				if (!context) throw new Error("Failed to create WebGPU context.");

				const format = navigator.gpu.getPreferredCanvasFormat();
				context.configure({ device, format, alphaMode: "premultiplied" });

				const shaderModule = device.createShaderModule({ code: lutViewerWgsl });

				const uniformBuffer = device.createBuffer({
					size: 20, // 5 × f32
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				});

				const bindGroupLayout = device.createBindGroupLayout({
					entries: [
						{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} },
					],
				});
				const bindGroup = device.createBindGroup({
					layout: bindGroupLayout,
					entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
				});

				let depthTexture = device.createTexture({
					size: [canvas.width || 800, canvas.height || 600],
					format: "depth24plus",
					usage: GPUTextureUsage.RENDER_ATTACHMENT,
				});

				const pipelineLayout = device.createPipelineLayout({
					bindGroupLayouts: [bindGroupLayout],
				});

				const blendState = {
					color: {
						srcFactor: "src-alpha" as const,
						dstFactor: "one-minus-src-alpha" as const,
					},
					alpha: {},
				};
				const depthState = {
					depthWriteEnabled: true,
					depthCompare: "less" as const,
					format: "depth24plus" as const,
				};

				const pipeline = device.createRenderPipeline({
					layout: pipelineLayout,
					vertex: {
						module: shaderModule,
						entryPoint: "vs_main",
						buffers: [
							{
								arrayStride: 24,
								stepMode: "instance",
								attributes: [
									{ shaderLocation: 0, offset: 0, format: "float32x3" },
									{ shaderLocation: 1, offset: 12, format: "float32x3" },
								],
							},
						],
					},
					fragment: {
						module: shaderModule,
						entryPoint: "fs_main",
						targets: [{ format, blend: blendState }],
					},
					primitive: { topology: "triangle-list" },
					depthStencil: depthState,
				});

				const wireframePipeline = device.createRenderPipeline({
					layout: pipelineLayout,
					vertex: { module: shaderModule, entryPoint: "vs_wireframe" },
					fragment: {
						module: shaderModule,
						entryPoint: "fs_wireframe",
						targets: [{ format, blend: blendState }],
					},
					primitive: { topology: "line-list" },
					depthStencil: depthState,
				});

				let animFrameId = 0;

				function frame() {
					if (!active) return;
					const c = canvasRef.current;
					if (!c) return;

					const rect = c.getBoundingClientRect();
					const w = Math.max(
						1,
						Math.round(rect.width * window.devicePixelRatio),
					);
					const h = Math.max(
						1,
						Math.round(rect.height * window.devicePixelRatio),
					);

					if (c.width !== w || c.height !== h) {
						c.width = w;
						c.height = h;
						depthTexture.destroy();
						depthTexture = device.createTexture({
							size: [w, h],
							format: "depth24plus",
							usage: GPUTextureUsage.RENDER_ATTACHMENT,
						});
					}

					device.queue.writeBuffer(
						uniformBuffer,
						0,
						new Float32Array([
							rotationRef.current[0],
							rotationRef.current[1],
							zoomRef.current,
							w / h,
						]),
					);

					const enc = device.createCommandEncoder();
					const pass = enc.beginRenderPass({
						colorAttachments: [
							{
								view: context!.getCurrentTexture().createView(),
								clearValue: { r: 0.07, g: 0.07, b: 0.08, a: 1.0 },
								loadOp: "clear",
								storeOp: "store",
							},
						],
						depthStencilAttachment: {
							view: depthTexture.createView(),
							depthClearValue: 1.0,
							depthLoadOp: "clear",
							depthStoreOp: "store",
						},
					});

					pass.setPipeline(wireframePipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(24, 1, 0, 0);

					const lut = currentLutRef.current;
					if (lut) {
						pass.setPipeline(pipeline);
						pass.setBindGroup(0, bindGroup);
						pass.setVertexBuffer(0, lut.vertexBuffer);
						pass.draw(6, lut.vertexCount, 0, 0);
					}

					pass.end();
					device.queue.submit([enc.finish()]);
					animFrameId = requestAnimationFrame(frame);
				}

				animFrameId = requestAnimationFrame(frame);
				cleanupWebGPU = () => {
					cancelAnimationFrame(animFrameId);
					uniformBuffer.destroy();
					depthTexture.destroy();
				};
			} catch (err) {
				if (active) {
					setError(err instanceof Error ? err.message : "Error loading LUT");
					setLoading(false);
				}
			}
		}

		initWebGPU();
		return () => {
			active = false;
			cleanupWebGPU?.();
		};
	}, []);

	// ─── Dynamic asset loading (when src changes) ───────────────────
	useEffect(() => {
		let active = true;

		async function loadLut() {
			try {
				const device = await ensureDevice();
				if (!active) return;

				// 1. Check if already in cache
				const cached = lutStore.get(src, device);
				if (cached) {
					currentLutRef.current = cached;
					setLoading(false);
					setError(null);
					return;
				}

				// 2. Try prefix fallback for runtime LUTs to avoid showing loading screen
				if (src.startsWith("runtime://lut/")) {
					const prefix = src.substring(0, src.lastIndexOf("-") + 1);
					if (prefix) {
						const fallback = lutStore.getAnyMatching(prefix, device);
						if (fallback) {
							currentLutRef.current = fallback;
							setLoading(false);
						}
					}
				}

				// If no fallback is available at all, show the loading screen
				if (!currentLutRef.current) {
					setLoading(true);
				}
				setError(null);

				// 3. Load the asset in the background
				const loaded = await lutStore.getOrLoad(src, device);
				if (!active) return;

				// Verify this is still the latest requested asset
				if (latestSrcRef.current === src) {
					currentLutRef.current = loaded;
					setLoading(false);
				}
			} catch (err) {
				if (active && latestSrcRef.current === src) {
					setError(err instanceof Error ? err.message : "Error loading LUT");
					setLoading(false);
				}
			}
		}

		loadLut();
		return () => {
			active = false;
		};
	}, [src]);

	// ─── Pointer Handlers ─────────────────────────────────────────────────────

	const handleMouseDown = (e: React.MouseEvent) => {
		isDraggingRef.current = true;
		setIsDragging(true);
		lastMousePosRef.current = [e.clientX, e.clientY];
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isDraggingRef.current) return;
		const dx = e.clientX - lastMousePosRef.current[0];
		const dy = e.clientY - lastMousePosRef.current[1];
		lastMousePosRef.current = [e.clientX, e.clientY];
		rotationRef.current[0] += dx * 0.005;
		rotationRef.current[1] = Math.max(
			-Math.PI / 2.1,
			Math.min(Math.PI / 2.1, rotationRef.current[1] + dy * 0.005),
		);
	};

	const handleMouseUp = () => {
		isDraggingRef.current = false;
		setIsDragging(false);
	};

	const handleWheel = (e: React.WheelEvent) => {
		const next = Math.max(
			1.1,
			Math.min(5.0, zoomRef.current + e.deltaY * 0.002),
		);
		zoomRef.current = next;
		setZoomDisplay(Math.round(next * 10) / 10);
	};

	// Touch support
	const handleTouchStart = (e: React.TouchEvent) => {
		if (e.touches.length === 1) {
			isDraggingRef.current = true;
			lastTouchRef.current = [e.touches[0].clientX, e.touches[0].clientY];
		}
	};

	const handleTouchMove = (e: React.TouchEvent) => {
		if (!isDraggingRef.current || e.touches.length !== 1) return;
		const dx = e.touches[0].clientX - lastTouchRef.current[0];
		const dy = e.touches[0].clientY - lastTouchRef.current[1];
		lastTouchRef.current = [e.touches[0].clientX, e.touches[0].clientY];
		rotationRef.current[0] += dx * 0.005;
		rotationRef.current[1] = Math.max(
			-Math.PI / 2.1,
			Math.min(Math.PI / 2.1, rotationRef.current[1] + dy * 0.005),
		);
	};

	const handleTouchEnd = () => {
		isDraggingRef.current = false;
	};

	// ─── Render ───────────────────────────────────────────────────────────────

	const isActive = !loading && !error;

	return (
		<>
			<style>{STYLES}</style>

			<div
				className="lut-viewport nowheel"
				style={{
					position: "relative",
					width: "100%",
					aspectRatio: `${viewportWidth} / ${viewportHeight}`,
					background: "#0d0d0f",
					borderRadius: 10,
					overflow: "hidden",
					border: isDragging
						? "1px solid rgba(255,255,255,0.14)"
						: "1px solid rgba(255,255,255,0.06)",
					boxShadow:
						"inset 0 0 0 1px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.45)",
					transition: "border-color 0.18s ease",
					userSelect: "none",
				}}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
				onWheel={handleWheel}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
			>
				{/* ── WebGPU Canvas ─────────────────────────────────────────────── */}
				<canvas
					ref={canvasRef}
					style={{
						display: "block",
						width: "100%",
						height: "100%",
						cursor: isDragging ? "grabbing" : "grab",
						touchAction: "none",
					}}
				/>

				{/* ── Viewport Corner Markers ───────────────────────────────────── */}
				{isActive && <CornerBrackets />}

				{/* ── LUT Name Badge (top-left) ─────────────────────────────────── */}
				{isActive && (
					<div
						className="lut-hud-item"
						style={{
							position: "absolute",
							top: 12,
							left: 12,
							display: "flex",
							alignItems: "center",
							gap: 5,
							background: "rgba(0,0,0,0.5)",
							backdropFilter: "blur(10px)",
							WebkitBackdropFilter: "blur(10px)",
							border: "1px solid rgba(255,255,255,0.07)",
							borderRadius: 5,
							padding: "3px 9px 3px 7px",
							animation: "lutFadeUp 0.35s ease",
						}}
					>
						{/* Mini 3-D cube glyph */}
						<svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
							<path
								d="M4.5 0.5L8.5 2.5V6.5L4.5 8.5L0.5 6.5V2.5L4.5 0.5Z"
								stroke="rgba(255,255,255,0.28)"
								strokeWidth="0.8"
							/>
							<path
								d="M4.5 0.5V4.5M4.5 4.5L8.5 2.5M4.5 4.5L0.5 2.5"
								stroke="rgba(255,255,255,0.14)"
								strokeWidth="0.8"
							/>
						</svg>
						<span
							style={{
								fontFamily:
									"ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
								fontSize: "9.5px",
								letterSpacing: "0.1em",
								color: "rgba(255,255,255,0.4)",
								textTransform: "uppercase",
							}}
						>
							{lutName}
						</span>
					</div>
				)}

				{/* ── Bottom HUD Bar ────────────────────────────────────────────── */}
				{isActive && (
					<div
						className="lut-hud-item"
						style={{
							position: "absolute",
							bottom: 0,
							left: 0,
							right: 0,
							padding: "14px 12px 10px",
							background:
								"linear-gradient(to top, rgba(0,0,0,0.55), transparent)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							pointerEvents: "none",
						}}
					>
						{/* Left: control hints */}
						<span
							style={{
								fontFamily:
									"ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
								fontSize: "9px",
								letterSpacing: "0.1em",
								color: "rgba(255,255,255,0.2)",
								textTransform: "uppercase",
							}}
						>
							Drag to Rotate · Scroll to Zoom
						</span>

						{/* Right: zoom readout + reset */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								pointerEvents: "auto",
							}}
						>
							{/* Zoom badge */}
							<div
								style={{
									background: "rgba(255,255,255,0.05)",
									border: "1px solid rgba(255,255,255,0.09)",
									borderRadius: 4,
									padding: "2px 8px",
									display: "flex",
									alignItems: "baseline",
									gap: 3,
								}}
							>
								<span
									style={{
										fontFamily:
											"ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
										fontSize: "8.5px",
										color: "rgba(255,255,255,0.22)",
										letterSpacing: "0.06em",
										textTransform: "uppercase",
									}}
								>
									Z
								</span>
								<span
									style={{
										fontFamily:
											"ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
										fontSize: "10.5px",
										color: "rgba(255,255,255,0.5)",
										letterSpacing: "0.02em",
									}}
								>
									{zoomDisplay.toFixed(1)}×
								</span>
							</div>

							{/* Reset button */}
							<button
								className="lut-reset-btn"
								onClick={(e) => {
									e.stopPropagation();
									handleReset();
								}}
								title="Reset camera to default view"
								style={{
									background: "rgba(255,255,255,0.04)",
									border: "1px solid rgba(255,255,255,0.09)",
									borderRadius: 4,
									padding: "3px 8px",
									cursor: "pointer",
									fontFamily:
										"ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
									fontSize: "9px",
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									color: "rgba(255,255,255,0.3)",
									transition: "background 0.15s, color 0.15s",
								}}
							>
								Reset
							</button>
						</div>
					</div>
				)}

				{/* ── Loading Overlay ───────────────────────────────────────────── */}
				{loading && <LoadingOverlay />}

				{/* ── Error Overlay ─────────────────────────────────────────────── */}
				{error && <ErrorOverlay message={error} />}
			</div>
		</>
	);
};
