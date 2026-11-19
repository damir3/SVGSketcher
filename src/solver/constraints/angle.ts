import { formatDimensionValue, renderAngleDimensionVisual } from '../../canvas/dimensionGeometry';
import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { LABEL_DISTANCE_PX, LINE_DISTANCE_PX } from '../../canvas/distances';
import { ORIGIN, Vec2 } from '../../math/vector';

/**
 * Dimensional constraint: angle between two lines equals targetAngle (in degrees)
 */
export class AngleConstraint extends BaseConstraint {
	readonly line1Id: string;
	readonly line2Id: string;
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;
	targetAngle: number; // in degrees
	arcRadius?: number; // visual radius in world units
	s1: number; // orientation factor for line 1 (+1 or -1)
	s2: number; // orientation factor for line 2 (+1 or -1)
	sign: number; // cross direction factor (+1 or -1)

	constructor(
		id: string,
		line1Id: string,
		line2Id: string,
		l1P1: string,
		l1P2: string,
		l2P1: string,
		l2P2: string,
		targetAngle: number,
		arcRadius = 40,
		s1 = 1,
		s2 = 1,
		sign = 1,
		weight = 1.0
	) {
		const isAxis1 = line1Id === 'axis_x' || line1Id === 'axis_y';
		const isAxis2 = line2Id === 'axis_x' || line2Id === 'axis_y';
		super(
			id,
			'angle',
			'Angle',
			[
				...new Set(
					[line1Id, line2Id, ...(isAxis1 ? [] : [l1P1, l1P2]), ...(isAxis2 ? [] : [l2P1, l2P2])].filter(Boolean)
				),
			],
			weight,
			false,
			true,
			targetAngle
		);
		this.line1Id = line1Id;
		this.line2Id = line2Id;
		this.l1P1 = isAxis1 ? 'origin' : l1P1;
		this.l1P2 = isAxis1 ? line1Id : l1P2;
		this.l2P1 = isAxis2 ? 'origin' : l2P1;
		this.l2P2 = isAxis2 ? line2Id : l2P2;
		this.targetAngle = targetAngle;
		this.arcRadius = arcRadius;
		this.s1 = s1;
		this.s2 = s2;
		this.sign = sign;
	}

