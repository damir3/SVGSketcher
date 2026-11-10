import { DEFAULT_ZOOM } from '../constants';
import { Vec2, type XY } from '../math/vector';
import type { AABB } from '../math/aabb';

export class Viewport {
	width: number;
	height: number;
	panX = 0; // World origin X on screen
	panY = 0; // World origin Y on screen
	zoom = DEFAULT_ZOOM; // Screen pixels per world unit

	private resizeFrame?: { width: number; height: number; panX: number; panY: number; zoom: number };

	constructor(width = 800, height = 600) {
		this.width = width;
		this.height = height;
		this.centerOrigin();
	}

	resize(width: number, height: number): boolean {
		if (width <= 0 || height <= 0 || (width === this.width && height === this.height)) return false;

		const center = this.screenToWorld(new Vec2(this.width / 2, this.height / 2));
		let frame = this.resizeFrame;
		// Keep the same world bounds across resize events until the camera moves.
		if (!frame || frame.panX !== this.panX || frame.panY !== this.panY || frame.zoom !== this.zoom) {
			frame = {
				width: this.width / this.zoom,
				height: this.height / this.zoom,
				panX: this.panX,
				panY: this.panY,
				zoom: this.zoom,
			};
			this.resizeFrame = frame;
		}

		this.width = width;
		this.height = height;
		this.zoom = Math.min(width / frame.width, height / frame.height);
		this.panX = width / 2 - center.x * this.zoom;
		this.panY = height / 2 + center.y * this.zoom;
		frame.panX = this.panX;
		frame.panY = this.panY;
		frame.zoom = this.zoom;
		return true;
	}

	centerOrigin(): void {
		this.panX = this.width / 2;
		this.panY = this.height / 2;
	}

	getTargetFit(bounds: AABB, padding = 80, minZoom = 0.05): { panX: number; panY: number; zoom: number } {
		const { min, max } = bounds;
		const boxWidth = max.x - min.x;
		const boxHeight = max.y - min.y;

		const availWidth = Math.min(this.width, Math.max(this.width - padding * 2, 50));
		const availHeight = Math.min(this.height, Math.max(this.height - padding * 2, 50));

		const effectiveWidth = Math.max(boxWidth, 20);
		const effectiveHeight = Math.max(boxHeight, 20);

		const zoomX = availWidth / effectiveWidth;
		const zoomY = availHeight / effectiveHeight;
		const fitZoom = Math.min(zoomX, zoomY);

		const zoom = Math.min(Math.max(fitZoom, minZoom), 50.0);

		const center = new Vec2().midpoint(min, max);
		const panX = this.width / 2 - center.x * zoom;
		const panY = this.height / 2 + center.y * zoom;

		return { panX, panY, zoom };
	}

	fitToBounds(bounds: AABB, padding = 80): void {
		const target = this.getTargetFit(bounds, padding);
		this.zoom = target.zoom;
		this.panX = target.panX;
		this.panY = target.panY;
	}

	screenToWorld(screen: XY): Vec2 {
		// CAD standard: Y points UP in world coordinates
		return new Vec2((screen.x - this.panX) / this.zoom, -(screen.y - this.panY) / this.zoom);
	}

	worldToScreen(world: XY): Vec2 {
		return new Vec2(this.panX + world.x * this.zoom, this.panY - world.y * this.zoom);
	}

	zoomAt(screen: XY, factor: number): void {
		const worldBefore = this.screenToWorld(screen);
		const minZoom = Math.min(this.zoom, 0.05);
		const newZoom = Math.min(Math.max(this.zoom * factor, minZoom), 200.0);
		this.zoom = newZoom;
		const screenAfter = this.worldToScreen(worldBefore);
		this.panX += screen.x - screenAfter.x;
		this.panY += screen.y - screenAfter.y;
	}

	pan(deltaScreenX: number, deltaScreenY: number): void {
		this.panX += deltaScreenX;
		this.panY += deltaScreenY;
	}

	getGridStep(): { step: number; subStep: number } {
		// Dynamic double grid with multiplicity of 5
		const targetPx = 80;
		const rawStep = targetPx / this.zoom;
		const exponent = Math.floor(Math.log10(rawStep));
		const power = Math.pow(10, exponent);
		const frac = rawStep / power;

		let step: number;
		if (frac < 1.7) {
			step = 1 * power;
		} else if (frac < 3.8) {
			step = 2.5 * power;
		} else if (frac < 7.5) {
			step = 5 * power;
		} else {
			step = 10 * power;
		}

		// Always 5 subdivisions per major step (multiplicity of 5)
		return { step, subStep: step / 5 };
	}
}
