import { SketchDocument } from '../src/model/sketch';
import type { SketchSnapshot } from '../src/model/history';
import { Vec2 } from '../src/math/vector';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';

export const SCENE_VERSION = 1;
export const SCENE_SIZES = { small: 8, medium: 24, large: 64 } as const;
export type SceneSize = keyof typeof SCENE_SIZES;
export type SceneFamily = 'rectangles' | 'splines';
export interface BenchmarkScene {
	id: string;
	version: number;
	family: SceneFamily;
	units: number;
	dragPointId: string;
	origin: { x: number; y: number };
	bounds: { min: Vec2; max: Vec2 };
	snapshot: SketchSnapshot;
}

/** No randomness, timestamps or active-backend dependencies enter scene generation. */
export function createBenchmarkScene(family: SceneFamily, size: SceneSize): BenchmarkScene {
	const previous = getGeometryKernel();
	setGeometryKernel(typescriptGeometryKernel);
	try {
		const sketch = new SketchDocument(),
			units = SCENE_SIZES[size];
		const columns = Math.ceil(Math.sqrt(units));
		let dragPointId = '';
		sketch.beginTransaction();
		sketch.withDeferredSolve(() => {
			for (let i = 0; i < units; i++) {
				const x = (i % columns) * 32,
					y = Math.floor(i / columns) * 24;
				if (family === 'rectangles') {
					const pts = [
						[x, y],
						[x + 16, y],
						[x + 16, y + 10],
						[x, y + 10],
					].map(([px, py]) => sketch.addPoint(new Vec2(px, py)));
					for (let j = 0; j < 4; j++) sketch.addLine(pts[j].id, pts[(j + 1) % 4].id);
					sketch.addHorizontalConstraint(pts[0].id, pts[1].id);
					sketch.addVerticalConstraint(pts[1].id, pts[2].id);
					sketch.addHorizontalConstraint(pts[2].id, pts[3].id);
					sketch.addVerticalConstraint(pts[3].id, pts[0].id);
					sketch.addDistanceConstraint(pts[0].id, pts[1].id, 16);
					sketch.addDistanceConstraint(pts[1].id, pts[2].id, 10);
					if (i === 0) dragPointId = pts[2].id;
				} else {
					const pts = Array.from({ length: 6 }, (_, j) =>
						sketch.addPoint(new Vec2(x + j * 4, y + 8 + Math.sin(j * 1.1) * 3), !(i === 0 && j === 3))
					);
					sketch.addFitSpline(pts.map(p => p.id));
					if (i === 0) {
						sketch.addDistanceConstraint(pts[2].id, pts[3].id, Math.hypot(pts[3].x - pts[2].x, pts[3].y - pts[2].y));
					}
					if (i === 0) dragPointId = pts[3].id;
				}
				const center = sketch.addPoint(new Vec2(x + 8, y + 3), true);
				const circle = sketch.addCircle(center.id, 1.5);
				sketch.addRadiusConstraint(circle.id, 1.5);
			}
		});
		sketch.commitTransaction();
		sketch.clearHistory();
		const origin = sketch.points.get(dragPointId)!;
		return {
			id: `${family}-${size}`,
			version: SCENE_VERSION,
			family,
			units,
			dragPointId,
			origin: { x: origin.x, y: origin.y },
			bounds: { min: new Vec2(-4, -4), max: new Vec2(columns * 32, Math.ceil(units / columns) * 24) },
			snapshot: sketch.takeSnapshot(),
		};
	} finally {
		setGeometryKernel(previous);
	}
}

/** Absolute targets give both backends the same path, independent of their previous solution. */
export function dragTarget(scene: BenchmarkScene, index: number, samples: number): Vec2 {
	const angle = (index / Math.max(1, samples)) * Math.PI * 2;
	return new Vec2(scene.origin.x + Math.cos(angle) * 2, scene.origin.y + Math.sin(angle) * 1.5);
}

export function sceneCounts(sketch: SketchDocument) {
	return {
		points: sketch.points.size,
		lines: sketch.lines.size,
		circles: sketch.circles.size,
		splines: sketch.splines.size,
		constraints: sketch.constraints.size,
		freeParameters: sketch.lastSolverResult?.freeParametersCount ?? 0,
		equations: sketch.lastSolverResult?.equationsCount ?? 0,
	};
}
