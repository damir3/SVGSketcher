import { add, dist, sub, vec, type Vec2 } from '../math/vector';
import { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';
import { createSvgCircle, createSvgElement, createSvgLine } from './svg';
import {
	TRANSFORM_FRAME_ATTRS,
	TRANSFORM_HANDLE_ATTRS,
	TRANSFORM_HANDLE_RADIUS,
	TRANSFORM_ROTATION_STEM_ATTRS,
} from './styles';

const HANDLE_HIT_RADIUS = 9;
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

type TransformHandle =
	| { type: 'move'; cursor: 'move' }
	| { type: 'rotate'; cursor: 'grab' }
	| { type: 'scale'; direction: Vec2; cursor: (typeof RESIZE_CURSORS)[number] };

function resizeCursor(direction: Vec2) {
	const octant = Math.round(Math.atan2(direction.y, direction.x) / (Math.PI / 4));
	return RESIZE_CURSORS[(octant + RESIZE_CURSORS.length) % RESIZE_CURSORS.length];
}

export function getTransformGizmo(screenCenter: Vec2, half: Vec2, angle: number, { exactBounds = false } = {}) {
	const radians = ((angle % 360) * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const x = exactBounds ? half.x : Math.max(12, half.x + 7);
	const y = exactBounds ? half.y : Math.max(12, half.y + 7);
	const toScreen = (x: number, y: number) => {
		const rotated = vec(x * cos - y * sin, x * sin + y * cos);
		return add(screenCenter, vec(rotated.x, -rotated.y));
	};
	return {
		center: screenCenter,
		corners: [vec(-1, 1), vec(1, 1), vec(1, -1), vec(-1, -1)].map(corner => ({
			point: toScreen(corner.x * x, corner.y * y),
			cursor: resizeCursor(sub(toScreen(corner.x, corner.y), screenCenter)),
		})),
		top: toScreen(0, y),
		rotation: toScreen(0, y + TEXT_ROTATION_HANDLE_DISTANCE_PX),
	};
}

export function hitTransformGizmo(screen: Vec2, gizmo: ReturnType<typeof getTransformGizmo>): TransformHandle | null {
	if (dist(screen, gizmo.rotation) <= HANDLE_HIT_RADIUS) return { type: 'rotate', cursor: 'grab' };
	let nearestDistance = dist(screen, gizmo.center);
	let handle: TransformHandle = { type: 'move', cursor: 'move' };
	for (const corner of gizmo.corners) {
		const distance = dist(screen, corner.point);
		if (distance >= nearestDistance) continue;
		nearestDistance = distance;
		handle = { type: 'scale', direction: sub(corner.point, gizmo.center), cursor: corner.cursor };
	}
	return nearestDistance <= HANDLE_HIT_RADIUS ? handle : null;
}

export function renderTransformGizmo(gizmo: ReturnType<typeof getTransformGizmo>, target: SVGGElement): void {
	const { center, corners, top, rotation } = gizmo;
	createSvgElement(
		'polygon',
		{
			...TRANSFORM_FRAME_ATTRS,
			points: corners.map(({ point }) => `${point.x},${point.y}`).join(' '),
		},
		target
	);
	createSvgLine(top, rotation, TRANSFORM_ROTATION_STEM_ATTRS, target);

	for (const point of [...corners.map(corner => corner.point), center, rotation]) {
		createSvgCircle(point, TRANSFORM_HANDLE_RADIUS, TRANSFORM_HANDLE_ATTRS, target);
	}
}
