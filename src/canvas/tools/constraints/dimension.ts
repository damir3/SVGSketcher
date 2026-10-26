import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, type Vec2 } from '../../../math/vector';

export interface DimensionState {
	step: number;
	line1Id: string | null;
	line2Id: string | null;
	point1Id: string | null;
	point2Id: string | null;
}

export function determineDistanceOrientation(
	s1: Vec2,
	s2: Vec2,
	cursor: Vec2
): {
	orientation: 'aligned' | 'horizontal' | 'vertical';
	offsetScreen: number;
} {
	const dx = s2.x - s1.x;
	const dy = s2.y - s1.y;
	const len = Math.hypot(dx, dy);

	const midX = (s1.x + s2.x) * 0.5;
	const midY = (s1.y + s2.y) * 0.5;
	const vx = cursor.x - midX;
	const vy = cursor.y - midY;

	// If points are nearly horizontal (|dy| < 5px), only horizontal makes sense
	if (Math.abs(dy) < 5) {
		return {
			orientation: 'horizontal',
			offsetScreen: vy,
		};
	}

	// If points are nearly vertical (|dx| < 5px), only vertical makes sense
	if (Math.abs(dx) < 5) {
		return {
			orientation: 'vertical',
			offsetScreen: vx,
		};
	}

	if (len < 1e-4) {
		return { orientation: 'aligned', offsetScreen: 0 };
	}

	const nx = -dy / len;
	const ny = dx / len;
	const normalOffset = vx * nx + vy * ny;

	// Angle of cursor from midpoint in degrees (-180 to 180)
	// -90° is UP, +90° is DOWN, 0° is RIGHT, ±180° is LEFT
	const theta = (Math.atan2(vy, vx) * 180) / Math.PI;

	// Angle of line and line normal in degrees
	const lineAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
	const norm1 = lineAngle + 90;
	const norm2 = lineAngle - 90;

	const angleDiff = (a: number, b: number): number => {
		const d = Math.abs(a - b) % 360;
		return d > 180 ? 360 - d : d;
	};

	const diffNormal = Math.min(angleDiff(theta, norm1), angleDiff(theta, norm2));
	const diffVertical = Math.min(angleDiff(theta, 90), angleDiff(theta, -90));
	const diffHorizontal = Math.min(angleDiff(theta, 0), angleDiff(theta, 180));

	// If cursor is pulled close to perpendicular to the line (within ±22°), it's aligned
	if (diffNormal < 22) {
		return {
			orientation: 'aligned',
			offsetScreen: normalOffset,
		};
	}

	// Compare whether cursor is pulled more towards vertical (UP/DOWN => horizontal dimension)
	// or horizontal (LEFT/RIGHT => vertical dimension)
	if (diffVertical < diffHorizontal) {
		return {
			orientation: 'horizontal',
			offsetScreen: vy,
		};
	} else {
		return {
			orientation: 'vertical',
			offsetScreen: vx,
		};
	}
}

export class DimensionTool extends BaseTool {
	readonly id = 'dimension' as const;

	state: DimensionState = {
		step: 0,
		line1Id: null,
		line2Id: null,
		point1Id: null,
		point2Id: null,
	};

	override activate(ctx: ToolContext): void {
		super.activate(ctx);

		const sel = ctx.sketch.selection;
		if (sel.lineIds.size === 1) {
			this.state = {
				step: 1,
				line1Id: [...sel.lineIds][0],
				line2Id: null,
				point1Id: null,
				point2Id: null,
			};
		} else if (sel.lineIds.size === 2) {
			const [l1, l2] = [...sel.lineIds];
			this.state = {
				step: 2,
				line1Id: l1,
				line2Id: l2,
				point1Id: null,
				point2Id: null,
			};
		} else if (sel.pointIds.size === 2) {
			const [p1, p2] = [...sel.pointIds];
			this.state = {
				step: 2,
				line1Id: null,
				line2Id: null,
				point1Id: p1,
				point2Id: p2,
			};
		} else if (sel.pointIds.size === 1) {
			const [p1] = [...sel.pointIds];
			this.state = {
				step: 1,
				line1Id: null,
				line2Id: null,
				point1Id: p1,
				point2Id: null,
			};
		} else {
			this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
		}
	}

	override deactivate(): void {
		this.cancel();
	}

