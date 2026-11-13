import { LABEL_DISTANCE_PX, LINE_DISTANCE_PX } from '../../distances';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import { ORIGIN, Vec2 } from '../../../math/vector';
import { RadiusConstraint } from '../../../solver/constraints/radius';

export interface DimensionState {
	step: number;
	line1Id: string | null;
	line2Id: string | null;
	point1Id: string | null;
	point2Id: string | null;
	point3Id?: string | null;
}

export function determineDistanceOrientation(
	s1: Vec2,
	s2: Vec2,
	cursor: Vec2
): {
	orientation: 'aligned' | 'horizontal' | 'vertical';
	offsetScreen: number;
} {
	const len = s1.distanceTo(s2);

	const midPoint = new Vec2().midpoint(s1, s2);
	const v = new Vec2().subVectors(cursor, midPoint);

	if (len < 1e-4) {
		return { orientation: 'aligned', offsetScreen: 0 };
	}

	const dir = new Vec2().subVectors(s2, s1).normalizeOrUnitX();
	const normal = dir.clone().perpendicular();
	const normalOffset = v.dot(normal);

	// Angle of cursor from midpoint in degrees (-180 to 180)
	// -90° is UP, +90° is DOWN, 0° is RIGHT, ±180° is LEFT
	const theta = v.signedAngleDeg();

	// Angle of line and line normal in degrees
	const lineAngle = dir.signedAngleDeg();
	const norm1 = lineAngle + 90;
	const norm2 = lineAngle - 90;

	const angleDiff = (a: number, b: number): number => {
		const d = Math.abs(a - b) % 360;
		return d > 180 ? 360 - d : d;
	};

	const diffNormal = Math.min(angleDiff(theta, norm1), angleDiff(theta, norm2));
	const diffVertical = Math.min(angleDiff(theta, 90), angleDiff(theta, -90));
	const diffHorizontal = Math.min(angleDiff(theta, 0), angleDiff(theta, 180));

	// If points are nearly horizontal (|dy| < 5px), vertical dimension makes no sense
	if (Math.abs(dir.y * len) < 5) {
		return {
			orientation: diffNormal <= 45 ? 'aligned' : 'horizontal',
			offsetScreen: diffNormal <= 45 ? normalOffset : v.y,
		};
	}

	// If points are nearly vertical (|dx| < 5px), horizontal dimension makes no sense
	if (Math.abs(dir.x * len) < 5) {
		return {
			orientation: diffNormal <= 45 ? 'aligned' : 'vertical',
			offsetScreen: diffNormal <= 45 ? normalOffset : v.x,
		};
	}

	// Choose between aligned, horizontal, and vertical based on which direction cursor is pulled towards
	if (diffNormal <= diffVertical + 15 && diffNormal <= diffHorizontal + 15) {
		return {
			orientation: 'aligned',
			offsetScreen: normalOffset,
		};
	} else if (diffVertical < diffHorizontal) {
		return {
			orientation: 'horizontal',
			offsetScreen: v.y,
		};
	} else {
		return {
			orientation: 'vertical',
			offsetScreen: v.x,
		};
	}
}

