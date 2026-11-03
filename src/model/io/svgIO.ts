import type { SketchDocument } from '../sketch';
import type { SketchSnapshot } from '../history';
import type { SketchPoint } from '../types';
import { bsplineToBezier, fitPointsToBezier, getSplineSvgPath, type BezierSegment } from '../../math/spline';
import { findSketchRegions } from '../../math/regions';
import { REGION_STYLE } from '../../canvas/styles';

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
		elements.push(`<path d="${region.path}" fill="${REGION_STYLE.fill}" fill-opacity="${REGION_STYLE.fillOpacity}" fill-rule="evenodd" stroke="none" />`);
	}

	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		usedPoints.add(line.p1Id);
		usedPoints.add(line.p2Id);
		const p1 = sketch.points.get(line.p1Id);
		const p2 = sketch.points.get(line.p2Id);
		if (p1 && p2) {
			const dash = line.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<line x1="${p1.x.toFixed(2)}" y1="${(-p1.y).toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${(-p2.y).toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" />`
			);
		}
	}

	for (const circ of sketch.circles.values()) {
		usedPoints.add(circ.centerId);
		const center = sketch.points.get(circ.centerId);
		if (center) {
			const dash = circ.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<circle cx="${center.x.toFixed(2)}" cy="${(-center.y).toFixed(2)}" r="${circ.radius.toFixed(2)}"${dash} stroke-width="2" fill="none" />`
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
			const dash = arc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
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
			const dash = el.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<ellipse cx="${sc.x.toFixed(2)}" cy="${sc.y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${sc.x.toFixed(2)} ${sc.y.toFixed(2)})"${dash} stroke-width="2" fill="none" />`
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
			const dash = elarc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} ${largeArc} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
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
				segments = bsplineToBezier(pts.map(p => ({ x: p.x, y: -p.y })), spline.knots);
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
				segments = fitPointsToBezier(pts.map(p => ({ x: p.x, y: -p.y })), handles);
			}
			const d = getSplineSvgPath(segments, p => p, !!spline.isClosed);
			const dash = spline.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
			elements.push(
				`<path d="${d}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
			);
		}
	}

	// Export isolated points
	for (const pt of sketch.points.values()) {
		if (!usedPoints.has(pt.id)) {
			const fill = '#0f172a';
			elements.push(
				`<circle cx="${pt.x.toFixed(2)}" cy="${(-pt.y).toFixed(2)}" r="2" fill="${fill}" />`
			);
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
			let metaEl: Element | null = doc.getElementById('sketcher-metadata') || doc.querySelector('metadata#sketcher-metadata');
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
				return { success: false, error: 'No parametric CAD metadata found in SVG' };
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
