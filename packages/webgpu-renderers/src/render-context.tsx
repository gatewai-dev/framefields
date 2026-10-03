import React, {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { ensureDevice } from "./device.js";
import { Renderer2D } from "./renderer2d/index.js";
import { SlugFontCache } from "./slug/slug-font-cache.js";
import {
	BrowserSurfaceProvider,
	type SurfaceProvider,
} from "./surface-provider.js";
import { textureCache } from "./texture-cache.js";

export interface RenderContextValue {
	device: GPUDevice;
	renderer: Renderer2D;
	surface: SurfaceProvider;
}

const RenderContext = createContext<RenderContextValue | null>(null);

export const useRenderContext = (): RenderContextValue => {
	const context = useContext(RenderContext);
	if (!context) {
		throw new Error("useRenderContext must be used within a RenderProvider");
	}
	return context;
};

export interface RenderProviderProps {
	containerRef?: React.RefObject<HTMLDivElement | null>;
	width?: number;
	height?: number;
	canvasStyle?: React.CSSProperties;
	children: ReactNode;
}

export const RenderProvider: React.FC<RenderProviderProps> = ({
	width = 1920,
	height = 1080,
	children,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [contextValue, setContextValue] = useState<RenderContextValue | null>(
		null,
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		let isMounted = true;
		let renderer: Renderer2D | null = null;
		let surface: BrowserSurfaceProvider | null = null;

		const initDevice = () => {
			ensureDevice().then((device) => {
				if (!isMounted) return;
				surface = new BrowserSurfaceProvider(device, canvas);
				renderer = new Renderer2D(device, surface.colorFormat);
				setContextValue({ device, renderer, surface });

				device.lost.then((lostInfo) => {
					if (!isMounted) return;
					if (lostInfo.reason === "destroyed") return;

					textureCache.destroy();
					SlugFontCache.destroy();

					initDevice();
				});
			});
		};

		initDevice();

		return () => {
			isMounted = false;
			if (renderer) renderer.destroy();
			if (surface) surface.destroy();
			textureCache.destroy();
			SlugFontCache.destroy();
		};
	}, []);

	return (
		<>
			<canvas
				ref={canvasRef}
				width={width}
				height={height}
				style={{ width: "100%", height: "100%" }}
			/>
			{contextValue && (
				<RenderContext.Provider value={contextValue}>
					{children}
				</RenderContext.Provider>
			)}
		</>
	);
};
