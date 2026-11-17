import { DIMENSION_EXTENSION_OVERRUN_PX, DIMENSION_EXTERNAL_ARROW_TAIL_PX } from './distances';
import { Vec2 } from '../math/vector';
import { distanceToArc, distanceToLinearDimension } from '../math/hitTest';
import {
	createSvgCircle,
	createSvgElement,
	createSvgLine,
	createSvgPath,
	getArcSvgPath,
	renderDimensionLabel,
} from './svg';
import {
	COLORS,
	DIM_ARROWS,
	EXTENSION_LINE_ATTRS,
	PREVIEW_EXTENSION_LINE_ATTRS,
	STROKE_WIDTH,
	type SvgAttrs,
} from './styles';

export interface LinearDimensionGeometry {
	d1: Vec2;
	d2: Vec2;
	extensionLines: Array<{ from: Vec2; to: Vec2 }>;
}

export interface ArcDimensionExtension {
	center: Vec2;
	radius: number;
	from: Vec2;
	to: Vec2;
	clockwise: boolean;
}

/** Continue the nearest arc endpoint to a dimension arrow outside its sweep. */
export function computeArcDimensionExtension(
	center: Vec2,
	start: Vec2,
	end: Vec2,
	radius: number,
	clockwise: boolean,
	target: Vec2
): ArcDimensionExtension | undefined {
	const twoPi = 2 * Math.PI;
	const positive = (angle: number) => ((angle % twoPi) + twoPi) % twoPi;
	const sign = clockwise ? 1 : -1;
	const startAngle = center.angleToPoint(start);
	const angle = center.angleToPoint(target);
	const sweep = positive((center.angleToPoint(end) - startAngle) * sign);
	const relative = positive((angle - startAngle) * sign);
	if (relative <= sweep + 1e-8 || twoPi - relative < 1e-8) return undefined;
	const extendEnd = relative - sweep < twoPi - relative;
	const extensionSign = extendEnd ? sign : -sign;
	return {
		center,
		radius,
		from: extendEnd ? end : start,
		to: Vec2.fromPolar(radius, angle + (extensionSign * 4) / Math.max(radius, 1)).add(center),
		clockwise: extensionSign > 0,
	};
}

export function distanceToArcDimensionExtension(screen: Vec2, extension: ArcDimensionExtension): number {
	return Math.min(
		distanceToArc(screen, extension.center, extension.radius, extension.from, extension.to, extension.clockwise) ??
			Infinity,
		screen.distanceTo(extension.from),
		screen.distanceTo(extension.to)
	);
}

export interface LinearDimensionVisualOptions {
	d1: Vec2;
	d2: Vec2;
	label: string;
	arcExtensions?: ArcDimensionExtension[];
	extensionLines?: Array<{ from: Vec2; to: Vec2 }>;
	parent: SVGElement;
	isSelected?: boolean;
	constraintId?: string;
	isPreview?: boolean;
	startPointHighlight?: Vec2;
	targetPointSnapped?: boolean;
	labelPosition?: number;
}

export interface AngleDimensionVisualOptions {
	parent: SVGElement;
	sCenter: Vec2;
	a1: number;
	a2: number;
	delta: number;
	rScreen: number;
	label: string;
	isSelected?: boolean;
	constraintId?: string;
	extensionLines?: Array<{ angle: number; pA: Vec2; pB: Vec2 }>;
}

