import { AABB } from '../math/aabb';
import { vec, type Vec2 } from '../math/vector';

export interface SketchImage {
	id: string;
	fileName: string;
	x: number;
	y: number;
	width: number;
	height: number;
	naturalWidth?: number;
	naturalHeight?: number;
	/** Pivot offset from the image midpoint, in source pixels (right and down). */
	pivotX?: number;
	pivotY?: number;
	angle: number;
	opacity: number;
	/** In-session reference retained by Undo. SVG export only stores the file name. */
	objectUrl?: string;
}

export function getImagePivotOffset(image: SketchImage): Vec2 {
	const x = image.naturalWidth ? ((image.pivotX ?? 0) / image.naturalWidth) * image.width : 0;
	const y = image.naturalHeight ? -((image.pivotY ?? 0) / image.naturalHeight) * image.height : 0;
	const radians = ((image.angle % 360) * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return vec(x * cos - y * sin, x * sin + y * cos);
}

export function getImageBounds(image: SketchImage): AABB {
	const radians = ((image.angle % 360) * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	const halfWidth = (image.width * cos + image.height * sin) / 2;
	const halfHeight = (image.width * sin + image.height * cos) / 2;
	return new AABB({ x: image.x - halfWidth, y: image.y - halfHeight }).addPoint({
		x: image.x + halfWidth,
		y: image.y + halfHeight,
	});
}

export function isValidImage(image: SketchImage): boolean {
	return (
		!!image &&
		typeof image.id === 'string' &&
		typeof image.fileName === 'string' &&
		image.fileName.length > 0 &&
		!/[\\/]/.test(image.fileName) &&
		image.fileName !== '.' &&
		image.fileName !== '..' &&
		[image.x, image.y, image.width, image.height, image.angle, image.opacity].every(Number.isFinite) &&
		image.width > 0 &&
		image.height > 0 &&
		image.opacity >= 0 &&
		image.opacity <= 1
	);
}
