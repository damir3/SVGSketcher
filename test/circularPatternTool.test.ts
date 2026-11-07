import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { CircularPatternTool } from '../src/canvas/tools/modify/circularPattern';
import { CircularPatternConstraint, RectangularPatternConstraint } from '../src/solver/constraints';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';
import { RectangularPatternTool } from '../src/canvas/tools/modify/rectangularPattern';

const origDoc = (globalThis as any).document;
const makeEl = () => {
	const listeners = new Map<string, Function[]>();
	const el: any = {
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
		appendChild: () => {},
		focus: () => {},
		select: () => {},
		blur: () => {},
		querySelector: () => makeEl(),
		querySelectorAll: () => [],
		getAttribute: () => '',
		setAttribute: () => {},
		value: '',
		checked: false,
	};
	return el;
};

(globalThis as any).document = {
	createElement: (_tag: string) => makeEl(),
	createElementNS: (_ns: string, _tag: string) => makeEl(),
	body: makeEl(),
	activeElement: null,
};

describe('CircularPatternTool & Panel Integration', () => {
	it('updates panel card on state changes and enables Apply button', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: 20 });
		const line = sketch.addLine(p1.id, p2.id);
		const center = sketch.addPoint({ x: 0, y: 0 });

		const tool = new CircularPatternTool();

		const mockCtx: any = {
			sketch,
			viewport: {
				worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
			},
			renderer: {
				patternCheckboxPositions: new Map(),
			},
			findPointNear: (screen: any) => {
				if (screen.x === 0 && screen.y === 0) return center;
				if (screen.x === 10 && screen.y === 10) return p1;
				return null;
			},
			findLineNear: (screen: any) => {
				if (screen.x === 15 && screen.y === 15) return line;
				return null;
			},
			findCircleNear: () => null,
			findArcNear: () => null,
			findEllipseNear: () => null,
			findEllipticalArcNear: () => null,
			requestRender: () => {},
			setCursor: () => {},
			showToast: () => {},
			setTool: () => {},
		};

		tool.activate(mockCtx);

		// Verify initial panel HTML uses the shared tool panel card style.
		const initialHtml = tool.sidebarPanel.render();
		assert.ok(initialHtml.includes('tool-panel-card'), 'Panel HTML should use tool-panel-card');
		assert.ok(initialHtml.includes('disabled'), 'Apply should be disabled initially');

		// Click line to select object
		tool.onMouseDown({
			screen: { x: 15, y: 15 },
			client: { x: 15, y: 15 },
			world: { x: 15, y: 15 },
			event: {} as any,
		});
		assert.ok(tool.state?.selectedObjectIds.has(line.id), 'Line should be selected');

		// Switch to center_point phase
		tool.setPhase('center_point');
		assert.equal(tool.state?.phase, 'center_point');

		// Click center point
		tool.onMouseDown({
			screen: { x: 0, y: 0 },
			client: { x: 0, y: 0 },
			world: { x: 0, y: 0 },
			event: {} as any,
		});
		assert.equal(tool.state?.centerPointId, center.id);

		// Now panel should allow Apply
		const activeHtml = tool.sidebarPanel.render();
		assert.ok(!activeHtml.includes('disabled'), 'Apply should be enabled when objects and center are selected');

		// Execute pattern
		const success = tool.executeCircularPattern();
		assert.equal(success, true, 'Pattern should execute successfully');

		// Constraint should be created
		const constraints = Array.from(sketch.constraints.values());
		const cpat = constraints.find(c => c instanceof CircularPatternConstraint) as CircularPatternConstraint;
		assert.ok(cpat, 'CircularPatternConstraint should exist');
		assert.equal(cpat.quantity, 3);
		assert.equal(cpat.copies.length, 2);
	});

	it('supports selecting origin as the center point', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 0 });
		const p2 = sketch.addPoint({ x: 20, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const tool = new CircularPatternTool();

		const mockCtx: any = {
			sketch,
			viewport: {
				worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
			},
			renderer: {
				patternCheckboxPositions: new Map(),
			},
			findPointNear: (screen: any) => {
				if (screen.x === 0 && screen.y === 0) return { id: 'origin', x: 0, y: 0 };
				return null;
			},
			findLineNear: (screen: any) => {
				if (screen.x === 15 && screen.y === 0) return line;
				return null;
			},
			findCircleNear: () => null,
			findArcNear: () => null,
			findEllipseNear: () => null,
			findEllipticalArcNear: () => null,
			requestRender: () => {},
			setCursor: () => {},
			showToast: () => {},
			setTool: () => {},
		};

		tool.activate(mockCtx);

		// Select line
		tool.onMouseDown({
			screen: { x: 15, y: 0 },
			client: { x: 15, y: 0 },
			world: { x: 15, y: 0 },
			event: {} as any,
		});

		// Switch to center_point phase and click origin
		tool.setPhase('center_point');
		tool.onMouseDown({
			screen: { x: 0, y: 0 },
			client: { x: 0, y: 0 },
			world: { x: 0, y: 0 },
			event: {} as any,
		});
		assert.equal(tool.state?.centerPointId, 'origin');

		const panelHtml = tool.sidebarPanel.render();
		assert.ok(panelHtml.includes('Origin (0, 0)'), 'Panel should show Origin as label');
		assert.ok(!panelHtml.includes('disabled'), 'Apply should be enabled');

		// Execute pattern around origin
		const success = tool.executeCircularPattern();
		assert.equal(success, true, 'Pattern around origin should execute successfully');

		const constraints = Array.from(sketch.constraints.values());
		const cpat = constraints.find(c => c instanceof CircularPatternConstraint) as CircularPatternConstraint;
		assert.ok(cpat, 'CircularPatternConstraint should exist');
		assert.equal(cpat.centerPtId, 'origin');
	});

	it('supports expression for circular pattern angle and updates constraint', () => {
		const sketch = new SketchDocument();
		sketch.addParameter('myAngle', '120');
		const p1 = sketch.addPoint({ x: 10, y: 0 });
		const p2 = sketch.addPoint({ x: 20, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const tool = new CircularPatternTool();
		const mockCtx: any = {
			sketch,
			viewport: {
				worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
			},
			renderer: {
				patternCheckboxPositions: new Map(),
			},
			findPointNear: (screen: any) => {
				if (screen.x === 0 && screen.y === 0) return { id: 'origin', x: 0, y: 0 };
				return null;
			},
			findLineNear: (screen: any) => {
				if (screen.x === 15 && screen.y === 0) return line;
				return null;
			},
			findCircleNear: () => null,
			findArcNear: () => null,
			findEllipseNear: () => null,
			findEllipticalArcNear: () => null,
			requestRender: () => {},
			setCursor: () => {},
			showToast: () => {},
			setTool: () => {},
		};

		tool.activate(mockCtx);
		tool.onMouseDown({
			screen: { x: 15, y: 0 },
			client: { x: 15, y: 0 },
			world: { x: 15, y: 0 },
			event: {} as any,
		});
		tool.setPhase('center_point');
		tool.onMouseDown({
			screen: { x: 0, y: 0 },
			client: { x: 0, y: 0 },
			world: { x: 0, y: 0 },
			event: {} as any,
		});

		// Popup should be open and positioned
		assert.equal(tool.popup.isOpen(), true);

		// Enter expression in popup
		const angleInput = tool.popup.getInputElement('angle')!;
		angleInput.value = 'myAngle';
		angleInput.dispatchEvent(new Event('input'));

		assert.equal(tool.state?.angle, 120);
		assert.equal(tool.state?.angleExpression, 'myAngle');

		// Execute pattern
		tool.executeCircularPattern();
		const cpat = Array.from(sketch.constraints.values()).find(
			c => c instanceof CircularPatternConstraint
		) as CircularPatternConstraint;
		assert.ok(cpat);
		assert.equal(cpat.totalAngle, 120);
		assert.equal(cpat.totalAngleExpression, 'myAngle');

		// Modify parameter in sketch - pattern should update
		sketch.updateParameter('myAngle', 'myAngle', '180');
		assert.equal(cpat.totalAngle, 180);
	});
});

