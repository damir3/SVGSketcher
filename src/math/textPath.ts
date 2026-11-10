import * as opentype from 'opentype.js';
import { Vec2 } from './vector';
import type { GeoCurve, GeoSegment, GeoEllipse, GeoEllipticalArc, GeoSpline } from './intersection';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import { evaluateBezier, evaluateBezierDerivative } from './spline';

export interface TextLayoutOptions {
	mode: 'text' | 'text_on_path';
	text: string;
	height: number; // in mm
	characterSpacing: number; // in %
	verticalAlignment?: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	alignment: 'left' | 'center' | 'right';
	rectangleCorners?: [Vec2, Vec2, Vec2, Vec2]; // p0 (TL), p1 (TR), p2 (BR), p3 (BL) in CAD coords
	coordSystem?: 'cad' | 'svg';
}

export interface CurveSample {
	point: Vec2;
	tangent: Vec2;
	normal: Vec2;
}

export interface PathEvaluator {
	// Length used for alignment and fitting. A closed continuation may extend beyond it.
	readonly length: number;
	getSampleAtDistance(s: number): CurveSample;
}

function createEllipsePathEvaluator(curve: GeoEllipse | GeoEllipticalArc): PathEvaluator {
	const { center, majorAxisPoint, minorAxisPoint } = curve;
	const radii = center.distancesTo(majorAxisPoint, minorAxisPoint);
	const { axisU, axisV } = ellipseAxes(center.angleToPoint(majorAxisPoint));
	const fullTurn = 2 * Math.PI;
	const direction = curve.type === 'ellipse' || curve.clockwise ? -1 : 1;
	let start = Math.PI;
	let sweep = fullTurn;
	if (radii.x === 0 || radii.y === 0) {
		sweep = 0;
	} else if (curve.type === 'elliptical_arc') {
		start = ellipseParameterAtPoint(curve.start, center, radii, axisU, axisV);
		const end = ellipseParameterAtPoint(curve.end, center, radii, axisU, axisV);
		sweep = (direction * (end - start)) % fullTurn;
		if (sweep < 0) sweep += fullTurn;
	}

	// Sample the full revolution, including the exact arc endpoint for alignment and fitting.
	const steps = 256;
	const angles = Array.from({ length: steps + 1 }, (_, i) => (i * fullTurn) / steps);
	const endIndex = angles.findIndex(angle => angle >= sweep);
	if (angles[endIndex] !== sweep) angles.splice(endIndex, 0, sweep);

	const lengths = [0];
	let previous = ellipsePointAtParameter(start, center, radii, axisU, axisV);
	for (let i = 1; i < angles.length; i++) {
		const point = ellipsePointAtParameter(start + direction * angles[i], center, radii, axisU, axisV);
		lengths.push(lengths[i - 1] + previous.distanceTo(point));
		previous = point;
	}

	const length = lengths[endIndex];
	const perimeter = lengths[lengths.length - 1];
	return {
		length,
		getSampleAtDistance(s: number) {
			const remainder = perimeter > 0 ? s % perimeter : 0;
			const distance = remainder < 0 ? remainder + perimeter : remainder;
			let low = 0;
			let high = lengths.length - 1;
			while (high - low > 1) {
				const middle = (low + high) >> 1;
				if (lengths[middle] <= distance) low = middle;
				else high = middle;
			}
			const span = lengths[high] - lengths[low];
			const fraction = span > 0 ? (distance - lengths[low]) / span : 0;
			const angle = angles[low] + fraction * (angles[high] - angles[low]);
			const theta = start + direction * angle;
			const du = -radii.x * Math.sin(theta);
			const dv = radii.y * Math.cos(theta);
			const forward = axisU.clone().multiplyScalar(du).addScaledVector(axisV, dv).normalizeOrUnitX();
			return {
				point: ellipsePointAtParameter(theta, center, radii, axisU, axisV),
				tangent: forward.clone().multiplyScalar(direction),
				normal: forward.clone().perpendicular().negate(),
			};
		},
	};
}

