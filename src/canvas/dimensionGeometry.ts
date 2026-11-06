import { dot, vec, add, addScaled, mid, normalizeOrNull, scale, sub, type Vec2 } from '../math/vector';

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
		const midPoint = mid(s1, s2);
		const dimY = cursor ? cursor.y : midPoint.y + screenOffset;
		d1 = { x: s1.x, y: dimY };
		d2 = { x: s2.x, y: dimY };
		const extDir = dimY >= midPoint.y ? 1 : -1;
		extEnd1 = { x: s1.x, y: dimY + extDir * 4 };
		extEnd2 = { x: s2.x, y: dimY + extDir * 4 };
	} else if (orientation === 'vertical') {
		const midPoint = mid(s1, s2);
		const dimX = cursor ? cursor.x : midPoint.x + screenOffset;
		d1 = { x: dimX, y: s1.y };
		d2 = { x: dimX, y: s2.y };
		const extDir = dimX >= midPoint.x ? 1 : -1;
		extEnd1 = { x: dimX + extDir * 4, y: s1.y };
		extEnd2 = { x: dimX + extDir * 4, y: s2.y };
	} else {
		const dir = normalizeOrNull(sub(s2, s1), 1e-4);
		if (!dir) return null;
		const normal = vec(-dir.y, dir.x);
		const midPoint = mid(s1, s2);
		const offset = cursor ? dot(sub(cursor, midPoint), normal) : screenOffset;

		d1 = { x: s1.x + normal.x * offset, y: s1.y + normal.y * offset };
		d2 = { x: s2.x + normal.x * offset, y: s2.y + normal.y * offset };
		const extDir = offset >= 0 ? 4 : -4;
		extEnd1 = { x: d1.x + normal.x * extDir, y: d1.y + normal.y * extDir };
		extEnd2 = { x: d2.x + normal.x * extDir, y: d2.y + normal.y * extDir };
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
	const delta = sub(s2, s1);
	const lineLen = Math.hypot(delta.x, delta.y);
	if (lineLen < 1e-4) return null;

	const dir = scale(delta, 1.0 / lineLen);

	const tProj = dot(sub(sp, s1), dir);
	let tDim = cursor ? dot(sub(cursor, s1), dir) : tProj + screenOffset;

	// Ensure there is always a visible offset / выноска if none was specified or cursor is directly at projection
	if (Math.abs(tDim - tProj) < 2) {
		const defaultOffset = tProj < lineLen * 0.5 ? 25 : -25;
		tDim = tProj + (screenOffset !== 0 ? screenOffset : defaultOffset);
	}

	const dBase = addScaled(s1, dir, tDim);
	const h = vec(sp.x - (s1.x + dir.x * tProj), sp.y - (s1.y + dir.y * tProj));
	const dTop = add(dBase, h);

	const extensionLines: Array<{ from: Vec2; to: Vec2 }> = [];

	// Extension line from point to dTop if offset along line
	if (Math.abs(tDim - tProj) > 2) {
		const extDir = tDim >= tProj ? 1 : -1;
		extensionLines.push({
			from: sp,
			to: { x: dTop.x + dir.x * extDir * 4, y: dTop.y + dir.y * extDir * 4 },
		});
	}

	// Extension line along line if dBase is beyond segment endpoints
	if (tDim < 0) {
		extensionLines.push({
			from: s1,
			to: { x: dBase.x - dir.x * 4, y: dBase.y - dir.y * 4 },
		});
	} else if (tDim > lineLen) {
		extensionLines.push({
			from: s2,
			to: { x: dBase.x + dir.x * 4, y: dBase.y + dir.y * 4 },
		});
	}

	return {
		d1: dBase,
		d2: dTop,
		extensionLines,
	};
}
