import type { IConstraint } from '../solver/types';

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
  isConstruction?: boolean;
}

export interface SketchLine {
  id: string;
  p1Id: string;
  p2Id: string;
  isConstruction?: boolean;
}

export interface SketchCircle {
  id: string;
  centerId: string;
  radius: number;
  isConstruction?: boolean;
}

export interface SketchArc {
  id: string;
  centerId: string;
  startPointId: string;
  endPointId: string;
  radius: number;
  clockwise?: boolean;
  isConstruction?: boolean;
}

export interface SketchEllipse {
  id: string;
  centerId: string;
  majorAxisPointId: string;
  minorAxisPointId: string;
  isConstruction?: boolean;
}

export interface SketchEllipticalArc {
  id: string;
  centerId: string;
  majorAxisPointId: string;
  minorAxisPointId: string;
  startPointId: string;
  endPointId: string;
  clockwise?: boolean;
  isConstruction?: boolean;
}

export type SketchEntity =
  | { type: 'point'; entity: SketchPoint }
  | { type: 'line'; entity: SketchLine }
  | { type: 'circle'; entity: SketchCircle }
  | { type: 'arc'; entity: SketchArc }
  | { type: 'ellipse'; entity: SketchEllipse }
  | { type: 'elliptical_arc'; entity: SketchEllipticalArc }
  | { type: 'constraint'; entity: IConstraint };

export interface SelectionState {
  pointIds: Set<string>;
  lineIds: Set<string>;
  circleIds: Set<string>;
  arcIds: Set<string>;
  ellipseIds: Set<string>;
  ellipticalArcIds: Set<string>;
  constraintIds: Set<string>;
}