export class DimensionTool extends BaseTool {
	readonly id = 'dimension' as const;
	private radiusDraft: { constraint: RadiusConstraint; returnToSelect: boolean } | null = null;

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
		} else if (sel.pointIds.size === 3) {
			const [p1, p2, p3] = [...sel.pointIds];
			this.state = {
				step: 2,
				line1Id: null,
				line2Id: null,
				point1Id: p1,
				point2Id: p2,
				point3Id: p3,
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
			const radialIds = [...sel.circleIds, ...sel.arcIds];
			if (radialIds.length === 1 && !ctx.sketch.hasRadiusConstraint(radialIds[0])) {
				this.beginRadiusPlacement(radialIds[0]);
			}
		}
	}

	beginRadiusPlacement(id: string, returnToSelect = false): void {
		const { sketch } = this.ctx;
		const circle = sketch.circles.get(id);
		const entity = circle ?? sketch.arcs.get(id);
		if (!entity) return;

		const radius = Math.max(0.01, Number(entity.radius.toFixed(2)));
		this.radiusDraft = {
			constraint: new RadiusConstraint('radius-preview', id, radius, 1, undefined, circle ? 'diameter' : 'radius'),
			returnToSelect,
		};
		sketch.selectEntity(id, circle ? 'circle' : 'arc', false);
		this.ctx.showToast('Click to place the dimension label');
		this.ctx.requestRender();
	}

	override deactivate(): void {
		this.cancel();
	}

	override cancel(): void {
		this.radiusDraft = null;
		this.state = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
		this.ctx.renderer.clearPreviews();
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	override isHighlightEnabled(): boolean {
		if (this.radiusDraft) return false;
		return (
			this.state.step < 2 ||
			Boolean(this.state.step === 2 && this.state.point1Id && this.state.point2Id && !this.state.point3Id)
		);
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'constraint') return false;
		if (this.state.step === 0) {
			return (
				target.type === 'point' ||
				target.type === 'line' ||
				target.type === 'circle' ||
				target.type === 'arc' ||
				target.type === 'ellipse' ||
				target.type === 'elliptical_arc'
			);
		}
		if (this.state.step === 1) {
			if (this.state.point1Id) {
				return (target.type === 'point' && target.id !== this.state.point1Id) || target.type === 'line';
			}
			if (this.state.line1Id) {
				return (target.type === 'line' && target.id !== this.state.line1Id) || target.type === 'point';
			}
		}
		if (this.state.step === 2 && this.state.point1Id && this.state.point2Id && !this.state.point3Id) {
			return target.type === 'point' && target.id !== this.state.point1Id && target.id !== this.state.point2Id;
		}
		return false;
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: false };
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		const screen = e.screen;
		if (this.radiusDraft) {
			const { sketch, viewport } = this.ctx;
			const { constraint: draft, returnToSelect } = this.radiusDraft;
			this.radiusDraft = null;
			draft.moveLabelTo(screen, sketch, viewport);
			const constraint = sketch.addRadiusConstraint(draft.circleId, undefined, undefined, draft);
			this.ctx.renderer.clearPreviews();
			if (returnToSelect) this.ctx.setTool('select');
			if (constraint) {
				sketch.selectEntity(constraint.id, 'constraint', false);
				this.ctx.showToast(
					constraint.displayMode === 'diameter' ? 'Diameter constraint applied' : 'Radius constraint applied'
				);
				this.ctx.requestRender();
				this.ctx.onEditDimension?.(constraint, e.client);
			}
			return true;
		}
		const world = e.world;
		const snap = this.ctx.findSnap(screen);

		const target = e.raw.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'arc' | 'constraint' | undefined;

		// Priority 1: When selecting points in step 0, step 1, or step 2 (2 points selected), points ALWAYS have top priority!
		const excludeIds = new Set<string>();
		if (this.state.step === 1 && this.state.point1Id) {
			excludeIds.add(this.state.point1Id);
		} else if (this.state.step === 2 && this.state.point1Id && this.state.point2Id && !this.state.point3Id) {
			excludeIds.add(this.state.point1Id);
			excludeIds.add(this.state.point2Id);
		}
		const nearPoint = this.ctx.findPointNear(screen);
		if (nearPoint && !excludeIds.has(nearPoint.id)) {
			id = nearPoint.id;
			type = 'point';
		}

		// Geometric hit test fallback if not clicking directly on entity
		if (!type || (type !== 'point' && type !== 'line' && type !== 'circle' && type !== 'arc')) {
			if (snap && snap.type === 'point' && snap.id && !excludeIds.has(snap.id)) {
				id = snap.id;
				type = 'point';
			} else {
				const hitLine = this.ctx.findLineNear(screen);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = this.ctx.findCircleNear(screen);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = this.ctx.findArcNear(screen);
						if (hitArc) {
							id = hitArc.id;
							type = 'arc';
						} else {
							const sOrigin = this.ctx.viewport.worldToScreen(ORIGIN);
							if (Math.abs(screen.y - sOrigin.y) <= LINE_DISTANCE_PX) {
								id = 'axis_x';
								type = 'line';
							} else if (Math.abs(screen.x - sOrigin.x) <= LINE_DISTANCE_PX) {
								id = 'axis_y';
								type = 'line';
							}
						}
					}
				}
			}
		}

		// If waiting for second point in step 1 or third point in step 2, snap to point has priority
		if (this.state.step === 1 && this.state.point1Id) {
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.state.point1Id) {
				id = snap.id;
				type = 'point';
			}
		} else if (this.state.step === 2 && this.state.point1Id && this.state.point2Id && !this.state.point3Id) {
			if (
				snap &&
				snap.type === 'point' &&
				snap.id &&
				snap.id !== this.state.point1Id &&
				snap.id !== this.state.point2Id
			) {
				id = snap.id;
				type = 'point';
			}
		}

		// STEP 0: Select first entity (point, line, or circle/arc)
		if (this.state.step === 0) {
			if (type === 'point' && id) {
				this.ctx.sketch.clearSelection();
				this.ctx.sketch.selectEntity(id, 'point', false);
				this.state = {
					step: 1,
					line1Id: null,
					line2Id: null,
					point1Id: id,
					point2Id: null,
				};
				this.ctx.requestRender();
			} else if (type === 'line' && id) {
				this.ctx.sketch.clearSelection();
				this.ctx.sketch.selectEntity(id, 'line', false);
				this.state = {
					step: 1,
					line1Id: id,
					line2Id: null,
					point1Id: null,
					point2Id: null,
				};
				this.ctx.requestRender();
			} else if ((type === 'circle' || type === 'arc') && id) {
				const { sketch } = this.ctx;
				if (sketch.hasRadiusConstraint(id)) {
					const constraint = sketch.addRadiusConstraint(id);
					if (constraint) {
						sketch.selectEntity(constraint.id, 'constraint', false);
						this.ctx.requestRender();
						this.ctx.onEditDimension?.(constraint, e.client);
					}
				} else {
					this.beginRadiusPlacement(id);
				}
			} else {
				this.ctx.sketch.clearSelection();
				this.state = {
					step: 0,
					line1Id: null,
					line2Id: null,
					point1Id: null,
					point2Id: null,
				};
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
				} else if (type === 'line' && (id === 'axis_x' || id === 'axis_y')) {
					const axis = id === 'axis_x' ? 'x' : 'y';
					const userPtId = this.state.point1Id;
					const existed = this.ctx.sketch.hasPointToAxisConstraint(userPtId, axis);
					const c = this.ctx.sketch.addPointToAxisDistanceConstraint(userPtId, axis);
					if (c) {
						this.ctx.showToast(
							existed
								? `Editing distance to ${axis.toUpperCase()}-axis`
								: `Distance to ${axis.toUpperCase()}-axis applied`
						);
						this.state = {
							step: 0,
							line1Id: null,
							line2Id: null,
							point1Id: null,
							point2Id: null,
						};
						this.ctx.renderer.clearPreviews();
						this.ctx.sketch.clearSelection();
						this.ctx.requestRender();
						if (this.ctx.onEditDimension) {
							this.ctx.onEditDimension(c, e.client);
						}
					}
					return true;
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
							const sp = this.ctx.viewport.worldToScreen(pt);
							const s1 = this.ctx.viewport.worldToScreen(lp1);
							const s2 = this.ctx.viewport.worldToScreen(lp2);
							const dir = new Vec2().subVectors(s2, s1);
							const lineLen = dir.length();
							if (lineLen > 1e-4) {
								const u = dir.clone().multiplyScalar(1 / lineLen);
								const tProj = new Vec2().subVectors(sp, s1).dot(u);
								const tCursor = new Vec2().subVectors(screen, s1).dot(u);
								let offsetScreen = tCursor - tProj;
								if (Math.abs(offsetScreen) < LABEL_DISTANCE_PX) {
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
							this.state = {
								step: 0,
								line1Id: null,
								line2Id: null,
								point1Id: null,
								point2Id: null,
							};
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
			const isAxis1 = this.state.line1Id === 'axis_x' || this.state.line1Id === 'axis_y';
			if (isAxis1) {
				const axis = this.state.line1Id === 'axis_x' ? 'x' : 'y';
				if (type === 'point' && id && id !== 'origin') {
					const existed = this.ctx.sketch.hasPointToAxisConstraint(id, axis);
					const c = this.ctx.sketch.addPointToAxisDistanceConstraint(id, axis);
					if (c) {
						this.ctx.showToast(
							existed
								? `Editing distance to ${axis.toUpperCase()}-axis`
								: `Distance to ${axis.toUpperCase()}-axis applied`
						);
						this.state = {
							step: 0,
							line1Id: null,
							line2Id: null,
							point1Id: null,
							point2Id: null,
						};
						this.ctx.renderer.clearPreviews();
						this.ctx.sketch.clearSelection();
						this.ctx.requestRender();
						if (this.ctx.onEditDimension) {
							this.ctx.onEditDimension(c, e.client);
						}
					}
					return true;
				}
				if (type === 'line' && id && id !== 'axis_x' && id !== 'axis_y') {
					this.ctx.sketch.selectEntity(id, 'line', true);
					this.state = {
						step: 2,
						line1Id: this.state.line1Id,
						line2Id: id,
						point1Id: null,
						point2Id: null,
					};
					this.ctx.requestRender();
					return true;
				}
				return true;
			}

			const l1 = this.state.line1Id ? this.ctx.sketch.lines.get(this.state.line1Id) : null;
			if (!l1) {
				this.state = {
					step: 0,
					line1Id: null,
					line2Id: null,
					point1Id: null,
					point2Id: null,
				};
				this.ctx.renderer.clearPreviews();
				this.ctx.requestRender();
				return true;
			}

			// If clicked on an axis line -> switch to Angle constraint mode!
			if (type === 'line' && (id === 'axis_x' || id === 'axis_y')) {
				this.ctx.sketch.selectEntity(id, 'line', true);
				this.state = {
					step: 2,
					line1Id: l1.id,
					line2Id: id,
					point1Id: null,
					point2Id: null,
				};
				this.ctx.requestRender();
				return true;
			}

			// If clicked on another line -> switch to Angle constraint mode!
			if (type === 'line' && id && id !== l1.id) {
				this.ctx.sketch.selectEntity(id, 'line', true);
				this.state = {
					step: 2,
					line1Id: l1.id,
					line2Id: id,
					point1Id: null,
					point2Id: null,
				};
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
					const sp = this.ctx.viewport.worldToScreen(pt);
					const s1 = this.ctx.viewport.worldToScreen(lp1);
					const s2 = this.ctx.viewport.worldToScreen(lp2);
					const dir = new Vec2().subVectors(s2, s1);
					const lineLen = dir.length();
					if (lineLen > 1e-4) {
						const u = dir.clone().multiplyScalar(1 / lineLen);
						const tProj = new Vec2().subVectors(sp, s1).dot(u);
						const tCursor = new Vec2().subVectors(screen, s1).dot(u);
						let offsetScreen = tCursor - tProj;
						if (Math.abs(offsetScreen) < LABEL_DISTANCE_PX) {
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
					this.state = {
						step: 0,
						line1Id: null,
						line2Id: null,
						point1Id: null,
						point2Id: null,
					};
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
				const s1 = this.ctx.viewport.worldToScreen(p1);
				const s2 = this.ctx.viewport.worldToScreen(p2);
				const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
				const offsetWorld = offsetScreen / this.ctx.viewport.zoom;

				const existed = this.ctx.sketch.hasDistanceConstraint(l1.p1Id, l1.p2Id, orientation);
				const c = this.ctx.sketch.addDistanceConstraint(l1.p1Id, l1.p2Id, undefined, offsetWorld, orientation);
				if (c) {
					if (orientation === 'horizontal') {
						const dx = s2.x - s1.x;
						if (Math.abs(dx) > 1e-4) {
							let t = (screen.x - s1.x) / dx;
							if (Math.abs(t - 0.5) < 0.04) t = 0.5;
							c.labelPosition = t;
						}
					} else if (orientation === 'vertical') {
						const dy = s2.y - s1.y;
						if (Math.abs(dy) > 1e-4) {
							let t = (screen.y - s1.y) / dy;
							if (Math.abs(t - 0.5) < 0.04) t = 0.5;
							c.labelPosition = t;
						}
					} else {
						const delta = new Vec2().subVectors(s2, s1);
						const len = delta.length();
						if (len > 1e-4) {
							const dir = delta.clone().multiplyScalar(1 / len);
							let t = new Vec2().subVectors(screen, s1).dot(dir) / len;
							if (Math.abs(t - 0.5) < 0.04) t = 0.5;
							c.labelPosition = t;
						}
					}
					const toastMsg = existed
						? 'Editing distance constraint'
						: orientation === 'horizontal'
							? 'Horizontal distance constraint applied'
							: orientation === 'vertical'
								? 'Vertical distance constraint applied'
								: 'Distance constraint applied';
					this.ctx.showToast(toastMsg);
					this.state = {
						step: 0,
						line1Id: null,
						line2Id: null,
						point1Id: null,
						point2Id: null,
					};
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

		// STEP 2: Either two/three points were selected OR two lines were selected
		if (this.state.step === 2) {
			// Subcase 0: Three points selected (Angle by 3 points, vertex = point2Id)
			if (this.state.point1Id && this.state.point2Id && this.state.point3Id) {
				const p1 = this.ctx.sketch.points.get(this.state.point1Id);
				const p2 = this.ctx.sketch.points.get(this.state.point2Id);
				const p3 = this.ctx.sketch.points.get(this.state.point3Id);
				if (p1 && p2 && p3) {
					const geom = this.ctx.sketch.calculateLinesAngleGeometry(p2, p1, p2, p3);
					const arcRadiusWorld = Math.max(10, world.distanceTo(geom.pInt));
					const existed = this.ctx.sketch.hasThreePointAngleConstraint(
						this.state.point1Id,
						this.state.point2Id,
						this.state.point3Id
					);
					const c = this.ctx.sketch.addThreePointAngleConstraint(
						this.state.point1Id,
						this.state.point2Id,
						this.state.point3Id,
						undefined,
						arcRadiusWorld
					);
					if (c) {
						this.ctx.showToast(existed ? 'Editing angle constraint' : 'Angle constraint applied');
						this.state = {
							step: 0,
							line1Id: null,
							line2Id: null,
							point1Id: null,
							point2Id: null,
							point3Id: null,
						};
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

			// Subcase 1: Two points selected! 3rd click either selects a 3rd point (angle mode) OR sets offset & places distance constraint!
			if (this.state.point1Id && this.state.point2Id) {
				if (type === 'point' && id && id !== this.state.point1Id && id !== this.state.point2Id) {
					this.ctx.sketch.selectEntity(id, 'point', true);
					this.state = {
						step: 2,
						line1Id: null,
						line2Id: null,
						point1Id: this.state.point1Id,
						point2Id: this.state.point2Id,
						point3Id: id,
					};
					this.ctx.requestRender();
					return true;
				}
				const isOrigin = this.state.point1Id === 'origin' || this.state.point2Id === 'origin';
				if (isOrigin) {
					const userPtId = this.state.point1Id === 'origin' ? this.state.point2Id! : this.state.point1Id!;
					const userPt = this.ctx.sketch.points.get(userPtId);
					if (userPt) {
						const sOrigin = this.ctx.viewport.worldToScreen(ORIGIN);
						const sPt = this.ctx.viewport.worldToScreen(userPt);
						const { orientation, offsetScreen } = determineDistanceOrientation(sOrigin, sPt, screen);
						let offsetWorld = offsetScreen / this.ctx.viewport.zoom;
						if (orientation === 'horizontal') {
							const sAxisY = this.ctx.viewport.worldToScreen(new Vec2(0, 100));
							const dy = sAxisY.y - sOrigin.y;
							const lineLen = Math.hypot(0, dy);
							const uy = lineLen > 1e-4 ? dy / lineLen : -1;
							const screenOffsetAlongAxis = (screen.y - sPt.y) * uy;
							offsetWorld = screenOffsetAlongAxis / this.ctx.viewport.zoom;
						} else if (orientation === 'vertical') {
							const screenOffsetAlongAxis = screen.x - sPt.x;
							offsetWorld = screenOffsetAlongAxis / this.ctx.viewport.zoom;
						}

						const existed = this.ctx.sketch.hasOriginConstraint(userPtId);
						const c = this.ctx.sketch.addOriginDistanceConstraint(userPtId, undefined, orientation, offsetWorld);
						if (c) {
							const toastMsg = existed
								? 'Editing distance to (0,0)'
								: orientation === 'horizontal'
									? 'Horizontal distance to (0,0) applied'
									: orientation === 'vertical'
										? 'Vertical distance to (0,0) applied'
										: 'Distance to (0,0) applied';
							this.ctx.showToast(toastMsg);
							this.state = {
								step: 0,
								line1Id: null,
								line2Id: null,
								point1Id: null,
								point2Id: null,
							};
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

				const p1 = this.ctx.sketch.points.get(this.state.point1Id);
				const p2 = this.ctx.sketch.points.get(this.state.point2Id);
				if (p1 && p2) {
					const s1 = this.ctx.viewport.worldToScreen(p1);
					const s2 = this.ctx.viewport.worldToScreen(p2);
					const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
					const offsetWorld = offsetScreen / this.ctx.viewport.zoom;

					const existed = this.ctx.sketch.hasDistanceConstraint(this.state.point1Id, this.state.point2Id, orientation);
					const c = this.ctx.sketch.addDistanceConstraint(
						this.state.point1Id,
						this.state.point2Id,
						undefined,
						offsetWorld,
						orientation
					);
					if (c) {
						if (orientation === 'horizontal') {
							const dx = s2.x - s1.x;
							if (Math.abs(dx) > 1e-4) {
								let t = (screen.x - s1.x) / dx;
								if (Math.abs(t - 0.5) < 0.04) t = 0.5;
								c.labelPosition = t;
							}
						} else if (orientation === 'vertical') {
							const dy = s2.y - s1.y;
							if (Math.abs(dy) > 1e-4) {
								let t = (screen.y - s1.y) / dy;
								if (Math.abs(t - 0.5) < 0.04) t = 0.5;
								c.labelPosition = t;
							}
						} else {
							const delta = new Vec2().subVectors(s2, s1);
							const len = delta.length();
							if (len > 1e-4) {
								const dir = delta.clone().multiplyScalar(1 / len);
								let t = new Vec2().subVectors(screen, s1).dot(dir) / len;
								if (Math.abs(t - 0.5) < 0.04) t = 0.5;
								c.labelPosition = t;
							}
						}
						const toastMsg = existed
							? 'Editing distance constraint'
							: orientation === 'horizontal'
								? 'Horizontal distance constraint applied'
								: orientation === 'vertical'
									? 'Vertical distance constraint applied'
									: 'Distance constraint applied';
						this.ctx.showToast(toastMsg);
						this.state = {
							step: 0,
							line1Id: null,
							line2Id: null,
							point1Id: null,
							point2Id: null,
						};
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
						const sp = this.ctx.viewport.worldToScreen(pt);
						const s1 = this.ctx.viewport.worldToScreen(p1);
						const s2 = this.ctx.viewport.worldToScreen(p2);
						const dir = new Vec2().subVectors(s2, s1);
						const lineLen = dir.length();
						if (lineLen > 1e-4) {
							const u = dir.clone().multiplyScalar(1 / lineLen);
							const tProj = new Vec2().subVectors(sp, s1).dot(u);
							const tCursor = new Vec2().subVectors(screen, s1).dot(u);
							const offsetWorld = (tCursor - tProj) / this.ctx.viewport.zoom;

							const existed = this.ctx.sketch.hasPointToLineDistanceConstraint(this.state.point1Id, this.state.line1Id);
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
								this.state = {
									step: 0,
									line1Id: null,
									line2Id: null,
									point1Id: null,
									point2Id: null,
								};
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
			const line1Id = this.state.line1Id!;
			const line2Id = this.state.line2Id!;
			const l1 = this.ctx.sketch.getLine(line1Id);
			const l2 = this.ctx.sketch.getLine(line2Id);
			if (!l1 || !l2 || (!this.ctx.sketch.lines.has(line1Id) && !this.ctx.sketch.lines.has(line2Id))) {
				this.state = {
					step: 0,
					line1Id: null,
					line2Id: null,
					point1Id: null,
					point2Id: null,
				};
				this.ctx.renderer.clearPreviews();
				this.ctx.requestRender();
				return true;
			}

			const p1 = this.ctx.sketch.points.get(l1.p1Id);
			const p2 = this.ctx.sketch.points.get(l1.p2Id);
			const p3 = this.ctx.sketch.points.get(l2.p1Id);
			const p4 = this.ctx.sketch.points.get(l2.p2Id);
			if (p1 && p2 && p3 && p4) {
				const geom = this.ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world, line1Id, line2Id);
				const arcRadiusWorld = Math.max(10, world.distanceTo(geom.pInt));
				const existed = this.ctx.sketch.hasAngleConstraint(line1Id, line2Id);
				const c = this.ctx.sketch.addAngleConstraint(line1Id, line2Id, undefined, arcRadiusWorld, world);
				if (c) {
					this.ctx.showToast(existed ? 'Editing angle constraint' : 'Angle constraint applied');
					this.state = {
						step: 0,
						line1Id: null,
						line2Id: null,
						point1Id: null,
						point2Id: null,
					};
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
		if (this.radiusDraft) {
			const { constraint } = this.radiusDraft;
			constraint.moveLabelTo(screen, ctx.sketch, ctx.viewport);
			constraint.renderDimension(ctx.sketch, ctx.viewport, ctx.targetGroup);
			return;
		}
		const world = ctx.cursorWorld;

		let p1Id: string | null = null;
		let p2Id: string | null = null;

		if (this.state.step === 1 && this.state.line1Id) {
			const l1 = ctx.sketch.lines.get(this.state.line1Id);
			if (l1) {
				// Check if hovering over a point (that is NOT an endpoint of line1)
				const hitPt = this.ctx.findPointNear(screen);
				if (hitPt && hitPt.id !== l1.p1Id && hitPt.id !== l1.p2Id) {
					const p1 = ctx.sketch.points.get(l1.p1Id);
					const p2 = ctx.sketch.points.get(l1.p2Id);
					if (p1 && p2) {
						const dir = new Vec2().subVectors(p2, p1);
						const lineLen = Math.max(dir.length(), 1e-7);
						const perpDist = Math.abs(new Vec2().subVectors(hitPt, p1).cross(dir)) / lineLen;
						const sp = ctx.viewport.worldToScreen(hitPt);
						const s1 = ctx.viewport.worldToScreen(p1);
						const s2 = ctx.viewport.worldToScreen(p2);
						this.ctx.renderer.renderPointToLineDistancePreview(sp, s1, s2, screen, perpDist);
						return;
					}
				}

				p1Id = l1.p1Id;
				p2Id = l1.p2Id;
			}
		} else if (this.state.step === 2 && this.state.point1Id && this.state.point2Id && this.state.point3Id) {
			const p1 = ctx.sketch.points.get(this.state.point1Id);
			const p2 = ctx.sketch.points.get(this.state.point2Id);
			const p3 = ctx.sketch.points.get(this.state.point3Id);
			if (p1 && p2 && p3) {
				const geom = ctx.sketch.calculateLinesAngleGeometry(p2, p1, p2, p3);
				const sCenter = ctx.viewport.worldToScreen(geom.pInt);
				const sRay1 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u1, 20));
				const sRay2 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u2, 20));
				const hasSeg1 = Boolean(ctx.sketch.getLineBetween(this.state.point2Id, this.state.point1Id));
				const hasSeg2 = Boolean(ctx.sketch.getLineBetween(this.state.point2Id, this.state.point3Id));
				const sp1 = ctx.viewport.worldToScreen(p1);
				const sp3 = ctx.viewport.worldToScreen(p3);
				this.ctx.renderer.renderAnglePreview(
					sCenter,
					sRay1,
					sRay2,
					screen,
					geom.initialAngleDeg,
					sCenter,
					hasSeg1 ? sp1 : sCenter,
					sCenter,
					hasSeg2 ? sp3 : sCenter
				);
			}
			return;
		} else if (this.state.step === 2 && this.state.point1Id && this.state.point2Id) {
			const hoverPtId =
				ctx.snap?.type === 'point' &&
				ctx.snap.id &&
				ctx.snap.id !== this.state.point1Id &&
				ctx.snap.id !== this.state.point2Id
					? ctx.snap.id
					: (() => {
							const pt = this.ctx.findPointNear(screen);
							if (pt && pt.id !== this.state.point1Id && pt.id !== this.state.point2Id) return pt.id;
							return null;
						})();
			if (hoverPtId) {
				const p1 = ctx.sketch.points.get(this.state.point1Id);
				const p2 = ctx.sketch.points.get(this.state.point2Id);
				const p3 = ctx.sketch.points.get(hoverPtId);
				if (p1 && p2 && p3) {
					const geom = ctx.sketch.calculateLinesAngleGeometry(p2, p1, p2, p3);
					const sCenter = ctx.viewport.worldToScreen(geom.pInt);
					const sRay1 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u1, 20));
					const sRay2 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u2, 20));
					const hasSeg1 = Boolean(ctx.sketch.getLineBetween(this.state.point2Id, this.state.point1Id));
					const hasSeg2 = Boolean(ctx.sketch.getLineBetween(this.state.point2Id, hoverPtId));
					const sp1 = ctx.viewport.worldToScreen(p1);
					const sp3 = ctx.viewport.worldToScreen(p3);
					this.ctx.renderer.renderAnglePreview(
						sCenter,
						sRay1,
						sRay2,
						screen,
						geom.initialAngleDeg,
						sCenter,
						hasSeg1 ? sp1 : sCenter,
						sCenter,
						hasSeg2 ? sp3 : sCenter
					);
					return;
				}
			}
			p1Id = this.state.point1Id;
			p2Id = this.state.point2Id;
		} else if (this.state.step === 1 && this.state.point1Id) {
			const p1 = ctx.sketch.points.get(this.state.point1Id);
			if (p1) {
				const s1 = ctx.viewport.worldToScreen(p1);

				// 1. TOP PRIORITY: Snap to any other point
				const snapPt =
					ctx.snap?.type === 'point' && ctx.snap.id && ctx.snap.id !== this.state.point1Id
						? {
								id: ctx.snap.id,
								worldPos: ctx.snap.worldPos,
								screenPos: ctx.snap.screenPos,
							}
						: (() => {
								const pt = this.ctx.findPointNear(screen);
								if (pt && pt.id !== p1.id) {
									return {
										id: pt.id,
										worldPos: pt,
										screenPos: ctx.viewport.worldToScreen(pt),
									};
								}
								return null;
							})();

				if (snapPt) {
					const targetScreen = snapPt.screenPos;
					const targetWorld = snapPt.worldPos;
					const currentDist = p1.distanceTo(targetWorld);
					this.ctx.renderer.renderDistanceLinePreview(s1, targetScreen, currentDist, true);
					return;
				}

				// 2. SECOND PRIORITY: Check if hovering over the body of a line
				const hitLine = this.ctx.findLineNear(screen);
				if (hitLine && hitLine.p1Id !== p1.id && hitLine.p2Id !== p1.id) {
					const lp1 = ctx.sketch.points.get(hitLine.p1Id);
					const lp2 = ctx.sketch.points.get(hitLine.p2Id);
					if (lp1 && lp2) {
						const dir = new Vec2().subVectors(lp2, lp1);
						const lineLen = Math.max(dir.length(), 1e-7);
						const perpDist = Math.abs(new Vec2().subVectors(p1, lp1).cross(dir)) / lineLen;
						if (perpDist >= 0.5) {
							const sp = ctx.viewport.worldToScreen(p1);
							const s1Line = ctx.viewport.worldToScreen(lp1);
							const s2Line = ctx.viewport.worldToScreen(lp2);
							this.ctx.renderer.renderPointToLineDistancePreview(sp, s1Line, s2Line, screen, perpDist);
							return;
						}
					}
				}

				// 3. Fallback: Free cursor in empty space
				const currentDist = p1.distanceTo(world);
				this.ctx.renderer.renderDistanceLinePreview(s1, screen, currentDist, false);
			}
		}

		if (p1Id && p2Id) {
			const p1 = ctx.sketch.points.get(p1Id);
			const p2 = ctx.sketch.points.get(p2Id);
			if (p1 && p2) {
				const s1 = ctx.viewport.worldToScreen(p1);
				const s2 = ctx.viewport.worldToScreen(p2);
				const { orientation } = determineDistanceOrientation(s1, s2, screen);
				let currentDist = p1.distanceTo(p2);
				if (orientation === 'horizontal') {
					currentDist = Math.abs(p2.x - p1.x);
				} else if (orientation === 'vertical') {
					currentDist = Math.abs(p2.y - p1.y);
				}
				this.ctx.renderer.renderDistancePreview(s1, s2, screen, currentDist, orientation);
			}
		} else if (this.state.step === 2 && this.state.line1Id && this.state.line2Id) {
			const line1Id = this.state.line1Id;
			const line2Id = this.state.line2Id;
			const l1 = ctx.sketch.getLine(line1Id);
			const l2 = ctx.sketch.getLine(line2Id);
			const hasUserLine1 = ctx.sketch.lines.has(line1Id);
			const hasUserLine2 = ctx.sketch.lines.has(line2Id);
			if (l1 && l2 && (hasUserLine1 || hasUserLine2)) {
				const p1 = ctx.sketch.points.get(l1.p1Id);
				const p2 = ctx.sketch.points.get(l1.p2Id);
				const p3 = ctx.sketch.points.get(l2.p1Id);
				const p4 = ctx.sketch.points.get(l2.p2Id);
				if (p1 && p2 && p3 && p4) {
					const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world, line1Id, line2Id);
					const sCenter = ctx.viewport.worldToScreen(geom.pInt);
					const sRay1 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u1, 20));
					const sRay2 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u2, 20));
					const sp1 = hasUserLine1 ? ctx.viewport.worldToScreen(p1) : undefined;
					const sp2 = hasUserLine1 ? ctx.viewport.worldToScreen(p2) : undefined;
					const sp3 = hasUserLine2 ? ctx.viewport.worldToScreen(p3) : undefined;
					const sp4 = hasUserLine2 ? ctx.viewport.worldToScreen(p4) : undefined;
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
					const sp = ctx.viewport.worldToScreen(pt);
					const s1 = ctx.viewport.worldToScreen(p1);
					const s2 = ctx.viewport.worldToScreen(p2);
					const dir = new Vec2().subVectors(p2, p1);
					const lineLen = Math.max(dir.length(), 1e-7);
					const perpDist = Math.abs(new Vec2().subVectors(pt, p1).cross(dir)) / lineLen;
					this.ctx.renderer.renderPointToLineDistancePreview(sp, s1, s2, screen, perpDist);
				}
			}
		}
	}
}