export function formatDimensionValue(val: number, fractionDigits = 2): string {
	return Number(val.toFixed(fractionDigits)).toString();
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
		extEnd1 = new Vec2(s1.x, dimY + extDir * DIMENSION_EXTENSION_OVERRUN_PX);
		extEnd2 = new Vec2(s2.x, dimY + extDir * DIMENSION_EXTENSION_OVERRUN_PX);
	} else if (orientation === 'vertical') {
		const midPoint = new Vec2().midpoint(s1, s2);
		const dimX = cursor ? cursor.x : midPoint.x + screenOffset;
		d1 = new Vec2(dimX, s1.y);
		d2 = new Vec2(dimX, s2.y);
		const extDir = dimX >= midPoint.x ? 1 : -1;
		extEnd1 = new Vec2(dimX + extDir * DIMENSION_EXTENSION_OVERRUN_PX, s1.y);
		extEnd2 = new Vec2(dimX + extDir * DIMENSION_EXTENSION_OVERRUN_PX, s2.y);
	} else {
		const dir = new Vec2().subVectors(s2, s1).normalizeOrNull(1e-4);
		if (!dir) return null;
		const normal = dir.clone().perpendicular();
		const midPoint = new Vec2().midpoint(s1, s2);
		const offset = cursor ? new Vec2().subVectors(cursor, midPoint).dot(normal) : screenOffset;

		d1 = s1.clone().addScaledVector(normal, offset);
		d2 = s2.clone().addScaledVector(normal, offset);
		const extDir = offset >= 0 ? DIMENSION_EXTENSION_OVERRUN_PX : -DIMENSION_EXTENSION_OVERRUN_PX;
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
			to: dTop.clone().addScaledVector(dir, DIMENSION_EXTENSION_OVERRUN_PX * extDir),
		});
	}

	// Extension line along line if dBase is beyond segment endpoints
	if (tDim < 0) {
		extensionLines.push({
			from: s1,
			to: dBase.clone().addScaledVector(dir, -DIMENSION_EXTENSION_OVERRUN_PX),
		});
	} else if (tDim > lineLen) {
		extensionLines.push({
			from: s2,
			to: dBase.clone().addScaledVector(dir, DIMENSION_EXTENSION_OVERRUN_PX),
		});
	}

	return {
		d1: dBase,
		d2: dTop,
		extensionLines,
	};
}

export function distanceToLinearDimensionVisual(screen: Vec2, d1: Vec2, d2: Vec2, labelPosition = 0.5): number {
	const basePos = d1.clone().lerp(d2, labelPosition);
	const distToLabel = screen.distanceTo(basePos);
	const distToSeg = distanceToLinearDimension(screen, d1, d2);
	let minDist = Math.min(distToLabel, distToSeg);
	if (labelPosition < 0) {
		minDist = Math.min(minDist, distanceToLinearDimension(screen, basePos, d1));
	} else if (labelPosition > 1) {
		minDist = Math.min(minDist, distanceToLinearDimension(screen, d2, basePos));
	}
	return minDist;
}

