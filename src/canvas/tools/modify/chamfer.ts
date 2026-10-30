import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import { dist, normalize, vec, type Vec2 } from '../../../math/vector';
import { ChamferPopup } from '../../../ui/chamfer-popup';
import type { HoverTarget } from '../hoverTarget';
import {
	type ChamferMode,
	type ChamferCandidate,
	findChamferCandidateForPoint,
	findChamferCandidateForLines,
	calculateChamferGeometry,
	commitChamferToSketch,
	getConnectedLinesForPoint,
} from '../../../math/chamfer';
import type { ChamferGizmoHandle } from '../../renderer';

export class ChamferTool extends BaseTool {
	readonly id = 'chamfer' as const;

	readonly popup: ChamferPopup;

	// Persistent settings
	mode: ChamferMode = 'equal_distance';
	dist1 = 10.0;
	dist2 = 10.0;
	angleDeg = 45.0;
	flip = false;

	// Single corner candidate at a time
	candidate: ChamferCandidate | null = null;
	firstLine: { id: string; clickPos: Vec2 } | null = null;

	gizmoDragState: {
		handle: ChamferGizmoHandle;
		startMouseWorld: Vec2;
		startValue: number;
	} | null = null;

	public onModeChange?: (mode: ChamferMode) => void;
	public onStateChange?: () => void;

	constructor() {
		super();
		this.popup = new ChamferPopup();

		this.popup.onParamsChange = (mode, dist1, dist2, angleDeg, flip) => {
			this.mode = mode;
			this.dist1 = dist1;
			this.dist2 = dist2;
			this.angleDeg = angleDeg;
			this.flip = flip;

			this.recalculate();
			this.ctx?.requestRender();
		};

		this.popup.onModeSwitchRequested = mode => {
			this.setMode(mode);
		};

		this.popup.onCommit = () => {
			this.commit();
		};

		this.popup.onCancel = () => {
			this.cancel();
		};
	}

