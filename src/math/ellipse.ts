import { Vec2, type XY } from './vector';

/** Returns the unit axes of an ellipse oriented at the given angle in radians. */
export function ellipseAxes(angle: number): { axisU: Vec2; axisV: Vec2 } {
	const axisU = Vec2.fromPolar(1, angle);
	return { axisU, axisV: axisU.clone().perpendicular() };
}

/** Returns the ellipse parameter in radians for the given point in the specified basis. */
export function ellipseParameterAtPoint(point: XY, center: Vec2, radii: Vec2, axisU: Vec2, axisV: Vec2): number {
	const offset = new Vec2().subVectors(point, center);
	return Math.atan2(offset.dot(axisV) / radii.y, offset.dot(axisU) / radii.x);
}

/** Returns the point on an ellipse at the given parameter in radians. */
export function ellipsePointAtParameter(t: number, center: Vec2, radii: Vec2, axisU: Vec2, axisV: Vec2): Vec2 {
	const u = radii.x * Math.cos(t);
	const v = radii.y * Math.sin(t);
	return center.clone().addScaledVector(axisU, u).addScaledVector(axisV, v);
}