export function createPathEvaluator(curve: GeoCurve): PathEvaluator {
	switch (curve.type) {
		case 'segment': {
			const seg = curve as GeoSegment;
			const totalLen = seg.p1.distanceTo(seg.p2);
			const delta = new Vec2().subVectors(seg.p2, seg.p1);
			const dir = totalLen > 1e-9 ? delta.clone().divideScalar(totalLen) : new Vec2(1, 0);
			const norm = dir.clone().perpendicular();
			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const clampedS = Math.max(0, Math.min(totalLen, s));
					return {
						point: seg.p1.clone().addScaledVector(dir, clampedS),
						tangent: dir,
						normal: norm,
					};
				},
			};
		}
		case 'circle':
		case 'arc': {
			const { center, radius } = curve;
			const fullTurn = 2 * Math.PI;
			const direction = curve.type === 'circle' || curve.clockwise ? -1 : 1;
			const start = curve.type === 'circle' ? Math.PI : center.angleToPoint(curve.start);
			let sweep = fullTurn;
			if (curve.type === 'arc') {
				const end = center.angleToPoint(curve.end);
				sweep = (direction * (end - start)) % fullTurn;
				if (sweep <= 0) sweep += fullTurn;
			}
			const circumference = fullTurn * radius;
			return {
				length: radius * sweep,
				getSampleAtDistance(s: number) {
					const offset = radius > 0 ? (s % circumference) / radius : 0;
					const theta = start + direction * offset;
					const normal = Vec2.fromPolar(1, theta);
					return {
						point: center.clone().addScaledVector(normal, radius),
						tangent: normal.clone().perpendicular().multiplyScalar(direction),
						normal,
					};
				},
			};
		}
		case 'ellipse':
		case 'elliptical_arc':
			return createEllipsePathEvaluator(curve);
		case 'spline': {
			const spline = curve as GeoSpline;
			const segments = spline.bezierSegments || [];
			if (segments.length === 0) {
				return {
					length: 0,
					getSampleAtDistance() {
						return { point: new Vec2(0, 0), tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
					},
				};
			}

			// Subdivide segments to approximate arc-lengths
			const stepsPerSeg = 20;
			const subSamples: Array<{ t: number; segIdx: number; cumLen: number }> = [];
			let cumLen = 0;

			for (let i = 0; i < segments.length; i++) {
				const seg = segments[i];
				let prevP = evaluateBezier(seg, 0);
				if (i === 0) {
					subSamples.push({ t: 0, segIdx: 0, cumLen: 0 });
				}
				for (let step = 1; step <= stepsPerSeg; step++) {
					const t = step / stepsPerSeg;
					const p = evaluateBezier(seg, t);
					cumLen += prevP.distanceTo(p);
					subSamples.push({ t, segIdx: i, cumLen });
					prevP = p;
				}
			}

			const totalLen = cumLen;

			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const clampedS = Math.max(0, Math.min(totalLen, s));
					// Binary search in subSamples
					let low = 0;
					let high = subSamples.length - 1;
					while (low < high - 1) {
						const mid = (low + high) >> 1;
						if (subSamples[mid].cumLen <= clampedS) {
							low = mid;
						} else {
							high = mid;
						}
					}

					const s0 = subSamples[low];
					const s1 = subSamples[high];
					const segSpan = s1.cumLen - s0.cumLen;
					const frac = segSpan > 1e-9 ? (clampedS - s0.cumLen) / segSpan : 0;
					// The endpoint of one segment is also t = 0 on the next segment.
					const startT = s0.segIdx === s1.segIdx ? s0.t : 0;
					const t = startT + frac * (s1.t - startT);
					const seg = segments[s1.segIdx];
					const pt = evaluateBezier(seg, t);
					const d = evaluateBezierDerivative(seg, t);
					const tan = d.clone().normalizeOrNull(1e-9) ?? new Vec2(1, 0);
					const norm = tan.clone().perpendicular();
					return {
						point: pt,
						tangent: tan,
						normal: norm,
					};
				},
			};
		}
		default:
			return {
				length: 0,
				getSampleAtDistance() {
					return { point: new Vec2(0, 0), tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
				},
			};
	}
}

/**
 * Generates an SVG path data string (d="...") representing the text.
 */
