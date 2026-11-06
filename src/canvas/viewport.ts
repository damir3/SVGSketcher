import { mid, vec, type Vec2 } from '../math/vector';
import type { AABB } from '../math/aabb';

export class Viewport {
	width = 800;
	height = 600;
	panX = 0; // World origin X on screen
	panY = 0; // World origin Y on screen
	zoom = 4.0; // Screen pixels per world unit

	constructor(width = 800, height = 600) {
		this.resize(width, height);
		this.centerOrigin();
	}

	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
	}

	centerOrigin(): void {
		this.panX = this.width / 2;
		this.panY = this.height / 2;
	}

	getTargetFit(bounds: AABB, padding = 80): { panX: number; panY: number; zoom: number } {
		const { min, max } = bounds;
		const boxWidth = max.x - min.x;
		const boxHeight = max.y - min.y;

		const availWidth = Math.max(this.width - padding * 2, 50);
		const availHeight = Math.max(this.height - padding * 2, 50);

		const effectiveWidth = Math.max(boxWidth, 20);
		const effectiveHeight = Math.max(boxHeight, 20);

		const zoomX = availWidth / effectiveWidth;
		const zoomY = availHeight / effectiveHeight;
		const fitZoom = Math.min(zoomX, zoomY);

		const zoom = Math.min(Math.max(fitZoom, 0.05), 50.0);

		const center = mid(min, max);
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

	screenToWorld(screen: Vec2): Vec2 {
		// CAD standard: Y points UP in world coordinates
		const wx = (screen.x - this.panX) / this.zoom;
		const wy = -(screen.y - this.panY) / this.zoom;
		return vec(wx, wy);
	}

	worldToScreen(world: Vec2): Vec2 {
		const sx = this.panX + world.x * this.zoom;
		const sy = this.panY - world.y * this.zoom;
		return vec(sx, sy);
	}

	zoomAt(screen: Vec2, factor: number): void {
		const worldBefore = this.screenToWorld(screen);
		const newZoom = Math.min(Math.max(this.zoom * factor, 0.05), 50.0);
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
