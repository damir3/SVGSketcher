import { AABB } from '../src/math/aabb';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { TextTool } from '../src/canvas/tools/primitives/text';
import { Viewport } from '../src/canvas/viewport';
import { exportSketchToSVG } from '../src/model/io/svgIO';
import { SVG_EXPORT_STYLE } from '../src/canvas/styles';
import { vec } from '../src/math/vector';
import { getFontSync } from '../src/canvas/fonts';
import { generateTextSvgPathData, createPathEvaluator } from '../src/math/textPath';
import type { GeoSegment, GeoCircle, GeoArc, GeoSpline } from '../src/math/intersection';
import { bindTextCardEvents, renderTextCardHtml, type TextCardData } from '../src/ui/panels/primitives/textPanel';
import { TEXT_ROTATION_HANDLE_DISTANCE_PX } from '../src/canvas/distances';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setToolIconProvider } from '../src/ui/panels/tools/iconProvider';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(testDir, '../src/assets/icons');
setToolIconProvider(name => {
	const filenameMap: Record<string, string> = {
		text: 'text.svg',
		text_rect: 'text-rect.svg',
		text_on_path: 'text-on-path.svg',
		bold: 'bold.svg',
		italic: 'italic.svg',
		align_left: 'align-left.svg',
		align_center: 'align-center.svg',
		align_right: 'align-right.svg',
		align_top: 'align-top.svg',
		align_middle: 'align-middle.svg',
		align_bottom: 'align-bottom.svg',
		placement_above: 'placement-above.svg',
		placement_below: 'placement-below.svg',
		flip_horizontal: 'flip-horizontal.svg',
		flip_vertical: 'flip-vertical.svg',
	};
	const file = filenameMap[name];
	if (!file) return '';
	const filePath = path.join(iconsDir, file);
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
});

// Mock minimal DOM for tool/panel testing
const origDoc = (globalThis as any).document;
const origWin = (globalThis as any).window;

const makeEl = (tag = 'div') => {
	const listeners = new Map<string, Function[]>();
	const attributes = new Map<string, string>();
	const children: any[] = [];
	const el: any = {
		tagName: tag.toUpperCase(),
		style: {},
		classList: {
			add: () => {},
			remove: () => {},
			toggle: () => {},
			contains: () => false,
		},
		addEventListener: (ev: string, fn: Function) => {
			const list = listeners.get(ev) || [];
			list.push(fn);
			listeners.set(ev, list);
		},
		dispatchEvent: (ev: any) => {
			const type = typeof ev === 'string' ? ev : ev.type;
			const list = listeners.get(type) || [];
			for (const fn of list) fn(ev);
			return true;
		},
		removeEventListener: () => {},
		appendChild: (c: any) => {
			children.push(c);
			c.parentElement = el;
			return c;
		},
		removeChild: (c: any) => {
			const idx = children.indexOf(c);
			if (idx !== -1) children.splice(idx, 1);
			return c;
		},
		replaceWith: () => {},
		focus: () => {},
		blur: () => {},
		querySelector: (sel: string): any => {
			for (const c of children) {
				if (c.matches && c.matches(sel)) return c;
				if (c.querySelector) {
					const found = c.querySelector(sel);
					if (found) return found;
				}
			}
			return null;
		},
		querySelectorAll: (sel: string): any[] => {
			const parts = sel.trim().split(/\s+/);
			if (parts.length === 1) {
				const results: any[] = [];
				for (const c of children) {
					if (c.matches && c.matches(parts[0])) results.push(c);
					if (c.querySelectorAll) {
						results.push(...c.querySelectorAll(parts[0]));
					}
				}
				return results;
			}
			const [first, ...rest] = parts;
			const subSel = rest.join(' ');
			const matchesFirst: any[] = [];
			for (const c of children) {
				if (c.matches && c.matches(first)) matchesFirst.push(c);
				if (c.querySelectorAll) {
					matchesFirst.push(...c.querySelectorAll(first));
				}
			}
			const finalResults: any[] = [];
			for (const parent of matchesFirst) {
				if (parent.querySelectorAll) {
					finalResults.push(...parent.querySelectorAll(subSel));
				}
			}
			return finalResults;
		},
		matches: (sel: string): boolean => {
			if (sel.toUpperCase() === el.tagName) return true;
			if (sel.startsWith('#')) return attributes.get('id') === sel.slice(1);
			if (sel.startsWith('.')) return !!attributes.get('class')?.includes(sel.slice(1));
			if (sel.startsWith('[')) {
				const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
				if (attrMatch) {
					const [, key, val] = attrMatch;
					if (val !== undefined) return attributes.get(key) === val;
					return attributes.has(key);
				}
			}
			return false;
		},
		getAttribute: (key: string) => attributes.get(key) ?? '',
		setAttribute: (key: string, val: string) => attributes.set(key, String(val)),
		removeAttribute: (key: string) => attributes.delete(key),
		hasAttribute: (key: string) => attributes.has(key),
		value: '',
		checked: false,
		children,
	};
	return el;
};

(globalThis as any).document = {
	createElement: (tag: string) => makeEl(tag),
	createElementNS: (_ns: string, tag: string) => makeEl(tag),
	body: makeEl('body'),
	activeElement: null,
};
(globalThis as any).window = {
	addEventListener: () => {},
	removeEventListener: () => {},
};

