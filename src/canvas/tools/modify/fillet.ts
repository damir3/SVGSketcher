import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import { dist, type Vec2 } from '../../../math/vector';
import { FilletPopup } from '../../../ui/fillet-popup';
import {
	getConnectedPrimitivesForPoint,
	calculateFilletGeometry,
	findMaxFilletRadius,
	commitFilletToSketch,
	type FilletCandidate,
	type FilletResult,
} from '../../../math/fillet';
import { sketchPrimitiveToGeoCurve } from '../../../math/intersection';

export class FilletTool extends BaseTool {
	readonly id = 'fillet' as const;

	readonly popup: FilletPopup;
	filletRadius = 10.0;
	pendingFillets: FilletCandidate[] = [];
	activeFilletId: string | null = null;
	filletFirstPrimitive: { type: 'line' | 'arc' | 'spline'; id: string; clickPos: Vec2 } | null = null;
	filletHoverPointId: string | null = null;
	filletGizmoDragState: {
		startMouseWorld: Vec2;
		startRadius: number;
		center: Vec2;
		bisectorDir: Vec2;
	} | null = null;

	constructor() {
		super();
		this.popup = new FilletPopup();
		this.popup.onRadiusChange = radius => {
			this.filletRadius = radius;
			this.recalculatePendingFillets();
			const activePf =
				this.pendingFillets.find(pf => pf.id === this.activeFilletId) ||
				this.pendingFillets[this.pendingFillets.length - 1];
			if (activePf && !activePf.result) {
				const c1 = sketchPrimitiveToGeoCurve(this.ctx.sketch, activePf.primitive1.type, activePf.primitive1.id);
				const c2 = sketchPrimitiveToGeoCurve(this.ctx.sketch, activePf.primitive2.type, activePf.primitive2.id);
				let maxR: number | null = null;
				if (c1 && c2) {
					let cornerVertex: Vec2 | undefined;
					if (activePf.vertexPointId) {
						const pt = this.ctx.sketch.points.get(activePf.vertexPointId);
						if (pt) cornerVertex = { x: pt.x, y: pt.y };
					}
					maxR = findMaxFilletRadius(
						c1,
						c2,
						{
							cornerVertex,
							clickPos1: activePf.clickPos1,
							clickPos2: activePf.clickPos2,
							endPointId1: activePf.endPointId1,
							endPointId2: activePf.endPointId2,
						},
						radius,
						0.1
					);
				}
				this.popup.setError(true, maxR !== null ? `Max: ${maxR.toFixed(1)} mm` : 'Radius too large');
			} else {
				this.popup.setError(false);
			}
			this.ctx.requestRender();
		};
		this.popup.onCommit = () => {
			const invalidPf = this.pendingFillets.find(pf => !pf.result);
			if (invalidPf) {
				const c1 = sketchPrimitiveToGeoCurve(this.ctx.sketch, invalidPf.primitive1.type, invalidPf.primitive1.id);
				const c2 = sketchPrimitiveToGeoCurve(this.ctx.sketch, invalidPf.primitive2.type, invalidPf.primitive2.id);
				let maxR: number | null = null;
				if (c1 && c2) {
					let cornerVertex: Vec2 | undefined;
					if (invalidPf.vertexPointId) {
						const pt = this.ctx.sketch.points.get(invalidPf.vertexPointId);
						if (pt) cornerVertex = { x: pt.x, y: pt.y };
					}
					maxR = findMaxFilletRadius(
						c1,
						c2,
						{
							cornerVertex,
							clickPos1: invalidPf.clickPos1,
							clickPos2: invalidPf.clickPos2,
							endPointId1: invalidPf.endPointId1,
							endPointId2: invalidPf.endPointId2,
						},
						this.filletRadius,
						0.1
					);
				}
				if (maxR !== null) {
					this.filletRadius = maxR;
					this.recalculatePendingFillets();
					this.popup.updateRadius(maxR);
					this.popup.setError(false);
					this.commit();
					this.ctx.showToast(`Committed with maximum possible radius (${maxR.toFixed(1)} mm)`);
				} else {
					this.ctx.showToast('Cannot commit: radius too large for corner');
				}
				return;
			}
			this.commit();
		};
		this.popup.onCancel = () => {
			this.cancel();
		};
	}

