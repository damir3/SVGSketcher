import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
	AngleConstraint,
} from '../src/solver/constraints';
import { serializeConstraint, deserializeConstraint } from '../src/model/history';
import { determineDistanceOrientation, DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { vec } from '../src/math/vector';

describe('Origin & Axis Constraints', () => {
	describe('Origin Distance & Coincident Constraints', () => {
		it('constrains a point coincident to (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(50, 80);

			const c = sketch.addOriginCoincidentConstraint(p.id);
			assert.ok(c, 'Constraint should be created');
			assert.equal(c.isCoincident, true);
			assert.equal(c.targetDistance, 0);

			assert.ok(Math.abs(p.x) < 1e-4, `Expected p.x ~ 0, got ${p.x}`);
			assert.ok(Math.abs(p.y) < 1e-4, `Expected p.y ~ 0, got ${p.y}`);
		});

		it('constrains a point to aligned distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(30, 40); // 3-4-5 triangle, distance 50

			const c = sketch.addOriginDistanceConstraint(p.id, 100, 'aligned');
			assert.ok(c);
			assert.equal(c.targetDistance, 100);

			const actualDist = Math.hypot(p.x, p.y);
			assert.ok(Math.abs(actualDist - 100) < 1e-3, `Expected distance ~ 100, got ${actualDist}`);
		});

		it('constrains a point to horizontal distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(20, 60);

			const c = sketch.addOriginDistanceConstraint(p.id, 45, 'horizontal');
			assert.ok(c);

			assert.ok(Math.abs(Math.abs(p.x) - 45) < 1e-3, `Expected |p.x| ~ 45, got ${p.x}`);
		});

		it('constrains a point to vertical distance from (0, 0)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(70, 20);

			const c = sketch.addOriginDistanceConstraint(p.id, 55, 'vertical');
			assert.ok(c);

			assert.ok(Math.abs(Math.abs(p.y) - 55) < 1e-3, `Expected |p.y| ~ 55, got ${p.y}`);
		});

		it('updates dimensional constraint for origin distance', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(30, 40);
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
			const p = sketch.addPoint(35, 90);

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
			const p = sketch.addPoint(60, 42);

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
			const p = sketch.addPoint(50, 15);

			const c = sketch.addPointToAxisDistanceConstraint(p.id, 'x', 30);
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 30);
			assert.equal(c.orientation, 'vertical');

			assert.ok(Math.abs(Math.abs(p.y) - 30) < 1e-3, `Expected |p.y| ~ 30, got ${p.y}`);
		});

		it('constrains a point to distance from Y-axis (|x| = d)', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(15, 50);

			const c = sketch.addPointToAxisDistanceConstraint(p.id, 'y', 40);
			assert.ok(c);
			assert.equal(c instanceof OriginDistanceConstraint, true);
			assert.equal(c.targetDistance, 40);
			assert.equal(c.orientation, 'horizontal');

			assert.ok(Math.abs(Math.abs(p.x) - 40) < 1e-3, `Expected |p.x| ~ 40, got ${p.x}`);
		});

		it('updates dimensional constraint for point-to-axis distance', () => {
			const sketch = new SketchDocument();
			const p = sketch.addPoint(20, 20);
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
			const p1 = sketch.addPoint(10, 25);
			const p2 = sketch.addPoint(60, 45);
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
			const p1 = sketch.addPoint(25, 10);
			const p2 = sketch.addPoint(45, 70);
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
			const p1 = sketch.addPoint(10, 15);
			const p2 = sketch.addPoint(70, 25);
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineToAxisDistanceConstraint(l.id, 'x', 50);
			assert.ok(c);
			assert.equal(c.isCollinear, false);

			assert.ok(Math.abs(Math.abs(p1.y) - 50) < 1e-3, `Expected |p1.y| ~ 50, got ${p1.y}`);
			assert.ok(Math.abs(Math.abs(p2.y) - 50) < 1e-3, `Expected |p2.y| ~ 50, got ${p2.y}`);
		});

		it('constrains a line distance to Y-axis (line becomes vertical at distance d)', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint(15, 10);
			const p2 = sketch.addPoint(25, 80);
			const l = sketch.addLine(p1.id, p2.id);

			const c = sketch.addLineToAxisDistanceConstraint(l.id, 'y', 40);
			assert.ok(c);
			assert.equal(c.isCollinear, false);

			assert.ok(Math.abs(Math.abs(p1.x) - 40) < 1e-3, `Expected |p1.x| ~ 40, got ${p1.x}`);
			assert.ok(Math.abs(Math.abs(p2.x) - 40) < 1e-3, `Expected |p2.x| ~ 40, got ${p2.x}`);
		});

		it('updates dimensional constraint for line-to-axis distance', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint(10, 20);
			const p2 = sketch.addPoint(60, 20);
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
			const p = sketch.addPoint(30, 40);
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

		it('deserializes legacy point_to_axis_distance records into OriginDistanceConstraint', () => {
			const serialized = {
				id: 'c_legacy_1',
				type: 'point_to_axis_distance' as const,
				pointId: 'p1',
				axis: 'x' as const,
				targetDistance: 25,
				side: 1,
				isCoincident: false,
			};
			const deserialized = deserializeConstraint(serialized as any) as OriginDistanceConstraint;

			assert.ok(deserialized instanceof OriginDistanceConstraint);
			assert.equal(deserialized.pointId, 'p1');
			assert.equal(deserialized.targetDistance, 25);
			assert.equal(deserialized.orientation, 'vertical');
		});

		it('serializes and deserializes LineToAxisDistanceConstraint correctly', () => {
			const sketch = new SketchDocument();
			const p1 = sketch.addPoint(10, 20);
			const p2 = sketch.addPoint(50, 20);
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
			const p = sketch.addPoint(40, 40);

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
			const p = sketch.addPoint(10, 20);
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
			const p = sketch.addPoint(0, 0);
			const c = sketch.addOriginCoincidentConstraint(p.id);
			assert.ok(c);

			let renderedLabel = '';
			let renderedX = 0;
			let renderedY = 0;
			const mockRenderCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					zoom: 1,
				},
				renderBadge: (_id: string, x: number, y: number, label: string) => {
					renderedLabel = label;
					renderedX = x;
					renderedY = y;
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
			const p = sketch.addPoint(50, 0);
			const c = sketch.addPointOnAxisConstraint(p.id, 'x');
			assert.ok(c);

			let renderedLabel = '';
			let renderedX = 0;
			let renderedY = 0;
			const mockRenderCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (x: number, y: number) => ({ x, y }),
					zoom: 1,
				},
				renderBadge: (_id: string, x: number, y: number, label: string) => {
					renderedLabel = label;
					renderedX = x;
					renderedY = y;
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
					worldToScreen: (x: number, y: number) => ({ x, y }),
					screenToWorld: (x: number, y: number) => ({ x, y }),
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
			const p = sketch.addPoint(50, 50);
			const c = sketch.addOriginDistanceConstraint(p.id, 50, 'horizontal', 0);
			assert.ok(c);

			const viewport: any = {
				zoom: 1,
				panX: 0,
				panY: 500, // screen Y = 500 - wy * zoom
				worldToScreen: (wx: number, wy: number) => ({ x: wx, y: 500 - wy }),
			};

			const sp = viewport.worldToScreen(p.x, p.y); // (50, 450)
			const sOrigin = viewport.worldToScreen(0, 0); // (0, 500)
			const sAxisY = viewport.worldToScreen(0, 100); // (0, 400)
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
			const p1 = sketch.addPoint(10, 10);
			const p2 = sketch.addPoint(60, 20);
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
			const p1 = sketch.addPoint(20, 20);
			const p2 = sketch.addPoint(40, 80);
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
			const p1 = sketch.addPoint(10, 10);
			const p2 = sketch.addPoint(50, 40);
			const line = sketch.addLine(p1.id, p2.id);

			let editedConstraint: any = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					panX: 0,
					panY: 0,
					worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
					screenToWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
				},
				renderer: {
					clearPreviews: () => {},
					renderAnglePreview: () => {},
				},
				showToast: () => {},
				requestRender: () => {},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				findHoverTarget: () => null,
				findSnap: () => null,
				setCursor: () => {},
				onEditDimension: (c: any) => {
					editedConstraint = c;
				},
			};

			const makeEvent = (pos: { x: number; y: number }, id?: string, type?: string) => ({
				screen: pos,
				world: pos,
				client: pos,
				raw: {
					target: {
						closest: () => (id ? { getAttribute: (attr: string) => attr === 'data-id' ? id : (attr === 'data-type' ? type : null) } : null),
					},
				},
			} as any);

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
			const p1 = sketch.addPoint(10, 10);
			const p2 = sketch.addPoint(50, 40);
			const line = sketch.addLine(p1.id, p2.id);

			let editedConstraint: any = null;
			const mockCtx: any = {
				sketch,
				viewport: {
					zoom: 1,
					panX: 0,
					panY: 0,
					worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
					screenToWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
				},
				renderer: {
					clearPreviews: () => {},
					renderAnglePreview: () => {},
				},
				showToast: () => {},
				requestRender: () => {},
				findPointNear: () => null,
				findLineNear: () => null,
				findCircleNear: () => null,
				findArcNear: () => null,
				findHoverTarget: () => null,
				findSnap: () => null,
				setCursor: () => {},
				onEditDimension: (c: any) => {
					editedConstraint = c;
				},
			};

			const makeEvent = (pos: { x: number; y: number }, id?: string, type?: string) => ({
				screen: pos,
				world: pos,
				client: pos,
				raw: {
					target: {
						closest: () => (id ? { getAttribute: (attr: string) => attr === 'data-id' ? id : (attr === 'data-type' ? type : null) } : null),
					},
				},
			} as any);

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
			const p1 = sketch.addPoint(10, 10);
			const p2 = sketch.addPoint(50, 40);
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
			const p1 = sketch.addPoint(10, 10);
			const p2 = sketch.addPoint(50, 40);
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
});