	override getEquationsCount(): number {
		return this.isReference ? 0 : 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		if (this.isReference) return [];
		const isAxis1 = this.line1Id === 'axis_x' || this.line1Id === 'axis_y';
		const isAxis2 = this.line2Id === 'axis_x' || this.line2Id === 'axis_y';

		const p1 = readParamPoint(paramMap, this.l1P1);
		const p2 = readParamPoint(paramMap, this.l1P2);
		const p3 = readParamPoint(paramMap, this.l2P1);
		const p4 = readParamPoint(paramMap, this.l2P2);

		const dir1 = new Vec2().subVectors(p2, p1).multiplyScalar(this.s1);
		const dir2 = new Vec2().subVectors(p4, p3).multiplyScalar(this.s2);

		const l1 = Math.max(dir1.length(), 1e-7);
		const l2 = Math.max(dir2.length(), 1e-7);
		const avgL = isAxis1 ? l2 : isAxis2 ? l1 : (l1 + l2) * 0.5;

		const u1 = dir1.clone().divideScalar(l1);
		const u2 = dir2.clone().divideScalar(l2);

		const targetRad = (this.targetAngle * Math.PI) / 180;
		const rotAngle = this.sign * targetRad;
		const rotated = u1.rotateAround(ORIGIN, rotAngle);

		// Cross product between rotated u1 and u2
		return [rotated.cross(u2) * avgL * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		if (this.isReference) return [];
		const d1 = readParamPoint(paramMap, this.l1P2).sub(readParamPoint(paramMap, this.l1P1)).multiplyScalar(this.s1);
		const d2 = readParamPoint(paramMap, this.l2P2).sub(readParamPoint(paramMap, this.l2P1)).multiplyScalar(this.s2);
		const length1 = d1.length(),
			length2 = d2.length();
		const l1 = Math.max(length1, 1e-7),
			l2 = Math.max(length2, 1e-7);
		const u1 = d1.divideScalar(l1),
			u2 = d2.divideScalar(l2);
		const angle = (this.sign * this.targetAngle * Math.PI) / 180;
		const rotated = u1.clone().rotateAround(ORIGIN, angle);
		const cross = rotated.cross(u2);
		const axis1 = this.line1Id === 'axis_x' || this.line1Id === 'axis_y';
		const axis2 = this.line2Id === 'axis_x' || this.line2Id === 'axis_y';
		const average = axis1 ? l2 : axis2 ? l1 : (l1 + l2) * 0.5;
		const gradient = (u: Vec2, length: number, actualLength: number, g: Vec2, averageFactor: number) => {
			if (actualLength > 1e-7) g.addScaledVector(u, -u.dot(g));
			g.multiplyScalar(average / length);
			if (actualLength > 1e-7) g.addScaledVector(u, cross * averageFactor);
			return g.multiplyScalar(this.weight);
		};
		const g1 = gradient(
			u1,
			l1,
			length1,
			new Vec2(u2.y, -u2.x).rotateAround(ORIGIN, -angle),
			axis1 ? 0 : axis2 ? 1 : 0.5
		).multiplyScalar(this.s1);
		const g2 = gradient(u2, l2, length2, new Vec2(-rotated.y, rotated.x), axis1 ? 1 : axis2 ? 0 : 0.5).multiplyScalar(
			this.s2
		);
		const entries: JacobianEntry[] = [];
		for (const [id, g, sign] of [
			[this.l1P1, g1, -1],
			[this.l1P2, g1, 1],
			[this.l2P1, g2, -1],
			[this.l2P2, g2, 1],
		] as const) {
			this.addJacobianEntry(entries, paramIndices, `${id}.x`, baseRow, g.x * sign);
			this.addJacobianEntry(entries, paramIndices, `${id}.y`, baseRow, g.y * sign);
		}
		return entries;
	}

	isSatisfied(paramMap: Map<string, number>): boolean {
		if (this.isReference) return true;
		const dir1 = readParamPoint(paramMap, this.l1P2).sub(readParamPoint(paramMap, this.l1P1)).multiplyScalar(this.s1);
		const dir2 = readParamPoint(paramMap, this.l2P2).sub(readParamPoint(paramMap, this.l2P1)).multiplyScalar(this.s2);
		const length1 = dir1.length();
		const length2 = dir2.length();
		if (!Number.isFinite(length1) || !Number.isFinite(length2) || length1 === 0 || length2 === 0) return false;
		const rotated = dir1.divideScalar(length1).rotateAround(ORIGIN, (this.sign * this.targetAngle * Math.PI) / 180);
		const actual = dir2.divideScalar(length2);
		// The weighted residual shrinks with the lines, even if their angle remains wrong.
		const angularError = Math.atan2(rotated.cross(actual), rotated.dot(actual));
		return Math.abs(angularError) <= 1e-3;
	}

	updateReferenceValue(paramMap: Map<string, number>, sketch?: SketchDocument): void {
		if (!this.isReference) return;
		const dir1 = readParamPoint(paramMap, this.l1P2).sub(readParamPoint(paramMap, this.l1P1)).multiplyScalar(this.s1);
		const dir2 = readParamPoint(paramMap, this.l2P2).sub(readParamPoint(paramMap, this.l2P1)).multiplyScalar(this.s2);
		const angle = Math.atan2(dir1.cross(dir2), dir1.dot(dir2));
		const arc = this.line1Id === this.line2Id ? sketch?.arcs.get(this.line1Id) : undefined;
		this.targetAngle = arc
			? (((((angle * (arc.clockwise ? -1 : 1)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 180) / Math.PI
			: (Math.abs(angle) * 180) / Math.PI;
		this.value = this.targetAngle;
		this.name = 'Reference Angle';
		this.expression = undefined;
	}

	private resolveLinePoints(sketch: SketchDocument) {
		const l1 = sketch.getLine(this.line1Id);
		const l2 = sketch.getLine(this.line2Id);
		const p1 = sketch.points.get(l1 ? l1.p1Id : this.l1P1);
		const p2 = sketch.points.get(l1 ? l1.p2Id : this.l1P2);
		const p3 = sketch.points.get(l2 ? l2.p1Id : this.l2P1);
		const p4 = sketch.points.get(l2 ? l2.p2Id : this.l2P2);
		return p1 && p2 && p3 && p4 ? { l1, l2, p1, p2, p3, p4 } : null;
	}

	moveLabelTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		const world = viewport.screenToWorld(screen);
		const resolved = this.resolveLinePoints(sketch);
		if (!resolved) return;
		const { l1, l2, p1, p2, p3, p4 } = resolved;
		const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world, this.line1Id, this.line2Id);
		const arcRadiusWorld = Math.max(10, world.distanceTo(geom.pInt));
		this.arcRadius = arcRadiusWorld;

		if (l1 && l2 && (geom.s1 !== this.s1 || geom.s2 !== this.s2)) {
			this.s1 = geom.s1;
			this.s2 = geom.s2;
			this.sign = geom.sign;
			const newAngle = Math.round(geom.initialAngleDeg * 10) / 10;
			this.targetAngle = newAngle;
			this.value = newAngle;
			this.name = 'Angle';
			if (this.isReference) {
				this.updateReferenceValue(sketch.paramManager.getCurrentValues(), sketch);
				sketch.notify();
			} else {
				sketch.solve();
			}
		}
	}

	private computeScreenArcLayout(sketch: SketchDocument, viewport: Viewport) {
		this.updateReferenceValue(sketch.paramManager.getCurrentValues(), sketch);
		const resolved = this.resolveLinePoints(sketch);
		if (!resolved) return null;
		const { p1, p2, p3, p4 } = resolved;

		const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, undefined, this.line1Id, this.line2Id);

		const v1 = new Vec2().subVectors(p2, p1);
		const v2 = new Vec2().subVectors(p4, p3);
		const l1Len = Math.max(v1.length(), 1e-7);
		const l2Len = Math.max(v2.length(), 1e-7);

		const s1Factor = this.s1 ?? geom.s1;
		const s2Factor = this.s2 ?? geom.s2;

		const u1 = v1.clone().multiplyScalar(s1Factor / l1Len);
		const u2 = v2.clone().multiplyScalar(s2Factor / l2Len);

		const sCenter = viewport.worldToScreen(geom.pInt);
		const sRay1 = viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(u1, 20));
		const sRay2 = viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(u2, 20));

		const a1 = Vec2.from(sCenter).angleToPoint(sRay1);
		const a2 = Vec2.from(sCenter).angleToPoint(sRay2);

		const TWO_PI = 2 * Math.PI;
		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;
		const arc = this.line1Id === this.line2Id ? sketch.arcs.get(this.line1Id) : undefined;
		if (this.isReference && arc) delta = ((arc.clockwise ? 1 : -1) * this.targetAngle * Math.PI) / 180;

		const rWorld = this.arcRadius ?? 40;
		const rScreen = Math.max(28, rWorld * viewport.zoom);
		const midAngle = a1 + delta * 0.5;
		const midPoint = Vec2.fromPolar(rScreen, midAngle).add(sCenter);

		return { p1, p2, p3, p4, sCenter, a1, a2, delta, rScreen, midAngle, midPoint };
	}

