// Numerical reference captured before native routing. Document edits remain in chamfer.ts.
import { Vec2 } from './vector';
import type { ChamferCandidate, ChamferMode, ChamferResult } from './chamfer';

export function calculateChamferCorner(vertexPos: Vec2, pOther1: Vec2, pOther2: Vec2) {
	const v1 = new Vec2().subVectors(pOther1, vertexPos);
	const v2 = new Vec2().subVectors(pOther2, vertexPos);

	const len1 = v1.length();
	const len2 = v2.length();

	if (len1 < 1e-4 || len2 < 1e-4) return null;

	const dir1 = v1.clone().divideScalar(len1);
	const dir2 = v2.clone().divideScalar(len2);

	const dotValue = Math.max(-1, Math.min(1, dir1.dot(dir2)));
	// Check collinearity
	if (Math.abs(dotValue) > 0.9999) return null;

	const cornerAngleRad = Math.acos(dotValue);

	return { dir1, dir2, len1, len2, cornerAngleRad };
}

/**
 * Calculates chamfer geometry (points t1 and t2, distances, angle) for a candidate given parameters.
 */
export function calculateChamferGeometry(
	candidate: Pick<ChamferCandidate, 'vertexPos' | 'dir1' | 'dir2' | 'len1' | 'len2' | 'cornerAngleRad'>,
	mode: ChamferMode,
	dist1Input: number,
	dist2Input: number,
	angleDegInput: number,
	flip: boolean
): ChamferResult {
	const theta = candidate.cornerAngleRad;
	let effDist1 = 0;
	let effDist2 = 0;
	let effAngleDeg = 45;

	let isValid = true;
	let errorMessage: string | undefined;

	const maxDist1 = Math.max(0.1, candidate.len1 - 0.1);
	const maxDist2 = Math.max(0.1, candidate.len2 - 0.1);

	if (mode === 'equal_distance') {
		effDist1 = Math.max(0.1, dist1Input);
		effDist2 = effDist1;
		// In equal distance mode on corner theta, angle at A in triangle VAB:
		// (180 - theta) / 2
		effAngleDeg = ((Math.PI - theta) / 2) * (180 / Math.PI);
	} else if (mode === 'two_distance') {
		const d1 = Math.max(0.1, dist1Input);
		const d2 = Math.max(0.1, dist2Input);
		if (!flip) {
			effDist1 = d1;
			effDist2 = d2;
		} else {
			effDist1 = d2;
			effDist2 = d1;
		}
		// Angle at A via arctan2 / trigonometry in triangle VAB:
		// Vector AB = t2 - t1
		const pt1 = candidate.vertexPos.clone().addScaledVector(candidate.dir1, effDist1);
		const pt2 = candidate.vertexPos.clone().addScaledVector(candidate.dir2, effDist2);
		const vAB = new Vec2().subVectors(pt2, pt1);
		const vAV = candidate.dir1.clone().negate();
		const dotAB_AV = Math.max(-1, Math.min(1, vAB.dot(vAV) / (vAB.length() || 1)));
		effAngleDeg = Math.acos(dotAB_AV) * (180 / Math.PI);
	} else if (mode === 'distance_angle') {
		const d = Math.max(0.1, dist1Input);
		const aDeg = Math.max(0, Math.min(179.9, angleDegInput));
		effAngleDeg = aDeg;
		const alphaRad = (aDeg * Math.PI) / 180;

		// In triangle VAB, corner at V is theta, angle at reference vertex is alphaRad.
		// Sum of angles = 180 -> beta = pi - theta - alphaRad.
		// For valid triangle, alphaRad + theta must be < pi, and alphaRad > 0.
		if (alphaRad <= 1e-4) {
			isValid = false;
			errorMessage = 'Angle must be greater than 0°';
			effDist1 = d;
			effDist2 = 0;
		} else if (alphaRad + theta >= Math.PI - 1e-4) {
			isValid = false;
			errorMessage = 'Angle too large for corner';
			// Fallback calculation so geometry doesn't blow up
			effDist1 = d;
			effDist2 = d;
		} else {
			const sinBeta = Math.sin(Math.PI - theta - alphaRad);
			const sinAlpha = Math.sin(alphaRad);
			const otherDist = d * (sinAlpha / Math.max(1e-5, sinBeta));

			if (!flip) {
				effDist1 = d;
				effDist2 = otherDist;
			} else {
				effDist2 = d;
				effDist1 = otherDist;
			}
		}
	}

	if (effDist1 > maxDist1 || effDist2 > maxDist2) {
		isValid = false;
		if (!errorMessage) {
			errorMessage = 'Distance too large for corner';
		}
	}

	const t1 = candidate.vertexPos.clone().addScaledVector(candidate.dir1, effDist1);
	const t2 = candidate.vertexPos.clone().addScaledVector(candidate.dir2, effDist2);

	const chamferLength = t1.distanceTo(t2);
	const midPoint = new Vec2().midpoint(t1, t2);
	const bisectorDir = new Vec2().addVectors(candidate.dir1, candidate.dir2).normalizeOrUnitX();

	return {
		t1,
		t2,
		dist1: effDist1,
		dist2: effDist2,
		angleDeg: effAngleDeg,
		chamferLength,
		midPoint,
		bisectorDir,
		maxDist1,
		maxDist2,
		isValid,
		errorMessage,
	};
}
