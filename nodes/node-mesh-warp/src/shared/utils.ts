export function createUniformGrid(cols: number, rows: number) {
	const points: { x: number; y: number }[] = [];
	for (let r = 0; r < rows; r++) {
		const y = (r / (rows - 1)) * 100;
		for (let c = 0; c < cols; c++) {
			const x = (c / (cols - 1)) * 100;
			points.push({ x, y });
		}
	}
	return points;
}

export function interpolateGridPoint(
	u: number,
	v: number,
	oldPoints: { x: number; y: number }[],
	oldCols: number,
	oldRows: number,
) {
	const px = u * (oldCols - 1);
	const py = v * (oldRows - 1);

	const x0 = Math.floor(px);
	const x1 = Math.min(oldCols - 1, x0 + 1);
	const y0 = Math.floor(py);
	const y1 = Math.min(oldRows - 1, y0 + 1);

	const tx = px - x0;
	const ty = py - y0;

	const p00 = oldPoints[y0 * oldCols + x0];
	const p10 = oldPoints[y0 * oldCols + x1];
	const p01 = oldPoints[y1 * oldCols + x0];
	const p11 = oldPoints[y1 * oldCols + x1];

	if (!p00 || !p10 || !p01 || !p11) {
		return { x: u * 100, y: v * 100 };
	}

	const x =
		(1 - tx) * (1 - ty) * p00.x +
		tx * (1 - ty) * p10.x +
		(1 - tx) * ty * p01.x +
		tx * ty * p11.x;

	const y =
		(1 - tx) * (1 - ty) * p00.y +
		tx * (1 - ty) * p10.y +
		(1 - tx) * ty * p01.y +
		tx * ty * p11.y;

	return { x, y };
}

export function resizeGrid(
	oldPoints: { x: number; y: number }[] | undefined | null,
	oldCols: number,
	oldRows: number,
	newCols: number,
	newRows: number,
) {
	if (!oldPoints || oldPoints.length !== oldCols * oldRows) {
		return createUniformGrid(newCols, newRows);
	}
	const points: { x: number; y: number }[] = [];
	for (let r = 0; r < newRows; r++) {
		const v = r / (newRows - 1);
		for (let c = 0; c < newCols; c++) {
			const u = c / (newCols - 1);
			points.push(interpolateGridPoint(u, v, oldPoints, oldCols, oldRows));
		}
	}
	return points;
}
