import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
	AngleConstraint,
	SymmetryConstraint,
	MidpointConstraint,
	CollinearConstraint,
	TangentLineCircleConstraint,
	EqualRadiusConstraint,
} from '../src/solver/constraints';
import { serializeConstraint, deserializeConstraint } from '../src/solver/constraints/serialization';
import { determineDistanceOrientation, DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { vec } from '../src/math/vector';

describe('Origin & Axis Constraints', () => {
	describe('Origin Distance & Coincident Constraints', () => {
		it('constrains a point coincident to (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 50, y: 80 });

			const c = sketch.addOriginCoincidentConstraint(p.id);
			assert.ok(c, 'Constraint should be created');
			assert.equal(c.isCoincident, true);
			assert.equal(c.targetDistance, 0);

			assert.ok(Math.abs(p.x) < 1e-4, `Expected p.x ~ 0, got ${p.x}`);
			assert.ok(Math.abs(p.y) < 1e-4, `Expected p.y ~ 0, got ${p.y}`);
		});

		it('constrains a point to aligned distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 30, y: 40 }); // 3-4-5 triangle, distance 50

			const c = sketch.addOriginDistanceConstraint(p.id, 100, 'aligned');
			assert.ok(c);
			assert.equal(c.targetDistance, 100);

			const actualDist = Math.hypot(p.x, p.y);
			assert.ok(Math.abs(actualDist - 100) < 1e-3, `Expected distance ~ 100, got ${actualDist}`);
		});

		it('constrains a point to horizontal distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 20, y: 60 });

			const c = sketch.addOriginDistanceConstraint(p.id, 45, 'horizontal');
			assert.ok(c);

			assert.ok(Math.abs(Math.abs(p.x) - 45) < 1e-3, `Expected |p.x| ~ 45, got ${p.x}`);
		});

		it('constrains a point to vertical distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 70, y: 20 });

			const c = sketch.addOriginDistanceConstraint(p.id, 55, 'vertical');
			assert.ok(c);

			assert.ok(Math.abs(Math.abs(p.y) - 55) < 1e-3, `Expected |p.y| ~ 55, got ${p.y}`);
		});

		it('updates dimensional constraint for origin distance', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 30, y: 40 });
			const c = sketch.addOriginDistanceConstraint(p.id, 50, 'aligned');
			assert.ok(c);

			const updated = sketch.updateDimensionalConstraint(c.id, 80);
			assert.equal(updated, true);
			assert.equal(c.targetDistance, 80);

			const actualDist = Math.hypot(p.x, p.y);
			assert.ok(Math.abs(actualDist - 80) < 1e-3, `Expected distance ~ 80, got ${actualDist}`);
		});
	});

	describe('Point To Axis Constraints (via OriginDistanceConstraint)', () => {
		it('constrains a point to lie on the X-axis (y = 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 35, y: 90 });

			const c = sketch.addPointOnAxisConstraint(p.id, 'x');
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 0);
			assert.equal(c.orientation, 'vertical');

			assert.ok(Math.abs(p.y) < 1e-4, `Expected p.y ~ 0, got ${p.y}`);
			assert.ok(Math.abs(p.x - 35) < 1e-3, `Expected p.x ~ 35, got ${p.x}`);
		});

		it('constrains a point to lie on the Y-axis (x = 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 60, y: 42 });

			const c = sketch.addPointOnAxisConstraint(p.id, 'y');
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 0);
			assert.equal(c.orientation, 'horizontal');

			assert.ok(Math.abs(p.x) < 1e-4, `Expected p.x ~ 0, got ${p.x}`);
			assert.ok(Math.abs(p.y - 42) < 1e-3, `Expected p.y ~ 42, got ${p.y}`);
		});

		it('constrains a point to distance from X-axis (|y| = d)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 50, y: 15 });

			const c = sketch.addPointToAxisDistanceConstraint(p.id, 'x', 30);
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 30);
			assert.equal(c.orientation, 'vertical');

			assert.ok(Math.abs(Math.abs(p.y) - 30) < 1e-3, `Expected |p.y| ~ 30, got ${p.y}`);
		});

		it('constrains a point to distance from Y-axis (|x| = d)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 15, y: 50 });

			const c = sketch.addPointToAxisDistanceConstraint(p.id, 'y', 40);
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 40);
			assert.equal(c.orientation, 'horizontal');

			assert.ok(Math.abs(Math.abs(p.x) - 40) < 1e-3, `Expected |p.x| ~ 40, got ${p.x}`);
		});

		it('updates dimensional constraint for point-to-axis distance', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 20, y: 20 });
			const c = sketch.addPointToAxisDistanceConstraint(p.id, 'x', 20);
			assert.ok(c);

			const updated = sketch.updateDimensionalConstraint(c.id, 65);
			assert.equal(updated, true);
			assert.equal(c.targetDistance, 65);

			assert.ok(Math.abs(Math.abs(p.y) - 65) < 1e-3, `Expected |p.y| ~ 65, got ${p.y}`);
		});
	});

	describe('Line To Axis Constraints', () => {
		it('constrains a line collinear with X-axis (y1 = 0, y2 = 0)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 25 });
			const p2 = sketch.addPoint({ x: 60, y: 45 });
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineCollinearWithAxisConstraint(l.id, 'x');
			assert.ok(c);
			assert.equal(c.isCollinear, true);
			assert.equal(c.axis, 'x');

			assert.ok(Math.abs(p1.y) < 1e-4, `Expected p1.y ~ 0, got ${p1.y}`);
			assert.ok(Math.abs(p2.y) < 1e-4, `Expected p2.y ~ 0, got ${p2.y}`);
		});

		it('constrains a line collinear with Y-axis (x1 = 0, x2 = 0)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 25, y: 10 });
			const p2 = sketch.addPoint({ x: 45, y: 70 });
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineCollinearWithAxisConstraint(l.id, 'y');
			assert.ok(c);
			assert.equal(c.isCollinear, true);
			assert.equal(c.axis, 'y');

			assert.ok(Math.abs(p1.x) < 1e-4, `Expected p1.x ~ 0, got ${p1.x}`);
			assert.ok(Math.abs(p2.x) < 1e-4, `Expected p2.x ~ 0, got ${p2.x}`);
		});

		it('constrains a line distance to X-axis (line becomes horizontal at distance d)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 15 });
			const p2 = sketch.addPoint({ x: 70, y: 25 });
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineToAxisDistanceConstraint(l.id, 'x', 50);
			assert.ok(c);
			assert.equal(c.isCollinear, false);

			assert.ok(Math.abs(Math.abs(p1.y) - 50) < 1e-3, `Expected |p1.y| ~ 50, got ${p1.y}`);
			assert.ok(Math.abs(Math.abs(p2.y) - 50) < 1e-3, `Expected |p2.y| ~ 50, got ${p2.y}`);
		});

		it('constrains a line distance to Y-axis (line becomes vertical at distance d)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 15, y: 10 });
			const p2 = sketch.addPoint({ x: 25, y: 80 });
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineToAxisDistanceConstraint(l.id, 'y', 40);
			assert.ok(c);
			assert.equal(c.isCollinear, false);

			assert.ok(Math.abs(Math.abs(p1.x) - 40) < 1e-3, `Expected |p1.x| ~ 40, got ${p1.x}`);
			assert.ok(Math.abs(Math.abs(p2.x) - 40) < 1e-3, `Expected |p2.x| ~ 40, got ${p2.x}`);
		});

		it('updates dimensional constraint for line-to-axis distance', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 20 });
			const p2 = sketch.addPoint({ x: 60, y: 20 });
			const l = sketch.addLine(p1.id, p2.id);
			const c = sketch.addLineToAxisDistanceConstraint(l.id, 'x', 20);
			assert.ok(c);

			const updated = sketch.updateDimensionalConstraint(c.id, 75);
			assert.equal(updated, true);
			assert.equal(c.targetDistance, 75);

			assert.ok(Math.abs(Math.abs(p1.y) - 75) < 1e-3, `Expected |p1.y| ~ 75, got ${p1.y}`);
			assert.ok(Math.abs(Math.abs(p2.y) - 75) < 1e-3, `Expected |p2.y| ~ 75, got ${p2.y}`);
		});
	});

	describe('Serialization & History (Undo / Redo)', () => {
		it('serializes and deserializes OriginDistanceConstraint correctly', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 30, y: 40 });
			const c1 = sketch.addOriginDistanceConstraint(p.id, 50, 'aligned');
			assert.ok(c1);

			const serialized = serializeConstraint(c1);
			const deserialized = deserializeConstraint(serialized) as OriginDistanceConstraint;

			assert.ok(deserialized instanceof OriginDistanceConstraint);
			assert.equal(deserialized.pointId, p.id);
			assert.equal(deserialized.targetDistance, 50);
			assert.equal(deserialized.orientation, 'aligned');
			assert.equal(deserialized.isCoincident, false);
		});

		it('serializes and deserializes LineToAxisDistanceConstraint correctly', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 20 });
			const p2 = sketch.addPoint({ x: 50, y: 20 });
			const l = sketch.addLine(p1.id, p2.id);
			const c1 = sketch.addLineToAxisDistanceConstraint(l.id, 'y', 35);
			assert.ok(c1);

			const serialized = serializeConstraint(c1);
			const deserialized = deserializeConstraint(serialized) as LineToAxisDistanceConstraint;

			assert.ok(deserialized instanceof LineToAxisDistanceConstraint);
			assert.equal(deserialized.lineId, l.id);
			assert.equal(deserialized.axis, 'y');
			assert.equal(deserialized.targetDistance, 35);
			assert.equal(deserialized.isCollinear, false);
		});

		it('supports undo and redo for origin and axis constraints', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 40, y: 40 });

			sketch.pushHistory();
			const c = sketch.addOriginCoincidentConstraint(p.id);
			assert.ok(c);
			assert.ok(Math.abs(p.x) < 1e-4);
			assert.ok(Math.abs(p.y) < 1e-4);

			// Undo
			sketch.undo();
			assert.equal(sketch.constraints.size, 0);
			const ptUndone = sketch.points.get(p.id)!;
			assert.equal(ptUndone.x, 40);
			assert.equal(ptUndone.y, 40);

			// Redo
			sketch.redo();
			assert.equal(sketch.constraints.size, 1);
			const ptRedone = sketch.points.get(p.id)!;
			assert.ok(Math.abs(ptRedone.x) < 1e-4);
			assert.ok(Math.abs(ptRedone.y) < 1e-4);
		});

		it('links axis and origin constraints with getConstraintsForEntity and getEntitiesForConstraint', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 10, y: 20 });
			const cOrigin = sketch.addOriginDistanceConstraint(p.id, 25, 'aligned');
			const cAxis = sketch.addPointOnAxisConstraint(p.id, 'x');
			assert.ok(cOrigin);
			assert.ok(cAxis);

			const originConstraints = sketch.getConstraintsForEntity('point', 'origin');
			assert.ok(originConstraints.some(c => c.id === cOrigin.id));

			const axisXConstraints = sketch.getConstraintsForEntity('line', 'axis_x');
			assert.ok(axisXConstraints.some(c => c.id === cAxis.id));

			const originEntities = sketch.getEntitiesForConstraint(cOrigin);
			assert.ok(originEntities.some(e => e.id === 'origin' && e.type === 'point'));
			assert.ok(originEntities.some(e => e.id === p.id && e.type === 'point'));

			const axisEntities = sketch.getEntitiesForConstraint(cAxis);
			assert.ok(axisEntities.some(e => e.id === 'axis_x' && e.type === 'line'));
			assert.ok(axisEntities.some(e => e.id === p.id && e.type === 'point'));
		});

		it('supports entity selection for origin, axis_x, and axis_y', () => {
			const sketch = new SketchDocument();
			sketch.selectEntity('axis_x', 'line', false);
			assert.ok(sketch.selection.lineIds.has('axis_x'));
			assert.equal(sketch.isEntitySelected('axis_x', 'line'), true);

			sketch.selectEntity('axis_y', 'line', true);
			assert.ok(sketch.selection.lineIds.has('axis_x'));
			assert.ok(sketch.selection.lineIds.has('axis_y'));

			sketch.selectEntity('origin', 'point', false);
			assert.ok(sketch.selection.pointIds.has('origin'));
			assert.equal(sketch.selection.lineIds.size, 0);
		});

		it('renders standard coincident badge for point coincident to origin', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 0, y: 0 });
			const c = sketch.addOriginCoincidentConstraint(p.id);
			assert.ok(c);

			let renderedLabel = '';
			let renderedX = 0;
			let renderedY = 0;
			const mockRenderCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				renderBadge: (_id: string, position: { x: number; y: number }, label: string) => {
					renderedLabel = label;
					renderedX = position.x;
					renderedY = position.y;
				},
			};

			c.render(mockRenderCtx);
			assert.equal(renderedLabel, '●', 'Should render standard coincident badge ● instead of origin');
			assert.equal(renderedX, -12);
			assert.equal(renderedY, -12);

			const dist = c.distanceTo({ x: -12, y: -12 }, sketch, mockRenderCtx.viewport);
			assert.ok(dist !== null && dist < 1e-3);
		});

		it('renders standard point-on-line badge for point on axis (targetDistance = 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 50, y: 0 });
			const c = sketch.addPointOnAxisConstraint(p.id, 'x');
			assert.ok(c);

			let renderedLabel = '';
			let renderedX = 0;
			let renderedY = 0;
			const mockRenderCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				renderBadge: (_id: string, position: { x: number; y: number }, label: string) => {
					renderedLabel = label;
					renderedX = position.x;
					renderedY = position.y;
				},
			};

			c.render(mockRenderCtx);
			assert.equal(renderedLabel, '⚲', 'Should render standard point-on-line badge ⚲ instead of on_x/on_y');
			assert.equal(renderedX, 50);
			assert.equal(renderedY, 14);

			const dist = c.distanceTo({ x: 50, y: 14 }, sketch, mockRenderCtx.viewport);
			assert.ok(dist !== null && dist < 1e-3);
		});

		it('determineDistanceOrientation supports aligned distance to (0,0) and axes', () => {
			const sOrigin = { x: 0, y: 0 };
			const sPt = { x: 100, y: 100 }; // 45 deg line

			// Normal is at 135 deg (-45 deg). Cursor pulled perpendicular:
			const cursorNormal = { x: 20, y: 80 };
			const resAligned = determineDistanceOrientation(sOrigin, sPt, cursorNormal);
			assert.equal(resAligned.orientation, 'aligned');

			// Cursor pulled up/down (vertical direction) => horizontal dimension:
			const cursorVertical = { x: 50, y: 200 };
			const resHoriz = determineDistanceOrientation(sOrigin, sPt, cursorVertical);
			assert.equal(resHoriz.orientation, 'horizontal');

			// Cursor pulled left/right (horizontal direction) => vertical dimension:
			const cursorHorizontal = { x: 200, y: 50 };
			const resVert = determineDistanceOrientation(sOrigin, sPt, cursorHorizontal);
			assert.equal(resVert.orientation, 'vertical');
		});

		it('LineTool creates a line starting from (0,0) and applies origin coincident constraint', () => {
			const sketch = new SketchDocument();
			const lineTool = new LineTool();
			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				},
				renderer: { clearPreviews: () => {} },
				isConstructionMode: false,
				setCursor: () => {},
				applySnapConstraintIfNeeded: (pointId: string, snap: any) => {
					if (snap?.id === 'origin') {
						sketch.addOriginCoincidentConstraint(pointId);
					}
				},
				requestRender: () => {},
			};
			lineTool.activate(mockCtx);

			// Step 1: Click at (0,0) with origin snap
			const snapOrigin = { type: 'point', id: 'origin', worldPos: vec(0, 0), screenPos: vec(0, 0) };
			lineTool.onMouseDown({
				raw: {} as MouseEvent,
				screen: vec(0, 0),
				client: vec(0, 0),
				world: vec(0, 0),
				snap: snapOrigin as any,
				effectiveWorld: vec(0, 0),
				effectiveScreen: vec(0, 0),
			});

			assert.equal(sketch.points.size, 1, 'Should create a sketch point at (0,0)');
			const [startPt] = Array.from(sketch.points.values());
			const originC = sketch.getOriginConstraint(startPt.id);
			assert.ok(originC && originC.isCoincident, 'Should be coincident with origin');

			// Step 2: Click to place end point
			lineTool.onMouseDown({
				raw: {} as MouseEvent,
				screen: vec(80, 60),
				client: vec(80, 60),
				world: vec(80, 60),
				snap: null,
				effectiveWorld: vec(80, 60),
				effectiveScreen: vec(80, 60),
			});

			assert.equal(sketch.lines.size, 1, 'Line starting from (0,0) should be created');
			const [line] = Array.from(sketch.lines.values());
			assert.equal(line.p1Id, startPt.id);
		});

		it('horizontal distance to axis callout moves up when dragging up', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint({ x: 50, y: 50 });
			const c = sketch.addOriginDistanceConstraint(p.id, 50, 'horizontal', 0);
			assert.ok(c);

			const viewport: any = {
				zoom: 1,
				panX: 0,
				panY: 500, // screen Y = 500 - wy * zoom
				worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: 500 - p.y }),
			};

			const sp = viewport.worldToScreen(p); // (50, 450)
			const sOrigin = viewport.worldToScreen({ x: 0, y: 0 }); // (0, 500)
			const sAxisY = viewport.worldToScreen({ x: 0, y: 100 }); // (0, 400)
			const dy = sAxisY.y - sOrigin.y; // -100
			const uy = dy / Math.hypot(0, dy); // -1

			// Dragging cursor UP by 40px: screen.y = 410 (sp.y = 450)
			const cursorScreen = { x: 50, y: 410 };
			const screenOffset = (cursorScreen.y - sp.y) * uy; // (410 - 450) * (-1) = 40
			c.offset = screenOffset / viewport.zoom; // 40

			let renderedD1: any = null;
			const mockCtx: any = {
				sketch,
				viewport,
				targetGroup: null,
				renderLinearDimensionVisual: (opts: any) => {
					renderedD1 = opts.d1;
				},
			};
			c.render(mockCtx);

			assert.ok(renderedD1, 'Dimension should be rendered');
			assert.equal(renderedD1.y, 410, 'Dimension Y coordinate should match cursor Y when dragged UP');
		});
	});

	describe('Line to Axis Angle Constraints', () => {
		it('creates and solves AngleConstraint between line and X-axis', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 });
			const p2 = sketch.addPoint({ x: 60, y: 20 });
			const line = sketch.addLine(p1.id, p2.id);

			// Fix p1 so p2 rotates around p1
			sketch.addFixedConstraint(p1.id);

			const c = sketch.addAngleConstraint(line.id, 'axis_x', 30);
			assert.ok(c, 'Angle constraint should be created');
			assert.equal(c instanceof AngleConstraint, true);
			assert.equal(c.targetAngle, 30);
			assert.equal(c.line1Id, line.id);
			assert.equal(c.line2Id, 'axis_x');

			// Check angle of line with X-axis
			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const actualAngle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
			assert.ok(Math.abs(actualAngle - 30) < 0.5, `Expected angle ~ 30, got ${actualAngle}`);

			// Update angle to 60 degrees
			const updated = sketch.updateDimensionalConstraint(c.id, 60);
			assert.equal(updated, true);
			assert.equal(c.targetAngle, 60);

			const dx60 = p2.x - p1.x;
			const dy60 = p2.y - p1.y;
			const actualAngle60 = (Math.atan2(Math.abs(dy60), Math.abs(dx60)) * 180) / Math.PI;
			assert.ok(Math.abs(actualAngle60 - 60) < 0.5, `Expected angle ~ 60, got ${actualAngle60}`);
		});

		it('creates and solves AngleConstraint between line and Y-axis', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 20, y: 20 });
			const p2 = sketch.addPoint({ x: 40, y: 80 });
			const line = sketch.addLine(p1.id, p2.id);

			// Fix p1
			sketch.addFixedConstraint(p1.id);

			const c = sketch.addAngleConstraint(line.id, 'axis_y', 45);
			assert.ok(c);
			assert.equal(c.targetAngle, 45);
			assert.equal(c.line2Id, 'axis_y');

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const actualAngleWithY = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
			assert.ok(Math.abs(actualAngleWithY - 45) < 0.5, `Expected angle with Y ~ 45, got ${actualAngleWithY}`);
		});

		it('DimensionTool creates AngleConstraint when clicking a line and then X-axis', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 });
			const p2 = sketch.addPoint({ x: 50, y: 40 });
			const line = sketch.addLine(p1.id, p2.id);

			let editedConstraint: any = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					panX: 0,
					panY: 0,
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				},
				renderer: {
					clearPreviews: () => {},
					renderAnglePreview: () => {},
				},
				showToast: () => {},
				requestRender: () => {},
				setCursor: () => {},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				findHoverTarget: () => null,
				findSnap: () => null,
				onEditDimension: (c: any) => {
					editedConstraint = c;
				},
			};

			const makeEvent = (pos: { x: number; y: number }, id?: string, type?: string) =>
				({
					screen: pos,
					world: pos,
					client: pos,
					raw: {
						target: {
							closest: () =>
								id
									? { getAttribute: (attr: string) => (attr === 'data-id' ? id : attr === 'data-type' ? type : null) }
									: null,
						},
					},
				}) as any;

			const tool = new DimensionTool();
			tool.activate(mockCtx);

			// Click 1: select line
			tool.onMouseDown(makeEvent(vec(30, 25), line.id, 'line'));

			assert.equal((tool as any).state.step, 1);
			assert.equal((tool as any).state.line1Id, line.id);

			// Click 2: click X-axis -> transitions to Step 2 (Angle mode)
			tool.onMouseDown(makeEvent(vec(50, 0), 'axis_x', 'line'));

			assert.equal((tool as any).state.step, 2);
			assert.equal((tool as any).state.line1Id, line.id);
			assert.equal((tool as any).state.line2Id, 'axis_x');

			// Click 3: place dimension arc/text
			tool.onMouseDown(makeEvent(vec(40, 10)));

			assert.equal((tool as any).state.step, 0);
			assert.ok(editedConstraint, 'Dimension edit callback should have been called');
			assert.equal(editedConstraint instanceof AngleConstraint, true);
			assert.equal(editedConstraint.line1Id, line.id);
			assert.equal(editedConstraint.line2Id, 'axis_x');
		});

		it('DimensionTool creates AngleConstraint when clicking X-axis first then line', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 });
			const p2 = sketch.addPoint({ x: 50, y: 40 });
			const line = sketch.addLine(p1.id, p2.id);

			let editedConstraint: any = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					panX: 0,
					panY: 0,
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				},
				renderer: {
					clearPreviews: () => {},
					renderAnglePreview: () => {},
				},
				showToast: () => {},
				requestRender: () => {},
				setCursor: () => {},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				findHoverTarget: () => null,
				findSnap: () => null,
				onEditDimension: (c: any) => {
					editedConstraint = c;
				},
			};

			const makeEvent = (pos: { x: number; y: number }, id?: string, type?: string) =>
				({
					screen: pos,
					world: pos,
					client: pos,
					raw: {
						target: {
							closest: () =>
								id
									? { getAttribute: (attr: string) => (attr === 'data-id' ? id : attr === 'data-type' ? type : null) }
									: null,
						},
					},
				}) as any;

			const tool = new DimensionTool();
			tool.activate(mockCtx);

			// Click 1: select axis
			tool.onMouseDown(makeEvent(vec(50, 0), 'axis_x', 'line'));

			assert.equal((tool as any).state.step, 1);
			assert.equal((tool as any).state.line1Id, 'axis_x');

			// Click 2: click line -> transitions to Step 2 (Angle mode)
			tool.onMouseDown(makeEvent(vec(30, 25), line.id, 'line'));

			assert.equal((tool as any).state.step, 2);
			assert.equal((tool as any).state.line1Id, 'axis_x');
			assert.equal((tool as any).state.line2Id, line.id);

			// Click 3: place dimension arc/text
			tool.onMouseDown(makeEvent(vec(40, 10)));

			assert.equal((tool as any).state.step, 0);
			assert.ok(editedConstraint);
			assert.equal(editedConstraint instanceof AngleConstraint, true);
		});

		it('links constraints and entities for AngleConstraint with axis', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 });
			const p2 = sketch.addPoint({ x: 50, y: 40 });
			const line = sketch.addLine(p1.id, p2.id);

			const c = sketch.addAngleConstraint(line.id, 'axis_x', 35);
			assert.ok(c);

			const lineConstraints = sketch.getConstraintsForEntity('line', line.id);
			assert.ok(lineConstraints.some(sc => sc.id === c.id));

			const axisConstraints = sketch.getConstraintsForEntity('line', 'axis_x');
			assert.ok(axisConstraints.some(sc => sc.id === c.id));

			const entities = sketch.getEntitiesForConstraint(c);
			assert.ok(entities.some(e => e.type === 'line' && e.id === line.id));
			assert.ok(entities.some(e => e.type === 'line' && e.id === 'axis_x'));
		});

		it('serializes and deserializes AngleConstraint with axis correctly', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 });
			const p2 = sketch.addPoint({ x: 50, y: 40 });
			const line = sketch.addLine(p1.id, p2.id);

			const c = sketch.addAngleConstraint(line.id, 'axis_x', 35);
			assert.ok(c);

			const serialized = serializeConstraint(c);
			const restored = deserializeConstraint(serialized) as AngleConstraint;

			assert.equal(restored instanceof AngleConstraint, true);
			assert.equal(restored.line1Id, line.id);
			assert.equal(restored.line2Id, 'axis_x');
			assert.equal(restored.targetAngle, 35);
		});
	});

	describe('Symmetry Constraints with Axes and Origin', () => {
		it('constrains two points symmetric across X-axis and Y-axis', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 30, y: 40 });
			const p2 = sketch.addPoint({ x: 10, y: -15 });
			sketch.addFixedConstraint(p1.id);

			const cX = sketch.addSymmetryConstraint(p1.id, p2.id, 'axis_x');
			assert.ok(cX instanceof SymmetryConstraint);
			assert.equal(cX.lineId, 'axis_x');
			assert.ok(Math.abs(p2.x - 30) < 1e-3, `Expected p2.x ~ 30, got ${p2.x}`);
			assert.ok(Math.abs(p2.y - -40) < 1e-3, `Expected p2.y ~ -40, got ${p2.y}`);

			const p3 = sketch.addPoint({ x: -10, y: 20 });
			const cY = sketch.addSymmetryConstraint(p1.id, p3.id, 'axis_y');
			assert.ok(cY instanceof SymmetryConstraint);
			assert.equal(cY.lineId, 'axis_y');
			assert.ok(Math.abs(p3.x - -30) < 1e-3, `Expected p3.x ~ -30, got ${p3.x}`);
			assert.ok(Math.abs(p3.y - 40) < 1e-3, `Expected p3.y ~ 40, got ${p3.y}`);
		});

		it('constrains two points symmetric across Origin (0,0)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 25, y: 35 });
			const p2 = sketch.addPoint({ x: -10, y: -15 });
			sketch.addFixedConstraint(p1.id);

			const c = sketch.addSymmetryConstraint(p1.id, p2.id, 'origin');
			assert.ok(c instanceof SymmetryConstraint);
			assert.equal(c.lineId, 'origin');
			assert.ok(Math.abs(p2.x - -25) < 1e-3, `Expected p2.x ~ -25, got ${p2.x}`);
			assert.ok(Math.abs(p2.y - -35) < 1e-3, `Expected p2.y ~ -35, got ${p2.y}`);
		});

		it('constrains a point and Origin (0,0) symmetric across a user line', () => {
			const sketch = new SketchDocument();
			const lp1 = sketch.addPoint({ x: 20, y: -50 });
			const lp2 = sketch.addPoint({ x: 20, y: 50 });
			const line = sketch.addLine(lp1.id, lp2.id);
			sketch.addFixedConstraint(lp1.id);
			sketch.addFixedConstraint(lp2.id);

			const p = sketch.addPoint({ x: 30, y: 10 });
			const c = sketch.addSymmetryConstraint(p.id, 'origin', line.id);
			assert.ok(c instanceof SymmetryConstraint);
			assert.ok(Math.abs(p.x - 40) < 1e-3, `Expected p.x ~ 40, got ${p.x}`);
			assert.ok(Math.abs(p.y - 0) < 1e-3, `Expected p.y ~ 0, got ${p.y}`);
		});

		it('ConstraintTool(symmetry) supports 2 points + axis, 2 points + origin, 2 circles + axis/origin, and 2 lines + axis/origin', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 20, y: 30 });
			const p2 = sketch.addPoint({ x: -10, y: 25 });
			sketch.addFixedConstraint(p1.id);

			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				},
				showToast: () => {},
				requestRender: () => {},
				setCursor: () => {},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
			};

			const makeEvent = (pos: { x: number; y: number }, id?: string, type?: string) =>
				({
					screen: pos,
					world: pos,
					client: pos,
					raw: {
						target: {
							closest: () =>
								id
									? { getAttribute: (attr: string) => (attr === 'data-id' ? id : attr === 'data-type' ? type : null) }
									: null,
						},
					},
				}) as any;

			const tool = new ConstraintTool('symmetry');
			tool.activate(mockCtx);

			// 1. Two points + Y-axis
			tool.onMouseDown(makeEvent(vec(20, 30), p1.id, 'point'));
			tool.onMouseDown(makeEvent(vec(-10, 25), p2.id, 'point'));
			tool.onMouseDown(makeEvent(vec(0, 50), 'axis_y', 'line'));

			assert.ok(Math.abs(p2.x - -20) < 1e-3);
			assert.ok(Math.abs(p2.y - 30) < 1e-3);

			// 2. Two points + origin
			const p3 = sketch.addPoint({ x: -15, y: -20 });
			tool.onMouseDown(makeEvent(vec(20, 30), p1.id, 'point'));
			tool.onMouseDown(makeEvent(vec(-15, -20), p3.id, 'point'));
			tool.onMouseDown(makeEvent(vec(0, 0), 'origin', 'point'));

			assert.ok(Math.abs(p3.x - -20) < 1e-3);
			assert.ok(Math.abs(p3.y - -30) < 1e-3);

			// 3. Two circles + X-axis
			const c1Center = sketch.addPoint({ x: 40, y: 25 });
			const c1 = sketch.addCircle(c1Center.id, 12);
			sketch.addFixedConstraint(c1Center.id);
			sketch.addRadiusConstraint(c1.id, 12);

			const c2Center = sketch.addPoint({ x: 35, y: -20 });
			const c2 = sketch.addCircle(c2Center.id, 8);

			tool.onMouseDown(makeEvent(vec(40, 37), c1.id, 'circle'));
			tool.onMouseDown(makeEvent(vec(35, -28), c2.id, 'circle'));
			tool.onMouseDown(makeEvent(vec(50, 0), 'axis_x', 'line'));

			assert.ok(Math.abs(c2Center.x - 40) < 1e-3);
			assert.ok(Math.abs(c2Center.y - -25) < 1e-3);
			assert.ok(Math.abs(c2.radius - 12) < 1e-3);
			assert.ok([...sketch.constraints.values()].some(c => c instanceof EqualRadiusConstraint));
		});

		it('links, renders, serializes, and preserves SymmetryConstraint with axes/origin during orphan cleanup', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 20, y: 30 });
			const p2 = sketch.addPoint({ x: 20, y: -30 });
			const cAxis = sketch.addSymmetryConstraint(p1.id, p2.id, 'axis_x')!;
			assert.ok(cAxis);

			const p3 = sketch.addPoint({ x: -20, y: -30 });
			const cOrigin = sketch.addSymmetryConstraint(p1.id, p3.id, 'origin')!;
			assert.ok(cOrigin);

			// Check entity links
			assert.ok(sketch.getConstraintsForEntity('line', 'axis_x').some(c => c.id === cAxis.id));
			assert.ok(sketch.getEntitiesForConstraint(cAxis).some(e => e.id === 'axis_x' && e.type === 'line'));

			assert.ok(sketch.getConstraintsForEntity('point', 'origin').some(c => c.id === cOrigin.id));
			assert.ok(sketch.getEntitiesForConstraint(cOrigin).some(e => e.id === 'origin' && e.type === 'point'));

			// Check orphan cleanup preservation when deleting an unrelated point
			const extraPt = sketch.addPoint({ x: 100, y: 100 });
			sketch.removeEntity(extraPt.id);
			assert.ok(
				sketch.constraints.has(cAxis.id),
				'Symmetry with axis_x should not be deleted by cleanOrphanConstraints'
			);
			assert.ok(
				sketch.constraints.has(cOrigin.id),
				'Symmetry with origin should not be deleted by cleanOrphanConstraints'
			);

			// Serialization
			const restored = deserializeConstraint(serializeConstraint(cAxis)) as SymmetryConstraint;
			assert.equal(restored instanceof SymmetryConstraint, true);
			assert.equal(restored.lineId, 'axis_x');
		});
	});

	describe('Midpoint Constraints with Origin', () => {
		it('constrains line midpoint to Origin (0,0)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 30, y: 40 });
			const p2 = sketch.addPoint({ x: -20, y: -30 });
			const line = sketch.addLine(p1.id, p2.id);
			sketch.addFixedConstraint(p1.id);

			const c = sketch.addMidpointConstraint('origin', line.id);
			assert.ok(c instanceof MidpointConstraint);
			assert.equal(c.midId, 'origin');
			assert.ok(Math.abs(p2.x - -30) < 1e-3, `Expected p2.x ~ -30, got ${p2.x}`);
			assert.ok(Math.abs(p2.y - -40) < 1e-3, `Expected p2.y ~ -40, got ${p2.y}`);

			// Rejects coordinate axis as line target for midpoint
			assert.equal(sketch.addMidpointConstraint(p1.id, 'axis_x'), null);
		});

		it('renders badge at (0,0), links to origin, and survives cleanOrphanConstraints', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 20, y: 10 });
			const p2 = sketch.addPoint({ x: -20, y: -10 });
			const line = sketch.addLine(p1.id, p2.id);
			const c = sketch.addMidpointConstraint('origin', line.id)!;
			assert.ok(c);

			let badgePos: { x: number; y: number } | null = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				renderBadge: (_id: string, position: { x: number; y: number }) => {
					badgePos = position;
				},
			};
			c.render(mockCtx);
			assert.deepEqual(badgePos, { x: 0, y: -14 });
			assert.ok(c.distanceTo({ x: 0, y: -14 }, sketch, mockCtx.viewport)! < 1e-3);

			assert.ok(sketch.getConstraintsForEntity('point', 'origin').some(sc => sc.id === c.id));
			assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === 'origin' && e.type === 'point'));

			const extraPt = sketch.addPoint({ x: 99, y: 99 });
			sketch.removeEntity(extraPt.id);
			assert.ok(sketch.constraints.has(c.id), 'Midpoint on origin should survive cleanOrphanConstraints');
		});
	});

	describe('Tangent Constraints with Coordinate Axes', () => {
		it('constrains a circle tangent to X-axis and Y-axis', () => {
			const sketch = new SketchDocument();
			const center = sketch.addPoint({ x: 40, y: 35 });
			const circle = sketch.addCircle(center.id, 20);
			sketch.addRadiusConstraint(circle.id, 20);

			const cX = sketch.addTangentConstraint('axis_x', circle.id) as TangentLineCircleConstraint;
			assert.ok(cX instanceof TangentLineCircleConstraint);
			assert.equal(cX.lineId, 'axis_x');
			assert.ok(Math.abs(center.y - 20) < 1e-3, `Expected center.y ~ 20, got ${center.y}`);

			const cY = sketch.addTangentConstraint(circle.id, 'axis_y') as TangentLineCircleConstraint;
			assert.ok(cY instanceof TangentLineCircleConstraint);
			assert.equal(cY.lineId, 'axis_y');
			assert.ok(Math.abs(center.x - 20) < 1e-3, `Expected center.x ~ 20, got ${center.x}`);
		});

		it('ConstraintTool(tangent) selects axis even when clicking near (0,0) over origin DOM element', () => {
			const sketch = new SketchDocument();
			const center = sketch.addPoint({ x: 0, y: 25 });
			const circle = sketch.addCircle(center.id, 15);
			sketch.addRadiusConstraint(circle.id, 15);

			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
				},
				showToast: () => {},
				requestRender: () => {},
				setCursor: () => {},
				findPointNear: () => ({ id: 'origin', x: 0, y: 0 }),
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
			};

			const tool = new ConstraintTool('tangent');
			tool.activate(mockCtx);

			// Hover options should disable origin and enable axes for tangent tool
			const hoverOpts = tool.getHoverTargetOptions();
			assert.equal(hoverOpts.allowOrigin, false);
			assert.equal(hoverOpts.allowAxes, true);

			// Click 1: circle
			tool.onMouseDown({
				screen: vec(0, 40),
				world: vec(0, 40),
				client: vec(0, 40),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? circle.id : attr === 'data-type' ? 'circle' : null),
						}),
					},
				},
			} as any);

			// Click 2: near (0,0) where raw.target is 'origin' (point), should fall through to axis_x
			tool.onMouseDown({
				screen: vec(2, 0),
				world: vec(2, 0),
				client: vec(2, 0),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? 'origin' : attr === 'data-type' ? 'point' : null),
						}),
					},
				},
			} as any);

			assert.ok(Math.abs(center.y - 15) < 1e-3, `Expected center.y ~ 15, got ${center.y}`);
		});

		it('renders tangent badge on infinite axis, links entities, serializes, and survives cleanOrphanConstraints', () => {
			const sketch = new SketchDocument();
			const center = sketch.addPoint({ x: 200, y: 20 });
			const circle = sketch.addCircle(center.id, 20);
			const c = sketch.addTangentConstraint('axis_x', circle.id) as TangentLineCircleConstraint;
			assert.ok(c);

			let renderedBadge = false;
			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				renderBadge: (_id: string, _position: { x: number; y: number }, label: string) => {
					if (label === 'tangent') renderedBadge = true;
				},
				renderBadgeOnSegment: () => {
					assert.fail('Should not call renderBadgeOnSegment for axis');
				},
				renderBadgeOnCircle: () => {},
			};
			c.render(mockCtx);
			assert.equal(renderedBadge, true, 'Should render tangent badge at tangent point even at x=200 along axis_x');

			assert.ok(sketch.getConstraintsForEntity('line', 'axis_x').some(sc => sc.id === c.id));
			assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === 'axis_x' && e.type === 'line'));

			const restored = deserializeConstraint(serializeConstraint(c)) as TangentLineCircleConstraint;
			assert.equal(restored instanceof TangentLineCircleConstraint, true);
			assert.equal(restored.lineId, 'axis_x');

			const extraPt = sketch.addPoint({ x: 50, y: 50 });
			sketch.removeEntity(extraPt.id);
			assert.ok(sketch.constraints.has(c.id), 'Tangent with axis_x should survive cleanOrphanConstraints');
		});
	});

	describe('Collinear Constraints with Coordinate Axes', () => {
		it('addCollinearConstraint delegates to LineToAxisDistanceConstraint when given axis_x or axis_y', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 15 });
			const p2 = sketch.addPoint({ x: 50, y: 25 });
			const line = sketch.addLine(p1.id, p2.id);

			const c = sketch.addCollinearConstraint(line.id, 'axis_x');
			assert.ok(c instanceof LineToAxisDistanceConstraint);
			assert.equal(c.isCollinear, true);
			assert.equal(c.axis, 'x');
			assert.ok(Math.abs(p1.y) < 1e-4);
			assert.ok(Math.abs(p2.y) < 1e-4);

			assert.equal(sketch.addCollinearConstraint('axis_x', 'axis_y'), null);
		});
	});

	describe('Two-Line Symmetry with Opposite Endpoint Directions (sketch_1793864359069.svg)', () => {
		it('correctly pairs endpoints when two lines have opposite directions across axis_y', () => {
			const sketch = new SketchDocument();
			// Exact coordinates and direction from sketch_1793864359069.svg:
			// Line-5: Point-5 (bottom-right) -> Point-6 (top-right)
			// Line-7: Point-7 (top-left) -> Point-8 (bottom-left)
			const p5 = sketch.addPoint({ x: 101.79068827101727, y: 12.987276531412446 });
			const p6 = sketch.addPoint({ x: 83.87500000000027, y: 45.25141492374967 });
			const p7 = sketch.addPoint({ x: -83.87500000000028, y: 45.25141492374967 });
			const p8 = sketch.addPoint({ x: -101.79069099267647, y: 12.987276534860813 });

			const line5 = sketch.addLine(p5.id, p6.id);
			const line7 = sketch.addLine(p7.id, p8.id);
			sketch.addHorizontalConstraint(p6.id, p7.id);

			const ctx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			const tool = new ConstraintTool('symmetry');
			tool.activate(ctx);

			// Simulate box-selecting both lines before activating tool (includes endpoints in selection)
			sketch.selectEntity(p5.id, 'point', true);
			sketch.selectEntity(p6.id, 'point', true);
			sketch.selectEntity(p7.id, 'point', true);
			sketch.selectEntity(p8.id, 'point', true);
			sketch.selectEntity(line5.id, 'line', true);
			sketch.selectEntity(line7.id, 'line', true);

			// Re-activating tool prunes endpoints of selected lines
			tool.activate(ctx);
			assert.equal(sketch.selection.pointIds.size, 0);
			assert.equal(sketch.selection.lineIds.size, 2);

			// Click axis_y
			tool.onMouseDown({
				screen: vec(400, 200),
				world: vec(0, 100),
				client: vec(400, 200),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? 'axis_y' : attr === 'data-type' ? 'line' : null),
						}),
					},
				},
			} as any);

			// Verify both lines kept their length (~36.9) and did NOT collapse!
			const len5 = Math.hypot(p6.x - p5.x, p6.y - p5.y);
			const len7 = Math.hypot(p8.x - p7.x, p8.y - p7.y);
			assert.ok(len5 > 35, `Expected Line-5 length > 35, got ${len5}`);
			assert.ok(len7 > 35, `Expected Line-7 length > 35, got ${len7}`);

			// Verify p5 is paired with p8 (bottom pair) and p6 is paired with p7 (top pair)
			assert.ok(Math.abs(p5.x + p8.x) < 1e-4);
			assert.ok(Math.abs(p5.y - p8.y) < 1e-4);
			assert.ok(Math.abs(p6.x + p7.x) < 1e-4);
			assert.ok(Math.abs(p6.y - p7.y) < 1e-4);

			// Drag p5 and verify p8 mirrors across axis_y
			sketch.dragPoint(p5.id, 120, 10);
			assert.ok(Math.abs(p5.x + p8.x) < 1e-3);
			assert.ok(Math.abs(p5.y - p8.y) < 1e-3);
		});
	});

	describe('Three-Point Constraints (Midpoint, Collinear, Angle)', () => {
		it('Midpoint by 3 points picks the geometrically middle point regardless of selection order', () => {
			const sketch = new SketchDocument();
			const pA = sketch.addPoint({ x: 0, y: 0 }, true);
			const pMid = sketch.addPoint({ x: 45, y: 18 }); // geometrically closest to midpoint (50, 10)
			const pB = sketch.addPoint({ x: 100, y: 20 }, true);

			// Pass points in order (pA, pB, pMid) — pMid should still be identified as midId
			const c = sketch.addThreePointMidpointConstraint(pA.id, pB.id, pMid.id);
			assert.ok(c instanceof MidpointConstraint);
			assert.equal(c.midId, pMid.id);
			assert.ok(Math.abs(pMid.x - 50) < 1e-4, `Expected pMid.x ~ 50, got ${pMid.x}`);
			assert.ok(Math.abs(pMid.y - 10) < 1e-4, `Expected pMid.y ~ 10, got ${pMid.y}`);

			// Entity links include all 3 points
			for (const pid of [pA.id, pMid.id, pB.id]) {
				assert.ok(sketch.getConstraintsForEntity('point', pid).some(sc => sc.id === c.id));
				assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === pid && e.type === 'point'));
			}
		});

		it('ConstraintTool(midpoint) applies 3-point midpoint on 3 arbitrary points', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 10, y: 10 }, true);
			const p2 = sketch.addPoint({ x: 90, y: 50 }, true);
			const p3 = sketch.addPoint({ x: 48, y: 25 }); // middle point

			const ctx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			const tool = new ConstraintTool('midpoint');
			tool.activate(ctx);

			for (const pt of [p1, p2, p3]) {
				tool.onMouseDown({
					screen: vec(pt.x, pt.y),
					world: vec(pt.x, pt.y),
					client: vec(pt.x, pt.y),
					raw: {
						target: {
							closest: () => ({
								getAttribute: (attr: string) => (attr === 'data-id' ? pt.id : attr === 'data-type' ? 'point' : null),
							}),
						},
					},
				} as any);
			}

			assert.ok(Math.abs(p3.x - 50) < 1e-4, `Expected p3.x ~ 50, got ${p3.x}`);
			assert.ok(Math.abs(p3.y - 30) < 1e-4, `Expected p3.y ~ 30, got ${p3.y}`);
		});

		it('Collinear by 3 points constrains 3 points onto one line and removes exactly 1 DoF', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 0, y: 0 }, true);
			const p2 = sketch.addPoint({ x: 50, y: 25 });
			const p3 = sketch.addPoint({ x: 100, y: 0 }, true);

			const c = sketch.addThreePointCollinearConstraint(p1.id, p2.id, p3.id);
			assert.ok(c instanceof CollinearConstraint);
			assert.equal(c.isThreePoint(), true);
			assert.equal(c.getEquationsCount(), 1);
			assert.ok(Math.abs(p2.y) < 1e-4, `Expected p2.y ~ 0, got ${p2.y}`);
			assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');

			// Serialization roundtrip preserves 3-point collinear
			const restored = deserializeConstraint(serializeConstraint(c)) as CollinearConstraint;
			assert.ok(restored instanceof CollinearConstraint);
			assert.equal(restored.isThreePoint(), true);
			assert.equal(restored.getEquationsCount(), 1);

			// Entity links include all 3 points
			for (const pid of [p1.id, p2.id, p3.id]) {
				assert.ok(sketch.getConstraintsForEntity('point', pid).some(sc => sc.id === c.id));
				assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === pid && e.type === 'point'));
			}
		});

		it('ConstraintTool(collinear) applies 3-point collinear on 3 points including origin', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 40, y: 40 }, true);
			const p2 = sketch.addPoint({ x: 80, y: 60 });

			const ctx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
			};

			const tool = new ConstraintTool('collinear');
			tool.activate(ctx);

			for (const id of ['origin', p1.id, p2.id]) {
				tool.onMouseDown({
					screen: vec(0, 0),
					world: vec(0, 0),
					client: vec(0, 0),
					raw: {
						target: {
							closest: () => ({
								getAttribute: (attr: string) => (attr === 'data-id' ? id : attr === 'data-type' ? 'point' : null),
							}),
						},
					},
				} as any);
			}

			// Origin (0,0), p1 (40,40), p2 should lie on y = x
			assert.ok(Math.abs(p2.x - p2.y) < 1e-3, `Expected p2.x ~ p2.y, got (${p2.x}, ${p2.y})`);
			assert.equal(sketch.getConstraintsForEntity('point', 'origin').length, 1);
		});

		it('Angle by 3 points uses the 2nd point as the vertex (∠P1-P2-P3) and solves target angle', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 100, y: 0 }, true);
			const p2 = sketch.addPoint({ x: 0, y: 0 }, true); // vertex
			const p3 = sketch.addPoint({ x: 60, y: 80 }); // initial angle ~53.13 deg
			sketch.addDistanceConstraint(p2.id, p3.id, 100);

			const c = sketch.addThreePointAngleConstraint(p1.id, p2.id, p3.id, 90);
			assert.ok(c instanceof AngleConstraint);
			assert.equal(c.l1P1, p2.id);
			assert.equal(c.l1P2, p1.id);
			assert.equal(c.l2P1, p2.id);
			assert.equal(c.l2P2, p3.id);

			assert.ok(Math.abs(p3.x - 0) < 1e-3, `Expected p3.x ~ 0, got ${p3.x}`);
			assert.ok(Math.abs(p3.y - 100) < 1e-3, `Expected p3.y ~ 100, got ${p3.y}`);

			// Update dimensional constraint to 60 degrees
			const updated = sketch.updateDimensionalConstraint(c.id, 60);
			assert.equal(updated, true);
			assert.ok(Math.abs(p3.x - 50) < 1e-2, `Expected p3.x ~ 50, got ${p3.x}`);
			assert.ok(Math.abs(p3.y - 86.6025) < 1e-2, `Expected p3.y ~ 86.6025, got ${p3.y}`);

			// Entity links include all 3 points
			for (const pid of [p1.id, p2.id, p3.id]) {
				assert.ok(sketch.getConstraintsForEntity('point', pid).some(sc => sc.id === c.id));
				assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === pid && e.type === 'point'));
			}

			// Serialization roundtrip preserves 3-point angle
			const restored = deserializeConstraint(serializeConstraint(c)) as AngleConstraint;
			assert.ok(restored instanceof AngleConstraint);
			assert.equal(restored.line1Id, '');
			assert.equal(restored.line2Id, '');
			assert.equal(restored.l1P1, p2.id);
			assert.equal(restored.l1P2, p1.id);
			assert.equal(restored.l2P1, p2.id);
			assert.equal(restored.l2P2, p3.id);
		});

		it('DimensionTool creates 3-point angle constraint via 4 clicks (P1, vertex P2, P3, place arc)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint({ x: 100, y: 0 }, true);
			const p2 = sketch.addPoint({ x: 0, y: 0 }, true); // vertex
			const p3 = sketch.addPoint({ x: 0, y: 100 });

			let editedConstraint: any = null;
			const ctx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					screenToWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
					zoom: 1,
				},
				renderer: {
					clearPreviews: () => {},
					renderAnglePreview: () => {},
					renderDistancePreview: () => {},
					renderDistanceLinePreview: () => {},
				},
				findSnap: () => null,
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				requestRender: () => {},
				showToast: () => {},
				setCursor: () => {},
				onEditDimension: (c: any) => {
					editedConstraint = c;
				},
			};

			const tool = new DimensionTool();
			tool.activate(ctx);

			// Click 1: p1
			tool.onMouseDown({
				screen: vec(100, 0),
				world: vec(100, 0),
				client: vec(100, 0),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? p1.id : attr === 'data-type' ? 'point' : null),
						}),
					},
				},
			} as any);
			assert.equal(tool.state.step, 1);
			assert.equal(tool.state.point1Id, p1.id);

			// Click 2: p2 (vertex)
			tool.onMouseDown({
				screen: vec(0, 0),
				world: vec(0, 0),
				client: vec(0, 0),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? p2.id : attr === 'data-type' ? 'point' : null),
						}),
					},
				},
			} as any);
			assert.equal(tool.state.step, 2);
			assert.equal(tool.state.point2Id, p2.id);

			// Click 3: p3
			tool.onMouseDown({
				screen: vec(0, 100),
				world: vec(0, 100),
				client: vec(0, 100),
				raw: {
					target: {
						closest: () => ({
							getAttribute: (attr: string) => (attr === 'data-id' ? p3.id : attr === 'data-type' ? 'point' : null),
						}),
					},
				},
			} as any);
			assert.equal(tool.state.step, 2);
			assert.equal(tool.state.point3Id, p3.id);

			// Click 4: place angle dimension arc at (30, 30)
			tool.onMouseDown({
				screen: vec(30, 30),
				world: vec(30, 30),
				client: vec(30, 30),
				raw: {
					target: {
						closest: () => null,
					},
				},
			} as any);

			assert.equal(tool.state.step, 0);
			assert.ok(editedConstraint instanceof AngleConstraint);
			assert.equal(editedConstraint.l1P1, p2.id);
			assert.equal(editedConstraint.l1P2, p1.id);
			assert.equal(editedConstraint.l2P1, p2.id);
			assert.equal(editedConstraint.l2P2, p3.id);
			assert.equal(editedConstraint.targetAngle, 90);
		});
	});
});
