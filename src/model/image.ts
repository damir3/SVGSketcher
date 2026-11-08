import { AABB } from '../math/aabb';

export interface SketchImage {
	id: string;
	fileName: string;
	x: number;
	y: number;
	width: number;
	height: number;
	naturalWidth?: number;
	naturalHeight?: number;
	angle: number;
	opacity: number;
	/** In-session reference retained by Undo. SVG export only stores the file name. */
	objectUrl?: string;
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
