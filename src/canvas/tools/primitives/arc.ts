import { arcThreePoint, arcTangent, arcCenter, pointAtDistance, viewOrientation } from '../../../math/construction';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { Vec2 } from '../../../math/vector';
import { renderArcPreviewVisual } from '../../previewHelpers';
import { createSvgCircle, createSvgLine } from '../../svg';
import { AUX_RAY_ATTRS, GUIDE_OUTLINE_ATTRS, getPreviewStrokeAttrs } from '../../styles';
import { ToolPopup } from '../../../ui/tool-popup';
import type { SketchDocument } from '../../../model/sketch';
import type { SketchLine, SketchArc } from '../../../model/types';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { dispatchToolModeChange } from '../modeChangeEvent';

const TWO_PI = 2 * Math.PI;

export type ArcMode = 'three_point' | 'center' | 'tangent';

interface ConnectedCurveInfo {
	entity: SketchLine | SketchArc;
	tangentDir: Vec2; // Outward unit tangent in world coordinates
}

/**
 * Finds an existing line or arc connected to ptId and returns its unit tangent vector at ptId.
 */
export function findConnectedCurveForTangent(sketch: SketchDocument, ptId: string): ConnectedCurveInfo | null {
	// 1. Check lines
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		if (line.p1Id === ptId || line.p2Id === ptId) {
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;
			const tangentDir = (line.p1Id === ptId ? new Vec2().subVectors(p1, p2) : new Vec2().subVectors(p2, p1))
				.clone()
				.normalizeOrNull(1e-6);
			if (!tangentDir) continue;
			return {
				entity: line,
				tangentDir,
			};
		}
	}

	// 2. Check arcs
	for (const arc of sketch.arcs.values()) {
		if (arc.startPointId === ptId || arc.endPointId === ptId) {
			const center = sketch.points.get(arc.centerId);
			const pt = sketch.points.get(ptId);
			if (!center || !pt) continue;
			const radial = new Vec2().subVectors(pt, center);
			const rLen = radial.length();
			if (rLen < 1e-6) continue;

			const isCW = !!arc.clockwise;
			const forwardTangent = isCW
				? radial
						.clone()
						.perpendicular()
						.multiplyScalar(-1 / rLen)
				: radial.clone().perpendicular().divideScalar(rLen);
			const tangentDir = arc.endPointId === ptId ? forwardTangent : forwardTangent.clone().negate();
			return {
				entity: arc,
				tangentDir,
			};
		}
	}

	return null;
}

export class ArcTool extends BaseTool {
	readonly id = 'arc' as const;
	readonly popup = new ToolPopup<'radius' | 'angle'>({
		className: 'arc-popup',
		fields: [
			{ id: 'radius', label: 'Radius', type: 'dimension', unit: 'mm', min: 0.1, lockable: true },
			{ id: 'angle', label: 'Angle', type: 'dimension', unit: '°', min: 0.1, max: 359.9, lockable: true },
		],
		onKeyDown: e => this.sidebarPanel?.handleKeyDown?.(e) || this.onKeyDown(e),
	});
	private lastPointer: ToolMouseEvent | null = null;

	private _mode: ArcMode = 'center';
	private drawingStep: 0 | 1 | 2 = 0;

	// --- 3-Point Arc State ---
	private startPointId: string | null = null;
	private startWorldPos: Vec2 | null = null;
	private arcPoint2Id: string | null = null;
	private arcPoint2WorldPos: Vec2 | null = null;

	// --- Centerpoint Arc State ---
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;
	private arcPoint1Id: string | null = null;
	private arcPoint1WorldPos: Vec2 | null = null;
	private arcCenterPrevAngle: number | null = null;
	private arcCenterTotalAngle = 0;

	// --- Tangent Arc State ---
	private tangentStartPointId: string | null = null;
	private tangentStartWorldPos: Vec2 | null = null;
	private tangentDir: Vec2 | null = null;
	private connectedEntityId: string | null = null;

