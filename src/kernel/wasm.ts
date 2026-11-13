import {
	GEOMETRY_KERNEL_API_VERSION,
	KERNEL_CURVE_STRIDE,
	MAX_BEZIER_INTERSECTION_CANDIDATES,
	MAX_CONIC_INTERSECTION_CANDIDATES,
	type GeometryKernel,
	type IntersectionPair,
	type KernelCurve,
	type Point2,
} from './types';
import type { KernelSolveProblem, KernelSolveResult, KernelSolverEvaluator } from './solverTypes';
import { createWasmSplineKernel, type SplineGeometryBinding } from './splineWasm';
import { createWasmRegionKernel, type RegionBinding } from './regionWasm';
import { createWasmEditingKernel, type EditingBinding } from './editingWasm';

import { createWasmFilletKernel, type FilletBinding } from './filletWasm';

import { createWasmChamferKernel, type ChamferBinding } from './chamferWasm';

import { createWasmOffsetKernel, type OffsetBinding } from './offsetWasm';

/** Structural interface to generated bindings; no generated code is required for TS-only builds. */
export interface WasmKernelBindings {
	offset_geometry: OffsetBinding;
	chamfer_geometry: ChamferBinding;
	fillet_geometry: FilletBinding;
	curve_editing: EditingBinding;
	find_regions_packed: RegionBinding;
	spline_geometry: SplineGeometryBinding;
	api_version(): number;
	intersect_pairs(data: Float64Array): Float64Array;
	solve_system(
		values: Float64Array,
		stiffness: Float64Array,
		lowerBounds: Float64Array,
		settings: Float64Array,
		nativeConstraints: Float64Array,
		evaluate: KernelSolverEvaluator
	): Float64Array;
}

function solveWasm(
	bindings: WasmKernelBindings,
	problem: KernelSolveProblem,
	evaluate: KernelSolverEvaluator
): KernelSolveResult {
	const { options } = problem;
	const settings = new Float64Array([
		problem.equationsCount,
		problem.hardEquationsCount,
		problem.skipDoF ? 1 : 0,
		options.maxIterations,
		options.tolerance,
		options.initialLambda,
		options.lambdaFactor,
		options.minLambda,
		options.maxLambda,
		options.gradRelTolerance ?? 0,
	]);
	const data = bindings.solve_system(
		problem.values,
		problem.stiffness,
		problem.lowerBounds,
		settings,
		problem.nativeConstraints ?? new Float64Array(),
		evaluate
	);
	const n = problem.values.length;
	const status = ['CONVERGED', 'UNDER_CONSTRAINED', 'OVER_CONSTRAINED'] as const;
	const [tag, iterations, initialError, finalError, degreesOfFreedom, fixedCount] = data;
	if (
		data.length < 6 + n ||
		!Number.isInteger(tag) ||
		!status[tag] ||
		!Number.isInteger(iterations) ||
		iterations < 0 ||
		iterations > options.maxIterations ||
		!Number.isFinite(initialError) ||
		!Number.isFinite(finalError) ||
		!Number.isInteger(degreesOfFreedom) ||
		degreesOfFreedom < 0 ||
		degreesOfFreedom > n ||
		!Number.isInteger(fixedCount) ||
		fixedCount < 0 ||
		fixedCount > n ||
		data.length !== 6 + n + fixedCount
	) {
		throw new Error('Invalid WASM solver result');
	}
	const values = data.slice(6, 6 + n);
	if (!values.every(Number.isFinite)) throw new Error('Non-finite WASM solver state');
	const constrainedIndices = Array.from(data.subarray(6 + n));
	if (
		constrainedIndices.some(i => !Number.isInteger(i) || i < 0 || i >= n) ||
		new Set(constrainedIndices).size !== fixedCount
	) {
		throw new Error('Invalid WASM solver parameter indices');
	}
	return { status: status[tag], iterations, initialError, finalError, degreesOfFreedom, values, constrainedIndices };
}

