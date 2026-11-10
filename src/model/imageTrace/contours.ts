import { Vec2 } from '../../math/vector';

/**
 * Contour extraction. Coordinates are continuous image coordinates: pixel (x, y) covers [x, x + 1] × [y, y + 1].
 * All contours are closed and returned without repeating the first point.
 */

// Corner bit order: tl = 0, tr = 1, br = 2, bl = 3. Edges: top = 0, right = 1, bottom = 2, left = 3.
type CellSegment = [edgeA: number, edgeB: number, referenceCorner: number];

const CASES: Record<number, CellSegment[]> = {
	1: [[3, 0, 0]],
	2: [[0, 1, 1]],
	3: [[3, 1, 0]],
	4: [[1, 2, 2]],
	6: [[0, 2, 1]],
	7: [[3, 2, 3]],
	8: [[2, 3, 3]],
	9: [[0, 2, 0]],
	11: [[1, 2, 2]],
	12: [[3, 1, 3]],
	13: [[0, 1, 1]],
	14: [[3, 0, 0]],
};

const SADDLE_CASES: Record<number, { centerInside: CellSegment[]; centerOutside: CellSegment[] }> = {
	5: {
		centerInside: [
			[0, 1, 1],
			[2, 3, 3],
		],
		centerOutside: [
			[3, 0, 0],
			[1, 2, 2],
		],
	},
	10: {
		centerInside: [
			[3, 0, 0],
			[1, 2, 2],
		],
		centerOutside: [
			[0, 1, 1],
			[2, 3, 3],
		],
	},
};

/**
 * Marching squares iso-contours of a scalar field sampled at pixel centers. Values above `iso` are inside;
 * everything outside the image counts as outside, so every contour is closed.
 */
export function marchingSquares(field: Float32Array, width: number, height: number, iso: number): Vec2[][] {
	const paddedWidth = width + 2;
	const paddedHeight = height + 2;
	const sample = (i: number, j: number): number =>
		i < 0 || j < 0 || i >= width || j >= height ? Number.NEGATIVE_INFINITY : field[j * width + i];
	const value = (i: number, j: number): number => {
		const v = sample(i, j);
		return v === Number.NEGATIVE_INFINITY ? Math.min(0, iso - 1) : v;
	};
	const verticalOffset = paddedWidth * paddedHeight;
	const edgeId = (i: number, j: number, edge: number): number => {
		// Cell (i, j) spans samples i..i+1, j..j+1 in sample coordinates (padded by one on each side).
		switch (edge) {
			case 0:
				return (j + 1) * paddedWidth + (i + 1);
			case 2:
				return (j + 2) * paddedWidth + (i + 1);
			case 3:
				return verticalOffset + (j + 1) * paddedWidth + (i + 1);
			default:
				return verticalOffset + (j + 1) * paddedWidth + (i + 2);
		}
	};
	const edgePoint = (i: number, j: number, edge: number): Vec2 => {
		let i0 = i;
		let j0 = j;
		let i1 = i;
		let j1 = j;
		if (edge === 0) i1 = i + 1;
		else if (edge === 2) {
			j0 = j1 = j + 1;
			i1 = i + 1;
		} else if (edge === 3) j1 = j + 1;
		else {
			i0 = i1 = i + 1;
			j1 = j + 1;
		}
		const v0 = value(i0, j0);
		const v1 = value(i1, j1);
		const t = Math.abs(v1 - v0) < 1e-12 ? 0.5 : Math.min(1, Math.max(0, (iso - v0) / (v1 - v0)));
		return new Vec2(i0 + (i1 - i0) * t + 0.5, j0 + (j1 - j0) * t + 0.5);
	};
	const cornerPoint = (i: number, j: number, corner: number): Vec2 =>
		new Vec2(i + (corner === 1 || corner === 2 ? 1 : 0) + 0.5, j + (corner >= 2 ? 1 : 0) + 0.5);

	const starts = new Map<number, number>();
	const segmentEnds: number[] = [];
	const points = new Map<number, Vec2>();

	for (let j = -1; j < height; j++) {
		for (let i = -1; i < width; i++) {
			const corners = [value(i, j), value(i + 1, j), value(i + 1, j + 1), value(i, j + 1)];
			let index = 0;
			for (let c = 0; c < 4; c++) if (corners[c] > iso) index |= 1 << c;
			if (index === 0 || index === 15) continue;
			let segments = CASES[index];
			if (!segments) {
				const center = (corners[0] + corners[1] + corners[2] + corners[3]) / 4;
				segments = center > iso ? SADDLE_CASES[index].centerInside : SADDLE_CASES[index].centerOutside;
			}
			for (const [edgeA, edgeB, reference] of segments) {
				const idA = edgeId(i, j, edgeA);
				const idB = edgeId(i, j, edgeB);
				const pA = points.get(idA) ?? edgePoint(i, j, edgeA);
				const pB = points.get(idB) ?? edgePoint(i, j, edgeB);
				points.set(idA, pA);
				points.set(idB, pB);
				const r = cornerPoint(i, j, reference);
				const inside = (index >> reference) & 1;
				const crossValue = (pB.x - pA.x) * (r.y - pA.y) - (pB.y - pA.y) * (r.x - pA.x);
				const forward = inside ? crossValue > 0 : crossValue < 0;
				const from = forward ? idA : idB;
				const to = forward ? idB : idA;
				starts.set(from, segmentEnds.length);
				segmentEnds.push(to);
			}
		}
	}

	const used = new Uint8Array(segmentEnds.length);
	const contours: Vec2[][] = [];
	for (const [startEdge, firstSegment] of starts) {
		if (used[firstSegment]) continue;
		const contour: Vec2[] = [];
		let edge = startEdge;
		let segment: number | undefined = firstSegment;
		while (segment !== undefined && !used[segment]) {
			used[segment] = 1;
			contour.push(points.get(edge)!);
			edge = segmentEnds[segment];
			segment = starts.get(edge);
		}
		if (contour.length >= 3) contours.push(contour);
	}
	return contours;
}