	override isBusy(): boolean {
		return this.pendingFillets.length > 0 || this.filletFirstPrimitive !== null;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		if (this.filletRadius <= 0.1 || !isFinite(this.filletRadius)) {
			this.filletRadius = 10.0;
		}
	}

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override getRenderOptions(): Record<string, unknown> {
		return {
			filletState: {
				pendingFillets: this.pendingFillets,
				activeFilletId: this.activeFilletId,
				selectedPrimitive1: this.filletFirstPrimitive,
				hoverPointId: this.filletHoverPointId,
			},
		};
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// 1. Check for Fillet Gizmo handle dragging
		if (this.ctx.renderer.filletGizmoHandle) {
			const gh = this.ctx.renderer.filletGizmoHandle;
			if (dist(screen, { x: gh.screenX, y: gh.screenY }) <= 20) {
				this.filletGizmoDragState = {
					startMouseWorld: world,
					startRadius: gh.radius,
					center: gh.worldCenter,
					bisectorDir: gh.worldBisectorDir,
				};
				e.raw.preventDefault();
				e.raw.stopPropagation();
				return;
			}
		}

		// 2. Point or primitive selection
		if (!this.filletFirstPrimitive) {
			const nearPt = this.ctx.findPointNear(screen, 16);
			if (nearPt) {
				const conn = getConnectedPrimitivesForPoint(this.ctx.sketch, nearPt.id);
				if (conn.valid) {
					this.addFilletForPoint(nearPt.id);
					return;
				}
			}

			const hitPrim = this.findFilletPrimitiveNearScreen(screen);
			if (hitPrim) {
				this.filletFirstPrimitive = {
					type: hitPrim.type,
					id: hitPrim.id,
					clickPos: world,
				};
				this.ctx.requestRender();
				return;
			}
		} else {
			const hitPrim = this.findFilletPrimitiveNearScreen(screen);
			if (hitPrim) {
				if (hitPrim.id === this.filletFirstPrimitive.id) {
					this.filletFirstPrimitive = null;
					this.ctx.requestRender();
					return;
				} else {
					this.addFilletForPrimitives(
						this.filletFirstPrimitive,
						{ type: hitPrim.type, id: hitPrim.id },
						this.filletFirstPrimitive.clickPos,
						world
					);
					this.filletFirstPrimitive = null;
					return;
				}
			}
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// Gizmo drag handling
		if (this.filletGizmoDragState) {
			const { startMouseWorld, startRadius, bisectorDir } = this.filletGizmoDragState;
			const inwardDir = { x: -bisectorDir.x, y: -bisectorDir.y };
			const delta = (world.x - startMouseWorld.x) * inwardDir.x + (world.y - startMouseWorld.y) * inwardDir.y;
			const newRadius = Math.max(0.5, Math.round((startRadius + delta) * 2) / 2);
			if (Math.abs(newRadius - this.filletRadius) > 1e-4) {
				const oldRadius = this.filletRadius;
				this.filletRadius = newRadius;
				this.recalculatePendingFillets();
				const activePf =
					this.pendingFillets.find(pf => pf.id === this.activeFilletId) ||
					this.pendingFillets[this.pendingFillets.length - 1];
				if (activePf && !activePf.result && newRadius > oldRadius) {
					this.filletRadius = oldRadius;
					this.recalculatePendingFillets();
				}
				this.popup.updateRadius(this.filletRadius);
				this.ctx.requestRender();
			}
			return;
		}

		// Hover corner highlight
		let needsRender = false;
		if (!this.filletFirstPrimitive) {
			const nearPt = this.ctx.findPointNear(screen, 16);
			if (nearPt) {
				const conn = getConnectedPrimitivesForPoint(this.ctx.sketch, nearPt.id);
				const newHover = conn.valid ? nearPt.id : null;
				if (newHover !== this.filletHoverPointId) {
					this.filletHoverPointId = newHover;
					needsRender = true;
				}
			} else if (this.filletHoverPointId !== null) {
				this.filletHoverPointId = null;
				needsRender = true;
			}
		} else {
			if (this.filletHoverPointId !== null) {
				this.filletHoverPointId = null;
				needsRender = true;
			}
		}

		// Update cursor
		if (
			this.ctx.renderer.filletGizmoHandle &&
			dist(screen, { x: this.ctx.renderer.filletGizmoHandle.screenX, y: this.ctx.renderer.filletGizmoHandle.screenY }) <= 20
		) {
			this.ctx.setCursor('grab');
		} else if (this.filletHoverPointId) {
			this.ctx.setCursor('pointer');
		} else {
			this.ctx.setCursor('crosshair');
		}

		// Update popup position
		if (this.popup.isOpen() && this.pendingFillets.length > 0) {
			const activePf =
				this.pendingFillets.find(pf => pf.id === this.activeFilletId) ||
				this.pendingFillets[this.pendingFillets.length - 1];
			if (activePf) {
				if (activePf.result) {
					const sPos = this.ctx.viewport.worldToScreen(activePf.result.midArc.x, activePf.result.midArc.y);
					this.popup.updatePosition(sPos);
				} else if (activePf.vertexPointId) {
					const pt = this.ctx.sketch.points.get(activePf.vertexPointId);
					if (pt) {
						const sPos = this.ctx.viewport.worldToScreen(pt.x, pt.y);
						this.popup.updatePosition(sPos);
					}
				} else if (activePf.clickPos1) {
					const sPos = this.ctx.viewport.worldToScreen(activePf.clickPos1.x, activePf.clickPos1.y);
					this.popup.updatePosition(sPos);
				}
			}
		}

		if (needsRender) {
			this.ctx.requestRender();
		}
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		if (this.filletGizmoDragState) {
			this.filletGizmoDragState = null;
			this.ctx.requestRender();
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

	override commit(): void {
		if (this.pendingFillets.length === 0) return;
		this.ctx.sketch.beginTransaction();
		let firstArcId: string | undefined;

		for (let i = 0; i < this.pendingFillets.length; i++) {
			const pf = this.pendingFillets[i];
			if (!pf.result) continue;
			const res = commitFilletToSketch(this.ctx.sketch, pf, i === 0, firstArcId);
			if (res && i === 0) {
				firstArcId = res.arcId;
			}
		}

		this.ctx.sketch.solve();
		this.ctx.sketch.commitTransaction();

		this.ctx.showToast(`Created ${this.pendingFillets.length} fillet${this.pendingFillets.length > 1 ? 's' : ''}`);
		this.cancel();
	}

	override cancel(): void {
		if (this.filletFirstPrimitive !== null) {
			this.filletFirstPrimitive = null;
			this.ctx.requestRender();
			return;
		}
		if (this.pendingFillets.some(pf => !pf.result)) {
			this.filletRadius = 10.0;
		}
		this.pendingFillets = [];
		this.activeFilletId = null;
		this.filletHoverPointId = null;
		this.filletGizmoDragState = null;
		this.popup.hide();
		this.ctx.renderer.clearPreviews();
		this.ctx.requestRender();
	}

	private findFilletPrimitiveNearScreen(screen: Vec2): { type: 'line' | 'arc' | 'spline'; id: string } | null {
		const line = this.ctx.findLineNear(screen, 16);
		if (line && !line.isSplineHandle) {
			return { type: 'line', id: line.id };
		}
		const arc = this.ctx.findArcNear(screen, 18);
		if (arc) {
			return { type: 'arc', id: arc.id };
		}
		const spline = this.ctx.findSplineNear(screen, 18);
		if (spline) {
			return { type: 'spline', id: spline.id };
		}
		return null;
	}

	private addFilletForPoint(pointId: string): void {
		const conn = getConnectedPrimitivesForPoint(this.ctx.sketch, pointId);
		if (!conn.valid || conn.primitives.length !== 2) return;

		const existingIdx = this.pendingFillets.findIndex(pf => pf.vertexPointId && conn.pointIds.has(pf.vertexPointId));
		if (existingIdx !== -1) {
			this.pendingFillets.splice(existingIdx, 1);
			if (this.pendingFillets.length === 0) {
				this.popup.hide();
				this.activeFilletId = null;
			} else {
				this.activeFilletId = this.pendingFillets[this.pendingFillets.length - 1].id;
			}
			this.ctx.requestRender();
			return;
		}

		const prim1 = conn.primitives[0];
		const prim2 = conn.primitives[1];
		const pt = this.ctx.sketch.points.get(pointId);
		if (!pt) return;

		const candidate: FilletCandidate = {
			id: `fillet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			vertexPointId: pointId,
			primitive1: { type: prim1.type, id: prim1.id },
			primitive2: { type: prim2.type, id: prim2.id },
			endPointId1: prim1.endPointId,
			endPointId2: prim2.endPointId,
		};

		const c1 = sketchPrimitiveToGeoCurve(this.ctx.sketch, prim1.type, prim1.id);
		const c2 = sketchPrimitiveToGeoCurve(this.ctx.sketch, prim2.type, prim2.id);
		let candidateResult: FilletResult | null = null;
		if (c1 && c2) {
			const filletOpts = {
				cornerVertex: { x: pt.x, y: pt.y },
				endPointId1: prim1.endPointId,
				endPointId2: prim2.endPointId,
			};
			candidateResult = calculateFilletGeometry(c1, c2, this.filletRadius, filletOpts);
			if (!candidateResult) {
				const maxR = findMaxFilletRadius(c1, c2, filletOpts, Math.max(100, this.filletRadius), 0.1);
				if (maxR === null) {
					this.ctx.showToast('Cannot fillet this corner (curves are parallel or collinear)');
					return;
				}
				this.filletRadius = Math.min(this.filletRadius, maxR);
				candidateResult = calculateFilletGeometry(c1, c2, this.filletRadius, filletOpts);
				this.ctx.showToast(`Radius adjusted to ${this.filletRadius.toFixed(1)} mm for this corner`);
			}
		}

		candidate.result = candidateResult;
		this.pendingFillets.push(candidate);
		this.activeFilletId = candidate.id;

		const sPos = candidate.result
			? this.ctx.viewport.worldToScreen(candidate.result.midArc.x, candidate.result.midArc.y)
			: this.ctx.viewport.worldToScreen(pt.x, pt.y);

		if (this.pendingFillets.length === 1) {
			this.popup.show(sPos, this.filletRadius);
		} else {
			this.popup.updatePosition(sPos);
		}

		this.ctx.requestRender();
	}

	private addFilletForPrimitives(
		prim1: { type: 'line' | 'arc' | 'spline'; id: string },
		prim2: { type: 'line' | 'arc' | 'spline'; id: string },
		clickPos1: Vec2,
		clickPos2: Vec2
	): void {
		const existingIdx = this.pendingFillets.findIndex(
			pf =>
				(pf.primitive1.id === prim1.id && pf.primitive2.id === prim2.id) ||
				(pf.primitive1.id === prim2.id && pf.primitive2.id === prim1.id)
		);
		if (existingIdx !== -1) {
			this.pendingFillets.splice(existingIdx, 1);
			if (this.pendingFillets.length === 0) {
				this.popup.hide();
				this.activeFilletId = null;
			} else {
				this.activeFilletId = this.pendingFillets[this.pendingFillets.length - 1].id;
			}
			this.ctx.requestRender();
			return;
		}

		const candidate: FilletCandidate = {
			id: `fillet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			primitive1: { type: prim1.type, id: prim1.id },
			primitive2: { type: prim2.type, id: prim2.id },
			clickPos1,
			clickPos2,
		};

		const getEndpoints = (p: { type: 'line' | 'arc' | 'spline'; id: string }): string[] => {
			if (p.type === 'line') {
				const l = this.ctx.sketch.lines.get(p.id);
				return l ? [l.p1Id, l.p2Id] : [];
			}
			if (p.type === 'arc') {
				const a = this.ctx.sketch.arcs.get(p.id);
				return a ? [a.startPointId, a.endPointId] : [];
			}
			if (p.type === 'spline') {
				const s = this.ctx.sketch.splines.get(p.id);
				return s && s.pointIds.length >= 2 ? [s.pointIds[0], s.pointIds[s.pointIds.length - 1]] : [];
			}
			return [];
		};

		const eps1 = getEndpoints(prim1);
		const eps2 = getEndpoints(prim2);
		let sharedCornerPt: Vec2 | undefined;
		let endPointId1: string | undefined;
		let endPointId2: string | undefined;

		for (const ep1 of eps1) {
			const conn1 = getConnectedPrimitivesForPoint(this.ctx.sketch, ep1);
			for (const ep2 of eps2) {
				if (conn1.pointIds.has(ep2)) {
					const pt = this.ctx.sketch.points.get(ep1);
					if (pt) {
						sharedCornerPt = { x: pt.x, y: pt.y };
						endPointId1 = ep1;
						endPointId2 = ep2;
						candidate.vertexPointId = ep1;
						candidate.endPointId1 = ep1;
						candidate.endPointId2 = ep2;
						break;
					}
				}
			}
			if (sharedCornerPt) break;
		}

		const c1 = sketchPrimitiveToGeoCurve(this.ctx.sketch, prim1.type, prim1.id);
		const c2 = sketchPrimitiveToGeoCurve(this.ctx.sketch, prim2.type, prim2.id);
		let candidateResult: FilletResult | null = null;
		if (c1 && c2) {
			const filletOpts = {
				cornerVertex: sharedCornerPt,
				endPointId1,
				endPointId2,
				clickPos1,
				clickPos2,
			};
			candidateResult = calculateFilletGeometry(c1, c2, this.filletRadius, filletOpts);
			if (!candidateResult) {
				const maxR = findMaxFilletRadius(c1, c2, filletOpts, Math.max(100, this.filletRadius), 0.1);
				if (maxR === null) {
					this.ctx.showToast('Cannot fillet this corner (curves are parallel or collinear)');
					return;
				}
				this.filletRadius = Math.min(this.filletRadius, maxR);
				candidateResult = calculateFilletGeometry(c1, c2, this.filletRadius, filletOpts);
				this.ctx.showToast(`Radius adjusted to ${this.filletRadius.toFixed(1)} mm for this corner`);
			}
		}

		candidate.result = candidateResult;
		this.pendingFillets.push(candidate);
		this.activeFilletId = candidate.id;

		const sPos = candidate.result
			? this.ctx.viewport.worldToScreen(candidate.result.midArc.x, candidate.result.midArc.y)
			: sharedCornerPt
			? this.ctx.viewport.worldToScreen(sharedCornerPt.x, sharedCornerPt.y)
			: this.ctx.viewport.worldToScreen(clickPos1.x, clickPos1.y);

		if (this.pendingFillets.length === 1) {
			this.popup.show(sPos, this.filletRadius);
		} else {
			this.popup.updatePosition(sPos);
		}

		this.ctx.requestRender();
	}

	private recalculatePendingFillets(): void {
		for (const pf of this.pendingFillets) {
			const c1 = sketchPrimitiveToGeoCurve(this.ctx.sketch, pf.primitive1.type, pf.primitive1.id);
			const c2 = sketchPrimitiveToGeoCurve(this.ctx.sketch, pf.primitive2.type, pf.primitive2.id);
			if (c1 && c2) {
				let cornerVertex: Vec2 | undefined;
				if (pf.vertexPointId) {
					const pt = this.ctx.sketch.points.get(pf.vertexPointId);
					if (pt) cornerVertex = { x: pt.x, y: pt.y };
				}
				pf.result = calculateFilletGeometry(c1, c2, this.filletRadius, {
					cornerVertex,
					clickPos1: pf.clickPos1,
					clickPos2: pf.clickPos2,
					endPointId1: pf.endPointId1,
					endPointId2: pf.endPointId2,
				});
			}
		}
	}
}
