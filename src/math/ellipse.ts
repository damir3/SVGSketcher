import { dot, sub, vec, type Vec2 } from './vector';

/** Returns the unit axes of an ellipse oriented at the given angle in radians. */
export function ellipseAxes(angle: number): { axisU: Vec2; axisV: Vec2 } {
	const axisU = vec(Math.cos(angle), Math.sin(angle));
	return { axisU, axisV: vec(-axisU.y, axisU.x) };
}

/** Returns the ellipse parameter in radians for the given point in the specified basis. */
export function ellipseParameterAtPoint(point: Vec2, center: Vec2, radii: Vec2, axisU: Vec2, axisV: Vec2): number {
	const offset = sub(point, center);
	return Math.atan2(dot(offset, axisV) / radii.y, dot(offset, axisU) / radii.x);
}

/** Returns the point on an ellipse at the given parameter in radians. */
export function ellipsePointAtParameter(t: number, center: Vec2, radii: Vec2, axisU: Vec2, axisV: Vec2): Vec2 {
	const u = radii.x * Math.cos(t);
	const v = radii.y * Math.sin(t);
	return vec(center.x + u * axisU.x + v * axisV.x, center.y + u * axisU.y + v * axisV.y);
}