export function renderLinearDimensionVisual(opts: LinearDimensionVisualOptions): void {
	const {
		d1,
		d2,
		label,
		extensionLines,
		arcExtensions,
		parent,
		isSelected = false,
		constraintId,
		isPreview = false,
		startPointHighlight,
		targetPointSnapped = false,
	} = opts;

	const g = constraintId
		? createSvgElement(
				'g',
				{
					class: 'dimension-item',
					'data-id': constraintId,
					'data-type': 'constraint',
				},
				parent
			)
		: parent;

	const color = isSelected ? COLORS.selected : COLORS.primary;
	const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

	// 1. Extension lines
	if (extensionLines && extensionLines.length > 0) {
		const extAttrs = isPreview
			? PREVIEW_EXTENSION_LINE_ATTRS
			: isSelected
				? { ...EXTENSION_LINE_ATTRS, stroke: COLORS.selected }
				: EXTENSION_LINE_ATTRS;
		for (const ext of extensionLines) {
			createSvgLine(ext.from, ext.to, extAttrs, g);
		}
	}

	for (const extension of arcExtensions ?? []) {
		const attrs = isPreview
			? PREVIEW_EXTENSION_LINE_ATTRS
			: isSelected
				? { ...EXTENSION_LINE_ATTRS, stroke: COLORS.selected }
				: EXTENSION_LINE_ATTRS;
		createSvgPath(
			getArcSvgPath(extension.center, extension.from, extension.to, extension.radius, extension.clockwise),
			{ ...attrs, fill: 'none', class: 'dimension-arc-extension' },
			g
		);
	}

	// 2. Start point highlight (origin anchor)
	if (startPointHighlight) {
		createSvgCircle(
			startPointHighlight,
			4,
			{
				fill: COLORS.primary,
				stroke: COLORS.white,
				'stroke-width': 1.5,
			},
			g
		);
	}

	// 3. Target point snap ring
	if (targetPointSnapped) {
		createSvgCircle(
			d2,
			6,
			{
				fill: COLORS.guideFaint,
				stroke: COLORS.primary,
				'stroke-width': 1.5,
			},
			g
		);
	}

	// 4. Dimension line with arrowheads (Engineering CAD style)
	const screenDist = d1.distanceTo(d2);
	const lineAttrs: SvgAttrs = {
		stroke: color,
		'stroke-width': STROKE_WIDTH.dimension,
	};
	const minInsideDist = 40;
	if (screenDist >= minInsideDist) {
		createSvgLine(d1, d2, { ...lineAttrs, 'marker-start': arrowUrl, 'marker-end': arrowUrl }, g);
	} else if (screenDist > 1e-4) {
		// Flipped arrows outside pointing inward (GOST 2.307)
		createSvgLine(d1, d2, lineAttrs, g);
		const u = new Vec2().subVectors(d2, d1).multiplyScalar(1 / screenDist);
		createSvgLine(
			d1.clone().addScaledVector(u, -DIMENSION_EXTERNAL_ARROW_TAIL_PX),
			d1,
			{ ...lineAttrs, 'marker-end': arrowUrl },
			g
		);
		createSvgLine(
			d2.clone().addScaledVector(u, DIMENSION_EXTERNAL_ARROW_TAIL_PX),
			d2,
			{ ...lineAttrs, 'marker-end': arrowUrl },
			g
		);
	} else {
		createSvgLine(d1, d2, lineAttrs, g);
	}

	// Dimension number placed above the dimension line
	let angle = 0;
	if (screenDist > 1e-4) {
		angle = Math.atan2(d2.y - d1.y, d2.x - d1.x);
	}
	// Normalize angle so text reads from left to right (or bottom to top from the right side, GOST 2.307)
	if (angle > Math.PI / 2 - 1e-4) {
		angle -= Math.PI;
	} else if (angle <= -Math.PI / 2) {
		angle += Math.PI;
	}
	const uText = Vec2.fromPolar(1, angle);
	const up = new Vec2(uText.y, -uText.x);

	const t = opts.labelPosition ?? 0.5;
	const basePos = d1.clone().lerp(d2, t);

	// Extend dimension line if text moved outside extension lines
	if (screenDist > 1e-4 && (t < 0 || t > 1)) {
		const u = new Vec2().subVectors(d2, d1).multiplyScalar(1 / screenDist);
		const overhang = Math.max(12, (label.length * 7.5) / 2) + 6;
		if (t < 0) {
			createSvgLine(basePos.clone().addScaledVector(u, -overhang), d1, lineAttrs, g);
		} else if (t > 1) {
			createSvgLine(d2, basePos.clone().addScaledVector(u, overhang), lineAttrs, g);
		}
	}

	const textPos = basePos.addScaledVector(up, 8.5);
	const angleDeg = (angle * 180) / Math.PI;

	renderDimensionLabel(g, textPos, label, color, 'linear', {
		angleDeg,
	});
}

export function renderAngleExtensionLines(
	parentG: SVGElement,
	sCenter: Vec2,
	angleRad: number,
	rScreen: number,
	pA: Vec2,
	pB: Vec2,
	color: string
): void {
	const v = Vec2.fromPolar(1, angleRad);

	const k1 = new Vec2().subVectors(pA, sCenter).dot(v);
	const k2 = new Vec2().subVectors(pB, sCenter).dot(v);
	const kMin = Math.min(k1, k2);
	const kMax = Math.max(k1, k2);

	const kEnd = rScreen + DIMENSION_EXTENSION_OVERRUN_PX;
	if (kEnd <= 0) return;

	const intervals: Array<[number, number]> = [];
	if (kMax <= 0) {
		intervals.push([0, kEnd]);
	} else if (kMin <= 0) {
		if (kEnd > kMax) {
			intervals.push([kMax, kEnd]);
		}
	} else {
		intervals.push([0, Math.min(kMin, kEnd)]);
		if (kEnd > kMax) {
			intervals.push([kMax, kEnd]);
		}
	}

	for (const [startK, endK] of intervals) {
		if (endK - startK < 1) continue;
		const p1 = sCenter.clone().addScaledVector(v, startK);
		const p2 = sCenter.clone().addScaledVector(v, endK);

		createSvgLine(
			p1,
			p2,
			{
				...EXTENSION_LINE_ATTRS,
				stroke: color,
			},
			parentG
		);
	}
}

