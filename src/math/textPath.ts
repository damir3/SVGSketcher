import * as opentype from 'opentype.js';
import { vec, dist, normalize, type Vec2 } from './vector';
import type { GeoCurve, GeoSegment, GeoCircle, GeoArc, GeoSpline } from './intersection';
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
	readonly length: number;
	getSampleAtDistance(s: number): CurveSample;
}

export function createPathEvaluator(curve: GeoCurve): PathEvaluator {
	switch (curve.type) {
		case 'segment': {
			const seg = curve as GeoSegment;
			const totalLen = dist(seg.p1, seg.p2);
			const dir = totalLen > 1e-9 ? normalize(vec(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y)) : vec(1, 0);
			const norm = vec(-dir.y, dir.x);
			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const clampedS = Math.max(0, Math.min(totalLen, s));
					return {
						point: vec(seg.p1.x + dir.x * clampedS, seg.p1.y + dir.y * clampedS),
						tangent: dir,
						normal: norm,
					};
				},
			};
		}
		case 'circle': {
			const c = curve as GeoCircle;
			const totalLen = 2 * Math.PI * c.radius;
			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const theta = s / c.radius;
					const cos = Math.cos(theta);
					const sin = Math.sin(theta);
					return {
						point: vec(c.center.x + c.radius * cos, c.center.y + c.radius * sin),
						tangent: vec(-sin, cos),
						normal: vec(cos, sin),
					};
				},
			};
		}
		case 'arc': {
			const arc = curve as GeoArc;
			const thetaS = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x);
			const thetaE = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x);
			let sweep = 0;
			const dir = arc.clockwise ? -1 : 1;
			if (arc.clockwise) {
				sweep = (thetaS - thetaE) % (2 * Math.PI);
				if (sweep <= 0) sweep += 2 * Math.PI;
			} else {
				sweep = (thetaE - thetaS) % (2 * Math.PI);
				if (sweep <= 0) sweep += 2 * Math.PI;
			}
			const totalLen = arc.radius * sweep;
			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const u = totalLen > 1e-9 ? Math.max(0, Math.min(1, s / totalLen)) : 0;
					const theta = thetaS + dir * u * sweep;
					const cos = Math.cos(theta);
					const sin = Math.sin(theta);
					return {
						point: vec(arc.center.x + arc.radius * cos, arc.center.y + arc.radius * sin),
						tangent: vec(dir * -sin, dir * cos),
						normal: vec(cos, sin),
					};
				},
			};
		}
		case 'spline': {
			const spline = curve as GeoSpline;
			const segments = spline.bezierSegments || [];
			if (segments.length === 0) {
				return {
					length: 0,
					getSampleAtDistance() {
						return { point: vec(0, 0), tangent: vec(1, 0), normal: vec(0, 1) };
					},
				};
			}

			// Subdivide segments to approximate arc-lengths
			const stepsPerSeg = 20;
			const subSamples: Array<{ t: number; segIdx: number; p: Vec2; cumLen: number }> = [];
			let cumLen = 0;

			for (let i = 0; i < segments.length; i++) {
				const seg = segments[i];
				let prevP = evaluateBezier(seg, 0);
				if (i === 0) {
					subSamples.push({ t: 0, segIdx: 0, p: prevP, cumLen: 0 });
				}
				for (let step = 1; step <= stepsPerSeg; step++) {
					const t = step / stepsPerSeg;
					const p = evaluateBezier(seg, t);
					cumLen += dist(prevP, p);
					subSamples.push({ t, segIdx: i, p, cumLen });
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
					const segIdx = s0.segIdx;
					const t = s0.t + frac * (s1.t - s0.t);
					const seg = segments[segIdx];
					const pt = evaluateBezier(seg, t);
					const d = evaluateBezierDerivative(seg, t);
					const tan = dist(d, vec(0, 0)) > 1e-9 ? normalize(d) : vec(1, 0);
					const norm = vec(-tan.y, tan.x);
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
					return { point: vec(0, 0), tangent: vec(1, 0), normal: vec(0, 1) };
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
		const width = dist(p0, p1);
		const height = dist(p0, p3);

		if (width <= 1e-3 || height <= 1e-3) return '';

		const center = vec((p0.x + _p2.x) / 2, (p0.y + _p2.y) / 2);
		const ux = normalize(vec(p1.x - p0.x, p1.y - p0.y));
		const uy = normalize(vec(p0.x - p3.x, p0.y - p3.y));

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
						const cadX = center.x + lx * ux.x + ly * uy.x;
						const cadY = center.y + lx * ux.y + ly * uy.y;

						if (isSvgCoord) {
							return vec(cadX, -cadY);
						}
						return vec(cadX, cadY);
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

		// Placement: above curve or below curve
		const baseNormalOffset = options.placement === 'below' ? -effectiveHeight : 0.5;

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
				tan = vec(-tan.x, -tan.y);
			}

			const gPath = g.getPath(0, 0, effectiveHeight);

			for (const cmd of gPath.commands) {
				const transformCurve = (x: number, y: number): Vec2 => {
					let dx = x - w / 2;
					let localY = -y;
					if (options.flipVertical) {
						localY = effectiveHeight - localY;
					}
					let dy = localY + baseNormalOffset;

					const cadX = sample.point.x + dx * tan.x + dy * norm.x;
					const cadY = sample.point.y + dx * tan.y + dy * norm.y;

					if (isSvgCoord) {
						return vec(cadX, -cadY);
					}
					return vec(cadX, cadY);
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
