import type { SketchDocument } from '../sketch';
import type { SketchSnapshot } from '../history';
import type { SketchPoint } from '../types';
import { bsplineToBezier, fitPointsToBezier, getSplineSvgPath, type BezierSegment } from '../../math/spline';
import { findSketchRegions } from '../../math/regions';
import { SVG_EXPORT_STYLE } from '../../canvas/styles';

export interface SketchFileMetadata {
	format: 'svg-sketcher';
	version: number;
	generator?: string;
	createdAt?: string;
	viewport?: {
		panX: number;
		panY: number;
		zoom: number;
	};
	snapshot: SketchSnapshot;
}

type SvgMatrix = [number, number, number, number, number, number];

function multiplySvgMatrices(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}

function parseSvgTransform(value: string | null): SvgMatrix {
	let matrix: SvgMatrix = [1, 0, 0, 1, 0, 0];
	if (!value) return matrix;

	const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
	for (const match of value.matchAll(pattern)) {
		const args = (match[2].match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
		let next: SvgMatrix = [1, 0, 0, 1, 0, 0];

		switch (match[1]) {
			case 'matrix':
				if (args.length === 6) {
					next = args as SvgMatrix;
				}
				break;
			case 'translate':
				next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
				break;
			case 'scale':
				next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
				break;
			case 'rotate': {
				const angle = ((args[0] ?? 0) * Math.PI) / 180;
				const c = Math.cos(angle);
				const s = Math.sin(angle);
				next = [c, s, -s, c, 0, 0];
				if (args.length >= 3) {
					const cx = args[1];
					const cy = args[2];
					next = multiplySvgMatrices([1, 0, 0, 1, cx, cy], multiplySvgMatrices(next, [1, 0, 0, 1, -cx, -cy]));
				}
				break;
			}
			case 'skewX':
				next = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
				break;
			case 'skewY':
				next = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
				break;
		}

		matrix = multiplySvgMatrices(matrix, next);
	}

	return matrix;
}

function parseSvgLengthInMillimeters(value: string | null): number | null {
	if (!value) return null;
	const match = value.trim().match(/^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)\s*(px|mm|cm|in|pt|pc)?$/i);
	if (!match) return null;

	const length = Number(match[1]);
	if (!Number.isFinite(length)) return null;

	// Sketcher treats SVG pixels as millimeters for a practical CAD import scale.
	const toMm: Record<string, number> = {
		px: 1,
		mm: 1,
		cm: 10,
		in: 25.4,
		pt: 25.4 / 72,
		pc: 25.4 / 6,
	};

	return length * (toMm[(match[2] ?? 'px').toLowerCase()] ?? 1);
}

type SvgPathSegment =
	| { kind: 'line'; start: [number, number]; end: [number, number] }
	| {
			kind: 'cubic';
			start: [number, number];
			c1: [number, number];
			c2: [number, number];
			end: [number, number];
	  }
	| {
			kind: 'arc';
			start: [number, number];
			end: [number, number];
			rx: number;
			ry: number;
			rotation: number;
			large: number;
			sweep: number;
	  };

