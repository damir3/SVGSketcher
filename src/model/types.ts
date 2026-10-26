import type { IConstraint } from '../solver/types';
export * from './primitives';
import type {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
} from './primitives';

export type SketchEntity =
	| { type: 'point'; entity: SketchPoint }
	| { type: 'line'; entity: SketchLine }
	| { type: 'circle'; entity: SketchCircle }
	| { type: 'arc'; entity: SketchArc }
	| { type: 'ellipse'; entity: SketchEllipse }
	| { type: 'elliptical_arc'; entity: SketchEllipticalArc }
	| { type: 'spline'; entity: SketchSpline }
	| { type: 'constraint'; entity: IConstraint };

export interface SelectionState {
	pointIds: Set<string>;
	lineIds: Set<string>;
	circleIds: Set<string>;
	arcIds: Set<string>;
	ellipseIds: Set<string>;
	ellipticalArcIds: Set<string>;
	splineIds: Set<string>;
	constraintIds: Set<string>;
}
