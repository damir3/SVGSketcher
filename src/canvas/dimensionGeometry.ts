import type { Vec2 } from '../math/vector';

export interface LinearDimensionGeometry {
	d1: Vec2;
	d2: Vec2;
	extensionLines: Array<{ from: Vec2; to: Vec2 }>;
}

export interface LinearDimensionVisualOptions {
	d1: Vec2;
	d2: Vec2;
	label: string;
	extensionLines?: Array<{ from: Vec2; to: Vec2 }>;
	parent: SVGElement;
	isSelected?: boolean;
	constraintId?: string;
	isTooltip?: boolean;
	startPointHighlight?: Vec2;
	targetPointSnapped?: boolean;
}

export function formatDimensionValue(val: number): string {
	return Number.isInteger(val) ? val.toFixed(1) : Number(val.toFixed(2)).toString();
}

export function computeDistanceDimensionGeometry(
	s1: Vec2,
	s2: Vec2,
	orientation: 'aligned' | 'horizontal' | 'vertical' | 'direct',
	screenOffset = 0,
	cursor?: Vec2
): LinearDimensionGeometry | null {
	if (orientation === 'direct') {
		return {
			d1: s1,
			d2: s2,
			extensionLines: [],
		};
	}

	let d1: Vec2;
	let d2: Vec2;
	let extEnd1: Vec2;
	let extEnd2: Vec2;

	if (orientation === 'horizontal') {
		const midY = (s1.y + s2.y) * 0.5;
		const dimY = cursor ? cursor.y : midY + screenOffset;
		d1 = { x: s1.x, y: dimY };
		d2 = { x: s2.x, y: dimY };
		const extDir = dimY >= midY ? 1 : -1;
		extEnd1 = { x: s1.x, y: dimY + extDir * 4 };
		extEnd2 = { x: s2.x, y: dimY + extDir * 4 };
	} else if (orientation === 'vertical') {
		const midX = (s1.x + s2.x) * 0.5;
		const dimX = cursor ? cursor.x : midX + screenOffset;
		d1 = { x: dimX, y: s1.y };
		d2 = { x: dimX, y: s2.y };
		const extDir = dimX >= midX ? 1 : -1;
		extEnd1 = { x: dimX + extDir * 4, y: s1.y };
		extEnd2 = { x: dimX + extDir * 4, y: s2.y };
	} else {
		const dx = s2.x - s1.x;
		const dy = s2.y - s1.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-4) return null;

		const nx = -dy / len;
		const ny = dx / len;
		const midX = (s1.x + s2.x) * 0.5;
		const midY = (s1.y + s2.y) * 0.5;
		const offset = cursor ? (cursor.x - midX) * nx + (cursor.y - midY) * ny : screenOffset;

		d1 = { x: s1.x + nx * offset, y: s1.y + ny * offset };
		d2 = { x: s2.x + nx * offset, y: s2.y + ny * offset };
		const extDir = offset >= 0 ? 4 : -4;
		extEnd1 = { x: d1.x + nx * extDir, y: d1.y + ny * extDir };
		extEnd2 = { x: d2.x + nx * extDir, y: d2.y + ny * extDir };
	}

	return {
		d1,
		d2,
		extensionLines: [
			{ from: s1, to: extEnd1 },
			{ from: s2, to: extEnd2 },
		],
	};
}

export function computePointToLineDimensionGeometry(
	sp: Vec2,
	s1: Vec2,
	s2: Vec2,
	screenOffset = 0,
	cursor?: Vec2
): LinearDimensionGeometry | null {
	const dx = s2.x - s1.x;
	const dy = s2.y - s1.y;
	const lineLen = Math.hypot(dx, dy);
	if (lineLen < 1e-4) return null;

	const ux = dx / lineLen;
	const uy = dy / lineLen;

	const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
	let tDim = cursor ? (cursor.x - s1.x) * ux + (cursor.y - s1.y) * uy : tProj + screenOffset;

	// Ensure there is always a visible offset / выноска if none was specified or cursor is directly at projection
	if (Math.abs(tDim - tProj) < 2) {
		const defaultOffset = (tProj < lineLen * 0.5 ? 25 : -25);
		tDim = tProj + (screenOffset !== 0 ? screenOffset : defaultOffset);
	}

	const dBase = { x: s1.x + ux * tDim, y: s1.y + uy * tDim };
	const hx = sp.x - (s1.x + ux * tProj);
	const hy = sp.y - (s1.y + uy * tProj);
	const dTop = { x: dBase.x + hx, y: dBase.y + hy };

	const extensionLines: Array<{ from: Vec2; to: Vec2 }> = [];

	// Extension line from point to dTop if offset along line
	if (Math.abs(tDim - tProj) > 2) {
		const extDir = tDim >= tProj ? 1 : -1;
		extensionLines.push({
			from: sp,
			to: { x: dTop.x + ux * extDir * 4, y: dTop.y + uy * extDir * 4 },
		});
	}

	// Extension line along line if dBase is beyond segment endpoints
	if (tDim < 0) {
		extensionLines.push({
			from: s1,
			to: { x: dBase.x - ux * 4, y: dBase.y - uy * 4 },
		});
	} else if (tDim > lineLen) {
		extensionLines.push({
			from: s2,
			to: { x: dBase.x + ux * 4, y: dBase.y + uy * 4 },
		});
	}

	return {
		d1: dBase,
		d2: dTop,
		extensionLines,
	};
}
