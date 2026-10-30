import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	getConnectedLinesForPoint,
	findChamferCandidateForPoint,
	findChamferCandidateForLines,
	calculateChamferGeometry,
	commitChamferToSketch,
} from '../src/math/chamfer';
import {
	PointOnLineConstraint,
	DistanceConstraint,
	AngleConstraint,
} from '../src/solver/constraints';
import { ChamferTool } from '../src/canvas/tools/modify/chamfer';
import { dist, vec } from '../src/math/vector';

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
			getAttribute: () => 'equal_distance',
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
	};

	return () => {
		(globalThis as any).document = origDoc;
		(globalThis as any).window = origWin;
	};
}

describe('Chamfer Corner Discovery', () => {
	it('identifies a valid corner with exactly 2 lines meeting at a vertex', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const res = getConnectedLinesForPoint(sketch, p0.id);
		assert.equal(res.valid, true);
		assert.equal(res.lineIds.length, 2);
		assert.ok(res.lineIds.includes(l1.id));
		assert.ok(res.lineIds.includes(l2.id));
	});

	it('rejects an endpoint with only 1 connected line', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		sketch.addLine(p0.id, p1.id);

		const res = getConnectedLinesForPoint(sketch, p1.id);
		assert.equal(res.valid, false);
		assert.equal(res.lineIds.length, 1);
	});

	it('rejects a vertex with 3 or more lines', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		const p3 = sketch.addPoint(-100, 0);

		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);
		sketch.addLine(p0.id, p3.id);

		const res = getConnectedLinesForPoint(sketch, p0.id);
		assert.equal(res.valid, false);
		assert.equal(res.lineIds.length, 3);
	});

	it('rejects a corner connected to an arc', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const pCenter = sketch.addPoint(0, 50);

		sketch.addLine(p0.id, p1.id);
		sketch.addArc(pCenter.id, p0.id, 50, 0, Math.PI / 2);

		const res = getConnectedLinesForPoint(sketch, p0.id);
		assert.equal(res.valid, false);
	});

	it('supports coincident vertices connected by CoincidentConstraint', () => {
		const sketch = new SketchDocument();
		const pA = sketch.addPoint(0, 0);
		const pB = sketch.addPoint(0, 0);
		sketch.addCoincidentConstraint(pA.id, pB.id);

		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(pA.id, p1.id);
		const l2 = sketch.addLine(pB.id, p2.id);

		const res = getConnectedLinesForPoint(sketch, pA.id);
		assert.equal(res.valid, true);
		assert.equal(res.lineIds.length, 2);
		assert.ok(res.lineIds.includes(l1.id));
		assert.ok(res.lineIds.includes(l2.id));
	});
});

describe('Chamfer Candidate Construction', () => {
	it('builds candidate from vertex point', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id);
		assert.ok(cand);
		assert.equal(cand.vertexPointId, p0.id);
		assert.ok(Math.abs(cand.cornerAngleRad - Math.PI / 2) < 1e-4);
	});

	it('builds candidate from two lines sharing a vertex', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForLines(sketch, l1.id, l2.id);
		assert.ok(cand);
		assert.equal(cand.vertexPointId, p0.id);
	});

	it('rejects collinear lines sharing a vertex (180 deg)', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(-100, 0);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForLines(sketch, l1.id, l2.id);
		assert.equal(cand, null);
	});

	it('rejects disjoint lines not sharing a vertex', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const p3 = sketch.addPoint(0, 50);
		const p4 = sketch.addPoint(100, 50);

		const l1 = sketch.addLine(p1.id, p2.id);
		const l2 = sketch.addLine(p3.id, p4.id);

		const cand = findChamferCandidateForLines(sketch, l1.id, l2.id);
		assert.equal(cand, null);
	});
});