	onModeChange?: (mode: ArcMode) => void;
	onStateChange?: () => void;

	constructor(initialMode: ArcMode = 'center') {
		super();
		this._mode = initialMode;

		this.sidebarPanel = new VariationToolPanel<ArcMode>({
			title: 'Arc Tool',
			description: 'Select arc creation method:',
			dataAttribute: 'data-arc-mode',
			cancelButtonId: 'btn-arc-cancel-icon',
			modes: [
				{
					id: 'center',
					label: 'Center',
					title: 'Centerpoint Arc (Alt+1)',
					iconName: 'arc_center',
				},
				{
					id: 'three_point',
					label: '3-Point',
					title: '3-Point Arc (Alt+2)',
					iconName: 'arc',
				},
				{
					id: 'tangent',
					label: 'Tangent',
					title: 'Tangent Arc (Alt+3)',
					iconName: 'arc_tangent',
				},
			],
			getCurrentMode: () => this.mode,
			onSelectMode: mode => this.setMode(mode),
			onCancel: () => this.ctx?.setTool('select'),
			getHint: () => this.getStepHint(),
			bindStateChange: cb => {
				this.onStateChange = cb;
			},
		});
		const update = (field: 'radius' | 'angle') => {
			if (this.mode === 'three_point' && this.popup.isLocked(field)) {
				this.popup.setLocked(field === 'radius' ? 'angle' : 'radius', false);
			}
			if (this.lastPointer) this.syncPopup(this.lastPointer);
			this.ctx.requestRender();
		};
		this.popup.onChange = update;
		this.popup.onLockChange = update;
		this.popup.onCancel = () => this.ctx.setTool('select');
	}

	getStepHint(): string {
		const mode = this._mode;
		const step = this.drawingStep;
		if (mode === 'three_point') {
			if (step === 0) return '1. Click to place start point';
			if (step === 1) return '2. Click to place end point';
			return '3. Click to set arc radius and bulge';
		} else if (mode === 'center') {
			if (step === 0) return '1. Click to place center point';
			if (step === 1) return '2. Click to place start point (sets radius)';
			return '3. Click to place end point (sets sweep angle)';
		} else {
			if (step === 0) return '1. Click an endpoint of an existing line or arc';
			return '2. Click to place tangent arc end point';
		}
	}

	get mode(): ArcMode {
		return this._mode;
	}

	get step(): number {
		return this.drawingStep;
	}