export function renderAngleDimensionVisual(opts: AngleDimensionVisualOptions): void {
	const { parent, sCenter, a1, a2, delta, rScreen, label, isSelected = false, constraintId, extensionLines } = opts;

	const g = constraintId
		? createSvgElement(
				'g',
				{
					class: 'dimension-item',
					'data-id': constraintId,
					'data-type': 'constraint',
				},
				parent
			)
		: parent;

	const color = isSelected ? COLORS.selected : COLORS.primary;
	const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

	if (extensionLines) {
		for (const ext of extensionLines) {
			renderAngleExtensionLines(g, sCenter, ext.angle, rScreen, ext.pA, ext.pB, color);
		}
	}

	const sweepFlag = delta > 0 ? 1 : 0;
	const a = Vec2.fromPolar(rScreen, a1).add(sCenter);
	const b = Vec2.fromPolar(rScreen, a2).add(sCenter);
	const midAngle = a1 + delta * 0.5;
	const midPoint = Vec2.fromPolar(rScreen, midAngle).add(sCenter);

	const arcLen = rScreen * Math.abs(delta);
	const lineAttrs: SvgAttrs = {
		fill: 'none',
		stroke: color,
		'stroke-width': STROKE_WIDTH.dimension,
	};
	const arcPath = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;

	if (arcLen >= 40) {
		createSvgPath(
			arcPath,
			{
				...lineAttrs,
				'marker-start': arrowUrl,
				'marker-end': arrowUrl,
			},
			g
		);
	} else {
		// Flipped tangential arrows outside for sharp angles (GOST 2.307)
		createSvgPath(arcPath, lineAttrs, g);
		const uA = Vec2.fromPolar(1, a1);
		const tanA = uA.perpendicular().multiplyScalar(sweepFlag ? 1 : -1);
		createSvgLine(
			a.clone().addScaledVector(tanA, -DIMENSION_EXTERNAL_ARROW_TAIL_PX),
			a,
			{ stroke: color, 'stroke-width': STROKE_WIDTH.dimension, 'marker-end': arrowUrl },
			g
		);
		const uB = Vec2.fromPolar(1, a2);
		const tanB = uB.perpendicular().multiplyScalar(sweepFlag ? 1 : -1);
		createSvgLine(
			b.clone().addScaledVector(tanB, DIMENSION_EXTERNAL_ARROW_TAIL_PX),
			b,
			{ stroke: color, 'stroke-width': STROKE_WIDTH.dimension, 'marker-end': arrowUrl },
			g
		);
	}

	const uRad = Vec2.fromPolar(1, midAngle);
	if (arcLen < 26) {
		// Leader shelf for small angle
		const anchor = midPoint.clone().addScaledVector(uRad, 14);
		createSvgLine(midPoint, anchor, { stroke: color, 'stroke-width': STROKE_WIDTH.dimension }, g);
		const dirX = uRad.x >= 0 ? 1 : -1;
		const shelfLen = label.length * 7.5 + 10;
		const shelfEnd = new Vec2(anchor.x + dirX * shelfLen, anchor.y);
		createSvgLine(anchor, shelfEnd, { stroke: color, 'stroke-width': STROKE_WIDTH.dimension }, g);
		renderDimensionLabel(g, new Vec2(anchor.x + dirX * (shelfLen * 0.5), anchor.y - 8.5), label, color, 'angle');
	} else {
		// Above arc on convex side
		const textPos = midPoint.clone().addScaledVector(uRad, 8.5);
		const uTan = uRad.perpendicular();
		let textAngle = Math.atan2(uTan.y, uTan.x);
		if (textAngle > Math.PI / 2 - 1e-4) textAngle -= Math.PI;
		else if (textAngle <= -Math.PI / 2) textAngle += Math.PI;
		renderDimensionLabel(g, textPos, label, color, 'angle', {
			angleDeg: (textAngle * 180) / Math.PI,
		});
	}
}

