import { vec, type Vec2 } from '../math/vector';

export class Viewport {
  width = 800;
  height = 600;
  panX = 0; // World origin X on screen
  panY = 0; // World origin Y on screen
  zoom = 1.0; // Screen pixels per world unit

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

  screenToWorld(sx: number, sy: number): Vec2 {
    // CAD standard: Y points UP in world coordinates
    const wx = (sx - this.panX) / this.zoom;
    const wy = -(sy - this.panY) / this.zoom;
    return vec(wx, wy);
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    const sx = this.panX + wx * this.zoom;
    const sy = this.panY - wy * this.zoom;
    return vec(sx, sy);
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const worldBefore = this.screenToWorld(sx, sy);
    const newZoom = Math.min(Math.max(this.zoom * factor, 0.05), 50.0);
    this.zoom = newZoom;
    const screenAfter = this.worldToScreen(worldBefore.x, worldBefore.y);
    this.panX += sx - screenAfter.x;
    this.panY += sy - screenAfter.y;
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