describe('Chamfer Geometry Calculation', () => {
	it('calculates equal distance chamfer on orthogonal corner', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		const res = calculateChamferGeometry(cand, 'equal_distance', 15, 15, 45, false);

		assert.equal(res.isValid, true);
		assert.equal(res.dist1, 15);
		assert.equal(res.dist2, 15);
		assert.ok(Math.abs(res.chamferLength - 15 * Math.SQRT2) < 1e-4);
		assert.ok(Math.abs(res.angleDeg - 45) < 1e-4);
	});

	it('calculates two distance chamfer with flip', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;

		// Without flip: line 1 gets 10, line 2 gets 20
		const res1 = calculateChamferGeometry(cand, 'two_distance', 10, 20, 45, false);
		assert.equal(res1.isValid, true);
		assert.equal(res1.dist1, 10);
		assert.equal(res1.dist2, 20);

		// With flip: line 1 gets 20, line 2 gets 10
		const res2 = calculateChamferGeometry(cand, 'two_distance', 10, 20, 45, true);
		assert.equal(res2.isValid, true);
		assert.equal(res2.dist1, 20);
		assert.equal(res2.dist2, 10);
	});

	it('calculates distance and angle chamfer on 90-degree corner', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;

		// On 90 deg corner, distance 10 mm with angle 45 deg should yield other distance 10 mm
		const res = calculateChamferGeometry(cand, 'distance_angle', 10, 10, 45, false);
		assert.equal(res.isValid, true);
		assert.equal(res.dist1, 10);
		assert.ok(Math.abs(res.dist2 - 10) < 1e-3);
		assert.ok(Math.abs(res.angleDeg - 45) < 1e-3);

		// With angle 30 deg on 90 deg corner: in right triangle with leg1 = 10, angle opposite leg2 is 30 deg
		// tan(30) = leg2 / leg1 => leg2 = 10 * tan(30) = 10 / sqrt(3) ~= 5.7735
		const res30 = calculateChamferGeometry(cand, 'distance_angle', 10, 10, 30, false);
		assert.equal(res30.isValid, true);
		assert.ok(Math.abs(res30.dist2 - 10 * Math.tan((30 * Math.PI) / 180)) < 1e-3);

		// With flip: distance 10 is applied to line 2, line 1 gets the calculated other distance
		const resFlip = calculateChamferGeometry(cand, 'distance_angle', 10, 10, 30, true);
		assert.equal(resFlip.isValid, true);
		assert.equal(resFlip.dist2, 10);
		assert.ok(Math.abs(resFlip.dist1 - 10 * Math.tan((30 * Math.PI) / 180)) < 1e-3);
	});

	it('invalidates distance larger than line length', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(20, 0);
		const p2 = sketch.addPoint(0, 20);
		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		const res = calculateChamferGeometry(cand, 'equal_distance', 25, 25, 45, false);
		assert.equal(res.isValid, false);
		assert.ok(res.errorMessage?.includes('Distance too large'));
	});

	it('invalidates angle that exceeds corner geometric capability', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100); // 90 degree corner
		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		// 90 deg corner + 100 deg angle >= 180 deg -> impossible triangle
		const res = calculateChamferGeometry(cand, 'distance_angle', 10, 10, 100, false);
		assert.equal(res.isValid, false);
		assert.ok(res.errorMessage?.includes('Angle too large'));
	});
});