export function generateTextSvgPathData(
	options: TextLayoutOptions,
	font: opentype.Font,
	targetCurve?: GeoCurve | null
): string {
	if (!options.text || options.height <= 0) {
		return '';
	}

	const isSvgCoord = options.coordSystem === 'svg';
	let effectiveHeight = options.height;
	let scale = effectiveHeight / font.unitsPerEm;
	const spacingRatio = options.characterSpacing / 100;

	const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;
	const pathObj = new PathClass();

	if (options.mode === 'text' && options.rectangleCorners) {
		const [p0, p1, _p2, p3] = options.rectangleCorners;
		const width = p0.distanceTo(p1);
		const height = p0.distanceTo(p3);

		if (width <= 1e-3 || height <= 1e-3) return '';

		const center = new Vec2().midpoint(p0, _p2);
		const ux = new Vec2().subVectors(p1, p0).normalizeOrUnitX();
		const uy = new Vec2().subVectors(p0, p3).normalizeOrUnitX();

		const lines = (options.text || '').split(/\r?\n/);
		const numLines = Math.max(1, lines.length);
		const lineHeight = effectiveHeight * 1.25;
		const totalBlockHeight = (numLines - 1) * lineHeight;

		const ascender = (font.ascender || font.unitsPerEm * 0.8) * scale;
		const descender = (font.descender || -font.unitsPerEm * 0.2) * scale;
		const textMidY = (ascender + descender) / 2;

		let firstLineBaselineY = 0;
		const vAlign = options.verticalAlignment ?? 'middle';
		if (vAlign === 'top') {
			firstLineBaselineY = height / 2 - 1 - ascender;
		} else if (vAlign === 'bottom') {
			firstLineBaselineY = -height / 2 + 1 - descender + totalBlockHeight;
		} else {
			firstLineBaselineY = totalBlockHeight / 2 - textMidY;
		}

		const blockTop = firstLineBaselineY + ascender;
		const blockBottom = firstLineBaselineY - (numLines - 1) * lineHeight + descender;
		const blockCenterY = (blockTop + blockBottom) / 2;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const lineStr = lines[lineIdx];
			const lineGlyphs = font.stringToGlyphs(lineStr);
			if (lineGlyphs.length === 0) continue;

			const lineRawWidths = lineGlyphs.map(g => (g.advanceWidth || 0) * scale);
			const lineCharSpacings = lineRawWidths.map(w => w * spacingRatio);
			let lineTotalWidth = 0;
			for (let i = 0; i < lineRawWidths.length; i++) {
				lineTotalWidth += lineRawWidths[i] + (i < lineRawWidths.length - 1 ? lineCharSpacings[i] : 0);
			}

			let startX = 0;
			if (options.alignment === 'center') {
				startX = -lineTotalWidth / 2;
			} else if (options.alignment === 'right') {
				startX = width / 2 - lineTotalWidth - 1;
			} else {
				startX = -width / 2 + 1;
			}

			const lineBaselineY = firstLineBaselineY - lineIdx * lineHeight;

			let curX = startX;
			for (let i = 0; i < lineGlyphs.length; i++) {
				const g = lineGlyphs[i];
				const w = lineRawWidths[i];
				const gPath = g.getPath(0, 0, effectiveHeight);

				for (const cmd of gPath.commands) {
					const transformLocal = (x: number, y: number): Vec2 => {
						// In opentype, -y is upwards (above baseline).
						let lx = curX + x;
						let ly = lineBaselineY - y;

						if (options.flipHorizontal) {
							lx = 2 * startX + lineTotalWidth - lx;
						}
						if (options.flipVertical) {
							ly = 2 * blockCenterY - ly;
						}

						// Map to CAD coordinates
						const cad = center.clone().addScaledVector(ux, lx).addScaledVector(uy, ly);

						if (isSvgCoord) {
							return new Vec2(cad.x, -cad.y);
						}
						return cad;
					};

					appendTransformedCommand(pathObj, cmd, transformLocal);
				}

				curX += w + (i < lineGlyphs.length - 1 ? lineCharSpacings[i] : 0);
			}
		}
	} else if (options.mode === 'text_on_path' && targetCurve) {
		const singleLineText = options.text.replace(/\r?\n+/g, ' ');
		const glyphs = font.stringToGlyphs(singleLineText);
		if (glyphs.length === 0) return '';

		const rawWidths = glyphs.map(g => (g.advanceWidth || 0) * scale);
		const charSpacings = rawWidths.map(w => w * spacingRatio);
		let totalTextWidth = 0;
		for (let i = 0; i < rawWidths.length; i++) {
			totalTextWidth += rawWidths[i] + (i < rawWidths.length - 1 ? charSpacings[i] : 0);
		}
		const evaluator = createPathEvaluator(targetCurve);
		const curveLen = evaluator.length;
		if (curveLen <= 1e-3) return '';

		let extraGap = 0;
		if (options.fitToPath) {
			const unspacedTotal = rawWidths.reduce((a, b) => a + b, 0);
			if (glyphs.length <= 1) {
				extraGap = 0;
			} else {
				const remaining = curveLen - unspacedTotal;
				const gaps = Math.max(1, glyphs.length - 1);
				extraGap = remaining / gaps;
			}
			totalTextWidth = curveLen;
		}

		let startDist = 0;
		if (!options.fitToPath) {
			if (options.alignment === 'center') {
				startDist = Math.max(0, (curveLen - totalTextWidth) / 2);
			} else if (options.alignment === 'right') {
				startDist = Math.max(0, curveLen - totalTextWidth);
			} else {
				startDist = 0;
			}
		}

		const below = options.placement === 'below';
		let normalOffset = below ? -effectiveHeight : 0.5;
		if (options.flipVertical) {
			// Use the flat cap line above the path and the baseline below it.
			normalOffset = below ? 0 : font.charToGlyph('H').getBoundingBox().y2 * scale;
		}
		const normalDirection = options.flipVertical ? 1 : -1;

		let curDist = startDist;
		for (let i = 0; i < glyphs.length; i++) {
			const g = glyphs[i];
			const w = rawWidths[i];
			const advanceDist = w + (options.fitToPath ? extraGap : charSpacings[i]);
			const midDist = curDist + w / 2;

			let evalDist = midDist;
			if (options.flipHorizontal) {
				evalDist = 2 * startDist + totalTextWidth - midDist;
			}

			const sample = evaluator.getSampleAtDistance(evalDist);
			let tan = sample.tangent;
			let norm = sample.normal;

			if (options.flipHorizontal) {
				tan = tan.clone().negate();
			}

			const gPath = g.getPath(0, 0, effectiveHeight);

			for (const cmd of gPath.commands) {
				const transformCurve = (x: number, y: number): Vec2 => {
					const dx = x - w / 2;
					const dy = normalOffset + normalDirection * y;

					const cad = sample.point.clone().addScaledVector(tan, dx).addScaledVector(norm, dy);

					if (isSvgCoord) {
						return new Vec2(cad.x, -cad.y);
					}
					return cad;
				};

				appendTransformedCommand(pathObj, cmd, transformCurve);
			}

			curDist += advanceDist;
		}
	}

	return pathObj.toPathData(2);
}

function appendTransformedCommand(
	targetPath: opentype.Path,
	cmd: opentype.PathCommand,
	transform: (x: number, y: number) => Vec2
): void {
	switch (cmd.type) {
		case 'M': {
			const p = transform(cmd.x, cmd.y);
			targetPath.moveTo(p.x, p.y);
			break;
		}
		case 'L': {
			const p = transform(cmd.x, cmd.y);
			targetPath.lineTo(p.x, p.y);
			break;
		}
		case 'Q': {
			const c1 = transform(cmd.x1, cmd.y1);
			const p = transform(cmd.x, cmd.y);
			targetPath.quadraticCurveTo(c1.x, c1.y, p.x, p.y);
			break;
		}
		case 'C': {
			const c1 = transform(cmd.x1, cmd.y1);
			const c2 = transform(cmd.x2, cmd.y2);
			const p = transform(cmd.x, cmd.y);
			targetPath.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
			break;
		}
		case 'Z': {
			targetPath.close();
			break;
		}
	}
}