describe('RectangularPatternTool & Panel Integration', () => {
	it('updates panel card and popup, supports expression for distance and updates constraint', () => {
		const sketch = new SketchDocument();
		sketch.addParameter('gap', '25');
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 10, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const tool = new RectangularPatternTool();
		const mockCtx: any = {
			sketch,
			viewport: {
				worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
			},
			renderer: {
				patternCheckboxPositions: new Map(),
				rectangularGizmoHandles: new Map(),
			},
			findPointNear: () => null,
			findLineNear: (screen: any) => {
				if (screen.x === 5 && screen.y === 0) return line;
				return null;
			},
			findCircleNear: () => null,
			findArcNear: () => null,
			findEllipseNear: () => null,
			findEllipticalArcNear: () => null,
			requestRender: () => {},
			setCursor: () => {},
			showToast: () => {},
			setTool: () => {},
		};

		tool.activate(mockCtx);

		// Initially panel has card
		const initialHtml = tool.sidebarPanel.render();
		assert.ok(initialHtml.includes('tool-panel-card'));

		// Select line
		tool.onMouseDown({
			screen: { x: 5, y: 0 },
			client: { x: 5, y: 0 },
			world: { x: 5, y: 0 },
			event: {} as any,
		});
		assert.ok(tool.state?.selectedObjectIds.has(line.id));

		// Popup should now be open
		assert.equal(tool.popup.isOpen(), true);

		// Verify gizmo bounding box is computed and popup is placed to the right
		const bbox = tool.getGizmoBoundingBox();
		assert.ok(bbox);
		assert.ok(bbox.max.x >= 5);

		// Enter expression in popup
		const dist1Input = tool.popup.getInputElement('dist1')!;
		dist1Input.value = 'gap * 2';
		dist1Input.dispatchEvent(new Event('input'));

		assert.equal(tool.state?.distance1, 50);
		assert.equal(tool.state?.distance1Expression, 'gap * 2');

		// Execute pattern
		const success = tool.executeRectangularPattern();
		assert.equal(success, true);

		const rpat = Array.from(sketch.constraints.values()).find(
			c => c instanceof RectangularPatternConstraint
		) as RectangularPatternConstraint;
		assert.ok(rpat);
		assert.equal(rpat.distance1, 50);
		assert.equal(rpat.distance1Expression, 'gap * 2');

		// Update parameter in sketch - pattern should update
		sketch.updateParameter('gap', 'gap', '30');
		assert.equal(rpat.distance1, 60);
	});

	for (const mode of ['mirror', 'circular', 'rectangular'] as const) {
		it(`selects and transforms a spline with the ${mode} tool`, () => {
			const sketch = new SketchDocument();
			const center = sketch.addPoint({ x: 0, y: 0 }, true);
			const end = sketch.addPoint({ x: 0, y: 50 }, true);
			const axis = sketch.addLine(center.id, end.id);
			const pointIds = [
				{ x: 10, y: 5 },
				{ x: 16, y: 12 },
				{ x: 25, y: 8 },
				{ x: 28, y: 15 },
			].map(point => sketch.addPoint(point).id);
			const source =
				mode === 'rectangular'
					? sketch.addControlSpline(pointIds, true, undefined, false, [0, 0, 0, 0, 1, 1, 1, 1])
					: sketch.addFitSpline(pointIds, undefined, false, undefined, true);
			const counts = [sketch.points.size, sketch.lines.size, sketch.constraints.size];
			const tool =
				mode === 'mirror'
					? new MirrorTool()
					: mode === 'circular'
						? new CircularPatternTool()
						: new RectangularPatternTool();
			tool.activate({
				sketch,
				viewport: { worldToScreen: point => point, screenToWorld: point => point },
				renderer: { patternCheckboxPositions: new Map(), rectangularGizmoHandles: new Map() },
				findPointNear: screen => (screen.x === 0 && screen.y === 0 ? center : null),
				findLineNear: screen => (screen.x === 0 && screen.y === 25 ? axis : null),
				findCircleNear: () => null,
				findArcNear: () => null,
				findSplineNear: screen => (screen.x === 15 ? source : null),
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
				setTool: () => {},
			} as Parameters<typeof tool.activate>[0]);
			const click = (x: number, y: number) => {
				const screen = { x, y };
				tool.onMouseDown({
					screen,
					client: screen,
					world: screen,
					effectiveWorld: screen,
					effectiveScreen: screen,
					snap: null,
					raw: {} as MouseEvent,
				});
			};
			click(15, 10);
			assert.ok(tool.state?.selectedObjectIds.has(source.id));
			if (tool instanceof MirrorTool) {
				tool.setPhase('mirror_line');
				click(0, 25);
			} else if (tool instanceof CircularPatternTool) {
				tool.setPhase('center_point');
				click(0, 0);
				tool.state!.quantity = 2;
			} else {
				tool.setPhase('direction1');
				click(0, 25);
				tool.state!.quantity1 = 2;
				tool.state!.distance1 = 40;
			}
			tool.commit();
			const copy = [...sketch.splines.values()].find(spline => spline.id !== source.id);
			assert.ok(copy);
			assert.equal(copy.isClosed, source.isClosed);
			assert.equal(copy.isConstruction, source.isConstruction);
			assert.deepEqual(copy.knots, source.knots);
			const verifyGeometry = () => {
				const original = source.toGeoCurve(sketch)!.bezierSegments.flat();
				const transformed = copy.toGeoCurve(sketch)!.bezierSegments.flat();
				assert.equal(transformed.length, original.length);
				for (const [index, { x, y }] of original.entries()) {
					const expectedX = mode === 'rectangular' ? x : -x;
					const expectedY = mode === 'rectangular' ? y + 40 : mode === 'circular' ? -y : y;
					assert.ok(Math.hypot(transformed[index].x - expectedX, transformed[index].y - expectedY) < 1e-3);
				}
			};
			verifyGeometry();
			sketch.dragPoint(pointIds[1], 18, 15);
			verifyGeometry();
			if (source.splineType === 'fit') {
				const handle = sketch.lines.get(source.tangentLineIds![1])!;
				const end = sketch.points.get(handle.p2Id)!;
				sketch.dragPoint(end.id, end.x + 3, end.y + 2);
				verifyGeometry();
			}
			const constraint = [...sketch.constraints.values()].find(
				c => c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint
			);
			if (constraint instanceof CircularPatternConstraint) {
				assert.ok(sketch.updateCircularPattern(constraint.id, { suppression: true, suppressedIndices: [1] }));
			} else if (constraint instanceof RectangularPatternConstraint) {
				assert.ok(sketch.updateRectangularPattern(constraint.id, { quantity1: 1 }));
			}
			if (constraint) {
				assert.equal(sketch.splines.size, 1);
				assert.deepEqual(
					[sketch.points.size, sketch.lines.size, sketch.constraints.size],
					[counts[0], counts[1], counts[2] + 1]
				);
			}
		});
	}

	after(() => {
		(globalThis as any).document = origDoc;
	});
});
