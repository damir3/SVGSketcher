import { Vec2 } from '../math/vector';

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
	isPreview?: boolean;
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
		const midPoint = new Vec2().midpoint(s1, s2);
		const dimY = cursor ? cursor.y : midPoint.y + screenOffset;
		d1 = new Vec2(s1.x, dimY);
		d2 = new Vec2(s2.x, dimY);
		const extDir = dimY >= midPoint.y ? 1 : -1;
		extEnd1 = new Vec2(s1.x, dimY + extDir * 4);
		extEnd2 = new Vec2(s2.x, dimY + extDir * 4);
	} else if (orientation === 'vertical') {
		const midPoint = new Vec2().midpoint(s1, s2);
		const dimX = cursor ? cursor.x : midPoint.x + screenOffset;
		d1 = new Vec2(dimX, s1.y);
		d2 = new Vec2(dimX, s2.y);
		const extDir = dimX >= midPoint.x ? 1 : -1;
		extEnd1 = new Vec2(dimX + extDir * 4, s1.y);
		extEnd2 = new Vec2(dimX + extDir * 4, s2.y);
	} else {
		const dir = new Vec2().subVectors(s2, s1).normalizeOrNull(1e-4);
		if (!dir) return null;
		const normal = dir.clone().perpendicular();
		const midPoint = new Vec2().midpoint(s1, s2);
		const offset = cursor ? new Vec2().subVectors(cursor, midPoint).dot(normal) : screenOffset;

		d1 = s1.clone().addScaledVector(normal, offset);
		d2 = s2.clone().addScaledVector(normal, offset);
		const extDir = offset >= 0 ? 4 : -4;
		extEnd1 = d1.clone().addScaledVector(normal, extDir);
		extEnd2 = d2.clone().addScaledVector(normal, extDir);
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
	const delta = new Vec2().subVectors(s2, s1);
	const lineLen = delta.length();
	if (lineLen < 1e-4) return null;

	const dir = delta.clone().multiplyScalar(1.0 / lineLen);

	const tProj = new Vec2().subVectors(sp, s1).dot(dir);
	let tDim = cursor ? new Vec2().subVectors(cursor, s1).dot(dir) : tProj + screenOffset;

	// Ensure there is always a visible offset / выноска if none was specified or cursor is directly at projection
	if (Math.abs(tDim - tProj) < 2) {
		const defaultOffset = tProj < lineLen * 0.5 ? 25 : -25;
		tDim = tProj + (screenOffset !== 0 ? screenOffset : defaultOffset);
	}

	const dBase = s1.clone().addScaledVector(dir, tDim);
	const projection = s1.clone().addScaledVector(dir, tProj);
	const h = new Vec2().subVectors(sp, projection);
	const dTop = new Vec2().addVectors(dBase, h);

	const extensionLines: Array<{ from: Vec2; to: Vec2 }> = [];

	// Extension line from point to dTop if offset along line
	if (Math.abs(tDim - tProj) > 2) {
		const extDir = tDim >= tProj ? 1 : -1;
		extensionLines.push({
			from: sp,
			to: dTop.clone().addScaledVector(dir, 4 * extDir),
		});
	}

	// Extension line along line if dBase is beyond segment endpoints
	if (tDim < 0) {
		extensionLines.push({
			from: s1,
			to: dBase.clone().addScaledVector(dir, -4),
		});
	} else if (tDim > lineLen) {
		extensionLines.push({
			from: s2,
			to: dBase.clone().addScaledVector(dir, 4),
		});
	}

	return {
		d1: dBase,
		d2: dTop,
		extensionLines,
	};
}