	override isBusy(): boolean {
		return this.candidate !== null || this.firstLine !== null || this.gizmoDragState !== null;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.ctx.sketch.clearSelection();
		if (this.dist1 <= 0.1 || !isFinite(this.dist1)) this.dist1 = 10.0;
		if (this.dist2 <= 0.1 || !isFinite(this.dist2)) this.dist2 = 10.0;
		if (this.angleDeg <= 0.1 || !isFinite(this.angleDeg)) this.angleDeg = 45.0;
	}

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override cancel(): void {
		this.ctx?.highlightManager?.clear();
		this.candidate = null;
		this.firstLine = null;
		this.gizmoDragState = null;
		this.popup.hide();
		this.ctx?.setCursor(this.defaultCursor);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override isHighlightEnabled(): boolean {
		return !this.candidate && !this.gizmoDragState;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (this.candidate !== null || this.gizmoDragState !== null) return false;
		if (target.type === 'point') {
			if (this.firstLine) return false;
			const conn = getConnectedLinesForPoint(this.ctx.sketch, target.id);
			return conn.valid;
		}
		if (target.type === 'line') {
			const line = this.ctx.sketch.lines.get(target.id);
			if (!line || line.isSplineHandle) return false;
			if (this.firstLine && target.id === this.firstLine.id) return false;
			return true;
		}
		return false;
	}

	setMode(mode: ChamferMode): void {
		this.mode = mode;
		this.popup.setMode(mode);
		this.recalculate();
		this.onModeChange?.(mode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	recalculate(): void {
		if (!this.candidate) return;
		const res = calculateChamferGeometry(
			this.candidate,
			this.mode,
			this.dist1,
			this.dist2,
			this.angleDeg,
			this.flip
		);
		this.candidate.result = res;

		if (!res.isValid) {
			this.popup.setError(true, res.errorMessage || 'Invalid parameters');
		} else {
			this.popup.setError(false);
		}
	}

	commit(): void {
		if (!this.candidate || !this.candidate.result || !this.candidate.result.isValid) {
			this.ctx?.showToast('Cannot commit chamfer with invalid parameters');
			return;
		}

		const res = commitChamferToSketch(
			this.ctx.sketch,
			this.candidate,
			this.mode,
			this.dist1,
			this.dist2,
			this.angleDeg,
			this.flip
		);

		if (res) {
			this.ctx.showToast('Chamfer created');
		}

		this.ctx?.highlightManager?.clear();
		this.candidate = null;
		this.firstLine = null;
		this.gizmoDragState = null;
		this.popup.hide();
		this.ctx.setCursor(this.defaultCursor);
		this.ctx.requestRender();
	}

	override getRenderOptions(): Record<string, unknown> {
		return {
			chamferState: {
				candidate: this.candidate,
				firstLine: this.firstLine,
				mode: this.mode,
				flip: this.flip,
			},
		};
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// 1. Check for Chamfer Gizmo handle click / drag
		if (this.ctx.renderer.chamferGizmoHandles && this.ctx.renderer.chamferGizmoHandles.length > 0) {
			for (const gh of this.ctx.renderer.chamferGizmoHandles) {
				if (dist(screen, { x: gh.screenX, y: gh.screenY }) <= 20) {
					this.gizmoDragState = {
						handle: gh,
						startMouseWorld: world,
						startValue: gh.currentValue,
					};
					e.raw.preventDefault();
					e.raw.stopPropagation();
					return;
				}
			}
		}

		// 2. Point selection (vertex with exactly 2 lines)
		if (!this.firstLine) {
			const nearPt = this.ctx.findPointNear(screen, 16);
			if (nearPt) {
				const cand = findChamferCandidateForPoint(this.ctx.sketch, nearPt.id);
				if (cand) {
					this.selectCandidate(cand);
					return;
				}
			}

			// 3. Line selection (first line)
			const hitLine = this.ctx.findLineNear(screen, 14);
			if (hitLine && !hitLine.isSplineHandle) {
				this.firstLine = {
					id: hitLine.id,
					clickPos: world,
				};
				this.candidate = null;
				this.popup.hide();
				this.ctx.requestRender();
				return;
			}
		} else {
			// Second line selection
			const hitLine = this.ctx.findLineNear(screen, 14);
			if (hitLine && !hitLine.isSplineHandle) {
				if (hitLine.id === this.firstLine.id) {
					// Deselect
					this.firstLine = null;
					this.ctx.requestRender();
					return;
				}

				const cand = findChamferCandidateForLines(this.ctx.sketch, this.firstLine.id, hitLine.id);
				if (cand) {
					this.firstLine = null;
					this.selectCandidate(cand);
					return;
				} else {
					this.ctx.showToast('Selected lines do not share a common vertex');
				}
			}
		}
	}

	private selectCandidate(cand: ChamferCandidate): void {
		this.candidate = cand;
		this.firstLine = null;
		this.recalculate();

		if (this.candidate.result) {
			const sPos = this.ctx.viewport.worldToScreen(
				this.candidate.vertexPos.x,
				this.candidate.vertexPos.y
			);
			this.popup.show(sPos, this.mode, this.dist1, this.dist2, this.angleDeg, this.flip);
			this.popup.focus();
		}
		this.ctx.setCursor('default');
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// 1. Gizmo drag handling
		if (this.gizmoDragState && this.candidate && this.candidate.result) {
			this.ctx.setCursor('grabbing');
			const { handle, startMouseWorld, startValue } = this.gizmoDragState;

			if (handle.type === 'dist1' || handle.type === 'dist2') {
				if (this.mode === 'equal_distance') {
					// Drag along angle bisector
					const bisector = normalize({
						x: this.candidate.dir1.x + this.candidate.dir2.x,
						y: this.candidate.dir1.y + this.candidate.dir2.y,
					});
					const halfAngle = this.candidate.cornerAngleRad / 2;
					const cosHalf = Math.max(0.05, Math.cos(halfAngle));
					const delta = (world.x - startMouseWorld.x) * bisector.x + (world.y - startMouseWorld.y) * bisector.y;
					const deltaD = delta / cosHalf;
					const newDist = Math.max(0.5, Math.round((startValue + deltaD) * 2) / 2);
					this.dist1 = newDist;
					this.dist2 = newDist;
				} else if (this.mode === 'two_distance') {
					const dir = handle.dir || (handle.type === 'dist1' ? this.candidate.dir1 : this.candidate.dir2);
					const delta = (world.x - startMouseWorld.x) * dir.x + (world.y - startMouseWorld.y) * dir.y;
					const newDist = Math.max(0.5, Math.round((startValue + delta) * 2) / 2);
					if (handle.type === 'dist1') {
						if (!this.flip) {
							this.dist1 = newDist;
						} else {
							this.dist2 = newDist;
						}
					} else {
						if (!this.flip) {
							this.dist2 = newDist;
						} else {
							this.dist1 = newDist;
						}
					}
				} else if (this.mode === 'distance_angle') {
					const dir = handle.dir || (!this.flip ? this.candidate.dir1 : this.candidate.dir2);
					const delta = (world.x - startMouseWorld.x) * dir.x + (world.y - startMouseWorld.y) * dir.y;
					const newDist = Math.max(0.5, Math.round((startValue + delta) * 2) / 2);
					this.dist1 = newDist;
				}
				this.popup.updateValues(this.dist1, this.dist2, this.angleDeg);
				this.recalculate();
				this.ctx.requestRender();
				return;
			} else if (handle.type === 'angle') {
				// Angle drag around vertex A (or B if flipped)
				const refVertex = !this.flip ? this.candidate.result.t1 : this.candidate.result.t2;
				const refDir = !this.flip
					? vec(-this.candidate.dir1.x, -this.candidate.dir1.y)
					: vec(-this.candidate.dir2.x, -this.candidate.dir2.y);

				// Determine which side of refDir points into the corner interior
				const cross12 = this.candidate.dir1.x * this.candidate.dir2.y - this.candidate.dir1.y * this.candidate.dir2.x;
				const interiorSign = !this.flip ? (cross12 >= 0 ? -1 : 1) : (cross12 >= 0 ? 1 : -1);

				const toMouse = vec(world.x - refVertex.x, world.y - refVertex.y);
				const toMouseLen = Math.hypot(toMouse.x, toMouse.y);
				if (toMouseLen > 1e-4) {
					const crossMouse = refDir.x * toMouse.y - refDir.y * toMouse.x;
					const dotMouse = refDir.x * toMouse.x + refDir.y * toMouse.y;
					const signedCross = crossMouse * interiorSign;
					const signedAngleRad = Math.atan2(signedCross, dotMouse);
					const signedAngleDeg = (signedAngleRad * 180) / Math.PI;

					const cornerDeg = (this.candidate.cornerAngleRad * 180) / Math.PI;
					// In triangle VAB: theta + alpha + beta = 180 => alpha < 180 - theta
					const maxAngle = Math.max(0, Math.floor(180 - cornerDeg - 1));
					const newAngle = Math.max(0, Math.min(maxAngle, Math.round(signedAngleDeg)));
					this.angleDeg = newAngle;
					this.popup.updateValues(this.dist1, this.dist2, this.angleDeg);
					this.recalculate();
					this.ctx.requestRender();
				}
				return;
			}
		}

		// Update cursor: crosshair in selection mode, default in other cases (grab/grabbing on gizmos)
		const isOverGizmo = this.ctx.renderer.chamferGizmoHandles?.some(
			gh => dist(screen, { x: gh.screenX, y: gh.screenY }) <= 20
		);
		if (this.gizmoDragState) {
			this.ctx.setCursor('grabbing');
		} else if (isOverGizmo) {
			this.ctx.setCursor('grab');
		} else if (!this.candidate || this.firstLine) {
			this.ctx.setCursor('crosshair');
		} else {
			this.ctx.setCursor('default');
		}
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		if (this.gizmoDragState) {
			this.gizmoDragState = null;
		}
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab') {
			if (this.popup.isOpen()) {
				e.preventDefault();
				this.popup.focus();
				return true;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			this.commit();
			return true;
		}
	}
}