describe('Chamfer Commit and Document Integration', () => {
	it('commits equal distance chamfer: vertex remains, lines shortened with PointOnLine and Distance constraints', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		const result = commitChamferToSketch(sketch, cand, 'equal_distance', 15, 15, 45, false);

		assert.ok(result);
		// 1. Original vertex point remains in sketch
		assert.ok(sketch.points.has(p0.id));

		// 2. Chamfer line exists
		const chamferLine = sketch.lines.get(result.chamferLineId);
		assert.ok(chamferLine);

		// 3. Original lines shortened: endpoint replaced by cut points
		const updatedL1 = sketch.lines.get(l1.id)!;
		const updatedL2 = sketch.lines.get(l2.id)!;
		assert.ok(updatedL1.p1Id !== p0.id && updatedL1.p2Id !== p0.id);
		assert.ok(updatedL2.p1Id !== p0.id && updatedL2.p2Id !== p0.id);

		// 4. PointOnLine constraints added between p0 and shortened lines
		const polConstraints = [...sketch.constraints.values()].filter(
			c => c instanceof PointOnLineConstraint
		) as PointOnLineConstraint[];
		assert.equal(polConstraints.length, 2);
		assert.ok(polConstraints.some(c => c.pointId === p0.id && (c.lineP1Id === updatedL1.p1Id || c.lineP2Id === updatedL1.p1Id)));
		assert.ok(polConstraints.some(c => c.pointId === p0.id && (c.lineP1Id === updatedL2.p1Id || c.lineP2Id === updatedL2.p1Id)));

		// 5. Distance constraints created at 10px and -10px
		const distConstraints = [...sketch.constraints.values()].filter(
			c => c instanceof DistanceConstraint
		) as DistanceConstraint[];
		assert.equal(distConstraints.length, 2);
		const offsets = distConstraints.map(c => c.offset).sort((a, b) => (a ?? 0) - (b ?? 0));
		assert.equal(offsets[0], -10);
		assert.equal(offsets[1], 10);
		for (const dc of distConstraints) {
			assert.equal(dc.targetDistance, 15);
		}

		// 6. Solver solves without error
		const solveRes = sketch.solve();
		assert.ok(solveRes.finalError < 1e-4);
	});

	it('commits two distance chamfer with distinct distances', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		const result = commitChamferToSketch(sketch, cand, 'two_distance', 12, 24, 45, false);
		assert.ok(result);

		const distConstraints = [...sketch.constraints.values()].filter(
			c => c instanceof DistanceConstraint
		) as DistanceConstraint[];
		assert.equal(distConstraints.length, 2);
		const distValues = distConstraints.map(c => c.targetDistance).sort((a, b) => a - b);
		assert.equal(distValues[0], 12);
		assert.equal(distValues[1], 24);
	});

	it('commits distance and angle chamfer: creates Distance and Angle constraints', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		const result = commitChamferToSketch(sketch, cand, 'distance_angle', 10, 10, 45, false);
		assert.ok(result);

		// Must have 1 DistanceConstraint at offset 10 and 1 AngleConstraint
		const distConstraints = [...sketch.constraints.values()].filter(
			c => c instanceof DistanceConstraint
		) as DistanceConstraint[];
		assert.equal(distConstraints.length, 1);
		assert.equal(distConstraints[0].targetDistance, 10);
		assert.equal(distConstraints[0].offset, 10);

		const angleConstraints = [...sketch.constraints.values()].filter(
			c => c instanceof AngleConstraint
		) as AngleConstraint[];
		assert.equal(angleConstraints.length, 1);
		assert.ok(Math.abs(angleConstraints[0].targetAngle - 45) < 1e-2);

		// Solver converges
		const solveRes = sketch.solve();
		assert.ok(solveRes.finalError < 1e-4);
	});

	it('undo and redo cleanly restore sketch before and after chamfer', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const initialLineCount = sketch.lines.size;
		const initialConstraintCount = sketch.constraints.size;

		const cand = findChamferCandidateForPoint(sketch, p0.id)!;
		commitChamferToSketch(sketch, cand, 'equal_distance', 10, 10, 45, false);

		assert.equal(sketch.lines.size, initialLineCount + 1);

		// Undo
		sketch.undo();
		assert.equal(sketch.lines.size, initialLineCount);
		assert.equal(sketch.constraints.size, initialConstraintCount);
		const restoredL1 = sketch.lines.get(l1.id)!;
		const restoredL2 = sketch.lines.get(l2.id)!;
		assert.ok(restoredL1.p1Id === p0.id || restoredL1.p2Id === p0.id);
		assert.ok(restoredL2.p1Id === p0.id || restoredL2.p2Id === p0.id);

		// Redo
		sketch.redo();
		assert.equal(sketch.lines.size, initialLineCount + 1);
	});
});