	override isBusy(): boolean {
		return this.state.step > 0;
	}

	override cancel(): void {
		this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
		this.ctx.renderer.clearPreviews();
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		const screen = e.screen;
		const world = e.world;
		const snap = this.ctx.findSnap(screen);

		const target = e.raw.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'arc' | 'constraint' | undefined;

		// Priority 1: When selecting points in step 0 or step 1, points ALWAYS have top priority!
		const excludeId =
			this.state.step === 1 && this.state.point1Id ? this.state.point1Id : undefined;
		const nearPoint = this.ctx.findPointNear(screen, 22);
		if (nearPoint && (!excludeId || nearPoint.id !== excludeId)) {
			id = nearPoint.id;
			type = 'point';
		}

		// Geometric hit test fallback if not clicking directly on entity
		if (!type || (type !== 'point' && type !== 'line' && type !== 'circle' && type !== 'arc')) {
			if (snap && snap.type === 'point' && snap.id) {
				id = snap.id;
				type = 'point';
			} else {
				const hitLine = this.ctx.findLineNear(screen, 18);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = this.ctx.findCircleNear(screen, 18);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = this.ctx.findArcNear(screen, 18);
						if (hitArc) {
							id = hitArc.id;
							type = 'arc';
						}
					}
				}
			}
		}

		// If waiting for second point in step 1, snap to point has priority
		if (this.state.step === 1 && this.state.point1Id) {
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.state.point1Id) {
				id = snap.id;
				type = 'point';
			}
		}

		// STEP 0: Select first entity (point, line, or circle/arc)
		if (this.state.step === 0) {
			if (type === 'point' && id) {
				this.ctx.sketch.clearSelection();
				this.ctx.sketch.selectEntity(id, 'point', false);
				this.state = { step: 1, line1Id: null, line2Id: null, point1Id: id, point2Id: null };
				this.ctx.requestRender();
			} else if (type === 'line' && id) {
				this.ctx.sketch.clearSelection();
				this.ctx.sketch.selectEntity(id, 'line', false);
				this.state = { step: 1, line1Id: id, line2Id: null, point1Id: null, point2Id: null };
				this.ctx.requestRender();
			} else if ((type === 'circle' || type === 'arc') && id) {
				const existed = this.ctx.sketch.hasRadiusConstraint(id);
				const c = this.ctx.sketch.addRadiusConstraint(id);
				if (c) {
					this.ctx.showToast(existed ? 'Editing radius constraint' : 'Radius constraint applied');
					this.ctx.sketch.clearSelection();
					this.ctx.sketch.selectEntity(c.id, 'constraint', false);
					this.ctx.requestRender();
					if (this.ctx.onEditDimension) {
						this.ctx.onEditDimension(c, e.client);
					}
				}
			} else {
				this.ctx.sketch.clearSelection();
				this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
				this.ctx.renderer.clearPreviews();
				this.ctx.requestRender();
			}
			return true;
		}

		// STEP 1: First point OR first line was selected
		if (this.state.step === 1) {
			// Subcase 1: First point was selected. Now picking second point OR line!
			if (this.state.point1Id) {
				if (type === 'point' && id && id !== this.state.point1Id) {
					this.ctx.sketch.selectEntity(id, 'point', true);
					this.state = {
						step: 2,
						line1Id: null,
						line2Id: null,
						point1Id: this.state.point1Id,
						point2Id: id,
					};
					this.ctx.requestRender();
				} else if (type === 'line' && id) {
					const l = this.ctx.sketch.lines.get(id);
					// If this line contains point1 as an endpoint, snap to the other endpoint
					if (l && (l.p1Id === this.state.point1Id || l.p2Id === this.state.point1Id)) {
						const otherPtId = l.p1Id === this.state.point1Id ? l.p2Id : l.p1Id;
						this.ctx.sketch.selectEntity(otherPtId, 'point', true);
						this.state = {
							step: 2,
							line1Id: null,
							line2Id: null,
							point1Id: this.state.point1Id,
							point2Id: otherPtId,
						};
						this.ctx.requestRender();
					} else if (l) {
						const ptId = this.state.point1Id;
						const pt = this.ctx.sketch.points.get(ptId);
						const lp1 = this.ctx.sketch.points.get(l.p1Id);
						const lp2 = this.ctx.sketch.points.get(l.p2Id);
						let offsetWorld = 0;
						if (pt && lp1 && lp2) {
							const sp = this.ctx.viewport.worldToScreen(pt.x, pt.y);
							const s1 = this.ctx.viewport.worldToScreen(lp1.x, lp1.y);
							const s2 = this.ctx.viewport.worldToScreen(lp2.x, lp2.y);
							const dx = s2.x - s1.x;
							const dy = s2.y - s1.y;
							const lineLen = Math.hypot(dx, dy);
							if (lineLen > 1e-4) {
								const ux = dx / lineLen;
								const uy = dy / lineLen;
								const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
								const tCursor = (screen.x - s1.x) * ux + (screen.y - s1.y) * uy;
								let offsetScreen = tCursor - tProj;
								if (Math.abs(offsetScreen) < 15) {
									offsetScreen = tProj < lineLen * 0.5 ? 25 : -25;
								}
								offsetWorld = offsetScreen / this.ctx.viewport.zoom;
							}
						}
						const existed = this.ctx.sketch.hasPointToLineDistanceConstraint(ptId, id);
						const c = this.ctx.sketch.addPointToLineDistanceConstraint(ptId, id, undefined, offsetWorld);
						if (c) {
							this.ctx.showToast(
								existed ? 'Editing point-to-line distance constraint' : 'Point-to-line distance constraint applied'
							);
							this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
							this.ctx.renderer.clearPreviews();
							this.ctx.sketch.clearSelection();
							this.ctx.requestRender();
							if (this.ctx.onEditDimension) {
								this.ctx.onEditDimension(c, e.client);
							}
						}
					}
				}
				return true;
			}

			// Subcase 2: First line was selected.
			const l1 = this.state.line1Id ? this.ctx.sketch.lines.get(this.state.line1Id) : null;
			if (!l1) {
				this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
				this.ctx.renderer.clearPreviews();
				this.ctx.requestRender();
				return true;
			}

			// If clicked on another line -> switch to Angle constraint mode!
			if (type === 'line' && id && id !== l1.id) {
				this.ctx.sketch.selectEntity(id, 'line', true);
				this.state = { step: 2, line1Id: l1.id, line2Id: id, point1Id: null, point2Id: null };
				this.ctx.requestRender();
				return true;
			}

			// If clicked on a point (not one of line's endpoints) -> immediately apply Point-to-Line distance constraint!
			if (type === 'point' && id && id !== l1.p1Id && id !== l1.p2Id) {
				const pt = this.ctx.sketch.points.get(id);
				const lp1 = this.ctx.sketch.points.get(l1.p1Id);
				const lp2 = this.ctx.sketch.points.get(l1.p2Id);
				let offsetWorld = 0;
				if (pt && lp1 && lp2) {
					const sp = this.ctx.viewport.worldToScreen(pt.x, pt.y);
					const s1 = this.ctx.viewport.worldToScreen(lp1.x, lp1.y);
					const s2 = this.ctx.viewport.worldToScreen(lp2.x, lp2.y);
					const dx = s2.x - s1.x;
					const dy = s2.y - s1.y;
					const lineLen = Math.hypot(dx, dy);
					if (lineLen > 1e-4) {
						const ux = dx / lineLen;
						const uy = dy / lineLen;
						const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
						const tCursor = (screen.x - s1.x) * ux + (screen.y - s1.y) * uy;
						let offsetScreen = tCursor - tProj;
						if (Math.abs(offsetScreen) < 15) {
							offsetScreen = tProj < lineLen * 0.5 ? 25 : -25;
						}
						offsetWorld = offsetScreen / this.ctx.viewport.zoom;
					}
				}
				const existed = this.ctx.sketch.hasPointToLineDistanceConstraint(id, l1.id);
				const c = this.ctx.sketch.addPointToLineDistanceConstraint(id, l1.id, undefined, offsetWorld);
				if (c) {
					this.ctx.showToast(
						existed ? 'Editing point-to-line distance constraint' : 'Point-to-line distance constraint applied'
					);
					this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
					this.ctx.renderer.clearPreviews();
					this.ctx.sketch.clearSelection();
					this.ctx.requestRender();
					if (this.ctx.onEditDimension) {
						this.ctx.onEditDimension(c, e.client);
					}
				}
				return true;
			}

			// Second click sets offset & orientation for line distance constraint
			const p1 = this.ctx.sketch.points.get(l1.p1Id);
			const p2 = this.ctx.sketch.points.get(l1.p2Id);
			if (p1 && p2) {
				const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
				const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
				const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
				const offsetWorld = offsetScreen / this.ctx.viewport.zoom;

				const existed = this.ctx.sketch.hasDistanceConstraint(l1.p1Id, l1.p2Id, orientation);
				const c = this.ctx.sketch.addDistanceConstraint(l1.p1Id, l1.p2Id, undefined, offsetWorld, orientation);
				if (c) {
					const toastMsg = existed
						? 'Editing distance constraint'
						: orientation === 'horizontal'
						? 'Horizontal distance constraint applied'
						: orientation === 'vertical'
						? 'Vertical distance constraint applied'
						: 'Distance constraint applied';
					this.ctx.showToast(toastMsg);
					this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
					this.ctx.renderer.clearPreviews();
					this.ctx.sketch.clearSelection();
					this.ctx.requestRender();
					if (this.ctx.onEditDimension) {
						this.ctx.onEditDimension(c, e.client);
					}
				}
			}
			return true;
		}

		// STEP 2: Either two points were selected OR two lines were selected
		if (this.state.step === 2) {
			// Subcase 1: Two points selected! 3rd click sets offset & places distance constraint!
			if (this.state.point1Id && this.state.point2Id) {
				const p1 = this.ctx.sketch.points.get(this.state.point1Id);
				const p2 = this.ctx.sketch.points.get(this.state.point2Id);
				if (p1 && p2) {
					const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
					const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
					const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
					const offsetWorld = offsetScreen / this.ctx.viewport.zoom;

					const existed = this.ctx.sketch.hasDistanceConstraint(
						this.state.point1Id,
						this.state.point2Id,
						orientation
					);
					const c = this.ctx.sketch.addDistanceConstraint(
						this.state.point1Id,
						this.state.point2Id,
						undefined,
						offsetWorld,
						orientation
					);
					if (c) {
						const toastMsg = existed
							? 'Editing distance constraint'
							: orientation === 'horizontal'
							? 'Horizontal distance constraint applied'
							: orientation === 'vertical'
							? 'Vertical distance constraint applied'
							: 'Distance constraint applied';
						this.ctx.showToast(toastMsg);
						this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
						this.ctx.renderer.clearPreviews();
						this.ctx.sketch.clearSelection();
						this.ctx.requestRender();
						if (this.ctx.onEditDimension) {
							this.ctx.onEditDimension(c, e.client);
						}
					}
				}
				return true;
			}

			// Subcase 2: Point and Line selected (Point-to-Line Distance mode)
			if (this.state.point1Id && this.state.line1Id) {
				const pt = this.ctx.sketch.points.get(this.state.point1Id);
				const l = this.ctx.sketch.lines.get(this.state.line1Id);
				if (pt && l) {
					const p1 = this.ctx.sketch.points.get(l.p1Id);
					const p2 = this.ctx.sketch.points.get(l.p2Id);
					if (p1 && p2) {
						const sp = this.ctx.viewport.worldToScreen(pt.x, pt.y);
						const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
						const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
						const dx = s2.x - s1.x;
						const dy = s2.y - s1.y;
						const lineLen = Math.hypot(dx, dy);
						if (lineLen > 1e-4) {
							const ux = dx / lineLen;
							const uy = dy / lineLen;
							const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
							const tCursor = (screen.x - s1.x) * ux + (screen.y - s1.y) * uy;
							const offsetWorld = (tCursor - tProj) / this.ctx.viewport.zoom;

							const existed = this.ctx.sketch.hasPointToLineDistanceConstraint(
								this.state.point1Id,
								this.state.line1Id
							);
							const c = this.ctx.sketch.addPointToLineDistanceConstraint(
								this.state.point1Id,
								this.state.line1Id,
								undefined,
								offsetWorld
							);
							if (c) {
								this.ctx.showToast(
									existed ? 'Editing point-to-line distance constraint' : 'Point-to-line distance constraint applied'
								);
								this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
								this.ctx.renderer.clearPreviews();
								this.ctx.sketch.clearSelection();
								this.ctx.requestRender();
								if (this.ctx.onEditDimension) {
									this.ctx.onEditDimension(c, e.client);
								}
							}
						}
					}
				}
				return true;
			}

			// Subcase 3: Two lines selected (Angle mode)
			const l1 = this.state.line1Id ? this.ctx.sketch.lines.get(this.state.line1Id) : null;
			const l2 = this.state.line2Id ? this.ctx.sketch.lines.get(this.state.line2Id) : null;
			if (!l1 || !l2) {
				this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
				this.ctx.renderer.clearPreviews();
				this.ctx.requestRender();
				return true;
			}

			const p1 = this.ctx.sketch.points.get(l1.p1Id);
			const p2 = this.ctx.sketch.points.get(l1.p2Id);
			const p3 = this.ctx.sketch.points.get(l2.p1Id);
			const p4 = this.ctx.sketch.points.get(l2.p2Id);
			if (p1 && p2 && p3 && p4) {
				const geom = this.ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
				const arcRadiusWorld = Math.max(10, Math.hypot(world.x - geom.pInt.x, world.y - geom.pInt.y));
				const existed = this.ctx.sketch.hasAngleConstraint(l1.id, l2.id);
				const c = this.ctx.sketch.addAngleConstraint(l1.id, l2.id, undefined, arcRadiusWorld, world);
				if (c) {
					this.ctx.showToast(existed ? 'Editing angle constraint' : 'Angle constraint applied');
					this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
					this.ctx.renderer.clearPreviews();
					this.ctx.sketch.clearSelection();
					this.ctx.requestRender();
					if (this.ctx.onEditDimension) {
						this.ctx.onEditDimension(c, e.client);
					}
				}
			}
			return true;
		}

		return false;
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const screen = ctx.cursorScreen;
		const world = ctx.cursorWorld;

		let p1Id: string | null = null;
		let p2Id: string | null = null;

		if (this.state.step === 1 && this.state.line1Id) {
			const l1 = ctx.sketch.lines.get(this.state.line1Id);
			if (l1) {
				// Check if hovering over a point (that is NOT an endpoint of line1)
				const hitPt = this.ctx.findPointNear(screen, 18);
				if (hitPt && hitPt.id !== l1.p1Id && hitPt.id !== l1.p2Id) {
					const p1 = ctx.sketch.points.get(l1.p1Id);
					const p2 = ctx.sketch.points.get(l1.p2Id);
					if (p1 && p2) {
						const dx = p2.x - p1.x;
						const dy = p2.y - p1.y;
						const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);
						const cross = (hitPt.x - p1.x) * dy - (hitPt.y - p1.y) * dx;
						const perpDist = Math.abs(cross) / lineLen;
						const sp = ctx.viewport.worldToScreen(hitPt.x, hitPt.y);
						const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
						const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
						this.ctx.renderer.renderPointToLineDistancePreview(sp, s1, s2, screen, perpDist);
						return;
					}
				}

				p1Id = l1.p1Id;
				p2Id = l1.p2Id;
			}
		} else if (this.state.step === 2 && this.state.point1Id && this.state.point2Id) {
			p1Id = this.state.point1Id;
			p2Id = this.state.point2Id;
		} else if (this.state.step === 1 && this.state.point1Id) {
			const p1 = ctx.sketch.points.get(this.state.point1Id);
			if (p1) {
				const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);

				// 1. TOP PRIORITY: Snap to any other point
				const snapPt =
					ctx.snap?.type === 'point' && ctx.snap.id && ctx.snap.id !== this.state.point1Id
						? {
								id: ctx.snap.id,
								worldPos: ctx.snap.worldPos,
								screenPos: ctx.snap.screenPos,
						  }
						: (() => {
								const pt = this.ctx.findPointNear(screen, 22);
								if (pt && pt.id !== p1.id) {
									return {
										id: pt.id,
										worldPos: { x: pt.x, y: pt.y },
										screenPos: ctx.viewport.worldToScreen(pt.x, pt.y),
									};
								}
								return null;
						  })();

				if (snapPt) {
					const targetScreen = snapPt.screenPos;
					const targetWorld = snapPt.worldPos;
					const currentDist = dist(p1, targetWorld);
					this.ctx.renderer.renderDistanceLinePreview(s1, targetScreen, currentDist, true);
					return;
				}

				// 2. SECOND PRIORITY: Check if hovering over the body of a line
				const hitLine = this.ctx.findLineNear(screen, 14);
				if (hitLine && hitLine.p1Id !== p1.id && hitLine.p2Id !== p1.id) {
					const lp1 = ctx.sketch.points.get(hitLine.p1Id);
					const lp2 = ctx.sketch.points.get(hitLine.p2Id);
					if (lp1 && lp2) {
						const dx = lp2.x - lp1.x;
						const dy = lp2.y - lp1.y;
						const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);
						const cross = (p1.x - lp1.x) * dy - (p1.y - lp1.y) * dx;
						const perpDist = Math.abs(cross) / lineLen;
						if (perpDist >= 0.5) {
							const sp = ctx.viewport.worldToScreen(p1.x, p1.y);
							const s1Line = ctx.viewport.worldToScreen(lp1.x, lp1.y);
							const s2Line = ctx.viewport.worldToScreen(lp2.x, lp2.y);
							this.ctx.renderer.renderPointToLineDistancePreview(sp, s1Line, s2Line, screen, perpDist);
							return;
						}
					}
				}

				// 3. Fallback: Free cursor in empty space
				const currentDist = dist(p1, world);
				this.ctx.renderer.renderDistanceLinePreview(s1, screen, currentDist, false);
			}
		}

		if (p1Id && p2Id) {
			const p1 = ctx.sketch.points.get(p1Id);
			const p2 = ctx.sketch.points.get(p2Id);
			if (p1 && p2) {
				const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
				const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				const { orientation } = determineDistanceOrientation(s1, s2, screen);
				let currentDist = dist(p1, p2);
				if (orientation === 'horizontal') {
					currentDist = Math.abs(p2.x - p1.x);
				} else if (orientation === 'vertical') {
					currentDist = Math.abs(p2.y - p1.y);
				}
				this.ctx.renderer.renderDistancePreview(s1, s2, screen, currentDist, orientation);
			}
		} else if (this.state.step === 2 && this.state.line1Id && this.state.line2Id) {
			const l1 = ctx.sketch.lines.get(this.state.line1Id);
			const l2 = ctx.sketch.lines.get(this.state.line2Id);
			if (l1 && l2) {
				const p1 = ctx.sketch.points.get(l1.p1Id);
				const p2 = ctx.sketch.points.get(l1.p2Id);
				const p3 = ctx.sketch.points.get(l2.p1Id);
				const p4 = ctx.sketch.points.get(l2.p2Id);
				if (p1 && p2 && p3 && p4) {
					const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
					const sCenter = ctx.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
					const sRay1 = ctx.viewport.worldToScreen(geom.pInt.x + geom.u1.x * 20, geom.pInt.y + geom.u1.y * 20);
					const sRay2 = ctx.viewport.worldToScreen(geom.pInt.x + geom.u2.x * 20, geom.pInt.y + geom.u2.y * 20);
					const sp1 = ctx.viewport.worldToScreen(p1.x, p1.y);
					const sp2 = ctx.viewport.worldToScreen(p2.x, p2.y);
					const sp3 = ctx.viewport.worldToScreen(p3.x, p3.y);
					const sp4 = ctx.viewport.worldToScreen(p4.x, p4.y);
					this.ctx.renderer.renderAnglePreview(sCenter, sRay1, sRay2, screen, geom.initialAngleDeg, sp1, sp2, sp3, sp4);
				}
			}
		} else if (this.state.step === 2 && this.state.point1Id && this.state.line1Id) {
			const pt = ctx.sketch.points.get(this.state.point1Id);
			const l = ctx.sketch.lines.get(this.state.line1Id);
			if (pt && l) {
				const p1 = ctx.sketch.points.get(l.p1Id);
				const p2 = ctx.sketch.points.get(l.p2Id);
				if (p1 && p2) {
					const sp = ctx.viewport.worldToScreen(pt.x, pt.y);
					const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
					const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
					const dx = p2.x - p1.x;
					const dy = p2.y - p1.y;
					const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);
					const cross = (pt.x - p1.x) * dy - (pt.y - p1.y) * dx;
					const perpDist = Math.abs(cross) / lineLen;
					this.ctx.renderer.renderPointToLineDistancePreview(sp, s1, s2, screen, perpDist);
				}
			}
		}
	}
}
