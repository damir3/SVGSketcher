import { Vec2, type XY } from '../math/vector';
import { createSvgElement, createSvgPath } from './svg';
import { DIMENSION_FONT_SIZE, DIMENSION_TEXT_ATTRS } from './styles';

export function getCuttingPlaneMarks(start: XY, end: XY, unit: number, fontSize = DIMENSION_FONT_SIZE) {
	const direction = new Vec2().subVectors(end, start).normalizeOrNull(1e-6);
	if (!direction) return null;
	const normal = direction.clone().perpendicular();
	const labelOffset = Math.max(5 * unit, 0.625 * fontSize);
	const ends = [start, end].map((point, index) => {
		const tip = Vec2.from(point).addScaledVector(normal, 9 * unit);
		const base = tip.clone().addScaledVector(normal, -3 * unit);
		const left = base.clone().addScaledVector(direction, -2 * unit);
		const right = base.clone().addScaledVector(direction, 2 * unit);
		const label = Vec2.from(point).addScaledVector(direction, index ? labelOffset : -labelOffset);
		return {
			path: `M${point.x},${point.y} L${tip.x},${tip.y} M${left.x},${left.y} L${tip.x},${tip.y} L${right.x},${right.y}`,
			label,
			tip,
		};
	});
	return { ends, fontSize };
}

export function renderCuttingPlaneMarks(start: XY, end: XY, stroke: string, group: SVGGElement): void {
	const marks = getCuttingPlaneMarks(start, end, 1.5);
	if (!marks) return;
	for (const { path, label } of marks.ends) {
		createSvgPath(path, { fill: 'none', stroke, 'stroke-width': 1.5, 'pointer-events': 'none' }, group);
		createSvgElement(
			'text',
			{
				...DIMENSION_TEXT_ATTRS,
				x: label.x,
				y: label.y,
				fill: stroke,
				'pointer-events': 'none',
			},
			group,
			'A'
		);
	}
}