function encodeCurve(curve: KernelCurve, data: Float64Array, offset: number): void {
	if (curve.type === 'segment') {
		data.set([0, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y], offset);
	} else if (curve.type === 'circle') {
		data.set([1, curve.center.x, curve.center.y, curve.radius, 0], offset);
	} else if (curve.type === 'ellipse') {
		data.set(
			[
				2,
				curve.center.x,
				curve.center.y,
				curve.majorAxisPoint.x,
				curve.majorAxisPoint.y,
				curve.minorAxisPoint.x,
				curve.minorAxisPoint.y,
			],
			offset
		);
	} else {
		data[offset] = 3;
		curve.points.forEach((point, i) => data.set([point.x, point.y], offset + 1 + i * 2));
	}
}

export function createWasmGeometryKernel(bindings: WasmKernelBindings): GeometryKernel {
	if (bindings.api_version() !== GEOMETRY_KERNEL_API_VERSION) throw new Error('Unsupported WASM kernel API version');
	if (typeof bindings.solve_system !== 'function') throw new Error('WASM kernel has no numerical solver');
	if (typeof bindings.spline_geometry !== 'function') throw new Error('WASM kernel has no spline operations');
	if (typeof bindings.find_regions_packed !== 'function') throw new Error('WASM kernel has no region operations');
	if (typeof bindings.curve_editing !== 'function') throw new Error('WASM kernel has no curve editing operations');
	if (typeof bindings.fillet_geometry !== 'function') throw new Error('WASM kernel has no fillet operations');
	if (typeof bindings.chamfer_geometry !== 'function') throw new Error('WASM kernel has no chamfer operations');
	if (typeof bindings.offset_geometry !== 'function') throw new Error('WASM kernel has no offset operations');
	return {
		backend: 'wasm',
		apiVersion: GEOMETRY_KERNEL_API_VERSION,
		spline: createWasmSplineKernel((...args) => bindings.spline_geometry(...args)),
		findRegions: createWasmRegionKernel(data => bindings.find_regions_packed(data)),
		offset: createWasmOffsetKernel((data, items, settings) => bindings.offset_geometry(data, items, settings)),
		chamfer: createWasmChamferKernel((data, settings) => bindings.chamfer_geometry(data, settings)),
		fillet: createWasmFilletKernel((data, settings) => bindings.fillet_geometry(data, settings)),
		editing: createWasmEditingKernel((data, settings) => bindings.curve_editing(data, settings)),
		solveSystem: (problem, evaluate) => solveWasm(bindings, problem, evaluate),
		intersectPairs(pairs: readonly IntersectionPair[]): Point2[][] {
			if (!pairs.length) return [];
			const pairStride = KERNEL_CURVE_STRIDE * 2;
			const input = new Float64Array(pairs.length * pairStride);
			pairs.forEach(({ a, b }, i) => {
				encodeCurve(a, input, i * pairStride);
				encodeCurve(b, input, i * pairStride + KERNEL_CURVE_STRIDE);
			});
			const output = bindings.intersect_pairs(input);
			const results: Point2[][] = [];
			let offset = 0;
			for (let i = 0; i < pairs.length; i++) {
				const count = output[offset++];
				const maxCount =
					pairs[i].a.type === 'bezier' || pairs[i].b.type === 'bezier'
						? MAX_BEZIER_INTERSECTION_CANDIDATES
						: pairs[i].a.type === 'ellipse' || pairs[i].b.type === 'ellipse'
							? MAX_CONIC_INTERSECTION_CANDIDATES
							: 2;
				if (!Number.isInteger(count) || count < 0 || count > maxCount || offset + count * 2 > output.length) {
					throw new Error('Invalid WASM intersection result');
				}
				const points: Point2[] = [];
				for (let j = 0; j < count; j++) {
					const x = output[offset++],
						y = output[offset++];
					if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Non-finite WASM intersection point');
					points.push({ x, y });
				}
				results.push(points);
			}
			if (offset !== output.length) throw new Error('Unexpected trailing WASM intersection data');
			return results;
		},
	};
}
