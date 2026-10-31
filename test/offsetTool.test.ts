import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { OffsetTool } from '../src/canvas/tools/modify/offset';

function setupMockDocument() {
	const origDoc = (globalThis as any).document;
	const origWin = (globalThis as any).window;
	const makeEl = () => {
		const listeners = new Map<string, Function[]>();
		const el: any = {
			style: {},
			classList: {
				add: () => {},
				remove: () => {},
				toggle: () => {},
			},
			addEventListener: (ev: string, fn: Function) => {
				const list = listeners.get(ev) || [];
				list.push(fn);
				listeners.set(ev, list);
			},
			removeEventListener: () => {},
			appendChild: () => {},
			focus: () => {},
			select: () => {},
			blur: () => {},
			querySelector: () => makeEl(),
			querySelectorAll: () => [],
			getAttribute: () => 'one_side',
			setAttribute: () => {},
			value: '10.0',
			checked: false,
		};
		return el;
	};

	(globalThis as any).document = {
		createElement: (_tag: string) => makeEl(),
		createElementNS: (_ns: string, _tag: string) => ({
			setAttribute: () => {},
			setAttributeNS: () => {},
			style: {},
			appendChild: () => {},
			innerHTML: '',
			classList: {
				add: () => {},
				remove: () => {},
			},
		}),
		body: {
			appendChild: () => {},
			removeChild: () => {},
		},
	};
	(globalThis as any).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		innerWidth: 1024,
		innerHeight: 768,
	};

	return () => {
		(globalThis as any).document = origDoc;
		(globalThis as any).window = origWin;
	};
}