function parseSvgPath(d: string): Array<{ segments: SvgPathSegment[]; closed: boolean }> {
	const tokens = d.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?|[a-zA-Z]/gi) ?? [];
	const paths: Array<{ segments: SvgPathSegment[]; closed: boolean }> = [];
	let i = 0;
	let command = '';
	let x = 0;
	let y = 0;
	let sx = 0;
	let sy = 0;
	let cubicControl: [number, number] | null = null;
	let quadraticControl: [number, number] | null = null;
	let current: { segments: SvgPathSegment[]; closed: boolean } | null = null;

	const isCommand = (v: string) => /^[a-z]$/i.test(v);
	const take = (): number => Number(tokens[i++]);
	const hasNumbers = (count: number) => i + count <= tokens.length && !tokens.slice(i, i + count).some(isCommand);

	const lineTo = (ex: number, ey: number) => {
		current?.segments.push({ kind: 'line', start: [x, y], end: [ex, ey] });
		x = ex;
		y = ey;
	};

	while (i < tokens.length) {
		if (isCommand(tokens[i])) command = tokens[i++];
		if (!command) break;

		const relative = command === command.toLowerCase();
		const op = command.toUpperCase();

		if (op === 'Z') {
			if (current) {
				if (x !== sx || y !== sy) {
					lineTo(sx, sy);
				}
				current.closed = true;
				x = sx;
				y = sy;
			}
			cubicControl = null;
			quadraticControl = null;
			command = '';
			continue;
		}

		if (op === 'M' || op === 'L') {
			if (!hasNumbers(2)) {
				command = '';
				continue;
			}
			const nx = take();
			const ny = take();
			const ex = relative ? x + nx : nx;
			const ey = relative ? y + ny : ny;

			if (op === 'M') {
				x = ex;
				y = ey;
				current = { segments: [], closed: false };
				paths.push(current);
				sx = x;
				sy = y;
				command = relative ? 'l' : 'L';
			} else {
				lineTo(ex, ey);
			}

			cubicControl = null;
			quadraticControl = null;
			continue;
		}

		if (op === 'H' || op === 'V') {
			if (!hasNumbers(1)) {
				command = '';
				continue;
			}
			const n = take();
			lineTo(op === 'H' ? (relative ? x + n : n) : x, op === 'V' ? (relative ? y + n : n) : y);
			cubicControl = null;
			quadraticControl = null;
			continue;
		}

		if (op === 'C' || op === 'S') {
			const count = op === 'C' ? 6 : 4;
			if (!hasNumbers(count)) {
				command = '';
				continue;
			}
			const start: [number, number] = [x, y];
			const c1: [number, number] =
				op === 'C' ? [take(), take()] : cubicControl ? [2 * x - cubicControl[0], 2 * y - cubicControl[1]] : [x, y];
			if (relative && op === 'C') {
				c1[0] += start[0];
				c1[1] += start[1];
			}
			const c2: [number, number] = [take(), take()];
			const end: [number, number] = [take(), take()];
			if (relative) {
				c2[0] += start[0];
				c2[1] += start[1];
				end[0] += start[0];
				end[1] += start[1];
			}

			current?.segments.push({ kind: 'cubic', start, c1, c2, end });
			x = end[0];
			y = end[1];
			cubicControl = c2;
			quadraticControl = null;
			continue;
		}

		if (op === 'Q' || op === 'T') {
			const count = op === 'Q' ? 4 : 2;
			if (!hasNumbers(count)) {
				command = '';
				continue;
			}
			const start: [number, number] = [x, y];
			const control: [number, number] =
				op === 'Q'
					? [take(), take()]
					: quadraticControl
						? [2 * x - quadraticControl[0], 2 * y - quadraticControl[1]]
						: [x, y];
			if (relative && op === 'Q') {
				control[0] += start[0];
				control[1] += start[1];
			}
			const end: [number, number] = [take(), take()];
			if (relative) {
				end[0] += start[0];
				end[1] += start[1];
			}

			const c1: [number, number] = [
				start[0] + (2 / 3) * (control[0] - start[0]),
				start[1] + (2 / 3) * (control[1] - start[1]),
			];
			const c2: [number, number] = [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])];

			current?.segments.push({ kind: 'cubic', start, c1, c2, end });
			x = end[0];
			y = end[1];
			quadraticControl = control;
			cubicControl = null;
			continue;
		}

		if (op === 'A') {
			if (!hasNumbers(7)) {
				command = '';
				continue;
			}
			const rx = take();
			const ry = take();
			const rotation = take();
			const large = take();
			const sweep = take();
			const nx = take();
			const ny = take();

			const start: [number, number] = [x, y];
			const end: [number, number] = [relative ? x + nx : nx, relative ? y + ny : ny];

			if (rx === 0 || ry === 0) {
				lineTo(end[0], end[1]);
			} else if (start[0] !== end[0] || start[1] !== end[1]) {
				current?.segments.push({
					kind: 'arc',
					start,
					end,
					rx,
					ry,
					rotation,
					large,
					sweep,
				});
			}

			x = end[0];
			y = end[1];
			cubicControl = null;
			quadraticControl = null;
			continue;
		}

		command = '';
	}

	return paths.filter(path => path.segments.length > 0);
}