export function renderDistancePreviewVisual(
	parent: SVGElement,
	s1: Vec2,
	s2: Vec2,
	cursor?: Vec2,
	distVal = 0,
	orientation: 'aligned' | 'horizontal' | 'vertical' | 'direct' = 'aligned',
	isTargetSnapped = false
): void {
	const geom = computeDistanceDimensionGeometry(s1, s2, orientation, 0, cursor);
	if (!geom) return;

	let labelPosition: number | undefined;
	if (cursor && orientation !== 'direct') {
		if (orientation === 'horizontal') {
			const dx = s2.x - s1.x;
			if (Math.abs(dx) > 1e-4) labelPosition = (cursor.x - s1.x) / dx;
		} else if (orientation === 'vertical') {
			const dy = s2.y - s1.y;
			if (Math.abs(dy) > 1e-4) labelPosition = (cursor.y - s1.y) / dy;
		} else {
			const dir = new Vec2().subVectors(s2, s1).normalizeOrNull(1e-4);
			if (dir) {
				const totalLen = s1.distanceTo(s2);
				if (totalLen > 1e-4) {
					labelPosition = new Vec2().subVectors(cursor, s1).dot(dir) / totalLen;
				}
			}
		}
	}

	const labelPrefix = orientation === 'horizontal' ? 'H: ' : orientation === 'vertical' ? 'V: ' : '';
	renderLinearDimensionVisual({
		d1: geom.d1,
		d2: geom.d2,
		label: `${labelPrefix}${formatDimensionValue(distVal, 1)} mm`,
		extensionLines: geom.extensionLines,
		parent,
		isPreview: true,
		startPointHighlight: orientation === 'direct' ? s1 : undefined,
		targetPointSnapped: isTargetSnapped,
		labelPosition,
	});
}

export function renderPointToLineDistancePreviewVisual(
	parent: SVGElement,
	sp: Vec2,
	s1: Vec2,
	s2: Vec2,
	cursor?: Vec2,
	distVal = 0
): void {
	const geom = computePointToLineDimensionGeometry(sp, s1, s2, 0, cursor);
	if (!geom) return;
	let labelPosition =
		cursor && geom.d1.distanceToSquared(geom.d2) > 1e-8
			? new Vec2().subVectors(cursor, geom.d1).dot(new Vec2().subVectors(geom.d2, geom.d1)) /
				geom.d1.distanceToSquared(geom.d2)
			: 0.5;
	if (Math.abs(labelPosition - 0.5) < 0.04) labelPosition = 0.5;

	renderLinearDimensionVisual({
		d1: geom.d1,
		d2: geom.d2,
		label: `${formatDimensionValue(distVal, 1)} mm`,
		extensionLines: geom.extensionLines,
		parent,
		isPreview: true,
		startPointHighlight: sp,
		labelPosition,
	});
}

export function renderAnglePreviewVisual(
	parent: SVGElement,
	sCenter: Vec2,
	sRay1: Vec2,
	sRay2: Vec2,
	cursor: Vec2,
	angleDeg: number,
	sp1?: Vec2,
	sp2?: Vec2,
	sp3?: Vec2,
	sp4?: Vec2
): void {
	const a1 = sCenter.angleToPoint(sRay1);
	const a2 = sCenter.angleToPoint(sRay2);

	let delta = a2 - a1;
	while (delta > Math.PI) delta -= 2 * Math.PI;
	while (delta < -Math.PI) delta += 2 * Math.PI;

	const rScreen = Math.max(28, sCenter.distanceTo(cursor));
	const extensionLines: Array<{ angle: number; pA: Vec2; pB: Vec2 }> = [];
	if (sp1 && sp2) extensionLines.push({ angle: a1, pA: sp1, pB: sp2 });
	if (sp3 && sp4) extensionLines.push({ angle: a2, pA: sp3, pB: sp4 });

	renderAngleDimensionVisual({
		parent,
		sCenter,
		a1,
		a2,
		delta,
		rScreen,
		label: `${formatDimensionValue(angleDeg, 1)}°`,
		extensionLines,
	});
}