	setMode(newMode: ArcMode): void {
		if (this._mode === newMode) return;
		this.cancel();
		this._mode = newMode;
		dispatchToolModeChange('arc', newMode);
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.popup.setSketch(ctx.sketch);
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (!this.popup.isOpen() || !this.lastPointer) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			this.onMouseDown(this.lastPointer);
			return true;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			this.popup.cycleFocus(e.shiftKey);
			return true;
		}
	}

	private openPopup(e: ToolMouseEvent): void {
		this.popup.resetField('radius', 0);
		this.popup.resetField('angle', 0);
		this.popup.setFieldReadOnly('radius', false);
		this.popup.setFieldVisible('angle', this.mode !== 'center');
		this.popup.show(e.client);
	}

	private syncPopup(e: ToolMouseEvent): void {
		if (!this.popup.isOpen()) return;
		const point = this.shouldSnap() !== false ? e.effectiveWorld : e.world;
		if (this.mode === 'center' && this.centerWorldPos) {
			if (this.drawingStep === 1) {
				this.popup.updateValueIfUnlocked('radius', this.centerWorldPos.distanceTo(point));
			} else if (this.arcPoint1WorldPos) {
				const { sweep } = this.getCenterEnd(point);
				this.popup.updateValueIfUnlocked('angle', (sweep * 180) / Math.PI);
			}
		} else {
			const geometry = this.mode === 'three_point' ? this.getThreePointGeometry(point) : this.getTangentGeometry(point);
			this.popup.updateValueIfUnlocked('radius', geometry?.radius ?? 0);
			this.popup.updateValueIfUnlocked('angle', ((geometry?.sweepAngle ?? 0) * 180) / Math.PI);
		}
		this.popup.updatePosition(e.client);
	}

	override shouldSnap(): boolean | 'no-grid' {
		if (this._mode === 'three_point') {
			return this.drawingStep < 2 ? 'no-grid' : false;
		}
		return this.drawingStep === 0 ? true : 'no-grid';
	}

	override onMouseDown(e: ToolMouseEvent): void {
		this.lastPointer = e;
		switch (this._mode) {
			case 'three_point':
				this.onMouseDownThreePoint(e);
				break;
			case 'center':
				this.onMouseDownCenter(e);
				break;
			case 'tangent':
				this.onMouseDownTangent(e);
				break;
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		this.lastPointer = e;
		if (this._mode === 'center' && this.drawingStep === 2 && this.centerWorldPos && this.arcPoint1WorldPos) {
			const effectiveWorld = this.shouldSnap() !== false ? e.effectiveWorld : e.world;
			this.updateCenterArcAngle(effectiveWorld);
		}
		this.syncPopup(e);
	}

	override renderPreview(ctx: ToolRenderContext): void {
		switch (this._mode) {
			case 'three_point':
				this.renderPreviewThreePoint(ctx);
				break;
			case 'center':
				this.renderPreviewCenter(ctx);
				break;
			case 'tangent':
				this.renderPreviewTangent(ctx);
				break;
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.resetState();
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}

	private resetState(): void {
		this.drawingStep = 0;
		this.popup.hide();
		this.lastPointer = null;

		// 3-point
		this.startPointId = null;
		this.startWorldPos = null;
		this.arcPoint2Id = null;
		this.arcPoint2WorldPos = null;

		// center
		this.centerId = null;
		this.centerWorldPos = null;
		this.arcPoint1Id = null;
		this.arcPoint1WorldPos = null;
		this.arcCenterPrevAngle = null;
		this.arcCenterTotalAngle = 0;

		// tangent
		this.tangentStartPointId = null;
		this.tangentStartWorldPos = null;
		this.tangentDir = null;
		this.connectedEntityId = null;

		this.onStateChange?.();
	}

	// =========================================================================
	// 3-Point Arc Implementation
	// =========================================================================

	private onMouseDownThreePoint(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = this.shouldSnap() !== false ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			const pt = this.acquirePoint(snap?.worldPos ?? world, snap);
			this.startPointId = pt.id;
			this.startWorldPos = pt.pos;
			this.drawingStep = 1;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const p1World = this.startWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (p1World.distanceTo(effectiveWorld) < 2) {
				return;
			}

			const pt = this.acquirePoint(effectiveWorld, snap, true, this.startPointId);
			this.arcPoint2Id = pt.id;
			this.arcPoint2WorldPos = pt.pos;
			this.drawingStep = 2;
			this.openPopup(e);
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const geometry = this.getThreePointGeometry(world);
			if (!geometry) {
				this.ctx.showToast('Cannot form an arc with this radius or angle');
				return;
			}

			const center = sketch.addPoint(geometry.center);
			const arc = sketch.addArc(
				center.id,
				this.startPointId!,
				this.arcPoint2Id!,
				geometry.radius,
				geometry.clockwise,
				this.ctx.isConstructionMode
			);
			this.finalizeArcCommit(arc, '3-point arc created');
		}
	}

	private getThreePointGeometry(cursor: Vec2) {
		const start = this.startWorldPos,
			end = this.arcPoint2WorldPos;
		if (!start || !end) return null;
		return arcThreePoint(
			start,
			end,
			cursor,
			{
				radius: this.popup.isLocked('radius')
					? this.popup.getNumericValue('radius', start.distanceTo(end) / 2)
					: undefined,
				angle: this.popup.isLocked('angle') ? (this.popup.getNumericValue('angle', 90) * Math.PI) / 180 : undefined,
			},
			viewOrientation(this.ctx.viewport)
		);
	}

	private renderPreviewThreePoint(ctx: ToolRenderContext): void {
		const start = this.startWorldPos;
		if (!start) return;
		const { viewport, targetGroup, isConstruction } = ctx;
		const cursor = this.shouldSnap() !== false && ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
		const end = this.arcPoint2WorldPos ?? cursor;
		const geometry = this.getThreePointGeometry(cursor);
		const s1 = viewport.worldToScreen(start);
		const s2 = viewport.worldToScreen(end);
		if (!geometry) {
			createSvgLine(s1, s2, getPreviewStrokeAttrs(isConstruction, false, true), targetGroup);
			return;
		}
		renderArcPreviewVisual(
			targetGroup,
			viewport.worldToScreen(geometry.center),
			s1,
			s2,
			geometry.radius * viewport.zoom,
			geometry.clockwise,
			isConstruction
		);
	}

	// =========================================================================
	// Centerpoint Arc Implementation
	// =========================================================================

	private onMouseDownCenter(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = this.shouldSnap() !== false ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			const pt = this.acquirePoint(snap?.worldPos ?? world, snap);
			this.centerId = pt.id;
			this.centerWorldPos = pt.pos;
			this.drawingStep = 1;
			this.openPopup(e);
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const center = this.centerWorldPos!;
			const cursor = snap?.worldPos ?? world;
			const locked = this.popup.isLocked('radius');
			if (!locked && center.distanceTo(cursor) < 2) return;

			const start = this.getCenterStart(center, cursor);
			const startId = this.acquirePoint(start, snap, !locked, this.centerId).id;
			this.arcPoint1Id = startId;
			this.arcPoint1WorldPos = start;
			this.arcCenterPrevAngle = this.ctx.viewport
				.worldToScreen(center)
				.angleToPoint(this.ctx.viewport.worldToScreen(start));
			this.arcCenterTotalAngle = 0;
			this.drawingStep = 2;
			this.popup.updateValueIfUnlocked('radius', center.distanceTo(start));
			this.popup.setFieldReadOnly('radius', true);
			this.popup.setFieldVisible('angle', true);
			this.popup.updatePosition(e.client);
			this.popup.focus('angle');
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const cursor = snap?.worldPos ?? world;
			this.updateCenterArcAngle(cursor);
			const { end, radius, clockwise, sweep } = this.getCenterEnd(cursor);
			if (sweep < 1e-6) return;
			const useSnap =
				!this.popup.isLocked('angle') && (!this.popup.isLocked('radius') || end.distanceTo(cursor) < 1e-6);

			const endId = this.acquirePoint(end, snap, useSnap, this.centerId, this.arcPoint1Id).id;
			const arc = sketch.addArc(
				this.centerId!,
				this.arcPoint1Id!,
				endId,
				radius,
				clockwise,
				this.ctx.isConstructionMode
			);
			this.finalizeArcCommit(arc, 'Centerpoint arc created');
		}
	}

	private getCenterStart(center: Vec2, cursor: Vec2): Vec2 {
		return this.popup.isLocked('radius')
			? pointAtDistance(center, cursor, this.popup.getNumericValue('radius', 0.1))
			: cursor;
	}

	private getCenterEnd(cursor: Vec2) {
		return arcCenter(
			this.centerWorldPos!,
			this.arcPoint1WorldPos!,
			cursor,
			this.arcCenterTotalAngle,
			this.popup.isLocked('angle') ? (this.popup.getNumericValue('angle', 90) * Math.PI) / 180 : undefined,
			viewOrientation(this.ctx.viewport)
		);
	}

	private updateCenterArcAngle(effectiveWorld: Vec2): void {
		const centerWorld = this.centerWorldPos!;
		const startWorld = this.arcPoint1WorldPos!;

		const sCenter = this.ctx.viewport.worldToScreen(centerWorld);
		const sStart = this.ctx.viewport.worldToScreen(startWorld);
		const sCur = this.ctx.viewport.worldToScreen(effectiveWorld);

		const as = sCenter.angleToPoint(sStart);
		const acur = sCenter.angleToPoint(sCur);

		if (this.arcCenterPrevAngle === null) {
			this.arcCenterPrevAngle = as;
			this.arcCenterTotalAngle = 0;
		}

		let dAngle = acur - this.arcCenterPrevAngle;
		while (dAngle > Math.PI) dAngle -= TWO_PI;
		while (dAngle < -Math.PI) dAngle += TWO_PI;

		this.arcCenterTotalAngle += dAngle;
		this.arcCenterPrevAngle = acur;
		this.arcCenterTotalAngle = this.arcCenterTotalAngle % TWO_PI;
	}

	private renderPreviewCenter(ctx: ToolRenderContext): void {
		const center = this.centerWorldPos;
		if (!center) return;
		const cursor = ctx.snap?.worldPos ?? ctx.cursorWorld;
		const { viewport, targetGroup } = ctx;
		const sc = viewport.worldToScreen(center);
		if (this.drawingStep === 1) {
			const ss = viewport.worldToScreen(this.getCenterStart(center, cursor));
			createSvgCircle(sc, sc.distanceTo(ss), GUIDE_OUTLINE_ATTRS, targetGroup);
			createSvgLine(sc, ss, AUX_RAY_ATTRS, targetGroup);
		} else if (this.arcPoint1WorldPos) {
			const { end, radius, clockwise } = this.getCenterEnd(cursor);
			renderArcPreviewVisual(
				targetGroup,
				sc,
				viewport.worldToScreen(this.arcPoint1WorldPos),
				viewport.worldToScreen(end),
				radius * viewport.zoom,
				clockwise,
				ctx.isConstruction
			);
		}
	}

	// =========================================================================
	// Tangent Arc Implementation
	// =========================================================================

	private onMouseDownTangent(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = this.shouldSnap() !== false ? e.snap : null;
		const world = e.world;
		const screen = e.screen;

		if (this.drawingStep === 0) {
			// Find existing point under cursor
			let ptId: string | null = null;
			let ptPos: Vec2 | null = null;

			if (snap && snap.type === 'point' && snap.id) {
				ptId = snap.id;
				ptPos = snap.worldPos;
			} else {
				const nearPt = this.ctx.findPointNear(screen);
				if (nearPt) {
					ptId = nearPt.id;
					ptPos = nearPt.clone();
				}
			}

			if (!ptId || !ptPos) {
				this.ctx.showToast('Click an endpoint of an existing line or arc');
				return;
			}

			const curveInfo = findConnectedCurveForTangent(sketch, ptId);
			if (!curveInfo) {
				this.ctx.showToast('Selected point is not an endpoint of any line or arc');
				return;
			}

			sketch.beginTransaction();
			this.tangentStartPointId = ptId;
			this.tangentStartWorldPos = ptPos;
			this.tangentDir = curveInfo.tangentDir;
			this.connectedEntityId = curveInfo.entity.id;
			this.drawingStep = 1;
			this.openPopup(e);
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const geom = this.getTangentGeometry(snap?.worldPos ?? world);
			if (!geom) {
				return;
			}

			const useSnap = !this.popup.isLocked('radius') && !this.popup.isLocked('angle');
			const endPointId = this.acquirePoint(geom.end, snap, useSnap, this.tangentStartPointId).id;

			const centerPt = sketch.addPoint(geom.center);
			const arc = sketch.addArc(
				centerPt.id,
				this.tangentStartPointId!,
				endPointId,
				geom.radius,
				geom.clockwise,
				this.ctx.isConstructionMode
			);

			// Automatically add tangent constraint between the connected curve and the new arc
			if (this.connectedEntityId) {
				sketch.addTangentConstraint(this.connectedEntityId, arc.id);
			}

			this.finalizeArcCommit(arc, 'Tangent arc created');
		}
	}

	private getTangentGeometry(cursor: Vec2) {
		const start = this.tangentStartWorldPos,
			tangent = this.tangentDir;
		if (!start || !tangent) return null;
		const geometry = arcTangent(
			start,
			cursor,
			tangent,
			{
				radius: this.popup.isLocked('radius') ? this.popup.getNumericValue('radius', 1) : undefined,
				angle: this.popup.isLocked('angle') ? (this.popup.getNumericValue('angle', 90) * Math.PI) / 180 : undefined,
			},
			viewOrientation(this.ctx.viewport)
		);
		if (!geometry) return null;
		const vp = this.ctx.viewport;
		return {
			...geometry,
			sCenter: vp.worldToScreen(geometry.center),
			s1: vp.worldToScreen(start),
			s2: vp.worldToScreen(geometry.end),
		};
	}

	private renderPreviewTangent(ctx: ToolRenderContext): void {
		const start = this.tangentStartWorldPos;
		if (!start) return;
		const cursor = ctx.snap?.worldPos ?? ctx.cursorWorld;
		const geometry = this.getTangentGeometry(cursor);
		if (geometry) {
			renderArcPreviewVisual(
				ctx.targetGroup,
				geometry.sCenter,
				geometry.s1,
				geometry.s2,
				geometry.radius * ctx.viewport.zoom,
				geometry.clockwise,
				ctx.isConstruction
			);
		} else {
			createSvgLine(
				ctx.viewport.worldToScreen(start),
				ctx.viewport.worldToScreen(cursor),
				getPreviewStrokeAttrs(ctx.isConstruction, false, true),
				ctx.targetGroup
			);
		}
	}

	private constrainDimensions(arc: SketchArc): void {
		const { sketch } = this.ctx;
		if (this.popup.isLocked('radius')) {
			const constraint = sketch.addRadiusConstraint(arc.id, arc.radius);
			const expression = this.popup.getExpression('radius');
			if (constraint) {
				if (expression) constraint.expression = expression;
				const cursor = this.lastPointer?.screen ?? this.ctx.viewport.worldToScreen(sketch.points.get(arc.endPointId)!);
				constraint.placeLabelInsideNear(cursor, sketch, this.ctx.viewport);
			}
		}
		if (this.popup.isLocked('angle')) {
			const center = sketch.points.get(arc.centerId)!;
			const start = sketch.points.get(arc.startPointId)!;
			const end = sketch.points.get(arc.endPointId)!;
			const angle = this.popup.getNumericValue('angle', 90);
			const sign =
				new Vec2().subVectors(start, center).cross(new Vec2().subVectors(end, center)) * (angle > 180 ? -1 : 1);
			const constraint = sketch.addArcAngleConstraint(arc.id, angle, arc.radius * 0.5, sign);
			const expression = this.popup.getExpression('angle');
			if (constraint && expression) constraint.expression = expression;
		}
	}

	private acquirePoint(
		fallbackPos: Vec2,
		snap: ToolMouseEvent['snap'],
		allowSnap = true,
		...excludeIds: Array<string | null>
	): { id: string; pos: Vec2 } {
		const { sketch } = this.ctx;
		if (allowSnap && snap?.type === 'point' && snap.id && !excludeIds.includes(snap.id) && sketch.points.has(snap.id)) {
			return { id: snap.id, pos: snap.worldPos };
		}
		const pt = sketch.addPoint(fallbackPos);
		if (allowSnap) this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
		return { id: pt.id, pos: pt.clone() };
	}

	private finalizeArcCommit(arc: SketchArc, toastMessage: string): void {
		this.constrainDimensions(arc);
		this.ctx.sketch.commitTransaction();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast(toastMessage);
	}
}
