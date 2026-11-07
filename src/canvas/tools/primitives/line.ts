import { BaseTool } from '../base';
import type { SnapResult, ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { addScaled, angleFromToDeg, dist, normalizeOrNull, sub, vec, type Vec2 } from '../../../math/vector';
import { ToolPopup } from '../../../ui/tool-popup';
import { createSvgLine } from '../../svg';
import { getPreviewStrokeAttrs } from '../../styles';

type LineField = 'length' | 'angle';
type LinePointer = Pick<ToolMouseEvent, 'world' | 'snap' | 'client'>;

export class LineTool extends BaseTool {
	readonly id = 'line' as const;
	readonly popup = new ToolPopup<LineField>({
		className: 'line-popup',
		fields: [
			{ id: 'length', label: 'Length', type: 'dimension', unit: 'mm', lockable: true, defaultValue: 0 },
			{ id: 'angle', label: 'Angle', type: 'dimension', unit: '°', lockable: true, defaultValue: 0 },
		],
		onKeyDown: e => this.onKeyDown(e),
	});

	private startPointId: string | null = null;
	private lastPointer: LinePointer | null = null;

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.popup.setSketch(ctx.sketch);
		const update = () => {
			this.updateMeasurements();
			ctx.requestRender();
		};
		this.popup.onChange = update;
		this.popup.onLockChange = update;
		this.popup.onCancel = () => ctx.setTool('select');
	}

	override onMouseDown(e: ToolMouseEvent): void {
		if (this.startPointId) {
			if (this.finishSegment(e) && this.startPointId) e.raw.preventDefault();
			return;
		}

		const { sketch } = this.ctx;
		const { snap, world } = e;
		sketch.beginTransaction();
		let startId: string;
		if (snap?.type === 'point' && snap.id && sketch.points.has(snap.id)) {
			startId = snap.id;
		} else {
			startId = sketch.addPoint(snap?.worldPos ?? world).id;
			this.ctx.applySnapConstraintIfNeeded?.(startId, snap);
		}
		this.startSegment(startId, e.client);
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (!this.startPointId) return;
		this.lastPointer = e;
		this.updateMeasurements();
		this.popup.updatePosition(e.client);
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key !== 'Enter' || !this.lastPointer) return;
		e.preventDefault();
		e.stopPropagation();
		this.finishSegment(this.lastPointer);
		return true;
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const start = this.getStartPoint();
		if (!start) return;
		const { end } = this.getSegmentGeometry(start, ctx.cursorWorld, ctx.snap);
		createSvgLine(
			ctx.viewport.worldToScreen(start),
			ctx.viewport.worldToScreen(end),
			getPreviewStrokeAttrs(ctx.isConstruction, false, true),
			ctx.targetGroup
		);
	}

	override cancel(): void {
		if (!this.startPointId) return;
		this.ctx.sketch.rollbackTransaction();
		this.resetDrawing();
		this.ctx.requestRender();
	}

	private getStartPoint(): Vec2 | undefined {
		return this.startPointId ? this.ctx.sketch.getPoint(this.startPointId) : undefined;
	}

	private updateMeasurements(): void {
		const start = this.getStartPoint();
		if (!start || !this.lastPointer) return;
		const { end } = this.getSegmentGeometry(start, this.lastPointer.world, this.lastPointer.snap);
		this.popup.updateValueIfUnlocked('length', dist(start, end));
		this.popup.updateValueIfUnlocked('angle', angleFromToDeg(start, end));
	}

	private getSegmentGeometry(start: Vec2, world: Vec2, snap: SnapResult | null) {
		const length = this.popup.isLocked('length') ? this.popup.getNumericValue('length') : undefined;
		const angle = this.popup.isLocked('angle') ? this.popup.getNumericValue('angle') : undefined;
		const target = snap?.worldPos ?? world;
		if (angle !== undefined) {
			const radians = (angle * Math.PI) / 180;
			const direction = vec(Math.cos(radians), Math.sin(radians));
			const end = addScaled(start, direction, length ?? dist(start, target));
			return { end, length, angle };
		}

		const snapped = this.ctx.getAxisSnappedWorldPos?.(start, target, snap).pos ?? target;
		if (length === undefined) return { end: snapped, length, angle };
		const direction =
			normalizeOrNull(sub(snapped, start), 1e-9) ?? normalizeOrNull(sub(world, start), 1e-9) ?? vec(1, 0);
		return { end: addScaled(start, direction, length), length, angle };
	}

	private startSegment(pointId: string, client: Vec2): void {
		this.startPointId = pointId;
		this.lastPointer = { world: this.getStartPoint()!, snap: null, client };
		this.popup.resetField('length', 0);
		this.popup.resetField('angle', 0);
		if (this.popup.isOpen()) {
			this.popup.updatePosition(client);
			this.popup.focus('length');
		} else {
			this.popup.show(client);
		}
	}

	private finishSegment(pointer: LinePointer): boolean {
		const start = this.getStartPoint();
		const startId = this.startPointId;
		if (!start || !startId) return false;

		const { end, length, angle } = this.getSegmentGeometry(start, pointer.world, pointer.snap);
		if (length !== undefined && length <= 0) return false;
		if (dist(start, end) < 1e-9) return false;
		const snap =
			pointer.snap && ((length === undefined && angle === undefined) || dist(end, pointer.snap.worldPos) < 1e-6)
				? pointer.snap
				: null;

		const { sketch } = this.ctx;
		let endId: string;
		if (snap?.type === 'point' && snap.id && snap.id !== startId && sketch.points.has(snap.id)) {
			endId = snap.id;
		} else {
			endId = sketch.addPoint(end).id;
			this.ctx.applySnapConstraintIfNeeded?.(endId, snap);
		}

		const line = sketch.addLine(startId, endId, this.ctx.isConstructionMode);
		if (angle === undefined) {
			this.ctx.applyAutoOrientationConstraint?.(startId, endId);
		} else {
			this.constrainAngle(line.id, angle);
		}
		if (length !== undefined) {
			const constraint = sketch.addDistanceConstraint(startId, endId, length);
			const expression = this.popup.getExpression('length');
			if (constraint && expression) constraint.expression = expression;
		}
		sketch.commitTransaction();

		const hitPrimitive =
			snap && snap.type !== 'grid' && (snap.type !== 'point' || (snap.id !== undefined && snap.id !== startId));
		if (hitPrimitive) {
			this.resetDrawing();
		} else {
			sketch.beginTransaction();
			this.startSegment(endId, pointer.client);
		}
		this.ctx.requestRender();
		return true;
	}

	private constrainAngle(lineId: string, angle: number): void {
		// The angle dimension stores the magnitude and rotation direction separately.
		const turns = Math.round(angle / 360);
		const heading = angle - turns * 360;
		const sign = heading < 0 ? -1 : 1;
		const constraint = this.ctx.sketch.addAngleConstraint('axis_x', lineId, Math.abs(heading), undefined, 1, 1, sign);
		const expression = this.popup.getExpression('angle');
		if (!constraint || !expression) return;
		const wrapped = turns ? `(${expression}) - (${turns * 360})` : expression;
		constraint.expression = sign < 0 ? `-(${wrapped})` : wrapped;
	}

	private resetDrawing(): void {
		this.startPointId = null;
		this.lastPointer = null;
		this.popup.hide();
		this.ctx.renderer.clearPreviews();
	}
}