	getLabelScreenPos(sketch: SketchDocument, viewport: Viewport): Vec2 | null {
		return this.computeScreenArcLayout(sketch, viewport)?.midPoint ?? null;
	}

	override render(ctx: ConstraintRenderContext): void {
		this.updateReferenceValue(ctx.sketch.paramManager.getCurrentValues(), ctx.sketch);
		const layout = this.computeScreenArcLayout(ctx.sketch, ctx.viewport);
		if (!layout) return;
		const { p1, p2, p3, p4, sCenter, a1, a2, delta, rScreen } = layout;

		// Extension lines if arc points extend beyond the physical line segments
		const extensionLines: Array<{ angle: number; pA: Vec2; pB: Vec2 }> = [];
		const addExt = (lineId: string, lp1: string, lp2: string, angle: number, pA: Vec2, pB: Vec2) => {
			const isUser = Boolean(lineId && ctx.sketch.lines.has(lineId));
			const isArc = Boolean(lineId && ctx.sketch.arcs.has(lineId));
			if (!lineId || isUser || isArc) {
				const hasSeg = Boolean(isUser || isArc || ctx.sketch.getLineBetween(lp1, lp2));
				extensionLines.push({
					angle,
					pA: ctx.viewport.worldToScreen(pA),
					pB: ctx.viewport.worldToScreen(hasSeg ? pB : pA),
				});
			}
		};
		addExt(this.line1Id, this.l1P1, this.l1P2, a1, p1, p2);
		addExt(this.line2Id, this.l2P1, this.l2P2, a2, p3, p4);

		const prefix = this.expression ? 'fx: ' : '';
		renderAngleDimensionVisual({
			parent: ctx.targetGroup,
			sCenter,
			a1,
			a2,
			delta,
			rScreen,
			label: this.isReference
				? `(${formatDimensionValue(this.targetAngle, 1)}°)`
				: `${prefix}${formatDimensionValue(this.targetAngle, 1)}°`,
			isSelected: ctx.isSelected,
			constraintId: this.id,
			extensionLines,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx = LINE_DISTANCE_PX): number | null {
		const layout = this.computeScreenArcLayout(sketch, viewport);
		if (!layout) return null;
		const { sCenter, a1, delta, rScreen, midPoint } = layout;

		// 1. Check distance to badge / text box
		const dLabel = midPoint.distanceTo(screen);
		if (dLabel <= LABEL_DISTANCE_PX) return dLabel;

		// 2. Check distance to angle arc
		const dCenter = Math.hypot(screen.x - sCenter.x, screen.y - sCenter.y);
		const dRadial = Math.abs(dCenter - rScreen);
		if (dRadial <= LINE_DISTANCE_PX) {
			const TWO_PI = 2 * Math.PI;
			const sign = delta >= 0 ? 1 : -1;
			const ptSweep = ((((Vec2.from(sCenter).angleToPoint(screen) - a1) * sign) % TWO_PI) + TWO_PI) % TWO_PI;
			if (ptSweep <= Math.abs(delta)) return dRadial;
		}

		return null;
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () => (this.isReference ? 'Reference Angle' : 'Angle'),
			dimension: {
				label: 'Angle',
				getValue: () => `${Number(this.targetAngle.toFixed(2))}°`,
				isDisabled: () => !!this.isReference,
				disabledContent: () =>
					`<div class="inspector-row"><span>Reference</span><strong>(${formatDimensionValue(this.targetAngle, 1)}°)</strong></div>`,
			},
		});
	}
}
