interface CropAreaInput {
	cropType?: "rect" | "path" | null;
	leftPercentage: number;
	topPercentage: number;
	widthPercentage: number;
	heightPercentage: number;
	pathPoints?: { x: number; y: number }[] | null;
	roundness?: number | null;
}

export function calculateCropArea(config: CropAreaInput) {
	const isPath = config.cropType === "path";
	let leftPercentage = config.leftPercentage;
	let topPercentage = config.topPercentage;
	let widthPercentage = config.widthPercentage;
	let heightPercentage = config.heightPercentage;

	if (isPath && config.pathPoints && config.pathPoints.length > 0) {
		const xs = config.pathPoints.map((p) => p.x);
		const ys = config.pathPoints.map((p) => p.y);
		leftPercentage = Math.min(...xs);
		topPercentage = Math.min(...ys);
		widthPercentage = Math.max(0.01, Math.max(...xs) - leftPercentage);
		heightPercentage = Math.max(0.01, Math.max(...ys) - topPercentage);
	}

	return {
		leftPercentage,
		topPercentage,
		widthPercentage,
		heightPercentage,
	};
}
