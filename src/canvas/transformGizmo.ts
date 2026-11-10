import { ORIGIN, Vec2 } from '../math/vector';
import { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';
import { createSvgCircle, createSvgElement, createSvgLine } from './svg';
import {
	COLORS,
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
	const octant = Math.round(direction.signedAngle() / (Math.PI / 4));
	return RESIZE_CURSORS[(octant + RESIZE_CURSORS.length) % RESIZE_CURSORS.length];
}

export function getTransformGizmo(
	screenCenter: Vec2,
	half: Vec2,
	angle: number,
	{ exactBounds = false, pivot = screenCenter } = {}
) {
	const radians = ((angle % 360) * Math.PI) / 180;
	const x = exactBounds ? half.x : Math.max(12, half.x + 7);
	const y = exactBounds ? half.y : Math.max(12, half.y + 7);
	const toScreen = (x: number, y: number) => {
		const rotated = new Vec2(x, y).rotateAround(ORIGIN, radians);
		return new Vec2().addVectors(screenCenter, new Vec2(rotated.x, -rotated.y));
	};
	const upperRotation = toScreen(0, y + TEXT_ROTATION_HANDLE_DISTANCE_PX);
	const rotationBelow = upperRotation.distanceTo(pivot) < 2 * HANDLE_HIT_RADIUS;
	return {
		center: pivot,
		corners: [new Vec2(-1, 1), new Vec2(1, 1), new Vec2(1, -1), new Vec2(-1, -1)].map(corner => ({
			point: toScreen(corner.x * x, corner.y * y),
			cursor: resizeCursor(new Vec2().subVectors(toScreen(corner.x, corner.y), screenCenter)),
		})),
		rotationBase: toScreen(0, rotationBelow ? -y : y),
		rotation: rotationBelow ? toScreen(0, -y - TEXT_ROTATION_HANDLE_DISTANCE_PX) : upperRotation,
	};
}

export function hitTransformGizmo(screen: Vec2, gizmo: ReturnType<typeof getTransformGizmo>): TransformHandle | null {
	if (screen.distanceTo(gizmo.rotation) <= HANDLE_HIT_RADIUS) return { type: 'rotate', cursor: 'grab' };
	let nearestDistance = screen.distanceTo(gizmo.center);
	let handle: TransformHandle = { type: 'move', cursor: 'move' };
	for (const corner of gizmo.corners) {
		const distance = screen.distanceTo(corner.point);
		if (distance >= nearestDistance) continue;
		nearestDistance = distance;
		handle = { type: 'scale', direction: new Vec2().subVectors(corner.point, gizmo.center), cursor: corner.cursor };
	}
	return nearestDistance <= HANDLE_HIT_RADIUS ? handle : null;
}

export function renderTransformGizmo(
	gizmo: ReturnType<typeof getTransformGizmo>,
	target: SVGGElement,
	stroke: string = COLORS.primary
): void {
	const { center, corners, rotationBase, rotation } = gizmo;
	createSvgElement(
		'polygon',
		{
			...TRANSFORM_FRAME_ATTRS,
			stroke,
			points: corners.map(({ point }) => `${point.x},${point.y}`).join(' '),
		},
		target
	);
	createSvgLine(rotationBase, rotation, { ...TRANSFORM_ROTATION_STEM_ATTRS, stroke }, target);

	for (const point of [...corners.map(corner => corner.point), center, rotation]) {
		createSvgCircle(point, TRANSFORM_HANDLE_RADIUS, { ...TRANSFORM_HANDLE_ATTRS, stroke }, target);
	}
}