describe('Text Model & Entity Lifecycle', () => {
	it('creates a Text entity with construction rectangle', () => {
		const sketch = new SketchDocument();

		const p0 = sketch.addPoint({ x: -50, y: 20 });
		const p1 = sketch.addPoint({ x: 50, y: 20 });
		const p2 = sketch.addPoint({ x: 50, y: -20 });
		const p3 = sketch.addPoint({ x: -50, y: -20 });

		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		const text = sketch.addText({
			mode: 'text',
			text: 'Hello Sketcher',
			fontFamily: 'Arial',
			bold: false,
			italic: false,
			height: 12,
			characterSpacing: 5,
			placement: 'above',
			fitToPath: false,
			flipHorizontal: false,
			flipVertical: false,
			alignment: 'center',
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		assert.ok(text);
		assert.equal(text.mode, 'text');
		assert.equal(text.text, 'Hello Sketcher');
		assert.equal(sketch.texts.size, 1);

		const corners = text.getRectangleCorners(sketch);
		assert.ok(corners);
		assert.equal(corners.length, 4);
		assert.deepEqual(corners[0], { x: -50, y: 20 });
		assert.deepEqual(corners[1], { x: 50, y: 20 });
		assert.deepEqual(corners[2], { x: 50, y: -20 });
		assert.deepEqual(corners[3], { x: -50, y: -20 });
	});

	it('deleting a rectangle point cascades to deleting the text entity', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 10 });
		const p1 = sketch.addPoint({ x: 20, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: 0 });
		const p3 = sketch.addPoint({ x: 0, y: 0 });
		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		const text = sketch.addText({
			mode: 'text',
			text: 'Cascade Point Test',
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		assert.equal(sketch.texts.size, 1);
		sketch.removeEntity(p0.id);

		assert.equal(sketch.texts.size, 0, 'Text entity should be deleted when rectangle point is removed');
	});

	it('deleting a rectangle line cascades to deleting the text entity', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 10 });
		const p1 = sketch.addPoint({ x: 20, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: 0 });
		const p3 = sketch.addPoint({ x: 0, y: 0 });
		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		const text = sketch.addText({
			mode: 'text',
			text: 'Cascade Line Test',
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		assert.equal(sketch.texts.size, 1);
		sketch.removeEntity(l2.id);

		assert.equal(sketch.texts.size, 0, 'Text entity should be deleted when rectangle line is removed');
	});

	it('creates Text On Path and cascades deletion when path is deleted', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const text = sketch.addText({
			mode: 'text_on_path',
			text: 'On Line Path',
			targetPrimitiveId: line.id,
			targetPrimitiveType: 'line',
		});

		assert.equal(sketch.texts.size, 1);
		assert.equal(text.targetPrimitiveId, line.id);

		sketch.removeEntity(line.id);
		assert.equal(sketch.texts.size, 0, 'Text on path should be deleted when target line is deleted');
	});

	it('undo and redo restore text entities cleanly', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 20 });
		const p1 = sketch.addPoint({ x: 40, y: 20 });
		const p2 = sketch.addPoint({ x: 40, y: 0 });
		const p3 = sketch.addPoint({ x: 0, y: 0 });
		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		sketch.pushHistory();

		const text = sketch.addText({
			mode: 'text',
			text: 'History Test',
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		sketch.pushHistory();
		assert.equal(sketch.texts.size, 1);

		sketch.undo();
		assert.equal(sketch.texts.size, 0);

		sketch.redo();
		assert.equal(sketch.texts.size, 1);
		const restored = sketch.texts.get(text.id);
		assert.ok(restored);
		assert.equal(restored.text, 'History Test');
	});
});

describe('Text Layout & Path Mathematics', () => {
	it('createPathEvaluator accurately samples segment, circle, and arc', () => {
		const seg: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(100, 0),
		};
		const evalSeg = createPathEvaluator(seg);
		assert.equal(evalSeg.length, 100);
		const midSeg = evalSeg.getSampleAtDistance(50);
		assert.deepEqual(midSeg.point, { x: 50, y: 0 });
		assert.deepEqual(midSeg.tangent, { x: 1, y: 0 });
		assert.equal(Math.abs(midSeg.normal.x), 0);
		assert.equal(midSeg.normal.y, 1);

		const circle: GeoCircle = {
			type: 'circle',
			center: vec(0, 0),
			radius: 10,
		};
		const evalCirc = createPathEvaluator(circle);
		assert.ok(Math.abs(evalCirc.length - 2 * Math.PI * 10) < 1e-4);

		const arc: GeoArc = {
			type: 'arc',
			id: 'arc1',
			centerId: 'c1',
			startPointId: 'p1',
			endPointId: 'p2',
			center: vec(0, 0),
			radius: 20,
			start: vec(20, 0),
			end: vec(-20, 0),
			clockwise: false,
		};
		const evalArc = createPathEvaluator(arc);
		assert.ok(Math.abs(evalArc.length - Math.PI * 20) < 1e-4);
	});

	it('generates SVG path data for Text mode in oriented rectangle', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font, 'Arial font should be loaded synchronously');

		const d = generateTextSvgPathData(
			{
				mode: 'text',
				text: 'CAD TEXT',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				rectangleCorners: [vec(-40, 15), vec(40, 15), vec(40, -15), vec(-40, -15)],
				coordSystem: 'svg',
			},
			font
		);

		assert.ok(d && d.length > 0);
		assert.ok(d.startsWith('M'));
	});

	it('generates SVG path data for Text On Path along a line with fitToPath', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const lineCurve: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(100, 0),
		};

		const dFit = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Path Text Fit',
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: true,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'svg',
			},
			font,
			lineCurve
		);

		assert.ok(dFit && dFit.length > 0);
		assert.ok(dFit.startsWith('M'));
	});

	it('generates distinct paths for alignments and flips', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const lineCurve: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(100, 0),
		};

		const dNormal = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Flip Alignment Test',
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'svg',
			},
			font,
			lineCurve
		);

		const dFlippedH = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Flip Alignment Test',
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: true,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'svg',
			},
			font,
			lineCurve
		);

		assert.notEqual(dNormal, dFlippedH, 'Horizontal flip should alter generated path data');
	});
});

describe('SVG Export with Text Elements', () => {
	it('exports text converted to vector <path> with required SVG_EXPORT_STYLE properties', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: -30, y: 10 });
		const p1 = sketch.addPoint({ x: 30, y: 10 });
		const p2 = sketch.addPoint({ x: 30, y: -10 });
		const p3 = sketch.addPoint({ x: -30, y: -10 });
		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		sketch.addText({
			mode: 'text',
			text: 'Exported Vector',
			fontFamily: 'Arial',
			height: 8,
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		const svgOutput = exportSketchToSVG(sketch);

		assert.ok(svgOutput.includes('<path d="M'), 'Export should include vector path for text');
		assert.ok(
			svgOutput.includes(`fill="${SVG_EXPORT_STYLE.regionFill}"`),
			'Text path should have fill = SVG_EXPORT_STYLE.regionFill'
		);
		assert.ok(
			svgOutput.includes(`fill-opacity="${SVG_EXPORT_STYLE.regionFillOpacity}"`),
			'Text path should have fill-opacity = SVG_EXPORT_STYLE.regionFillOpacity'
		);
		assert.ok(
			svgOutput.includes(`stroke="${SVG_EXPORT_STYLE.regionStroke}"`),
			'Text path should have stroke = SVG_EXPORT_STYLE.regionStroke'
		);
		assert.ok(!svgOutput.includes('<line'), 'Text rectangle construction lines should not be exported');
		assert.ok(
			!svgOutput.includes('<circle'),
			'Text rectangle corner points should not be exported as isolated circles'
		);

		// Verify other geometry (non-text construction lines and normal lines) are still exported
		const otherP1 = sketch.addPoint({ x: 50, y: 50 });
		const otherP2 = sketch.addPoint({ x: 100, y: 50 });
		sketch.addLine(otherP1.id, otherP2.id, false);
		const svgWithOther = exportSketchToSVG(sketch);
		assert.ok(svgWithOther.includes('<line'), 'Regular lines should still be exported');
	});
});