function getSvgArcCenter(segment: Extract<SvgPathSegment, { kind: 'arc' }>) {
	let rx = Math.abs(segment.rx);
	let ry = Math.abs(segment.ry);
	const phi = (segment.rotation * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);

	const dx = (segment.start[0] - segment.end[0]) / 2;
	const dy = (segment.start[1] - segment.end[1]) / 2;
	const xp = cos * dx + sin * dy;
	const yp = -sin * dx + cos * dy;

	const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
	if (lambda > 1) {
		const scale = Math.sqrt(lambda);
		rx *= scale;
		ry *= scale;
	}

	const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
	const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
	const factor = (segment.large === segment.sweep ? -1 : 1) * Math.sqrt(denominator ? numerator / denominator : 0);

	const cxp = (factor * rx * yp) / ry;
	const cyp = (factor * -ry * xp) / rx;
	const cx = cos * cxp - sin * cyp + (segment.start[0] + segment.end[0]) / 2;
	const cy = sin * cxp + cos * cyp + (segment.start[1] + segment.end[1]) / 2;

	const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

	const ux = (xp - cxp) / rx;
	const uy = (yp - cyp) / ry;
	const vx = (-xp - cxp) / rx;
	const vy = (-yp - cyp) / ry;

	let start = angle(1, 0, ux, uy);
	let delta = angle(ux, uy, vx, vy);
	if (!segment.sweep && delta > 0) delta -= 2 * Math.PI;
	if (segment.sweep && delta < 0) delta += 2 * Math.PI;

	return { cx, cy, rx, ry, phi, start, delta };
}