describe('ChamferTool UI and Workflow', () => {
	it('selects candidate and opens popup when vertex point clicked', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const p2 = sketch.addPoint(0, 100);
			sketch.addLine(p0.id, p1.id);
			sketch.addLine(p0.id, p2.id);

			const tool = new ChamferTool();
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
					screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
				},
				renderer: {
					chamferGizmoHandles: [],
				},
				findPointNear: () => p0,
				findLineNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			tool.activate(mockCtx);
			assert.equal(tool.isBusy(), false);

			tool.onMouseDown({
				screen: { x: 400, y: 300 },
				world: { x: 0, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			assert.ok(tool.candidate);
			assert.equal(tool.candidate.vertexPointId, p0.id);
			assert.equal(tool.isBusy(), true);

			tool.deactivate();
		} finally {
			cleanupDoc();
		}
	});

	it('selects two lines sequentially to create chamfer candidate', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const p2 = sketch.addPoint(0, 100);
			const l1 = sketch.addLine(p0.id, p1.id);
			const l2 = sketch.addLine(p0.id, p2.id);

			const tool = new ChamferTool();
			let currentHitLine: any = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
					screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
				},
				renderer: {
					chamferGizmoHandles: [],
				},
				findPointNear: () => null,
				findLineNear: () => currentHitLine,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			tool.activate(mockCtx);

			// Click first line
			currentHitLine = l1;
			tool.onMouseDown({
				screen: { x: 450, y: 300 },
				world: { x: 50, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});
			assert.equal(tool.firstLine?.id, l1.id);
			assert.equal(tool.candidate, null);

			// Click second line
			currentHitLine = l2;
			tool.onMouseDown({
				screen: { x: 400, y: 250 },
				world: { x: 0, y: 50 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});
			assert.equal(tool.firstLine, null);
			assert.ok(tool.candidate);
			assert.equal(tool.candidate.vertexPointId, p0.id);

			tool.deactivate();
		} finally {
			cleanupDoc();
		}
	});

	it('allows mode changes and commits via tool.commit()', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint(0, 0);
			const p1 = sketch.addPoint(100, 0);
			const p2 = sketch.addPoint(0, 100);
			sketch.addLine(p0.id, p1.id);
			sketch.addLine(p0.id, p2.id);

			const tool = new ChamferTool();
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
					screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
				},
				renderer: {
					chamferGizmoHandles: [],
				},
				findPointNear: () => p0,
				findLineNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			tool.activate(mockCtx);
			tool.onMouseDown({
				screen: { x: 400, y: 300 },
				world: { x: 0, y: 0 },
				raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
			});

			tool.setMode('two_distance');
			assert.equal(tool.mode, 'two_distance');

			tool.commit();
			assert.equal(tool.candidate, null);
			assert.equal(tool.isBusy(), false);

			// Verify chamfer committed
			assert.equal(sketch.lines.size, 3);

			tool.deactivate();
		} finally {
			cleanupDoc();
		}
	});

	describe('Chamfer Gizmo Handles and Interaction', () => {
		it('Mode 1: dragging gizmo handle along angle bisector updates distance proportionally to cos(theta/2)', () => {
			const cleanupDoc = setupMockDocument();
			try {
				const sketch = new SketchDocument();
				const p0 = sketch.addPoint(0, 0);
				const p1 = sketch.addPoint(100, 0);
				const p2 = sketch.addPoint(0, 100);
				sketch.addLine(p0.id, p1.id);
				sketch.addLine(p0.id, p2.id);

				const cand = findChamferCandidateForPoint(sketch, p0.id)!;
				cand.result = calculateChamferGeometry(cand, 'equal_distance', 20, 20, 45, false);

				const tool = new ChamferTool();
				let renders = 0;
				const mockCtx: any = {
					sketch,
					viewport: {
						worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
						screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
					},
					renderer: {
						chamferGizmoHandles: [
							{
								type: 'dist1',
								screenX: 410,
								screenY: 290,
								worldPos: { x: 10, y: 10 },
								currentValue: 20,
							},
						],
					},
					findPointNear: () => p0,
					findLineNear: () => null,
					requestRender: () => { renders++; },
					showToast: () => {},
					setCursor: () => {},
				};
				tool.activate(mockCtx);
				tool.candidate = cand;
				tool.dist1 = 20;
				tool.dist2 = 20;

				// Start gizmo drag on Mode 1 bisector handle
				(tool as any).gizmoDragState = {
					handle: mockCtx.renderer.chamferGizmoHandles[0],
					startMouseWorld: { x: 10, y: 10 },
					startValue: 20,
				};

				// Drag mouse along bisector by delta = 10 * √2 ≈ 14.14 (from 10,10 to 20,20)
				// For 90 deg corner, cos(45 deg) = 1/√2, so deltaD = (10 * √2) / (1/√2) = 20
				// New dist should be 20 + 20 = 40
				tool.onMouseMove({
					screen: { x: 420, y: 280 },
					world: { x: 20, y: 20 },
					raw: {} as any,
				});

				assert.equal(tool.dist1, 40);
				assert.equal(tool.dist2, 40);

				tool.deactivate();
			} finally {
				cleanupDoc();
			}
		});

		it('Mode 2: dragging dist1 and dist2 gizmo handles updates independent distances', () => {
			const cleanupDoc = setupMockDocument();
			try {
				const sketch = new SketchDocument();
				const p0 = sketch.addPoint(0, 0);
				const p1 = sketch.addPoint(100, 0);
				const p2 = sketch.addPoint(0, 100);
				sketch.addLine(p0.id, p1.id);
				sketch.addLine(p0.id, p2.id);

				const cand = findChamferCandidateForPoint(sketch, p0.id)!;
				cand.result = calculateChamferGeometry(cand, 'two_distance', 15, 25, 45, false);

				const tool = new ChamferTool();
				tool.mode = 'two_distance';
				const mockCtx: any = {
					sketch,
					viewport: {
						worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
						screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
					},
					renderer: {
						chamferGizmoHandles: [],
					},
					findPointNear: () => p0,
					findLineNear: () => null,
					requestRender: () => {},
					showToast: () => {},
					setCursor: () => {},
				};
				tool.activate(mockCtx);
				tool.candidate = cand;
				tool.dist1 = 15;
				tool.dist2 = 25;

				// Drag dist1 handle along line 1 (x-axis)
				(tool as any).gizmoDragState = {
					handle: { type: 'dist1', currentValue: 15, dir: cand.dir1 },
					startMouseWorld: { x: 15, y: 0 },
					startValue: 15,
				};
				tool.onMouseMove({
					screen: { x: 425, y: 300 },
					world: { x: 25, y: 0 },
					raw: {} as any,
				});
				assert.equal(tool.dist1, 25);
				assert.equal(tool.dist2, 25);

				// Drag dist2 handle along line 2 (y-axis)
				(tool as any).gizmoDragState = {
					handle: { type: 'dist2', currentValue: 25, dir: cand.dir2 },
					startMouseWorld: { x: 0, y: 25 },
					startValue: 25,
				};
				tool.onMouseMove({
					screen: { x: 400, y: 265 },
					world: { x: 0, y: 35 },
					raw: {} as any,
				});
				assert.equal(tool.dist1, 25);
				assert.equal(tool.dist2, 35);

				tool.deactivate();
			} finally {
				cleanupDoc();
			}
		});

		it('Mode 3: dragging angle circle handle updates chamfer angle', () => {
			const cleanupDoc = setupMockDocument();
			try {
				const sketch = new SketchDocument();
				const p0 = sketch.addPoint(0, 0);
				const p1 = sketch.addPoint(100, 0);
				const p2 = sketch.addPoint(0, 100);
				sketch.addLine(p0.id, p1.id);
				sketch.addLine(p0.id, p2.id);

				const cand = findChamferCandidateForPoint(sketch, p0.id)!;
				cand.result = calculateChamferGeometry(cand, 'distance_angle', 20, 20, 45, false);

				const tool = new ChamferTool();
				tool.mode = 'distance_angle';
				const mockCtx: any = {
					sketch,
					viewport: {
						worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
						screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
					},
					renderer: {
						chamferGizmoHandles: [],
					},
					findPointNear: () => p0,
					findLineNear: () => null,
					requestRender: () => {},
					showToast: () => {},
					setCursor: () => {},
				};
				tool.activate(mockCtx);
				tool.candidate = cand;
				tool.dist1 = 20;
				tool.angleDeg = 45;

				// Reference vertex is T1 = (20, 0). Vector to V is (-1, 0).
				// Start drag on angle handle
				(tool as any).gizmoDragState = {
					handle: { type: 'angle', currentValue: 45, worldPos: cand.result.t1 },
					startMouseWorld: { x: 0, y: 20 },
					startValue: 45,
				};

				// Drag to (20, 20): from T1(20,0) to mouse(20,20) is (0, 20), perpendicular to line 1.
				// Angle between (-1, 0) and (0, 1) is 90 deg. Corner angle is 90 deg, so clamped to max 89 deg.
				tool.onMouseMove({
					screen: { x: 420, y: 280 },
					world: { x: 20, y: 20 },
					raw: {} as any,
				});
				assert.equal(tool.angleDeg, 89);

				// Drag to (10, 10): from T1(20,0) to mouse(10,10) is (-10, 10).
				// Angle with (-1, 0) is 45 deg.
				tool.onMouseMove({
					screen: { x: 410, y: 290 },
					world: { x: 10, y: 10 },
					raw: {} as any,
				});
				assert.equal(tool.angleDeg, 45);

				// Drag towards line 1: mouse at (10, 0) is parallel to (-1, 0) -> angle should reach 0
				tool.onMouseMove({
					screen: { x: 410, y: 300 },
					world: { x: 10, y: 0 },
					raw: {} as any,
				});
				assert.equal(tool.angleDeg, 0);

				// Drag past line 1 to outside the corner (y = -10): angle stays at 0 and does NOT increase
				tool.onMouseMove({
					screen: { x: 410, y: 310 },
					world: { x: 10, y: -10 },
					raw: {} as any,
				});
				assert.equal(tool.angleDeg, 0);

				tool.deactivate();

				// Test constrained triangle demo top vertex (corner angle ~64 deg)
				// Triangle with pA(-50, 0), pB(50, 0), pC(0, 80). Corner angle at pC is ~64 deg.
				// Angle at A can reach 180 - 64 - 1 = 115 deg (not restricted to 63 deg!)
				const triSketch = new SketchDocument();
				const pA = triSketch.addPoint(-50, 0);
				const pB = triSketch.addPoint(50, 0);
				const pC = triSketch.addPoint(0, 80);
				triSketch.addLine(pA.id, pC.id);
				triSketch.addLine(pB.id, pC.id);

				const triCand = findChamferCandidateForPoint(triSketch, pC.id)!;
				triCand.result = calculateChamferGeometry(triCand, 'distance_angle', 10, 10, 45, false);

				const triTool = new ChamferTool();
				triTool.mode = 'distance_angle';
				triTool.activate({
					sketch: triSketch,
					viewport: mockCtx.viewport,
					renderer: mockCtx.renderer,
					findPointNear: () => null,
					findLineNear: () => null,
					requestRender: () => {},
					showToast: () => {},
					setCursor: () => {},
				});
				triTool.candidate = triCand;
				triTool.dist1 = 10;
				triTool.angleDeg = 45;

				(triTool as any).gizmoDragState = {
					handle: { type: 'angle', currentValue: 45, worldPos: triCand.result.t1 },
					startMouseWorld: { x: triCand.result.t2.x, y: triCand.result.t2.y },
					startValue: 45,
				};

				const refVertex = triCand.result.t1;
				// Perpendicular to refDir into the corner (90 deg angle)
				triTool.onMouseMove({
					screen: { x: 400, y: 300 },
					world: { x: refVertex.x + 80, y: refVertex.y - 50 },
					raw: {} as any,
				});
				assert.equal(triTool.angleDeg, 90);
				assert.ok(triTool.angleDeg > 63, `Expected angleDeg > 63, got ${triTool.angleDeg}`);

				triTool.deactivate();
			} finally {
				cleanupDoc();
			}
		});

		it('sets crosshair in selection mode, default when candidate is active, and grab/grabbing on gizmos', () => {
			const cleanupDoc = setupMockDocument();
			try {
				const sketch = new SketchDocument();
				const p0 = sketch.addPoint(0, 0);
				const p1 = sketch.addPoint(100, 0);
				const p2 = sketch.addPoint(0, 100);
				sketch.addLine(p0.id, p1.id);
				sketch.addLine(p0.id, p2.id);

				const tool = new ChamferTool();
				let currentCursor = '';
				const mockCtx: any = {
					sketch,
					viewport: {
						worldToScreen: (x: number, y: number) => ({ x: x + 400, y: 300 - y }),
						screenToWorld: (x: number, y: number) => ({ x: x - 400, y: 300 - y }),
					},
					renderer: {
						chamferGizmoHandles: [] as any[],
					},
					findPointNear: (s: any) => (s.x === 400 && s.y === 300 ? p0 : null),
					findLineNear: () => null,
					requestRender: () => {},
					showToast: () => {},
					setCursor: (c: string) => {
						currentCursor = c;
					},
				};
				tool.activate(mockCtx);

				// 1. Initial selection mode: onMouseMove sets crosshair
				tool.onMouseMove({ screen: { x: 10, y: 10 }, world: { x: 0, y: 0 }, raw: {} as any });
				assert.equal(currentCursor, 'crosshair');

				// 2. Select corner: cursor becomes default
				tool.onMouseDown({
					screen: { x: 400, y: 300 },
					world: { x: 0, y: 0 },
					raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
				});
				assert.ok(tool.candidate);
				assert.equal(currentCursor, 'default');

				// Gizmo handles now present in renderer
				mockCtx.renderer.chamferGizmoHandles = [{ screenX: 420, screenY: 300, currentValue: 10, type: 'dist1' }];

				// 3. Move mouse over canvas away from gizmo: stays default
				tool.onMouseMove({ screen: { x: 50, y: 50 }, world: { x: 0, y: 0 }, raw: {} as any });
				assert.equal(currentCursor, 'default');

				// 4. Move mouse over gizmo handle: becomes grab
				tool.onMouseMove({ screen: { x: 420, y: 300 }, world: { x: 20, y: 0 }, raw: {} as any });
				assert.equal(currentCursor, 'grab');

				// 5. Drag gizmo handle: becomes grabbing
				tool.onMouseDown({
					screen: { x: 420, y: 300 },
					world: { x: 20, y: 0 },
					raw: { preventDefault: () => {}, stopPropagation: () => {} } as any,
				});
				tool.onMouseMove({ screen: { x: 430, y: 300 }, world: { x: 30, y: 0 }, raw: {} as any });
				assert.equal(currentCursor, 'grabbing');

				// 6. Release mouse: returns to default away from gizmo
				tool.onMouseUp({} as any);
				tool.onMouseMove({ screen: { x: 50, y: 50 }, world: { x: 0, y: 0 }, raw: {} as any });
				assert.equal(currentCursor, 'default');

				// 7. Cancel chamfer: returns to crosshair
				tool.cancel();
				assert.equal(currentCursor, 'crosshair');

				tool.deactivate();
			} finally {
				cleanupDoc();
			}
		});
	});
});
