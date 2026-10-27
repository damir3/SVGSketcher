import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, getCircumcircle, type Vec2 } from '../../../math/vector';
import {
	renderLinePreviewVisual,
	renderCirclePreviewVisual,
	renderArcPreviewVisual,
} from '../../previewHelpers';
import type { SketchDocument } from '../../../model/sketch';
import type { SketchLine, SketchArc } from '../../../model/types';

const TWO_PI = 2 * Math.PI;

export type ArcMode = 'three_point' | 'center' | 'tangent';

interface ConnectedCurveInfo {
	entity: SketchLine | SketchArc;
	tangentDir: Vec2; // Outward unit tangent in world coordinates
}

/**
 * Finds an existing line or arc connected to ptId and returns its unit tangent vector at ptId.
 */
export function findConnectedCurveForTangent(
	sketch: SketchDocument,
	ptId: string
): ConnectedCurveInfo | null {
	// 1. Check lines
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		if (line.p1Id === ptId || line.p2Id === ptId) {
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;
			const dx = line.p1Id === ptId ? p1.x - p2.x : p2.x - p1.x;
			const dy = line.p1Id === ptId ? p1.y - p2.y : p2.y - p1.y;
			const len = Math.hypot(dx, dy);
			if (len < 1e-6) continue;
			return {
				entity: line,
				tangentDir: vec(dx / len, dy / len),
			};
		}
	}

	// 2. Check arcs
	for (const arc of sketch.arcs.values()) {
		if (arc.startPointId === ptId || arc.endPointId === ptId) {
			const center = sketch.points.get(arc.centerId);
			const pt = sketch.points.get(ptId);
			if (!center || !pt) continue;
			const rx = pt.x - center.x;
			const ry = pt.y - center.y;
			const rLen = Math.hypot(rx, ry);
			if (rLen < 1e-6) continue;

			// In world coordinates, unit radial vector is (rx/r, ry/r).
			// Clockwise rotation in world coords is (ry/r, -rx/r).
			// Counter-clockwise rotation in world coords is (-ry/r, rx/r).
			const isCW = !!arc.clockwise;
			const forwardTangent = isCW ? vec(ry / rLen, -rx / rLen) : vec(-ry / rLen, rx / rLen);
			const tangentDir = arc.endPointId === ptId ? forwardTangent : vec(-forwardTangent.x, -forwardTangent.y);
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
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
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
		if (this._mode === 'center' && this.drawingStep === 2 && this.centerWorldPos && this.arcPoint1WorldPos) {
			this.updateCenterArcAngle(e.effectiveWorld);
		}
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
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			let pId: string;
			if (snap && snap.type === 'point' && snap.id) {
				pId = snap.id;
				this.startWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				pId = pt.id;
				this.startWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.startPointId = pId;
			this.drawingStep = 1;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const p1World = this.startWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (dist(p1World, effectiveWorld) < 2) {
				return;
			}

			let p2Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
				p2Id = snap.id;
				this.arcPoint2WorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld.x, effectiveWorld.y);
				p2Id = pt.id;
				this.arcPoint2WorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.arcPoint2Id = p2Id;
			this.drawingStep = 2;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const p1 = this.startWorldPos!;
			const p2 = this.arcPoint2WorldPos!;
			const p3 = snap ? snap.worldPos : world;

			const circum = getCircumcircle(p1, p2, p3);
			if (!circum || circum.radius < 1 || circum.radius > 50000) {
				this.ctx.showToast('Cannot form arc from collinear points');
				return;
			}

			const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
			const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
			const s3 = this.ctx.viewport.worldToScreen(p3.x, p3.y);
			const sc = this.ctx.viewport.worldToScreen(circum.center.x, circum.center.y);

			const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
			const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
			const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

			let sweepCW = (ae - as) % TWO_PI;
			if (sweepCW < 0) sweepCW += TWO_PI;
			let testCW = (a3 - as) % TWO_PI;
			if (testCW < 0) testCW += TWO_PI;

			const clockwise = testCW > 0 && testCW < sweepCW;

			const centerPt = sketch.addPoint(circum.center.x, circum.center.y);
			sketch.addArc(
				centerPt.id,
				this.startPointId!,
				this.arcPoint2Id!,
				circum.radius,
				clockwise,
				this.ctx.isConstructionMode
			);
			sketch.commitTransaction();
			this.resetState();
			this.ctx.requestRender();
			this.ctx.showToast('3-point arc created');
		}
	}

	private renderPreviewThreePoint(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.startWorldPos) {
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const length = dist(this.startWorldPos, effectiveWorld);
			const angleDeg =
				(Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
				Math.PI;
			renderLinePreviewVisual(ctx.targetGroup, s1, s2, length, angleDeg, ctx.isConstruction);
		} else if (this.drawingStep === 2 && this.startWorldPos && this.arcPoint2WorldPos) {
			const p1 = this.startWorldPos;
			const p2 = this.arcPoint2WorldPos;
			const p3 = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const circum = getCircumcircle(p1, p2, p3);

			const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
			const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);

			if (!circum || circum.radius < 1 || circum.radius > 50000) {
				const length = dist(p1, p2);
				const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
				renderLinePreviewVisual(ctx.targetGroup, s1, s2, length, angleDeg, ctx.isConstruction);
			} else {
				const sc = ctx.viewport.worldToScreen(circum.center.x, circum.center.y);
				const s3 = ctx.viewport.worldToScreen(p3.x, p3.y);
				const sr = circum.radius * ctx.viewport.zoom;

				const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
				const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
				const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

				let sweepCW = (ae - as) % TWO_PI;
				if (sweepCW < 0) sweepCW += TWO_PI;
				let testCW = (a3 - as) % TWO_PI;
				if (testCW < 0) testCW += TWO_PI;

				const clockwise = testCW > 0 && testCW < sweepCW;
				renderArcPreviewVisual(
					ctx.targetGroup,
					sc,
					s1,
					s2,
					sr,
					clockwise,
					circum.radius,
					undefined,
					ctx.isConstruction
				);
			}
		}
	}

	// =========================================================================
	// Centerpoint Arc Implementation
	// =========================================================================

	private onMouseDownCenter(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			let cId: string;
			if (snap && snap.type === 'point' && snap.id) {
				cId = snap.id;
				this.centerWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				cId = pt.id;
				this.centerWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerId = cId;
			this.drawingStep = 1;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const centerWorld = this.centerWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (dist(centerWorld, effectiveWorld) < 2) {
				return;
			}

			let p1Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId) {
				p1Id = snap.id;
				this.arcPoint1WorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld.x, effectiveWorld.y);
				p1Id = pt.id;
				this.arcPoint1WorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.arcPoint1Id = p1Id;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(this.arcPoint1WorldPos.x, this.arcPoint1WorldPos.y);
			this.arcCenterPrevAngle = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			this.arcCenterTotalAngle = 0;
			this.drawingStep = 2;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const centerWorld = this.centerWorldPos!;
			const startWorld = this.arcPoint1WorldPos!;
			const radius = Math.max(1, dist(centerWorld, startWorld));

			const effectiveWorld = snap ? snap.worldPos : world;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

			if (this.arcCenterPrevAngle !== null) {
				let dAngle = acur - this.arcCenterPrevAngle;
				while (dAngle > Math.PI) dAngle -= TWO_PI;
				while (dAngle < -Math.PI) dAngle += TWO_PI;
				this.arcCenterTotalAngle += dAngle;
			}

			this.arcCenterTotalAngle = this.arcCenterTotalAngle % TWO_PI;

			let clockwise = this.arcCenterTotalAngle >= 0;
			if (Math.abs(this.arcCenterTotalAngle) < 0.001) {
				let delta = acur - as;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
			const endWorldX = centerWorld.x + radius * Math.cos(worldAngle);
			const endWorldY = centerWorld.y + radius * Math.sin(worldAngle);

			let endPointId: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId && snap.id !== this.arcPoint1Id) {
				endPointId = snap.id;
			} else {
				const pt = sketch.addPoint(endWorldX, endWorldY);
				endPointId = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			sketch.addArc(
				this.centerId!,
				this.arcPoint1Id!,
				endPointId,
				radius,
				clockwise,
				this.ctx.isConstructionMode
			);
			sketch.commitTransaction();
			this.resetState();
			this.ctx.requestRender();
			this.ctx.showToast('Centerpoint arc created');
		}
	}

	private updateCenterArcAngle(effectiveWorld: Vec2): void {
		const centerWorld = this.centerWorldPos!;
		const startWorld = this.arcPoint1WorldPos!;

		const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
		const sStart = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
		const sCur = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

		const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
		const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

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
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			renderCirclePreviewVisual(ctx.targetGroup, s1, s2, radius, ctx.isConstruction, true);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.arcPoint1WorldPos) {
			const centerWorld = this.centerWorldPos;
			const startWorld = this.arcPoint1WorldPos;
			const radius = Math.max(1, dist(centerWorld, startWorld));
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;

			const sCenter = ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const sr = radius * ctx.viewport.zoom;

			const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

			let clockwise = this.arcCenterTotalAngle >= 0;
			if (Math.abs(this.arcCenterTotalAngle) < 0.001) {
				let delta = acur - as;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
			const endWorld = vec(
				centerWorld.x + radius * Math.cos(worldAngle),
				centerWorld.y + radius * Math.sin(worldAngle)
			);
			const sEnd = ctx.viewport.worldToScreen(endWorld.x, endWorld.y);

			let sweepAngle = 0;
			if (clockwise) {
				sweepAngle = (acur - as) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			} else {
				sweepAngle = (as - acur) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			}

			renderArcPreviewVisual(
				ctx.targetGroup,
				sCenter,
				sStart,
				sEnd,
				sr,
				clockwise,
				radius,
				sweepAngle,
				ctx.isConstruction
			);
		}
	}

	// =========================================================================
	// Tangent Arc Implementation
	// =========================================================================

	private onMouseDownTangent(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
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
				const nearPt = this.ctx.findPointNear(screen, 16);
				if (nearPt) {
					ptId = nearPt.id;
					ptPos = vec(nearPt.x, nearPt.y);
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
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const p1 = this.tangentStartWorldPos!;
			const p2 = snap ? snap.worldPos : world;
			const geom = this.computeTangentArcGeometry(p1, p2, this.tangentDir!);
			if (!geom) {
				return;
			}

			let endPointId: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.tangentStartPointId) {
				endPointId = snap.id;
			} else {
				const pt = sketch.addPoint(p2.x, p2.y);
				endPointId = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			const centerPt = sketch.addPoint(geom.center.x, geom.center.y);
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

			sketch.commitTransaction();
			this.resetState();
			this.ctx.requestRender();
			this.ctx.showToast('Tangent arc created');
		}
	}

	private computeTangentArcGeometry(
		p1: Vec2,
		p2: Vec2,
		tangentDir: Vec2
	): {
		center: Vec2;
		radius: number;
		clockwise: boolean;
		sweepAngle: number;
		sCenter: Vec2;
		s1: Vec2;
		s2: Vec2;
	} | null {
		const vx = p2.x - p1.x;
		const vy = p2.y - p1.y;
		const L = Math.hypot(vx, vy);
		if (L < 1e-3) return null;

		// Unit tangent leaving p1 in the direction of the connected curve
		const tx = tangentDir.x;
		const ty = tangentDir.y;

		// Unit normal 90 degrees CCW from tangent in Cartesian coordinates
		const nx = -ty;
		const ny = tx;

		const denom = 2 * (vx * nx + vy * ny);
		if (Math.abs(denom) < 1e-4) {
			return null;
		}

		const s = (L * L) / denom;
		const radius = Math.abs(s);
		if (radius < 0.5 || radius > 50000) {
			return null;
		}

		const center = vec(p1.x + s * nx, p1.y + s * ny);

		const sCenter = this.ctx.viewport.worldToScreen(center.x, center.y);
		const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
		const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
		const sT = vec(
			this.ctx.viewport.worldToScreen(p1.x + tx, p1.y + ty).x - s1.x,
			this.ctx.viewport.worldToScreen(p1.x + tx, p1.y + ty).y - s1.y
		);

		// In 2D screen coords (Y down), cross product of (s1 - sCenter) and tangent indicates rotation direction
		const ux = s1.x - sCenter.x;
		const uy = s1.y - sCenter.y;
		const cp = ux * sT.y - uy * sT.x;
		const clockwise = cp > 0;

		const a1 = Math.atan2(s1.y - sCenter.y, s1.x - sCenter.x);
		const a2 = Math.atan2(s2.y - sCenter.y, s2.x - sCenter.x);

		let sweepAngle = clockwise ? (a2 - a1) % TWO_PI : (a1 - a2) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;

		return {
			center,
			radius,
			clockwise,
			sweepAngle,
			sCenter,
			s1,
			s2,
		};
	}

	private renderPreviewTangent(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.tangentStartWorldPos && this.tangentDir) {
			const p1 = this.tangentStartWorldPos;
			const p2 = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const geom = this.computeTangentArcGeometry(p1, p2, this.tangentDir);

			if (geom) {
				const sr = geom.radius * ctx.viewport.zoom;
				renderArcPreviewVisual(
					ctx.targetGroup,
					geom.sCenter,
					geom.s1,
					geom.s2,
					sr,
					geom.clockwise,
					geom.radius,
					(geom.sweepAngle * 180) / Math.PI,
					ctx.isConstruction
				);
			} else {
				const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
				const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				const length = dist(p1, p2);
				const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
				renderLinePreviewVisual(ctx.targetGroup, s1, s2, length, angleDeg, ctx.isConstruction);
			}
		}
	}
}