function importPlainSvg(sketch: SketchDocument, doc: Document): { success: boolean; error?: string } {
	const root = doc.documentElement;
	if (root.localName !== 'svg') {
		return { success: false, error: 'Document root is not an SVG element' };
	}

	const shapes: Array<{ tag: string; attrs: Record<string, string>; matrix: SvgMatrix }> = [];

	const visit = (el: Element, parentMatrix: SvgMatrix): void => {
		if (['defs', 'clipPath', 'mask', 'marker', 'pattern', 'symbol'].includes(el.localName)) {
			return;
		}
		if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden') {
			return;
		}

		const matrix = multiplySvgMatrices(parentMatrix, parseSvgTransform(el.getAttribute('transform')));
		const tag = el.localName;

		if (['line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'path'].includes(tag)) {
			const attrs: Record<string, string> = {};
			for (const attr of Array.from(el.attributes)) {
				attrs[attr.name] = attr.value;
			}
			shapes.push({ tag, attrs, matrix });
		}

		for (const child of Array.from(el.children)) {
			visit(child, matrix);
		}
	};

	visit(root, [1, 0, 0, 1, 0, 0]);

	if (!shapes.length) {
		return { success: false, error: 'SVG contains no supported geometry' };
	}

	const rootViewBox = root
		.getAttribute('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	let viewMatrix: SvgMatrix = [1, 0, 0, 1, 0, 0];

	if (rootViewBox?.length === 4 && rootViewBox.every(Number.isFinite)) {
		const [minX, minY, width, height] = rootViewBox;
		const viewportWidth = parseSvgLengthInMillimeters(root.getAttribute('width')) ?? width;
		const viewportHeight = parseSvgLengthInMillimeters(root.getAttribute('height')) ?? height;
		const scale = Math.min(viewportWidth / width, viewportHeight / height);
		const offsetX = (viewportWidth - width * scale) / 2;
		const offsetY = (viewportHeight - height * scale) / 2;
		viewMatrix = [scale, 0, 0, scale, offsetX - minX * scale, offsetY - minY * scale];
	}

	const point = (x: number, y: number, matrix: SvgMatrix): [number, number] => {
		const m = multiplySvgMatrices(viewMatrix, matrix);
		return [m[0] * x + m[2] * y + m[4], -(m[1] * x + m[3] * y + m[5])];
	};

	const num = (attrs: Record<string, string>, key: string, fallback = 0) => Number(attrs[key] ?? fallback);

	const pathPointIds = new Map<string, string>();
	const getPathPointId = (coord: [number, number]): string => {
		const mapped = point(coord[0], coord[1], activeMatrix);
		const key = `${mapped[0].toFixed(10)},${mapped[1].toFixed(10)}`;
		let id = pathPointIds.get(key);
		if (!id) {
			id = sketch.addPoint(mapped[0], mapped[1]).id;
			pathPointIds.set(key, id);
		}
		return id;
	};

	const addPolyline = (coords: Array<[number, number]>, closed = false) => {
		const points = coords.map(([x, y]) => point(x, y, activeMatrix));
		const pointIds = points.map(([x, y]) => sketch.addPoint(x, y).id);
		for (let i = 1; i < points.length; i++) {
			sketch.addLine(pointIds[i - 1], pointIds[i]);
		}
		if (closed && points.length > 2) {
			sketch.addLine(pointIds[pointIds.length - 1], pointIds[0]);
		}
	};

	let activeMatrix: SvgMatrix = [1, 0, 0, 1, 0, 0];

	const importPath = (d: string): void => {
		for (const path of parseSvgPath(d)) {
			pathPointIds.clear();
			const segments = path.segments;

			for (let i = 0; i < segments.length; ) {
				const segment = segments[i];
				const startId = getPathPointId(segment.start);
				const endId = getPathPointId(segment.end);

				if (segment.kind === 'line') {
					sketch.addLine(startId, endId);
					i++;
					continue;
				}

				if (segment.kind === 'cubic') {
					const start = point(segment.start[0], segment.start[1], activeMatrix);
					const c1 = point(segment.c1[0], segment.c1[1], activeMatrix);
					const c2 = point(segment.c2[0], segment.c2[1], activeMatrix);
					const end = point(segment.end[0], segment.end[1], activeMatrix);
					const handles = [
						{
							h1: { x: 2 * start[0] - c1[0], y: 2 * start[1] - c1[1] },
							h2: { x: c1[0], y: c1[1] },
						},
						{
							h1: { x: c2[0], y: c2[1] },
							h2: { x: 2 * end[0] - c2[0], y: 2 * end[1] - c2[1] },
						},
					];
					sketch.addFitSpline([startId, endId], undefined, false, undefined, false, handles);
					i++;
					continue;
				}

				const arc = getSvgArcCenter(segment);
				const m = multiplySvgMatrices(viewMatrix, activeMatrix);
				const center = point(arc.cx, arc.cy, activeMatrix);
				const cos = Math.cos(arc.phi);
				const sin = Math.sin(arc.phi);

				const ux = arc.rx * (m[0] * cos + m[2] * sin);
				const uy = -arc.rx * (m[1] * cos + m[3] * sin);
				const vx = arc.ry * (-m[0] * sin + m[2] * cos);
				const vy = arc.ry * (m[1] * sin - m[3] * cos);

				const qxx = ux * ux + vx * vx;
				const qxy = ux * uy + vx * vy;
				const qyy = uy * uy + vy * vy;
				const axisAngle = 0.5 * Math.atan2(2 * qxy, qxx - qyy);
				const trace = qxx + qyy;
				const rootValue = Math.hypot(qxx - qyy, 2 * qxy);
				const majorRadius = Math.sqrt(Math.max(0, (trace + rootValue) / 2));
				const minorRadius = Math.sqrt(Math.max(0, (trace - rootValue) / 2));

				const major: [number, number] = [
					center[0] + majorRadius * Math.cos(axisAngle),
					center[1] + majorRadius * Math.sin(axisAngle),
				];
				const minor: [number, number] = [
					center[0] - minorRadius * Math.sin(axisAngle),
					center[1] + minorRadius * Math.cos(axisAngle),
				];

				const start = getPathPointId(segment.start);
				const end = getPathPointId(segment.end);
				const clockwise = ux * vy - uy * vx < 0 === (segment.sweep === 1);
				const centerId = sketch.addPoint(center[0], center[1]).id;

				if (Math.abs(majorRadius - minorRadius) < 1e-8) {
					sketch.addArc(centerId, start, end, majorRadius, clockwise);
				} else {
					const majorId = sketch.addPoint(major[0], major[1]).id;
					const minorId = sketch.addPoint(minor[0], minor[1]).id;
					sketch.addEllipticalArc(centerId, majorId, minorId, start, end, clockwise);
				}
				i++;
			}
		}
	};

	sketch.beginTransaction();
	try {
		sketch.clear();

		for (const shape of shapes) {
			const a = shape.attrs;
			activeMatrix = shape.matrix;

			switch (shape.tag) {
				case 'line':
					addPolyline([
						[num(a, 'x1'), num(a, 'y1')],
						[num(a, 'x2'), num(a, 'y2')],
					]);
					break;

				case 'polyline':
				case 'polygon': {
					const values = (a.points?.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
					const coords: Array<[number, number]> = [];
					for (let i = 0; i + 1 < values.length; i += 2) {
						coords.push([values[i], values[i + 1]]);
					}
					addPolyline(coords, shape.tag === 'polygon');
					break;
				}

				case 'path':
					importPath(a.d ?? '');
					break;

				case 'rect': {
					const x = num(a, 'x');
					const y = num(a, 'y');
					const w = num(a, 'width');
					const h = num(a, 'height');
					if (w <= 0 || h <= 0) break;

					const hasRx = a.rx !== undefined;
					const hasRy = a.ry !== undefined;
					let rx = hasRx ? num(a, 'rx') : hasRy ? num(a, 'ry') : 0;
					let ry = hasRy ? num(a, 'ry') : hasRx ? num(a, 'rx') : 0;
					if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx < 0 || ry < 0) break;

					rx = Math.min(rx, w / 2);
					ry = Math.min(ry, h / 2);

					if (rx === 0 || ry === 0) {
						addPolyline(
							[
								[x, y],
								[x + w, y],
								[x + w, y + h],
								[x, y + h],
							],
							true
						);
					} else {
						const d = `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
						importPath(d);
					}
					break;
				}

				case 'circle':
				case 'ellipse': {
					const cx = num(a, 'cx');
					const cy = num(a, 'cy');
					const rx = num(a, shape.tag === 'circle' ? 'r' : 'rx');
					const ry = num(a, shape.tag === 'circle' ? 'r' : 'ry', rx);
					if (rx <= 0 || ry <= 0) break;

					const center = point(cx, cy, activeMatrix);
					const matrix = multiplySvgMatrices(viewMatrix, activeMatrix);
					const ux = matrix[0] * rx;
					const uy = -matrix[1] * rx;
					const vx = matrix[2] * ry;
					const vy = -matrix[3] * ry;

					const qxx = ux * ux + vx * vx;
					const qxy = ux * uy + vx * vy;
					const qyy = uy * uy + vy * vy;
					const angle = 0.5 * Math.atan2(2 * qxy, qxx - qyy);
					const trace = qxx + qyy;
					const root = Math.hypot(qxx - qyy, 2 * qxy);
					const majorRadius = Math.sqrt(Math.max(0, (trace + root) / 2));
					const minorRadius = Math.sqrt(Math.max(0, (trace - root) / 2));

					const major: [number, number] = [
						center[0] + majorRadius * Math.cos(angle),
						center[1] + majorRadius * Math.sin(angle),
					];
					const minor: [number, number] = [
						center[0] - minorRadius * Math.sin(angle),
						center[1] + minorRadius * Math.cos(angle),
					];

					const c = sketch.addPoint(center[0], center[1]);
					if (Math.abs(majorRadius - minorRadius) < 1e-8 && shape.tag === 'circle') {
						sketch.addCircle(c.id, majorRadius);
					} else {
						const p1 = sketch.addPoint(major[0], major[1]);
						const p2 = sketch.addPoint(minor[0], minor[1]);
						sketch.addEllipse(c.id, p1.id, p2.id);
					}
					break;
				}
			}
		}

		if (
			sketch.lines.size +
				sketch.circles.size +
				sketch.arcs.size +
				sketch.ellipses.size +
				sketch.ellipticalArcs.size +
				sketch.splines.size ===
			0
		) {
			sketch.rollbackTransaction();
			return { success: false, error: 'SVG contains no supported geometry' };
		}

		sketch.commitTransaction();
		return { success: true };
	} catch (err) {
		sketch.rollbackTransaction();
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to import SVG geometry',
		};
	}
}

export function exportSketchToSVG(
	sketch: SketchDocument,
	viewportState?: { panX: number; panY: number; zoom: number }
): string {
	const metadataPayload: SketchFileMetadata = {
		format: 'svg-sketcher',
		version: 1,
		generator: 'SVG Sketcher',
		createdAt: new Date().toISOString(),
		viewport: viewportState,
		snapshot: sketch.takeSnapshot(),
	};

	const jsonString = JSON.stringify(metadataPayload, null, 2).replace(/]]>/g, ']]]]><![CDATA[>');

	// Generate clean SVG markup for CAD export (CAD Y-up converted to standard SVG Y-down)
	const elements: string[] = [];
	const usedPoints = new Set<string>();
	for (const region of findSketchRegions(sketch)) {
		elements.push(
			`<path d="${region.path}" fill="${SVG_EXPORT_STYLE.regionFill}" fill-opacity="${SVG_EXPORT_STYLE.regionFillOpacity}" fill-rule="evenodd" stroke="${SVG_EXPORT_STYLE.regionStroke}" />`
		);
	}

	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		usedPoints.add(line.p1Id);
		usedPoints.add(line.p2Id);
		const p1 = sketch.points.get(line.p1Id);
		const p2 = sketch.points.get(line.p2Id);
		if (p1 && p2) {
			const dash = line.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<line x1="${p1.x.toFixed(2)}" y1="${(-p1.y).toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${(-p2.y).toFixed(2)}"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" stroke-linecap="round" />`
			);
		}
	}

	for (const circ of sketch.circles.values()) {
		usedPoints.add(circ.centerId);
		const center = sketch.points.get(circ.centerId);
		if (center) {
			const dash = circ.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<circle cx="${center.x.toFixed(2)}" cy="${(-center.y).toFixed(2)}" r="${circ.radius.toFixed(2)}"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" fill="${SVG_EXPORT_STYLE.fill}" />`
			);
		}
	}

	for (const arc of sketch.arcs.values()) {
		usedPoints.add(arc.centerId);
		usedPoints.add(arc.startPointId);
		usedPoints.add(arc.endPointId);
		const center = sketch.points.get(arc.centerId);
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (center && start && end) {
			// Convert to SVG coordinates (Y-down)
			const sc = { x: center.x, y: -center.y };
			const ss = { x: start.x, y: -start.y };
			const se = { x: end.x, y: -end.y };

			const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
			const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
			const clockwise = !!arc.clockwise;

			let sweepAngle = 0;
			let sweepFlag = 0;
			if (clockwise) {
				sweepAngle = (ae - as) % (2 * Math.PI);
				if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
				sweepFlag = 1;
			} else {
				sweepAngle = (as - ae) % (2 * Math.PI);
				if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
				sweepFlag = 0;
			}
			const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;
			const dash = arc.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" stroke-linecap="round" fill="${SVG_EXPORT_STYLE.fill}" />`
			);
		}
	}

	for (const el of sketch.ellipses.values()) {
		usedPoints.add(el.centerId);
		usedPoints.add(el.majorAxisPointId);
		usedPoints.add(el.minorAxisPointId);
		const center = sketch.points.get(el.centerId);
		const maj = sketch.points.get(el.majorAxisPointId);
		const min = sketch.points.get(el.minorAxisPointId);
		if (center && maj && min) {
			const sc = { x: center.x, y: -center.y };
			const smaj = { x: maj.x, y: -maj.y };
			const smin = { x: min.x, y: -min.y };
			const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
			const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
			const deg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
			const dash = el.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<ellipse cx="${sc.x.toFixed(2)}" cy="${sc.y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${sc.x.toFixed(2)} ${sc.y.toFixed(2)})"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" fill="${SVG_EXPORT_STYLE.fill}" />`
			);
		}
	}

	for (const elarc of sketch.ellipticalArcs.values()) {
		usedPoints.add(elarc.centerId);
		usedPoints.add(elarc.majorAxisPointId);
		usedPoints.add(elarc.minorAxisPointId);
		usedPoints.add(elarc.startPointId);
		usedPoints.add(elarc.endPointId);
		const center = sketch.points.get(elarc.centerId);
		const maj = sketch.points.get(elarc.majorAxisPointId);
		const min = sketch.points.get(elarc.minorAxisPointId);
		const start = sketch.points.get(elarc.startPointId);
		const end = sketch.points.get(elarc.endPointId);
		if (center && maj && min && start && end) {
			const sc = { x: center.x, y: -center.y };
			const smaj = { x: maj.x, y: -maj.y };
			const smin = { x: min.x, y: -min.y };
			const ss = { x: start.x, y: -start.y };
			const se = { x: end.x, y: -end.y };

			const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
			const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
			const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
			const thetaDeg = (theta * 180) / Math.PI;

			const ux = Math.cos(theta);
			const uy = Math.sin(theta);
			const vx = -Math.sin(theta);
			const vy = Math.cos(theta);

			const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
			const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
			const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
			const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

			const ts = Math.atan2(vs / ry, us / rx);
			const te = Math.atan2(ve / ry, ue / rx);

			const clockwise = !!elarc.clockwise;
			let sweepAngle = 0;
			let sweepFlag = 0;
			if (clockwise) {
				sweepAngle = (te - ts) % (2 * Math.PI);
				if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
				sweepFlag = 1;
			} else {
				sweepAngle = (ts - te) % (2 * Math.PI);
				if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
				sweepFlag = 0;
			}
			const largeArc = sweepAngle > Math.PI ? 1 : 0;
			const dash = elarc.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} ${largeArc} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" stroke-linecap="round" fill="${SVG_EXPORT_STYLE.fill}" />`
			);
		}
	}

	for (const spline of sketch.splines.values()) {
		for (const pid of spline.pointIds) usedPoints.add(pid);
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				const l = sketch.lines.get(lid);
				if (l) {
					usedPoints.add(l.p1Id);
					usedPoints.add(l.p2Id);
				}
			}
		}
		const pts = spline.pointIds.map(id => sketch.points.get(id)).filter(Boolean) as SketchPoint[];
		if (pts.length >= 2) {
			let segments: BezierSegment[] = [];
			if (spline.splineType === 'control') {
				segments = bsplineToBezier(
					pts.map(p => ({ x: p.x, y: -p.y })),
					spline.knots
				);
			} else {
				const handles = (spline.tangentLineIds || []).map(lid => {
					const line = sketch.lines.get(lid);
					if (!line) return null;
					const p1 = sketch.points.get(line.p1Id);
					const p2 = sketch.points.get(line.p2Id);
					if (!p1 || !p2) return null;
					return {
						h1: { x: p1.x, y: -p1.y },
						h2: { x: p2.x, y: -p2.y },
					};
				});
				segments = fitPointsToBezier(
					pts.map(p => ({ x: p.x, y: -p.y })),
					handles
				);
			}
			const d = getSplineSvgPath(segments, p => p, !!spline.isClosed);
			const dash = spline.isConstruction
				? ` stroke-dasharray="${SVG_EXPORT_STYLE.constructionDashArray}" stroke="${SVG_EXPORT_STYLE.constructionStroke}"`
				: ` stroke="${SVG_EXPORT_STYLE.geometryStroke}"`;
			elements.push(
				`<path d="${d}"${dash} stroke-width="${SVG_EXPORT_STYLE.strokeWidth}" stroke-linecap="round" fill="${SVG_EXPORT_STYLE.fill}" />`
			);
		}
	}

	// Export isolated points
	for (const pt of sketch.points.values()) {
		if (!usedPoints.has(pt.id)) {
			const fill = SVG_EXPORT_STYLE.isolatedPointFill;
			elements.push(`<circle cx="${pt.x.toFixed(2)}" cy="${(-pt.y).toFixed(2)}" r="2" fill="${fill}" />`);
		}
	}

	const bbox = sketch.getBoundingBox();
	let viewBox = '-100 -100 200 200';

	if (bbox) {
		const w = bbox.maxX - bbox.minX;
		const h = bbox.maxY - bbox.minY;
		const padding = Math.max(10, Math.max(w, h) * 0.05);
		const minX = bbox.minX - padding;
		const minY = -bbox.maxY - padding;
		const vbWidth = Math.max(w + padding * 2, 20);
		const vbHeight = Math.max(h + padding * 2, 20);
		viewBox = `${minX.toFixed(2)} ${minY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}`;
	}

	return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  <metadata id="sketcher-metadata">\n    <![CDATA[\n${jsonString}\n    ]]>\n  </metadata>\n  ${elements.join('\n  ')}\n</svg>`;
}

export function importSketchFromSVG(
	sketch: SketchDocument,
	svgString: string
): {
	success: boolean;
	viewport?: { panX: number; panY: number; zoom: number };
	error?: string;
} {
	try {
		if (typeof DOMParser !== 'undefined') {
			const parser = new DOMParser();
			const doc = parser.parseFromString(svgString, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');
			if (parserError) {
				return { success: false, error: 'Invalid SVG XML structure' };
			}

			// Find sketcher metadata element
			let metaEl: Element | null =
				doc.getElementById('sketcher-metadata') || doc.querySelector('metadata#sketcher-metadata');
			if (!metaEl) {
				const allMetadata = doc.querySelectorAll('metadata');
				for (let i = 0; i < allMetadata.length; i++) {
					const el = allMetadata[i];
					if (el.textContent && el.textContent.includes('"format"') && el.textContent.includes('svg-sketcher')) {
						metaEl = el;
						break;
					}
				}
			}

			if (!metaEl || !metaEl.textContent) {
				return importPlainSvg(sketch, doc);
			}

			const rawText = metaEl.textContent.trim();
			const data = JSON.parse(rawText) as SketchFileMetadata;

			if (data.format !== 'svg-sketcher' || !data.snapshot) {
				return { success: false, error: 'Unsupported sketch metadata format' };
			}

			sketch.restoreSnapshot(data.snapshot);
			sketch.clearHistory();

			return {
				success: true,
				viewport: data.viewport,
			};
		}

		// Fallback (e.g. Node.js environment where DOMParser is not in global scope)
		const match =
			svgString.match(/<metadata[^>]*id="sketcher-metadata"[^>]*>([\s\S]*?)<\/metadata>/i) ||
			svgString.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
		if (match) {
			let text = match[1].trim();
			const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
			if (cdataMatch) {
				text = cdataMatch[1].trim();
			}
			const data = JSON.parse(text) as SketchFileMetadata;
			if (data.format === 'svg-sketcher' && data.snapshot) {
				sketch.restoreSnapshot(data.snapshot);
				sketch.clearHistory();
				return { success: true, viewport: data.viewport };
			}
		}
		return { success: false, error: 'No parametric CAD metadata found in SVG' };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to parse SVG metadata',
		};
	}
}
