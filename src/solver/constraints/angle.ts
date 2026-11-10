import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { COLORS, STROKE_WIDTH, DIM_ARROWS } from '../../canvas/styles';
import { createSvgElement, createSvgPath, renderDimensionLabel } from '../../canvas/svg';
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
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
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
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const l1 = ctx.sketch.getLine(this.line1Id);
		const l2 = ctx.sketch.getLine(this.line2Id);
		const p1 = ctx.sketch.points.get(l1 ? l1.p1Id : this.l1P1);
		const p2 = ctx.sketch.points.get(l1 ? l1.p2Id : this.l1P2);
		const p3 = ctx.sketch.points.get(l2 ? l2.p1Id : this.l2P1);
		const p4 = ctx.sketch.points.get(l2 ? l2.p2Id : this.l2P2);
		if (!p1 || !p2 || !p3 || !p4) return;

		const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, undefined, this.line1Id, this.line2Id);

		const v1 = new Vec2().subVectors(p2, p1);
		const v2 = new Vec2().subVectors(p4, p3);
		const l1Len = Math.max(v1.length(), 1e-7);
		const l2Len = Math.max(v2.length(), 1e-7);

		const s1Factor = this.s1 ?? geom.s1;
		const s2Factor = this.s2 ?? geom.s2;

		const u1 = v1.clone().multiplyScalar(s1Factor / l1Len);
		const u2 = v2.clone().multiplyScalar(s2Factor / l2Len);

		const sCenter = ctx.viewport.worldToScreen(geom.pInt);
		const sRay1 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(u1, 20));
		const sRay2 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(u2, 20));

		const a1 = sCenter.angleToPoint(sRay1);
		const a2 = sCenter.angleToPoint(sRay2);

		const TWO_PI = 2 * Math.PI;
		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;

		const sweepFlag = delta > 0 ? 1 : 0;
		const rWorld = this.arcRadius ?? 40;
		const rScreen = Math.max(28, rWorld * ctx.viewport.zoom);

		const a = Vec2.fromPolar(rScreen, a1).add(sCenter);
		const b = Vec2.fromPolar(rScreen, a2).add(sCenter);

		const midAngle = a1 + delta * 0.5;
		const midPoint = Vec2.fromPolar(rScreen, midAngle).add(sCenter);

		const g = createSvgElement(
			'g',
			{
				class: 'dimension-item',
				'data-id': this.id,
				'data-type': 'constraint',
			},
			ctx.targetGroup
		);

		const color = ctx.isSelected ? COLORS.selected : COLORS.primary;

		// Dashed extension lines if arc points extend beyond the physical line segments
		const sp1 = ctx.viewport.worldToScreen(p1);
		const sp2 = ctx.viewport.worldToScreen(p2);
		const sp3 = ctx.viewport.worldToScreen(p3);
		const sp4 = ctx.viewport.worldToScreen(p4);

		if (ctx.renderDashedExtensionLines) {
			const isUserLine1 = Boolean(this.line1Id && ctx.sketch.lines.has(this.line1Id));
			const isUserLine2 = Boolean(this.line2Id && ctx.sketch.lines.has(this.line2Id));
			const isArc1 = Boolean(this.line1Id && ctx.sketch.arcs.has(this.line1Id));
			const isArc2 = Boolean(this.line2Id && ctx.sketch.arcs.has(this.line2Id));
			const hasSeg1 = Boolean(isUserLine1 || isArc1 || ctx.sketch.getLineBetween(this.l1P1, this.l1P2));
			const hasSeg2 = Boolean(isUserLine2 || isArc2 || ctx.sketch.getLineBetween(this.l2P1, this.l2P2));
			if (!this.line1Id || isUserLine1 || isArc1) {
				ctx.renderDashedExtensionLines(g, sCenter, a1, rScreen, sp1, hasSeg1 ? sp2 : sp1, color);
			}
			if (!this.line2Id || isUserLine2 || isArc2) {
				ctx.renderDashedExtensionLines(g, sCenter, a2, rScreen, sp3, hasSeg2 ? sp4 : sp3, color);
			}
		}

		// Arc path with arrowheads
		const arrowUrl = ctx.isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;
		createSvgPath(
			`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
			{
				fill: 'none',
				stroke: color,
				'stroke-width': STROKE_WIDTH.dimension,
				'marker-start': arrowUrl,
				'marker-end': arrowUrl,
			},
			g
		);

		const prefix = this.expression ? 'fx: ' : '';
		renderDimensionLabel(g, midPoint, `${prefix}${this.targetAngle.toFixed(1)}°`, color, 'angle');
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx = LINE_DISTANCE_PX): number | null {
		const l1 = sketch.getLine(this.line1Id);
		const l2 = sketch.getLine(this.line2Id);
		const p1 = sketch.points.get(l1 ? l1.p1Id : this.l1P1);
		const p2 = sketch.points.get(l1 ? l1.p2Id : this.l1P2);
		const p3 = sketch.points.get(l2 ? l2.p1Id : this.l2P1);
		const p4 = sketch.points.get(l2 ? l2.p2Id : this.l2P2);
		if (!p1 || !p2 || !p3 || !p4) return null;

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

		const rWorld = this.arcRadius ?? 40;
		const rScreen = Math.max(28, rWorld * viewport.zoom);

		const midAngle = a1 + delta * 0.5;
		const midPoint = Vec2.fromPolar(rScreen, midAngle).add(sCenter);

		// 1. Check distance to badge / text box
		const dLabel = midPoint.distanceTo(screen);
		if (dLabel <= LABEL_DISTANCE_PX) return dLabel;

		// 2. Check distance to angle arc
		const dCenter = Math.hypot(screen.x - sCenter.x, screen.y - sCenter.y);
		const dRadial = Math.abs(dCenter - rScreen);
		if (dRadial <= LINE_DISTANCE_PX) {
			const pAngle = Vec2.from(sCenter).angleToPoint(screen);
			const sweepAngle = delta;
			let ptSweep = pAngle - a1;
			if (sweepAngle > 0) {
				while (ptSweep < 0) ptSweep += TWO_PI;
				while (ptSweep > TWO_PI) ptSweep -= TWO_PI;
				if (ptSweep <= sweepAngle) return dRadial;
			} else {
				while (ptSweep > 0) ptSweep -= TWO_PI;
				while (ptSweep < -TWO_PI) ptSweep += TWO_PI;
				if (ptSweep >= sweepAngle) return dRadial;
			}
		}

		return null;
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: 'Angle',
			dimension: {
				label: 'Angle',
				getValue: () => `${Number(this.targetAngle.toFixed(2))}°`,
			},
		});
	}
}