/** Follows the pixel cracks between foreground and background. Contour vertices lie on pixel corners. */
export function pixelEdgeContours(mask: Uint8Array, width: number, height: number): Vec2[][] {
	const fg = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
	const vertexId = (x: number, y: number) => y * (width + 1) + x;
	const edgeFrom: number[] = [];
	const edgeTo: number[] = [];
	const edgeDir: number[] = [];
	const outgoing = new Map<number, number[]>();
	const addEdge = (x0: number, y0: number, x1: number, y1: number, dir: number) => {
		const from = vertexId(x0, y0);
		const index = edgeFrom.length;
		edgeFrom.push(from);
		edgeTo.push(vertexId(x1, y1));
		edgeDir.push(dir);
		const list = outgoing.get(from);
		if (list) list.push(index);
		else outgoing.set(from, [index]);
	};
	// Directions in screen space: 0 = +x, 1 = +y, 2 = -x, 3 = -y. Foreground stays on the right-hand side.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!fg(x, y)) continue;
			if (!fg(x, y - 1)) addEdge(x, y, x + 1, y, 0);
			if (!fg(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1, 1);
			if (!fg(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1, 2);
			if (!fg(x - 1, y)) addEdge(x, y + 1, x, y, 3);
		}
	}

	const used = new Uint8Array(edgeFrom.length);
	const contours: Vec2[][] = [];
	const toPoint = (id: number): Vec2 => new Vec2(id % (width + 1), Math.floor(id / (width + 1)));
	for (let start = 0; start < edgeFrom.length; start++) {
		if (used[start]) continue;
		const corners: Vec2[] = [];
		let edge = start;
		let previousDir = -1;
		while (!used[edge]) {
			used[edge] = 1;
			if (edgeDir[edge] !== previousDir) corners.push(toPoint(edgeFrom[edge]));
			previousDir = edgeDir[edge];
			const candidates = (outgoing.get(edgeTo[edge]) ?? []).filter(e => !used[e]);
			if (!candidates.length) break;
			let next = candidates[0];
			if (candidates.length > 1) {
				for (const preferred of [(previousDir + 1) % 4, previousDir, (previousDir + 3) % 4]) {
					const match = candidates.find(e => edgeDir[e] === preferred);
					if (match !== undefined) {
						next = match;
						break;
					}
				}
			}
			edge = next;
		}
		// The first vertex is redundant when the contour closes with the same direction it started with.
		if (corners.length > 1 && edgeDir[start] === previousDir) corners.shift();
		if (corners.length >= 3) contours.push(corners);
	}
	return contours;
}
