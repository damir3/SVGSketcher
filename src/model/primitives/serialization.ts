import type { ISketchPrimitive } from './base';
import { SketchPoint } from './point';
import { SketchLine } from './line';
import { SketchCircle } from './circle';
import { SketchArc } from './arc';
import { SketchEllipse } from './ellipse';
import { SketchEllipticalArc } from './ellipticalArc';
import { SketchSpline } from './spline';

export interface PointSnapshot {
	type: 'point';
	id: string;
	x: number;
	y: number;
	fixed: boolean;
}
export interface LineSnapshot {
	type: 'line';
	id: string;
	p1Id: string;
	p2Id: string;
	isConstruction?: boolean;
	isSplineHandle?: boolean;
	parentSplineId?: string;
}
export interface CircleSnapshot {
	type: 'circle';
	id: string;
	centerId: string;
	radius: number;
	isConstruction?: boolean;
}
export interface ArcSnapshot {
	type: 'arc';
	id: string;
	centerId: string;
	startPointId: string;
	endPointId: string;
	radius: number;
	clockwise?: boolean;
	isConstruction?: boolean;
}
export interface EllipseSnapshot {
	type: 'ellipse';
	id: string;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	isConstruction?: boolean;
}
export interface EllipticalArcSnapshot {
	type: 'elliptical_arc';
	id: string;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	startPointId: string;
	endPointId: string;
	clockwise?: boolean;
	isConstruction?: boolean;
}
export interface SplineSnapshot {
	type: 'spline';
	id: string;
	splineType: 'fit' | 'control';
	pointIds: string[];
	tangentLineIds?: string[];
	knots?: number[];
	isClosed?: boolean;
	isConstruction?: boolean;
}

export type PrimitiveSnapshot =
	| PointSnapshot
	| LineSnapshot
	| CircleSnapshot
	| ArcSnapshot
	| EllipseSnapshot
	| EllipticalArcSnapshot
	| SplineSnapshot;

export function serializePrimitive(primitive: SketchPoint): PointSnapshot;
export function serializePrimitive(primitive: SketchLine): LineSnapshot;
export function serializePrimitive(primitive: SketchCircle): CircleSnapshot;
export function serializePrimitive(primitive: SketchArc): ArcSnapshot;
export function serializePrimitive(primitive: SketchEllipse): EllipseSnapshot;
export function serializePrimitive(primitive: SketchEllipticalArc): EllipticalArcSnapshot;
export function serializePrimitive(primitive: SketchSpline): SplineSnapshot;
export function serializePrimitive(primitive: ISketchPrimitive): PrimitiveSnapshot {
	const data = Object.fromEntries(
		Object.entries(primitive)
			.filter(([key]) => key !== 'sidebarPanel')
			.map(([key, value]) => [key, structuredClone(value)])
	);
	return data as PrimitiveSnapshot;
}