describe('OffsetTool UI and Workflow', () => {
	it('activates with correct default parameters and can switch directions', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const tool = new OffsetTool();

			assert.equal(tool.direction, 'one_side');
			assert.equal(tool.chainSelection, true);
			assert.equal(tool.dist1, 10.0);
			assert.equal(tool.dist2, 10.0);
			assert.equal(tool.flip, false);

			let directionChangedTo = '';
			tool.onDirectionChange = dir => {
				directionChangedTo = dir;
			};

			tool.setDirection('two_sides');
			assert.equal(tool.direction, 'two_sides');
			assert.equal(directionChangedTo, 'two_sides');

			tool.setDirection('symmetric');
			assert.equal(tool.direction, 'symmetric');
			assert.equal(directionChangedTo, 'symmetric');
		} finally {
			cleanup();
		}
	});

	it('selects chain and filters highlight based on valid continuations', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(50, 0);
			const p2 = sketch.addPoint(50, 50);
			const pFar1 = sketch.addPoint(200, 200);
			const pFar2 = sketch.addPoint(250, 200);

			const l0 = sketch.addLine(p0.id, p1.id);
			const l1 = sketch.addLine(p1.id, p2.id);
			const lFar = sketch.addLine(pFar1.id, pFar2.id);

			const tool = new OffsetTool();
			tool.setChainSelection(false); // test single element chain step by step

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: (screen: any) => {
					if (screen.x === 25) return l0;
					if (screen.x === 50) return l1;
					if (screen.x === 225) return lFar;
					return null;
				},
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// Initially, any primitive can be highlighted
			assert.equal(tool.canHighlight({ type: 'line', id: l0.id }), true);
			assert.equal(tool.canHighlight({ type: 'line', id: lFar.id }), true);

			// Click l0 to start chain
			tool.onMouseDown({
				screen: { x: 25, y: 0 },
				world: { x: 25, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.chain);
			assert.equal(tool.chain.items.length, 1);
			assert.equal(tool.chain.items[0].id, l0.id);

			// Now only connected primitives can be highlighted (l1 connects at p1; lFar does not)
			assert.equal(tool.canHighlight({ type: 'line', id: l1.id }), true);
			assert.equal(tool.canHighlight({ type: 'line', id: lFar.id }), false);

			// Click l1 to extend chain
			tool.onMouseDown({
				screen: { x: 50, y: 25 },
				world: { x: 50, y: 25 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.equal(tool.chain.items.length, 2);
			assert.equal(tool.chain.items[1].id, l1.id);
		} finally {
			cleanup();
		}
	});

	it('auto-traverses connected primitives when chainSelection is true', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(50, 0);
			const p2 = sketch.addPoint(50, 50);
			const p3 = sketch.addPoint(0, 50);

			const l0 = sketch.addLine(p0.id, p1.id);
			sketch.addLine(p1.id, p2.id);
			sketch.addLine(p2.id, p3.id);
			sketch.addLine(p3.id, p0.id); // creates a closed 4-sided loop

			const tool = new OffsetTool();
			tool.setChainSelection(true);

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// Clicking one line of the loop traverses the entire loop automatically
			tool.onMouseDown({
				screen: { x: 25, y: 0 },
				world: { x: 25, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.chain);
			assert.equal(tool.chain.items.length, 4);
			assert.equal(tool.chain.isClosed, true);
		} finally {
			cleanup();
		}
	});

	it('handles gizmo drag to change offset distance', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const l0 = sketch.addLine(p0.id, p1.id);

			const tool = new OffsetTool();
			tool.dist1 = 10;

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [
						{
							type: 'dist1',
							sideIndex: 0,
							arrowTipScreen: { x: 50, y: 10 },
							arrowTipWorld: { x: 50, y: 10 },
							baseWorld: { x: 50, y: 0 },
							normal: { x: 0, y: 1 },
							currentValue: 10,
							screenX: 50,
							screenY: 10,
						},
					],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// First select line
			tool.onMouseDown({
				screen: { x: 10, y: 0 },
				world: { x: 10, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			// Now click the gizmo handle at (50, 10)
			tool.onMouseDown({
				screen: { x: 50, y: 10 },
				world: { x: 50, y: 10 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.gizmoDragState);

			// Drag gizmo to (50, 25)
			tool.onMouseMove({
				screen: { x: 50, y: 25 },
				world: { x: 50, y: 25 },
				raw: {} as any,
			});

			assert.ok(tool.dist1 > 20);

			// Release gizmo
			tool.onMouseUp({
				screen: { x: 50, y: 25 },
				world: { x: 50, y: 25 },
				raw: {} as any,
			});

			assert.equal(tool.gizmoDragState, null);
		} finally {
			cleanup();
		}
	});

	it('commits offset geometry and constraints into the sketch document', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const l0 = sketch.addLine(p0.id, p1.id);

			const tool = new OffsetTool();
			tool.dist1 = 15;

			let toastMsg = '';
			let switchedTool = '';
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				setTool: (t: string) => {
					switchedTool = t;
				},
				showToast: (msg: string) => {
					toastMsg = msg;
				},
			};

			tool.activate(mockCtx);

			// Select line
			tool.onMouseDown({
				screen: { x: 20, y: 0 },
				world: { x: 20, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.chain);
			assert.ok(tool.geomResult?.isValid);

			// Commit
			tool.commit();

			assert.equal(toastMsg, 'Offset created');
			assert.equal(switchedTool, 'select');
			assert.equal(tool.chain, null);
			// 1 original line + 1 new offset line = 2 lines
			assert.equal(sketch.lines.size, 2);
			// 1 OffsetConstraint (handles distance and parallelism without overconstraining)
			assert.equal(sketch.constraints.size, 1);
		} finally {
			cleanup();
		}
	});

	it('supports selection toggle: clicking an already selected primitive toggles it off', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(50, 0);
			const p2 = sketch.addPoint(50, 50);
			const p3 = sketch.addPoint(0, 50);
			const l0 = sketch.addLine(p0.id, p1.id);
			sketch.addLine(p1.id, p2.id);
			sketch.addLine(p2.id, p3.id);
			sketch.addLine(p3.id, p0.id);

			const tool = new OffsetTool();
			tool.setChainSelection(true);

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// First click: select loop
			tool.onMouseDown({
				screen: { x: 25, y: 0 },
				world: { x: 25, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});
			assert.ok(tool.chain);
			assert.equal(tool.chain.items.length, 4);

			// Hover over selected line should be allowed (canHighlight = true)
			assert.equal(tool.canHighlight({ type: 'line', id: l0.id }), true);

			// Second click on the same line: toggles selection off
			tool.onMouseDown({
				screen: { x: 25, y: 0 },
				world: { x: 25, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});
			assert.equal(tool.chain, null);
			assert.equal(tool.geomResult, null);
		} finally {
			cleanup();
		}
	});

	it('correctly commits offset for constrained triangle demo without deformation', async () => {
		const cleanup = setupMockDocument();
		try {
			const { loadTrianglePreset } = await import('../src/model/presets');
			const sketch = new SketchDocument();
			loadTrianglePreset(sketch);

			const firstLine = Array.from(sketch.lines.values())[0];
			const tool = new OffsetTool();
			tool.dist1 = 10;
			tool.setChainSelection(true);

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => firstLine,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// Select triangle loop
			tool.onMouseDown({
				screen: { x: 0, y: 0 },
				world: { x: 0, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.chain);
			assert.equal(tool.chain.items.length, 3);
			assert.ok(tool.geomResult?.isValid);

			const expectedP0 = tool.geomResult.sides[0].primitives[0].p1!;
			const expectedP1 = tool.geomResult.sides[0].primitives[0].p2!;

			// Commit offset
			tool.commit();

			// Verify created lines
			const createdLines = Array.from(sketch.lines.values()).slice(3);
			assert.equal(createdLines.length, 3);

			const ptA = sketch.points.get(createdLines[0].p1Id)!;
			const ptB = sketch.points.get(createdLines[0].p2Id)!;

			// Coordinates should match preview exactly without shrinking or shifting sideways
			assert.ok(Math.abs(ptA.x - expectedP0.x) < 0.01, `ptA.x was ${ptA.x}, expected ${expectedP0.x}`);
			assert.ok(Math.abs(ptA.y - expectedP0.y) < 0.01, `ptA.y was ${ptA.y}, expected ${expectedP0.y}`);
			assert.ok(Math.abs(ptB.x - expectedP1.x) < 0.01, `ptB.x was ${ptB.x}, expected ${expectedP1.x}`);
			assert.ok(Math.abs(ptB.y - expectedP1.y) < 0.01, `ptB.y was ${ptB.y}, expected ${expectedP1.y}`);

			// Verify that sketch.solve() retains the exact symmetrical offset shape
			sketch.solve();
			assert.ok(Math.abs(ptA.x - expectedP0.x) < 0.01);
			assert.ok(Math.abs(ptA.y - expectedP0.y) < 0.01);
		} finally {
			cleanup();
		}
	});

	it('allows negative distance input acting analogous to flip', () => {
		const cleanup = setupMockDocument();
		try {
			const tool = new OffsetTool();
			const popup = tool.popup;

			// Set negative distance in input
			(popup as any).dist1Input.value = '-15.0';
			const params = popup.getParams();
			assert.equal(params.dist1, -15.0);

			// Recalculate with negative distance on a single line
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const l0 = sketch.addLine(p0.id, p1.id);

			tool.dist1 = -15;
			tool.flip = false;

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);
			tool.onMouseDown({
				screen: { x: 50, y: 0 },
				world: { x: 50, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.geomResult?.isValid);
			// Left normal for horizontal line is (0, 1). Negative distance offsets to y = -15
			const offLine = tool.geomResult.sides[0].primitives[0];
			assert.equal(offLine.p1!.y, -15);

			// Flip with negative distance: (-1) * (-15) = +15
			tool.flip = true;
			tool.recalculate();
			const flippedOffLine = tool.geomResult.sides[0].primitives[0];
			assert.equal(flippedOffLine.p1!.y, 15);
		} finally {
			cleanup();
		}
	});

	it('ensures modifying offset distance changes ONLY offset geometry and does not move the original geometry', async () => {
		const cleanup = setupMockDocument();
		try {
			const { loadTrianglePreset } = await import('../src/model/presets');
			const sketch = new SketchDocument();
			loadTrianglePreset(sketch);

			// Remove fixed constraint so original triangle is not artificially locked in world space
			for (const c of Array.from(sketch.constraints.values())) {
				if (c.type === 'fixed') sketch.removeConstraint(c.id);
			}

			const firstLine = Array.from(sketch.lines.values())[0];
			const tool = new OffsetTool();
			tool.dist1 = 10;
			tool.setChainSelection(true);

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
				},
				renderer: { offsetGizmoHandles: [] },
				findLineNear: () => firstLine,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);
			tool.onMouseDown({
				screen: { x: 0, y: 0 },
				world: { x: 0, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			tool.commit();

			// Original triangle vertices before changing offset distance
			const pA = sketch.points.get('Point-1')!;
			const pB = sketch.points.get('Point-2')!;
			const pC = sketch.points.get('Point-3')!;
			const origAx = pA.x, origAy = pA.y;
			const origBx = pB.x, origBy = pB.y;
			const origCx = pC.x, origCy = pC.y;

			// Find offset constraint
			const offConstraint = Array.from(sketch.constraints.values()).find(c => c.type === 'offset')!;
			assert.ok(offConstraint);

			// Change offset distance from 10 to 30
			sketch.updateDimensionalConstraint(offConstraint.id, 30);

			// Verify original geometry did not move
			assert.ok(Math.abs(pA.x - origAx) < 1e-4, `pA.x moved: ${pA.x} vs ${origAx}`);
			assert.ok(Math.abs(pA.y - origAy) < 1e-4, `pA.y moved: ${pA.y} vs ${origAy}`);
			assert.ok(Math.abs(pB.x - origBx) < 1e-4, `pB.x moved: ${pB.x} vs ${origBx}`);
			assert.ok(Math.abs(pB.y - origBy) < 1e-4, `pB.y moved: ${pB.y} vs ${origBy}`);
			assert.ok(Math.abs(pC.x - origCx) < 1e-4, `pC.x moved: ${pC.x} vs ${origCy}`);
			assert.ok(Math.abs(pC.y - origCy) < 1e-4, `pC.y moved: ${pC.y} vs ${origCy}`);

			// Verify offset vertices expanded to distance 30
			const offBottom = sketch.points.get('Point-4')!;
			assert.ok(Math.abs(offBottom.y - (-30)) < 0.1, `Offset bottom y was ${offBottom.y}, expected -30`);
		} finally {
			cleanup();
		}
	});

	it('calculates popup position relative to gizmo bounding box (offset=0 and distance gizmos)', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const l0 = sketch.addLine(p0.id, p1.id);

			const tool = new OffsetTool();
			tool.dist1 = 20;

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x: x + 200, y: 150 - y }),
					screenToWorld: (x: number, y: number) => ({ x: x - 200, y: 150 - y }),
				},
				renderer: {
					offsetGizmoHandles: [],
				},
				findLineNear: () => l0,
				findArcNear: () => null,
				findCircleNear: () => null,
				findEllipseNear: () => null,
				findEllipticalArcNear: () => null,
				findSplineNear: () => null,
				requestRender: () => {},
				setCursor: () => {},
				showToast: () => {},
			};

			tool.activate(mockCtx);

			// Click line to start offset
			tool.onMouseDown({
				screen: { x: 250, y: 150 },
				world: { x: 50, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			const bbox = tool.getGizmoBoundingBox()!;
			assert.ok(bbox);

			// Anchor is at (50, 0) => screen (250, 150)
			// Normal for horizontal line is (0, 1) => target at (50, 20) => screen (250, 130)
			assert.equal(bbox.minX, 250);
			assert.equal(bbox.maxX, 250);
			assert.equal(bbox.minY, 130);
			assert.equal(bbox.maxY, 150);

			// Test two_sides mode: dist1 = 20, dist2 = 30
			tool.direction = 'two_sides';
			tool.dist1 = 20;
			tool.dist2 = 30;
			tool.recalculate();

			const bbox2 = tool.getGizmoBoundingBox()!;
			assert.ok(bbox2);
			// Target 1: (50, 20) => screen (250, 130)
			// Target 2: (50, -30) => screen (250, 180)
			// Anchor: (50, 0) => screen (250, 150)
			assert.equal(bbox2.minY, 130);
			assert.equal(bbox2.maxY, 180);
			assert.equal(bbox2.minX, 250);
			assert.equal(bbox2.maxX, 250);

			// Verify popup position relative to bbox2
			tool.popup.updatePosition(bbox2);
			// left should be maxX + 100 = 250 + 100 = 350
			const container = (tool.popup as any).container;
			assert.equal(container.style.left, '350px');
		} finally {
			cleanup();
		}
	});
});