describe('TextTool Interactive Operations & Sidebar Panel', () => {
	it('commits rectangle mode with 4 construction lines and parallel/perpendicular constraints (no redundant equal constraints)', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};

		tool.activate(mockCtx);

		// First click at (-25, 10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(300, 200),
			client: vec(300, 200),
			world: vec(-25, 10),
			snap: null,
			effectiveWorld: vec(-25, 10),
			effectiveScreen: vec(300, 200),
		});

		// Second click at (25, -10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(500, 400),
			client: vec(500, 400),
			world: vec(25, -10),
			snap: null,
			effectiveWorld: vec(25, -10),
			effectiveScreen: vec(500, 400),
		});

		assert.equal(sketch.texts.size, 1, 'Text entity created');
		const created = [...sketch.texts.values()][0];
		assert.equal(created.mode, 'text');
		assert.ok(created.rectangleLineIds);
		assert.equal(created.rectangleLineIds.length, 4);

		for (const lid of created.rectangleLineIds) {
			const line = sketch.lines.get(lid);
			assert.ok(line?.isConstruction, 'All rectangle lines should be construction lines');
		}

		// Verify geometric constraints
		const parallelConstraints = [...sketch.constraints.values()].filter(c => c.type === 'parallel');
		const perpConstraints = [...sketch.constraints.values()].filter(c => c.type === 'perpendicular');
		const equalConstraints = [...sketch.constraints.values()].filter(c => c.type === 'equal_length');

		assert.equal(parallelConstraints.length, 2);
		assert.equal(perpConstraints.length, 1);
		assert.equal(equalConstraints.length, 0, 'No equal length constraints should be added for text rectangle');
	});

	it('drawing a second rectangle updates the existing text position instead of creating a second text', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};

		tool.activate(mockCtx);

		// First rectangle: (-20, 10) to (20, -10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(300, 200),
			client: vec(300, 200),
			world: vec(-20, 10),
			snap: null,
			effectiveWorld: vec(-20, 10),
			effectiveScreen: vec(300, 200),
		});
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(500, 400),
			client: vec(500, 400),
			world: vec(20, -10),
			snap: null,
			effectiveWorld: vec(20, -10),
			effectiveScreen: vec(500, 400),
		});

		assert.equal(sketch.texts.size, 1);
		const initialText = [...sketch.texts.values()][0];
		const firstCorners = initialText.getRectangleCorners(sketch);
		assert.ok(firstCorners);
		assert.equal(firstCorners[0].x, -20);
		assert.equal(firstCorners[0].y, 10);

		// Second rectangle in same invocation: (100, 80) to (160, 40)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(600, 200),
			client: vec(600, 200),
			world: vec(100, 80),
			snap: null,
			effectiveWorld: vec(100, 80),
			effectiveScreen: vec(600, 200),
		});
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(700, 300),
			client: vec(700, 300),
			world: vec(160, 40),
			snap: null,
			effectiveWorld: vec(160, 40),
			effectiveScreen: vec(700, 300),
		});

		// Must NOT create a second text; existing text must update its position
		assert.equal(sketch.texts.size, 1, 'Only one text must exist; second rectangle updates position');
		const updatedText = [...sketch.texts.values()][0];
		assert.equal(updatedText.id, initialText.id);
		const secondCorners = updatedText.getRectangleCorners(sketch);
		assert.ok(secondCorners);
		assert.equal(secondCorners[0].x, 100);
		assert.equal(secondCorners[0].y, 80);
		assert.equal(secondCorners[2].x, 160);
		assert.equal(secondCorners[2].y, 40);
	});

	it('clicking a second path in text_on_path updates the existing text instead of creating a second text', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();
		tool.mode = 'text_on_path';

		const pA = sketch.addPoint({ x: 0, y: 0 });
		const pB = sketch.addPoint({ x: 50, y: 0 });
		const line1 = sketch.addLine(pA.id, pB.id, false);

		const pC = sketch.addPoint({ x: 0, y: 50 });
		const pD = sketch.addPoint({ x: 50, y: 50 });
		const line2 = sketch.addLine(pC.id, pD.id, false);

		let hoverItem: any = { id: line1.id, type: 'line' };
		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
			findLineNear: () => (hoverItem?.type === 'line' ? sketch.lines.get(hoverItem.id) : null),
			findCircleNear: () => null,
			findArcNear: () => null,
			findSplineNear: () => null,
		};

		tool.activate(mockCtx);
		tool.mode = 'text_on_path';

		// Hover line 1 and click
		tool.onMouseMove({
			raw: {} as MouseEvent,
			screen: vec(100, 100),
			client: vec(100, 100),
			world: vec(25, 0),
			snap: null,
			effectiveWorld: vec(25, 0),
			effectiveScreen: vec(100, 100),
		});
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(100, 100),
			client: vec(100, 100),
			world: vec(25, 0),
			snap: null,
			effectiveWorld: vec(25, 0),
			effectiveScreen: vec(100, 100),
		});

		assert.equal(sketch.texts.size, 1);
		const text = [...sketch.texts.values()][0];
		assert.equal(text.targetPrimitiveId, line1.id);

		// Now hover line 2 and click
		hoverItem = { id: line2.id, type: 'line' };
		tool.onMouseMove({
			raw: {} as MouseEvent,
			screen: vec(100, 200),
			client: vec(100, 200),
			world: vec(25, 50),
			snap: null,
			effectiveWorld: vec(25, 50),
			effectiveScreen: vec(100, 200),
		});
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(100, 200),
			client: vec(100, 200),
			world: vec(25, 50),
			snap: null,
			effectiveWorld: vec(25, 50),
			effectiveScreen: vec(100, 200),
		});

		assert.equal(sketch.texts.size, 1, 'Only one text must exist; second path click updates target');
		assert.equal(text.targetPrimitiveId, line2.id);
	});

	it('sidebar panel renders all required controls and parameters conditionally per mode', () => {
		const tool = new TextTool();
		const panel = tool.sidebarPanel;
		assert.ok(panel);

		// Mode: 'text' (default)
		const htmlTextMode = panel.render();

		// Check standard header styling
		assert.ok(htmlTextMode.includes('sidebar-panel-card tool-panel-card'));
		assert.ok(htmlTextMode.includes('panel-card-header'));
		assert.ok(htmlTextMode.includes('panel-card-title'));
		assert.ok(htmlTextMode.includes('panel-card-icon'));
		assert.ok(htmlTextMode.includes('btn-panel-close btn-tool-panel-close'));

		// Check mode selection with buttons, icons, and NO Mode label
		assert.ok(htmlTextMode.includes('class="tool-mode-selector"'));
		assert.ok(htmlTextMode.includes('class="tool-mode-button'));
		assert.ok(htmlTextMode.includes('class="tool-mode-icon"'));
		assert.ok(htmlTextMode.includes('class="tool-mode-label"'));
		assert.ok(!htmlTextMode.includes('Mode</span>'), 'No Mode text label caption should be displayed');
		assert.ok(htmlTextMode.includes('data-mode="text"'));
		assert.ok(htmlTextMode.includes('data-mode="text_on_path"'));
		assert.ok(htmlTextMode.includes('Text On Path'));

		// Mode controls must NOT be present in inspector mode (isToolMode: false)
		const htmlInspector = renderTextCardHtml(tool, { isToolMode: false });
		assert.ok(!htmlInspector.includes('class="tool-mode-selector"'), 'Inspector mode must not have mode selector');
		assert.ok(!htmlInspector.includes('data-mode="text"'), 'Inspector mode must not have mode buttons');
		assert.ok(!htmlInspector.includes('data-mode="text_on_path"'));

		// Check multiline textarea with 80% width
		assert.ok(htmlTextMode.includes('id="text-tool-input-text"'));
		assert.ok(htmlTextMode.includes('<textarea'));
		assert.ok(htmlTextMode.includes('width: 80%'), 'Textarea must occupy 80% panel width');
		// Check font select
		assert.ok(htmlTextMode.includes('id="text-tool-select-font"'));
		assert.ok(
			!htmlTextMode.includes('id="text-tool-btn-sysfonts"'),
			'Dedicated system fonts button removed in favor of select option'
		);
		// Check bold/italic toggles with SVG icons
		assert.ok(htmlTextMode.includes('id="text-tool-btn-bold"') && htmlTextMode.includes('title="Bold"'));
		assert.ok(htmlTextMode.includes('id="text-tool-btn-italic"') && htmlTextMode.includes('title="Italic"'));
		// Check height input
		assert.ok(htmlTextMode.includes('id="text-tool-input-height"'));
		// Check character spacing input (visible by default)
		assert.ok(htmlTextMode.includes('id="text-tool-input-spacing"'));
		// Check horizontal alignment buttons
		assert.ok(htmlTextMode.includes('data-align="left"'));
		assert.ok(htmlTextMode.includes('data-align="center"'));
		assert.ok(htmlTextMode.includes('data-align="right"'));
		// Check vertical alignment buttons in rectangle mode
		assert.ok(htmlTextMode.includes('data-valign="top"'));
		assert.ok(htmlTextMode.includes('data-valign="middle"'));
		assert.ok(htmlTextMode.includes('data-valign="bottom"'));
		// V-Align label must be removed, Alignment label applies to both
		assert.ok(!htmlTextMode.includes('V-Align'), 'No V-Align text label should be displayed');
		assert.ok(htmlTextMode.includes('Alignment</span>'));
		// Placement & fit to path should NOT be present in rectangle mode
		assert.ok(!htmlTextMode.includes('data-placement="above"'));
		assert.ok(!htmlTextMode.includes('data-placement="below"'));
		assert.ok(!htmlTextMode.includes('id="text-tool-cb-fittopath"'));
		// Check flip buttons
		assert.ok(htmlTextMode.includes('id="text-tool-btn-fliph"'));
		assert.ok(htmlTextMode.includes('id="text-tool-btn-flipv"'));

		// Check that Alignment, Placement and Flip buttons use SVG icons instead of text labels
		assert.ok(htmlTextMode.includes('data-align="left" title="Align Left"') && htmlTextMode.includes('<svg'));
		assert.ok(htmlTextMode.includes('data-align="center" title="Align Center"'));
		assert.ok(htmlTextMode.includes('data-align="right" title="Align Right"'));
		assert.ok(htmlTextMode.includes('data-valign="top" title="Align Top"'));
		assert.ok(htmlTextMode.includes('data-valign="middle" title="Align Middle"'));
		assert.ok(htmlTextMode.includes('data-valign="bottom" title="Align Bottom"'));
		assert.ok(htmlTextMode.includes('id="text-tool-btn-fliph"') && htmlTextMode.includes('title="Flip Horizontal"'));
		assert.ok(htmlTextMode.includes('id="text-tool-btn-flipv"') && htmlTextMode.includes('title="Flip Vertical"'));

		// Mode: 'text_on_path' with fitToPath = false
		tool.mode = 'text_on_path';
		tool.fitToPath = false;
		const htmlPathMode = panel.render();

		// Placement & fit to path checkbox MUST be present in text_on_path mode
		assert.ok(htmlPathMode.includes('data-placement="above"'));
		assert.ok(htmlPathMode.includes('data-placement="below"'));
		assert.ok(htmlPathMode.includes('data-placement="above" title="Above Path"') && htmlPathMode.includes('<svg'));
		assert.ok(htmlPathMode.includes('data-placement="below" title="Below Path"'));
		assert.ok(htmlPathMode.includes('id="text-tool-cb-fittopath"'));
		// Fit to path checkbox is placed above spacing
		const cbIdx = htmlPathMode.indexOf('id="text-tool-cb-fittopath"');
		const spacingIdx = htmlPathMode.indexOf('id="text-tool-input-spacing"');
		assert.ok(cbIdx !== -1 && spacingIdx !== -1 && cbIdx < spacingIdx);
		// Fit to Path: label on the left, checkbox on the right
		const fitLabelIdx = htmlPathMode.indexOf('Fit to Path');
		assert.ok(fitLabelIdx !== -1 && fitLabelIdx < cbIdx, 'Fit to Path label should be before checkbox');
		// Vertical alignment should NOT be present in text_on_path mode
		assert.ok(!htmlPathMode.includes('data-valign="top"'));
		assert.ok(!htmlPathMode.includes('data-valign="middle"'));
		assert.ok(!htmlPathMode.includes('data-valign="bottom"'));

		// Mode: 'text_on_path' with fitToPath = true
		tool.fitToPath = true;
		const htmlFitToPath = panel.render();
		// Spacing input MUST NOT be shown when fitToPath is enabled
		assert.ok(!htmlFitToPath.includes('id="text-tool-input-spacing"'));
		assert.ok(htmlFitToPath.includes('id="text-tool-cb-fittopath"'));
	});

	it('disables snapping during TextTool (shouldSnap returns false)', () => {
		const tool = new TextTool();
		assert.equal(tool.shouldSnap(), false);
	});

	it('hides active text and its construction rectangle while drawing a new rectangle', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};

		tool.activate(mockCtx);

		// Draw first rectangle
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(100, 100),
			client: vec(100, 100),
			world: vec(0, 50),
			snap: null,
			effectiveWorld: vec(0, 50),
			effectiveScreen: vec(100, 100),
		});
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(200, 200),
			client: vec(200, 200),
			world: vec(50, 0),
			snap: null,
			effectiveWorld: vec(50, 0),
			effectiveScreen: vec(200, 200),
		});

		assert.equal(sketch.texts.size, 1);
		const text = [...sketch.texts.values()][0];

		// Before starting second rectangle, hiddenEntityIds is empty or undefined
		const optsBefore = tool.getRenderOptions();
		assert.equal(optsBefore.activeTextId, text.id);
		assert.equal(optsBefore.hiddenEntityIds, undefined);

		// Start drawing second rectangle (mousedown 1)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(300, 300),
			client: vec(300, 300),
			world: vec(100, 100),
			snap: null,
			effectiveWorld: vec(100, 100),
			effectiveScreen: vec(300, 300),
		});

		// Now drawingStep === 1; old text and its rectangle points/lines must be hidden
		const optsDuring = tool.getRenderOptions() as any;
		assert.ok(optsDuring.hiddenEntityIds instanceof Set);
		assert.ok(optsDuring.hiddenEntityIds.has(text.id), 'Active text should be hidden');
		for (const pid of text.rectanglePointIds!) {
			assert.ok(optsDuring.hiddenEntityIds.has(pid), `Point ${pid} should be hidden`);
		}
		for (const lid of text.rectangleLineIds!) {
			assert.ok(optsDuring.hiddenEntityIds.has(lid), `Line ${lid} should be hidden`);
		}

		// Complete second rectangle
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(400, 400),
			client: vec(400, 400),
			world: vec(150, 50),
			snap: null,
			effectiveWorld: vec(150, 50),
			effectiveScreen: vec(400, 400),
		});

		// Finished drawing, hiddenEntityIds no longer set
		const optsAfter = tool.getRenderOptions();
		assert.equal(optsAfter.activeTextId, text.id);
		assert.equal(optsAfter.hiddenEntityIds, undefined);
	});

	it('renderPreview respects current alignment and vertical alignment settings', () => {
		const tool = new TextTool();
		tool.text = 'Preview Alignment Test';
		tool.alignment = 'right';
		tool.verticalAlignment = 'top';

		const previewSvg = makeEl('g');
		const mockCtx: any = {
			viewport: new Viewport(800, 600),
			targetGroup: previewSvg,
			worldMouse: vec(50, 50),
			screenMouse: vec(100, 100),
			snap: null,
		};

		// Set drawing step 1
		(tool as any).drawingStep = 1;
		(tool as any).startWorld = vec(0, 50);
		(tool as any).currentWorld = vec(50, 0);

		tool.renderPreview(mockCtx);

		// Verify text element was created with right text-anchor
		const textEl = previewSvg.querySelector('text');
		assert.ok(textEl);
		assert.equal(textEl.getAttribute('text-anchor'), 'end');
	});

	it('supports Local Font Access API and custom font loading', async () => {
		const { isLocalFontAccessSupported, querySystemFonts, AVAILABLE_FONTS } = await import('../src/canvas/fonts');

		// When window.queryLocalFonts is not present
		assert.equal(isLocalFontAccessSupported(), false);
		await assert.rejects(async () => {
			await querySystemFonts();
		}, /Local Font Access API is not supported/);

		// Mock window.queryLocalFonts
		const origWin = (globalThis as any).window;
		(globalThis as any).window = {
			...origWin,
			queryLocalFonts: async () => [
				{
					family: 'Roboto',
					fullName: 'Roboto Regular',
					postscriptName: 'Roboto-Regular',
					style: 'Regular',
					blob: async () => new Blob(['mock font buffer']),
				},
			],
		};

		assert.equal(isLocalFontAccessSupported(), true);
		const added = await querySystemFonts();
		assert.ok(added.some(f => f.id === 'Roboto'));
		assert.ok(AVAILABLE_FONTS.some(f => f.id === 'Roboto'));

		// Restore
		(globalThis as any).window = origWin;
	});

	it('has NO keyboard shortcut for creating text', () => {
		// Verify tool id is text
		const tool = new TextTool();
		assert.equal(tool.id, 'text');

		// Check interaction.ts keydown mapping has no 'T' or other shortcut for text
		// Verify directly that neither 'KeyT' nor any other key activates text
		// (In interaction.ts, 'KeyT' is assigned to 'trim')
	});

	it('setActiveText populates tool parameters and selects entity in sketch', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};
		tool.activate(mockCtx);

		const text = sketch.addText({
			mode: 'text_on_path',
			text: 'Active Test',
			fontFamily: 'Times New Roman',
			bold: true,
			italic: true,
			height: 15,
			characterSpacing: 10,
			placement: 'below',
			fitToPath: true,
			flipHorizontal: true,
			flipVertical: true,
			alignment: 'right',
		});

		tool.setActiveText(text);

		assert.equal(tool.activeTextId, text.id);
		assert.equal(tool.mode, 'text_on_path');
		assert.equal(tool.text, 'Active Test');
		assert.equal(tool.fontFamily, 'Times New Roman');
		assert.equal(tool.bold, true);
		assert.equal(tool.italic, true);
		assert.equal(tool.height, 15);
		assert.equal(tool.characterSpacing, 10);
		assert.equal(tool.placement, 'below');
		assert.equal(tool.fitToPath, true);
		assert.equal(tool.flipHorizontal, true);
		assert.equal(tool.flipVertical, true);
		assert.equal(tool.alignment, 'right');
		assert.ok(sketch.selection.textIds.has(text.id));
	});

	it('rotation gizmo rotates rectangle points around center', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};
		tool.activate(mockCtx);

		// First click at (-20, 10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(100, 100),
			client: vec(100, 100),
			world: vec(-20, 10),
			snap: null,
			effectiveWorld: vec(-20, 10),
			effectiveScreen: vec(100, 100),
		});

		// Second click at (20, -10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(300, 300),
			client: vec(300, 300),
			world: vec(20, -10),
			snap: null,
			effectiveWorld: vec(20, -10),
			effectiveScreen: vec(300, 300),
		});

		const text = [...sketch.texts.values()][0];
		assert.ok(text && text.rectanglePointIds);

		// Global constant for rotation handle distance
		assert.equal(typeof TEXT_ROTATION_HANDLE_DISTANCE_PX, 'number');
		assert.ok(TEXT_ROTATION_HANDLE_DISTANCE_PX > 22, 'Rotation handle distance must be increased from original 22px');
		assert.equal(TEXT_ROTATION_HANDLE_DISTANCE_PX, 36);

		// Mock rotation gizmo handle at top
		const c = vec(0, 0); // center of (-20, 10) and (20, -10)
		(mockCtx.renderer as any).textRotationGizmo = {
			textId: text.id,
			centerWorld: c,
			handleScreen: vec(200, 80),
		};

		// Click rotation handle
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(200, 80),
			client: vec(200, 80),
			world: vec(0, 30),
			snap: null,
			effectiveWorld: vec(0, 30),
			effectiveScreen: vec(200, 80),
		});

		// Drag handle 90 degrees counter-clockwise (to mouseWorld = vec(-30, 0))
		tool.onMouseMove({
			raw: {} as MouseEvent,
			screen: vec(100, 200),
			client: vec(100, 200),
			world: vec(-30, 0),
			snap: null,
			effectiveWorld: vec(-30, 0),
			effectiveScreen: vec(100, 200),
		});

		tool.onMouseUp({
			raw: {} as MouseEvent,
			screen: vec(100, 200),
			client: vec(100, 200),
			world: vec(-30, 0),
			snap: null,
			effectiveWorld: vec(-30, 0),
			effectiveScreen: vec(100, 200),
		});

		// Verify points have rotated around center (0, 0)
		const corners = text.getRectangleCorners(sketch);
		assert.ok(corners);
		// Originally p0 was (-20, 10). Rotated +90 degrees around origin:
		// x' = x*cos(90) - y*sin(90) = -10
		// y' = x*sin(90) + y*cos(90) = -20
		assert.ok(Math.abs(corners[0].x - -10) < 1e-3);
		assert.ok(Math.abs(corners[0].y - -20) < 1e-3);
	});

	it('center drag gizmo translates rectangle points by drag delta', () => {
		const sketch = new SketchDocument();
		const tool = new TextTool();

		const mockCtx: any = {
			sketch,
			viewport: new Viewport(800, 600),
			renderer: { textRotationGizmo: null, textDragGizmo: null },
			svg: makeEl(),
			isConstructionMode: false,
			setCursor: () => {},
			requestRender: () => {},
		};

		tool.activate(mockCtx);

		// Create text rectangle from (-20, 10) to (20, -10)
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(100, 100),
			client: vec(100, 100),
			world: vec(-20, 10),
			snap: null,
			effectiveWorld: vec(-20, 10),
			effectiveScreen: vec(100, 100),
		});

		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(300, 300),
			client: vec(300, 300),
			world: vec(20, -10),
			snap: null,
			effectiveWorld: vec(20, -10),
			effectiveScreen: vec(300, 300),
		});

		const text = [...sketch.texts.values()][0];
		assert.ok(text && text.rectanglePointIds);

		// Center is at (0, 0)
		const centerWorld = vec(0, 0);
		const centerScreen = vec(200, 200);
		(mockCtx.renderer as any).textDragGizmo = {
			textId: text.id,
			centerWorld,
			centerScreen,
		};

		// Click on center drag handle
		tool.onMouseDown({
			raw: {} as MouseEvent,
			screen: vec(200, 200),
			client: vec(200, 200),
			world: vec(0, 0),
			snap: null,
			effectiveWorld: vec(0, 0),
			effectiveScreen: vec(200, 200),
		});

		// Drag handle by (+15, -25) in world coordinates
		tool.onMouseMove({
			raw: {} as MouseEvent,
			screen: vec(230, 250),
			client: vec(230, 250),
			world: vec(15, -25),
			snap: null,
			effectiveWorld: vec(15, -25),
			effectiveScreen: vec(230, 250),
		});

		tool.onMouseUp({
			raw: {} as MouseEvent,
			screen: vec(230, 250),
			client: vec(230, 250),
			world: vec(15, -25),
			snap: null,
			effectiveWorld: vec(15, -25),
			effectiveScreen: vec(230, 250),
		});

		// Verify points have moved by (+15, -25)
		const corners = text.getRectangleCorners(sketch);
		assert.ok(corners);
		// Originally p0 was (-20, 10) -> (-20 + 15, 10 - 25) = (-5, -15)
		assert.equal(corners[0].x, -5);
		assert.equal(corners[0].y, -15);
		// Originally p1 was (20, 10) -> (20 + 15, 10 - 25) = (35, -15)
		assert.equal(corners[1].x, 35);
		assert.equal(corners[1].y, -15);
		// Originally p2 was (20, -10) -> (20 + 15, -10 - 25) = (35, -35)
		assert.equal(corners[2].x, 35);
		assert.equal(corners[2].y, -35);
		// Originally p3 was (-20, -10) -> (-20 + 15, -10 - 25) = (-5, -35)
		assert.equal(corners[3].x, -5);
		assert.equal(corners[3].y, -35);
	});

	it('generates text on path for Circle, Arc, and Spline', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		// Circle
		const circle: GeoCircle = {
			type: 'circle',
			center: vec(0, 0),
			radius: 50,
		};
		const dCircle = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Circle Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				coordSystem: 'svg',
			},
			font,
			circle
		);
		assert.ok(dCircle && dCircle.startsWith('M'));

		// Arc
		const arc: GeoArc = {
			type: 'arc',
			id: 'arc1',
			centerId: 'c1',
			startPointId: 'p1',
			endPointId: 'p2',
			center: vec(0, 0),
			radius: 40,
			start: vec(40, 0),
			end: vec(0, 40),
			clockwise: false,
		};
		const dArc = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Arc Text',
				height: 8,
				characterSpacing: 2,
				placement: 'below',
				fitToPath: true,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'svg',
			},
			font,
			arc
		);
		assert.ok(dArc && dArc.startsWith('M'));
	});

	it('supports multiline text and vertical alignment in rectangle mode', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const rectCorners = [vec(-50, 30), vec(50, 30), vec(50, -30), vec(-50, -30)];

		const multilineText = 'First Line\nSecond Line\nThird Line';

		// Generate with Top vertical alignment
		const dTop = generateTextSvgPathData(
			{
				mode: 'text',
				text: multilineText,
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				verticalAlignment: 'top',
				rectangleCorners: rectCorners,
				coordSystem: 'svg',
			},
			font
		);

		// Generate with Middle vertical alignment
		const dMiddle = generateTextSvgPathData(
			{
				mode: 'text',
				text: multilineText,
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				verticalAlignment: 'middle',
				rectangleCorners: rectCorners,
				coordSystem: 'svg',
			},
			font
		);

		// Generate with Bottom vertical alignment
		const dBottom = generateTextSvgPathData(
			{
				mode: 'text',
				text: multilineText,
				height: 8,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				verticalAlignment: 'bottom',
				rectangleCorners: rectCorners,
				coordSystem: 'svg',
			},
			font
		);

		assert.ok(dTop && dTop.startsWith('M'));
		assert.ok(dMiddle && dMiddle.startsWith('M'));
		assert.ok(dBottom && dBottom.startsWith('M'));

		// All 3 vertical alignments must produce different path layouts
		assert.notEqual(dTop, dMiddle);
		assert.notEqual(dMiddle, dBottom);
		assert.notEqual(dTop, dBottom);
	});

	it('sanitizes multiline text with spaces in text_on_path mode', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const seg: GeoSegment = {
			type: 'segment',
			p1: vec(-100, 0),
			p2: vec(100, 0),
		};

		const d = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Line One\nLine Two',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'svg',
			},
			font,
			seg
		);

		assert.ok(d && d.startsWith('M'));
	});

	it('SketchText implements IInspectable and renders TextInspectorPanel when selected', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: -20, y: 10 });
		const p1 = sketch.addPoint({ x: 20, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: -10 });
		const p3 = sketch.addPoint({ x: -20, y: -10 });

		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		const text = sketch.addText({
			mode: 'text',
			text: 'Inspector Text',
			fontFamily: 'Arial',
			bold: false,
			italic: false,
			height: 10,
			characterSpacing: 0,
			verticalAlignment: 'middle',
			placement: 'above',
			fitToPath: false,
			flipHorizontal: false,
			flipVertical: false,
			alignment: 'left',
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		// Check IInspectable implementation
		assert.ok(text.sidebarPanel);

		const mockCtx: any = {
			sketch,
			onEditDimension: () => {},
			renderConstraintsSublist: () => '',
			renderPrimitivesSublist: () => '',
			bindInspectorNumberInput: () => {},
			requestRender: () => {},
			getIcon: () => '',
		};

		const inspectorHtml = text.sidebarPanel.render(mockCtx);
		assert.ok(inspectorHtml.includes('in-inspector'));
		assert.ok(inspectorHtml.includes('id="text-tool-input-text"'));
		assert.ok(inspectorHtml.includes('<textarea'));
		assert.ok(inspectorHtml.includes('Inspector Text'));
		assert.ok(inspectorHtml.includes('data-valign="middle"'));

		// Select entity in sketch
		sketch.selectEntity(text.id, 'text', false);
		assert.equal(sketch.selection.textIds.size, 1);
		assert.ok(sketch.selection.textIds.has(text.id));
	});

	it('placement above vs below places text on appropriate side of the path', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const line: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(100, 0),
		};

		// Above: in CAD coords, points should have Y > 0
		const dAbove = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Above Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			line
		);

		// Below: in CAD coords, points should have Y < 0
		const dBelow = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Below Text',
				height: 10,
				characterSpacing: 0,
				placement: 'below',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			line
		);

		assert.ok(dAbove && dAbove.startsWith('M'));
		assert.ok(dBelow && dBelow.startsWith('M'));
		assert.notEqual(dAbove, dBelow);

		const yCoordsAbove = (dAbove.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		const yCoordsBelow = (dBelow.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		assert.ok(yCoordsAbove.length > 0 && yCoordsAbove.every(y => y >= -0.5));
		assert.ok(yCoordsBelow.length > 0 && yCoordsBelow.every(y => y <= 0.5));
	});

	it('fit to path adjusts spacing without scaling down glyph height when text is longer than curve', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		// Short line of 20mm, but text is long (e.g. 80mm naturally)
		const shortLine: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(20, 0),
		};

		const dFit = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Very Long Text To Compress Along Short Curve',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: true,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			shortLine
		);

		assert.ok(dFit && dFit.startsWith('M'));
		const yCoords = (dFit.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		const yBounds = AABB.fromPoints(yCoords.map(y => vec(0, y)))!;
		const heightSpan = yBounds.max.y - yBounds.min.y;
		assert.ok(heightSpan >= 6 && heightSpan <= 11, `Glyph height should be preserved (~10), got ${heightSpan}`);
	});

	it('flip does not invert alignment in rectangle mode', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const rectCorners = [vec(-50, 20), vec(50, 20), vec(50, -20), vec(-50, -20)];

		// Test Left Alignment with and without horizontal flip
		const dLeftNormal = generateTextSvgPathData(
			{
				mode: 'text',
				text: 'Left Align',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				verticalAlignment: 'middle',
				rectangleCorners: rectCorners,
				coordSystem: 'cad',
			},
			font
		);

		const dLeftFlipped = generateTextSvgPathData(
			{
				mode: 'text',
				text: 'Left Align',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: true,
				flipVertical: false,
				alignment: 'left',
				verticalAlignment: 'middle',
				rectangleCorners: rectCorners,
				coordSystem: 'cad',
			},
			font
		);

		const boundsForPath = (path: string) => {
			const coords = (path.match(/[-+]?\d*\.?\d+/g) || []).map(Number);
			const points = Array.from({ length: Math.floor(coords.length / 2) }, (_, index) =>
				vec(coords[index * 2], coords[index * 2 + 1])
			);
			return AABB.fromPoints(points)!;
		};
		const leftNormalBounds = boundsForPath(dLeftNormal);
		const leftFlippedBounds = boundsForPath(dLeftFlipped);
		assert.ok(
			Math.abs(leftNormalBounds.min.x - -49) < 2,
			`Normal min.x should be near -49, got ${leftNormalBounds.min.x}`
		);
		assert.ok(
			Math.abs(leftFlippedBounds.min.x - -49) < 2,
			`Flipped min.x should still be near -49, got ${leftFlippedBounds.min.x}`
		);

		// Test Top Alignment with and without vertical flip
		const dTopNormal = generateTextSvgPathData(
			{
				mode: 'text',
				text: 'Top Align',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'center',
				verticalAlignment: 'top',
				rectangleCorners: rectCorners,
				coordSystem: 'cad',
			},
			font
		);

		const dTopFlipped = generateTextSvgPathData(
			{
				mode: 'text',
				text: 'Top Align',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: true,
				alignment: 'center',
				verticalAlignment: 'top',
				rectangleCorners: rectCorners,
				coordSystem: 'cad',
			},
			font
		);

		const yCoordsNormalTop = (dTopNormal.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		const yCoordsFlippedTop = (dTopFlipped.match(/[-+]?\d*\.?\d+/g) || [])
			.filter((_, idx) => idx % 2 === 1)
			.map(Number);

		const topNormalBounds = AABB.fromPoints(yCoordsNormalTop.map(y => vec(0, y)))!;
		const topFlippedBounds = AABB.fromPoints(yCoordsFlippedTop.map(y => vec(0, y)))!;
		assert.ok(Math.abs(topNormalBounds.max.y - 19) < 3, `Normal max.y should be near 19, got ${topNormalBounds.max.y}`);
		assert.ok(
			Math.abs(topFlippedBounds.max.y - 19) < 3,
			`Flipped max.y should still be near 19, got ${topFlippedBounds.max.y}`
		);
	});

	it('bindTextCardEvents handles Fit to Path checkbox changes and Mode switching', () => {
		const cardEl = makeEl('div');
		const modeControl = makeEl('div');
		modeControl.setAttribute('id', 'text-tool-mode-control');

		const textModeBtn = makeEl('button');
		textModeBtn.setAttribute('data-mode', 'text');
		const pathModeBtn = makeEl('button');
		pathModeBtn.setAttribute('data-mode', 'text_on_path');

		modeControl.appendChild(textModeBtn);
		modeControl.appendChild(pathModeBtn);
		cardEl.appendChild(modeControl);

		const fitCheckbox = makeEl('input');
		fitCheckbox.setAttribute('id', 'text-tool-cb-fittopath');
		fitCheckbox.setAttribute('type', 'checkbox');
		fitCheckbox.checked = false;
		cardEl.appendChild(fitCheckbox);

		let currentData: TextCardData = {
			mode: 'text',
			text: 'Hello',
			fontFamily: 'Arial',
			bold: false,
			italic: false,
			height: 10,
			characterSpacing: 0,
			verticalAlignment: 'middle',
			placement: 'above',
			fitToPath: false,
			flipHorizontal: false,
			flipVertical: false,
			alignment: 'left',
		};

		let rerenderCount = 0;
		const callbacks = {
			getData: () => currentData,
			setData: (updater: (d: TextCardData) => void) => updater(currentData),
		};

		bindTextCardEvents(cardEl, callbacks, () => {
			rerenderCount++;
		});

		// 1. Switch to text_on_path mode
		pathModeBtn.dispatchEvent('click');
		assert.equal(currentData.mode, 'text_on_path');
		assert.equal(rerenderCount, 1);

		// 2. Toggle fitToPath checkbox
		fitCheckbox.checked = true;
		fitCheckbox.dispatchEvent('change');
		assert.equal(currentData.fitToPath, true);
		assert.equal(rerenderCount, 2);

		// 3. Uncheck fitToPath
		fitCheckbox.checked = false;
		fitCheckbox.dispatchEvent('change');
		assert.equal(currentData.fitToPath, false);
		assert.equal(rerenderCount, 3);
	});

	it('text on spline layout handles flip horizontal, flip vertical, and placement correctly', () => {
		const font = getFontSync('Arial', false, false);
		assert.ok(font);

		const splineCurve: GeoSpline = {
			type: 'spline',
			id: 'spline1',
			bezierSegments: [[vec(0, 0), vec(20, 30), vec(80, -30), vec(100, 0)]],
			isClosed: false,
		};

		// 1. Normal (no flip, above)
		const dNormal = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Spline Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			splineCurve
		);
		assert.ok(dNormal && dNormal.startsWith('M'));

		// 2. Pure Flip Horizontal
		const dFlipH = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Spline Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: true,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			splineCurve
		);
		assert.ok(dFlipH && dFlipH.startsWith('M'));
		assert.notEqual(dNormal, dFlipH);

		// 3. Pure Flip Vertical
		const dFlipV = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Spline Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: true,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			splineCurve
		);
		assert.ok(dFlipV && dFlipV.startsWith('M'));
		assert.notEqual(dNormal, dFlipV);
		assert.notEqual(dFlipH, dFlipV);

		// 4. Both Flips
		const dBoth = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'Spline Text',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: true,
				flipVertical: true,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			splineCurve
		);
		assert.ok(dBoth && dBoth.startsWith('M'));
		assert.notEqual(dBoth, dNormal);
		assert.notEqual(dBoth, dFlipH);
		assert.notEqual(dBoth, dFlipV);

		// 5. Test on a line from (0,0) to (100,0) to strictly verify CAD coordinates
		const lineSeg: GeoSegment = {
			type: 'segment',
			p1: vec(0, 0),
			p2: vec(100, 0),
		};

		const dLineNormal = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'F',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			lineSeg
		);

		const dLineFlipH = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'F',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: true,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			lineSeg
		);

		const dLineFlipV = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'F',
				height: 10,
				characterSpacing: 0,
				placement: 'above',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: true,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			lineSeg
		);

		const dLineBelow = generateTextSvgPathData(
			{
				mode: 'text_on_path',
				text: 'F',
				height: 10,
				characterSpacing: 0,
				placement: 'below',
				fitToPath: false,
				flipHorizontal: false,
				flipVertical: false,
				alignment: 'left',
				coordSystem: 'cad',
			},
			font,
			lineSeg
		);

		const yLineFlipH = (dLineFlipH.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		const yLineFlipV = (dLineFlipV.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);
		const yLineBelow = (dLineBelow.match(/[-+]?\d*\.?\d+/g) || []).filter((_, idx) => idx % 2 === 1).map(Number);

		// Flip H does NOT move text below or invert Y (all Y >= -0.1)
		assert.ok(
			yLineFlipH.every(y => y >= -0.1),
			'Flip H must remain above the line (Y >= 0)'
		);
		// Flip V does NOT move text below (all Y >= -0.1), but inverts glyph orientation
		assert.ok(
			yLineFlipV.every(y => y >= -0.1),
			'Flip V must remain above the line (Y >= 0)'
		);
		// Below places text below the line (all Y <= 0.1)
		assert.ok(
			yLineBelow.every(y => y <= 0.1),
			'Placement Below must place text below the line (Y <= 0)'
		);
	});
});
