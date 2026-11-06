import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../src/math/ellipse';
import { vec } from '../src/math/vector';

function assertClose(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-12, `Expected ${actual} to be close to ${expected}`);
}

describe('ellipseAxes', () => {
	it('returns perpendicular unit axes oriented by a negative rotation', () => {
		const { axisU, axisV } = ellipseAxes(Math.atan2(-4, 3));

		assertClose(axisU.x, 0.6);
		assertClose(axisU.y, -0.8);
		assertClose(axisV.x, 0.8);
		assertClose(axisV.y, 0.6);
	});
});

describe('ellipseParameterAtPoint', () => {
	const center = vec(10, -7);
	const radii = vec(10, 5);
	const axisU = vec(0.6, 0.8);
	const axisV = vec(-0.8, 0.6);

	it('returns the parameter of a point on a translated, rotated ellipse', () => {
		const point = vec(8 + 3 * Math.sqrt(3), -5.5 + 4 * Math.sqrt(3));

		assertClose(ellipseParameterAtPoint(point, center, radii, axisU, axisV), Math.PI / 6);
	});

	it('normalizes by both radii and preserves the quadrant for points off the ellipse', () => {
		assertClose(ellipseParameterAtPoint(vec(12, 4), center, radii, axisU, axisV), Math.PI / 4);
		assertClose(ellipseParameterAtPoint(vec(8, -18), center, radii, axisU, axisV), (-3 * Math.PI) / 4);
	});

	it('reverses the parameter sign when the second basis axis is reversed', () => {
		const reversedAxisV = vec(0.8, -0.6);

		assertClose(ellipseParameterAtPoint(vec(12, 4), center, radii, axisU, reversedAxisV), -Math.PI / 4);
	});
});

describe('ellipsePointAtParameter', () => {
	const center = vec(10, -7);
	const radii = vec(10, 5);
	const axisU = vec(0.6, 0.8);
	const axisV = vec(-0.8, 0.6);

	it('evaluates a point on a translated, rotated ellipse with unequal radii', () => {
		const point = ellipsePointAtParameter(Math.PI / 6, center, radii, axisU, axisV);

		assertClose(point.x, 8 + 3 * Math.sqrt(3));
		assertClose(point.y, -5.5 + 4 * Math.sqrt(3));
	});

	it('preserves a negative parameter in a basis with the second axis reversed', () => {
		const reversedAxisV = vec(0.8, -0.6);
		const parameter = -Math.PI / 2;
		const point = ellipsePointAtParameter(parameter, center, radii, axisU, reversedAxisV);

		assertClose(point.x, 6);
		assertClose(point.y, -4);
		assertClose(ellipseParameterAtPoint(point, center, radii, axisU, reversedAxisV), parameter);
	});
});
