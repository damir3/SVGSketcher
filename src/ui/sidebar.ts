import type { SketchDocument } from '../model/sketch';
import type { SketchSpline } from '../model/types';
import type { CanvasInteraction } from '../canvas/interaction';
import { DistanceConstraint, RadiusConstraint, AngleConstraint, PointToLineDistanceConstraint, CircularPatternConstraint, RectangularPatternConstraint } from '../solver/constraints';
import { ICONS } from './icons';
import { dist } from '../math/vector';

export class Sidebar {
	private container: HTMLElement;
	private sketch: SketchDocument;
	private interaction?: CanvasInteraction;

	onEditDimension?: (constraint: DistanceConstraint | RadiusConstraint | AngleConstraint | PointToLineDistanceConstraint) => void;

	constructor(container: HTMLElement, sketch: SketchDocument, interaction?: CanvasInteraction) {
		this.container = container;
		this.sketch = sketch;
		this.interaction = interaction;

		this.sketch.onChange(() => this.render());
		if (this.interaction) {
			this.interaction.onMirrorStateChange = () => this.render();
			this.interaction.onCircularPatternStateChange = () => this.render();
			this.interaction.onRectangularPatternStateChange = () => this.render();
		}
		this.render();
	}

	render(): void {
		const res = this.sketch.lastSolverResult;
		const dof = res ? res.degreesOfFreedom : 0;
		const status = res ? res.status : 'CONVERGED';

		let statusClass = 'status-under';
		let statusLabel = `Under-constrained (${dof} DoF)`;

		if (status === 'OVER_CONSTRAINED') {
			statusClass = 'status-conflict';
			statusLabel = 'Over-constrained / Conflict';
		} else if (status === 'CONVERGED' && dof === 0) {
			statusClass = 'status-fully';
			statusLabel = 'Fully Defined (0 DoF)';
		}

		const points = [...this.sketch.points.values()].filter(p => !this.sketch.isSplineHandlePoint(p.id));
		const lines = [...this.sketch.lines.values()].filter(l => !l.isSplineHandle);
		const circles = [...this.sketch.circles.values()];
		const arcs = [...this.sketch.arcs.values()];
		const ellipses = [...this.sketch.ellipses.values()];
		const ellipticalArcs = [...this.sketch.ellipticalArcs.values()];
		const splines = [...this.sketch.splines.values()];
		const totalPrimitives =
			points.length +
			lines.length +
			circles.length +
			arcs.length +
			ellipses.length +
			ellipticalArcs.length +
			splines.length;

		this.container.innerHTML = `
			<div class="sidebar-header">
				<div class="sidebar-title">Inspector & Tree</div>
				<div class="dof-badge ${statusClass}">
					<span class="dof-indicator"></span>
					${statusLabel}
				</div>
			</div>

			<div class="sidebar-content">
				<!-- Mirror Tool Panel (when mirror tool is active) -->
				${this.renderMirrorToolCard()}

				<!-- Circular Pattern Tool Panel (when circular pattern tool is active) -->
				${this.renderCircularPatternToolCard()}

				<!-- Rectangular Pattern Tool Panel (when rectangular pattern tool is active) -->
				${this.renderRectangularPatternToolCard()}

				<!-- Selected item inspector -->
				${this.renderInspector()}

				<!-- Primitives Tree -->
				<div class="tree-group">
					<div class="tree-header">
						<span class="tree-title">Primitives (${totalPrimitives})</span>
					</div>
					<div class="tree-list">
						${splines.map(s => this.renderSplineItem(s)).join('')}
						${lines.map(l => this.renderLineItem(l)).join('')}
						${circles.map(c => this.renderCircleItem(c)).join('')}
						${arcs.map(a => this.renderArcItem(a)).join('')}
						${ellipses.map(e => this.renderEllipseItem(e)).join('')}
						${ellipticalArcs.map(ea => this.renderEllipticalArcItem(ea)).join('')}
						${points.map(p => this.renderPointItem(p)).join('')}
						${totalPrimitives === 0 ? '<div class="tree-empty">No primitives yet. Use the left toolbar to draw.</div>' : ''}
					</div>
				</div>
			</div>
		`;

		this.bindEvents();
	}

	private renderMirrorToolCard(): string {
		if (!this.interaction || this.interaction.activeTool !== 'mirror') {
			return '';
		}

		const state = this.interaction.mirrorState;
		const objCount = state ? state.selectedObjectIds.size : 0;
		const mirrorLineId = state?.mirrorLineId ?? null;
		const phase = state?.phase ?? 'objects';

		let lineLabel = 'Click a line in canvas';
		if (mirrorLineId) {
			const line = this.sketch.lines.get(mirrorLineId);
			if (line) {
				const p1 = this.sketch.points.get(line.p1Id);
				const p2 = this.sketch.points.get(line.p2Id);
				const len = p1 && p2 ? ` (${dist(p1, p2).toFixed(1)} mm)` : '';
				lineLabel = `${line.id}${len}`;
			} else {
				lineLabel = mirrorLineId;
			}
		}

		const canApply = objCount > 0 && !!mirrorLineId;

		return `
			<div class="sidebar-panel-card mirror-tool-card">
				<div class="panel-card-header">
					<div class="panel-card-title">
						<span class="panel-card-icon">${ICONS.mirror}</span>
						<span>Mirror Tool</span>
					</div>
					<button class="btn-panel-close" id="btn-mirror-cancel-icon" title="Cancel (Esc)">✕</button>
				</div>
				<div class="panel-card-desc">
					Create symmetric copies of primitives across a centerline.
				</div>

				<div class="mirror-steps">
					<div class="mirror-step-item ${phase === 'objects' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-mirror-phase-objects" type="button">
							<span class="mirror-step-num">1</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Objects to Mirror</div>
								<div class="mirror-step-value">${objCount === 0 ? 'Click or box-select...' : `${objCount} object${objCount === 1 ? '' : 's'} selected`}</div>
							</div>
						</button>
						${objCount > 0 ? `<button class="mirror-step-clear" id="btn-mirror-clear-objects" title="Clear selection">✕</button>` : ''}
					</div>

					<div class="mirror-step-item ${phase === 'mirror_line' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-mirror-phase-line" type="button">
							<span class="mirror-step-num">2</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Mirror Line</div>
								<div class="mirror-step-value ${mirrorLineId ? 'selected-line' : ''}">${lineLabel}</div>
							</div>
						</button>
						${mirrorLineId ? `<button class="mirror-step-clear" id="btn-mirror-clear-line" title="Clear mirror line">✕</button>` : ''}
					</div>
				</div>

				<div class="mirror-actions">
					<button class="btn-mirror-ok" id="btn-mirror-ok" ${canApply ? '' : 'disabled'} title="Apply Mirror (Enter)">
						Apply Mirror
					</button>
					<button class="btn-mirror-cancel" id="btn-mirror-cancel" title="Cancel (Esc)">
						Cancel
					</button>
				</div>
				<div class="mirror-hint">
					${!mirrorLineId && objCount === 0 
						? 'Select objects first, then pick a mirror line.' 
						: (!mirrorLineId ? 'Click a centerline in the canvas to reflect across.' : (objCount === 0 ? 'Pick geometry in the canvas to mirror.' : 'Ready to apply! Press Enter or click Apply Mirror.'))}
				</div>
			</div>
		`;
	}

	private renderCircularPatternToolCard(): string {
		if (!this.interaction || this.interaction.activeTool !== 'circular_pattern') {
			return '';
		}

		const state = this.interaction.circularPatternState;
		const objCount = state ? state.selectedObjectIds.size : 0;
		const centerPointId = state?.centerPointId ?? null;
		const phase = state?.phase ?? 'objects';
		const distribution = state?.distribution ?? 'full';
		const angle = state?.angle ?? 180;
		const quantity = state?.quantity ?? 3;
		const suppression = state?.suppression ?? false;
		const suppressedCount = state?.suppressedIndices.size ?? 0;
		const totalCopies = Math.max(1, quantity - 1);
		const activeCopies = totalCopies - suppressedCount;

		let centerLabel = 'Click a point in canvas';
		if (centerPointId) {
			const pt = this.sketch.points.get(centerPointId);
			if (pt) {
				centerLabel = `Point (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`;
			} else {
				centerLabel = centerPointId;
			}
		}

		const canApply = objCount > 0 && !!centerPointId && activeCopies > 0 && (distribution === 'full' || (!isNaN(angle) && Math.abs(angle) > 1e-3));

		return `
			<div class="sidebar-panel-card pattern-tool-card">
				<div class="panel-card-header">
					<div class="panel-card-title">
						<span class="panel-card-icon">${ICONS.circular_pattern}</span>
						<span>Circular Pattern</span>
					</div>
					<button class="btn-panel-close" id="btn-cpat-cancel-icon" title="Cancel (Esc)">✕</button>
				</div>
				<div class="panel-card-desc">
					Rotate copies of geometry around a center point.
				</div>

				<div class="mirror-steps">
					<div class="mirror-step-item ${phase === 'objects' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-cpat-phase-objects" type="button">
							<span class="mirror-step-num">1</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Objects to Pattern</div>
								<div class="mirror-step-value">${objCount === 0 ? 'Click or box-select...' : `${objCount} object${objCount === 1 ? '' : 's'} selected`}</div>
							</div>
						</button>
						${objCount > 0 ? `<button class="mirror-step-clear" id="btn-cpat-clear-objects" title="Clear selection">✕</button>` : ''}
					</div>

					<div class="mirror-step-item ${phase === 'center_point' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-cpat-phase-center" type="button">
							<span class="mirror-step-num">2</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Center Point</div>
								<div class="mirror-step-value ${centerPointId ? 'selected-line' : ''}">${centerLabel}</div>
							</div>
						</button>
						${centerPointId ? `<button class="mirror-step-clear" id="btn-cpat-clear-center" title="Clear center point">✕</button>` : ''}
					</div>
				</div>

				<!-- Pattern Parameters -->
				<div class="pattern-params-card">
					<div class="pattern-param-row">
						<label class="pattern-param-label">Distribution</label>
						<div class="pattern-segmented-control">
							<button type="button" class="seg-btn ${distribution === 'full' ? 'active' : ''}" data-dist="full">Full</button>
							<button type="button" class="seg-btn ${distribution === 'partial' ? 'active' : ''}" data-dist="partial">Partial</button>
							<button type="button" class="seg-btn ${distribution === 'symmetric' ? 'active' : ''}" data-dist="symmetric">Symmetric</button>
						</div>
					</div>

					${distribution !== 'full' ? `
					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-cpat-angle">Total Angle</label>
						<div class="pattern-input-suffix-wrapper">
							<input type="number" id="input-cpat-angle" value="${angle}" min="-360" max="360" step="5" class="pattern-num-input" />
							<span class="pattern-input-suffix">°</span>
						</div>
					</div>
					` : ''}

					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-cpat-quantity">Quantity</label>
						<div class="pattern-quantity-wrapper">
							<input type="number" id="input-cpat-quantity" value="${quantity}" min="2" max="100" step="1" class="pattern-num-input" />
						</div>
					</div>

					<div class="pattern-param-row pattern-suppress-row">
						<label class="pattern-checkbox-label">
							<input type="checkbox" id="check-cpat-suppression" ${suppression ? 'checked' : ''} />
							<span>Suppression</span>
						</label>
						${suppression ? `<span class="pattern-suppress-count">${activeCopies} of ${totalCopies} enabled</span>` : ''}
					</div>
				</div>

				<div class="mirror-actions">
					<button class="btn-mirror-ok" id="btn-cpat-ok" ${canApply ? '' : 'disabled'} title="Apply Pattern (Enter)">
						Apply Pattern
					</button>
					<button class="btn-mirror-cancel" id="btn-cpat-cancel" title="Cancel (Esc)">
						Cancel
					</button>
				</div>
				<div class="mirror-hint">
					${!centerPointId && objCount === 0 
						? 'Select objects first, then pick a center point.' 
						: (!centerPointId ? 'Click a point in the canvas to set the rotation center.' : (objCount === 0 ? 'Pick geometry in the canvas to pattern.' : 'Ready to apply! Press Enter or click Apply Pattern.'))}
				</div>
			</div>
		`;
	}

	private renderRectangularPatternToolCard(): string {
		if (!this.interaction || this.interaction.activeTool !== 'rectangular_pattern') {
			return '';
		}

		const state = this.interaction.rectangularPatternState;
		const objCount = state ? state.selectedObjectIds.size : 0;
		const line1Id = state?.line1Id ?? null;
		const line2Id = state?.line2Id ?? null;
		const phase = state?.phase ?? 'objects';
		const quantity1 = state?.quantity1 ?? 3;
		const distance1 = state?.distance1 ?? 0;
		const direction1 = state?.direction1 ?? 'one_direction';
		const quantity2 = state?.quantity2 ?? 3;
		const distance2 = state?.distance2 ?? 0;
		const direction2 = state?.direction2 ?? 'one_direction';
		const suppression = state?.suppression ?? false;
		const suppressedIndices = state?.suppressedIndices ?? new Set<number>();

		const maxI = Math.abs(distance1) > 1e-6 ? quantity1 : 1;
		const maxJ = Math.abs(distance2) > 1e-6 ? quantity2 : 1;
		let totalCopies = 0;
		let suppressedCount = 0;
		for (let i = 0; i < maxI; i++) {
			for (let j = 0; j < maxJ; j++) {
				if (i === 0 && j === 0) continue;
				totalCopies++;
				if (suppression && suppressedIndices.has(i * 1000 + j)) {
					suppressedCount++;
				}
			}
		}
		const activeCopies = totalCopies - suppressedCount;

		let line1Label = 'Default: X-Axis (1, 0)';
		if (line1Id) {
			const line = this.sketch.lines.get(line1Id);
			if (line) {
				const p1 = this.sketch.points.get(line.p1Id);
				const p2 = this.sketch.points.get(line.p2Id);
				const len = p1 && p2 ? ` (${dist(p1, p2).toFixed(1)} mm)` : '';
				line1Label = `${line.id}${len}`;
			} else {
				line1Label = line1Id;
			}
		}

		let line2Label = line1Id ? 'Default: Perpendicular' : 'Default: Y-Axis (0, 1)';
		if (line2Id) {
			const line = this.sketch.lines.get(line2Id);
			if (line) {
				const p1 = this.sketch.points.get(line.p1Id);
				const p2 = this.sketch.points.get(line.p2Id);
				const len = p1 && p2 ? ` (${dist(p1, p2).toFixed(1)} mm)` : '';
				line2Label = `${line.id}${len}`;
			} else {
				line2Label = line2Id;
			}
		}

		const canApply = objCount > 0 && totalCopies > 0 && activeCopies > 0;

		return `
			<div class="sidebar-panel-card pattern-tool-card">
				<div class="panel-card-header">
					<div class="panel-card-title">
						<span class="panel-card-icon">${ICONS.rectangular_pattern}</span>
						<span>Rectangular Pattern</span>
					</div>
					<button class="btn-panel-close" id="btn-rpat-cancel-icon" title="Cancel (Esc)">✕</button>
				</div>
				<div class="panel-card-desc">
					Create linear or 2D grid copies along direction axes.
				</div>

				<div class="mirror-steps">
					<div class="mirror-step-item ${phase === 'objects' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-rpat-phase-objects" type="button">
							<span class="mirror-step-num">1</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Objects to Pattern</div>
								<div class="mirror-step-value">${objCount === 0 ? 'Click or box-select...' : `${objCount} object${objCount === 1 ? '' : 's'} selected`}</div>
							</div>
						</button>
						${objCount > 0 ? `<button class="mirror-step-clear" id="btn-rpat-clear-objects" title="Clear selection">✕</button>` : ''}
					</div>

					<div class="mirror-step-item ${phase === 'direction1' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-rpat-phase-dir1" type="button">
							<span class="mirror-step-num">2</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Direction 1</div>
								<div class="mirror-step-value ${line1Id ? 'selected-line' : ''}">${line1Label}</div>
							</div>
						</button>
						${line1Id ? `<button class="mirror-step-clear" id="btn-rpat-clear-dir1" title="Reset to X-Axis">✕</button>` : ''}
					</div>

					<div class="mirror-step-item ${phase === 'direction2' ? 'active' : ''}">
						<button class="mirror-step-btn" id="btn-rpat-phase-dir2" type="button">
							<span class="mirror-step-num">3</span>
							<div class="mirror-step-info">
								<div class="mirror-step-title">Direction 2</div>
								<div class="mirror-step-value ${line2Id ? 'selected-line' : ''}">${line2Label}</div>
							</div>
						</button>
						${line2Id ? `<button class="mirror-step-clear" id="btn-rpat-clear-dir2" title="Reset to Perpendicular">✕</button>` : ''}
					</div>
				</div>

				<!-- Pattern Parameters -->
				<div class="pattern-params-card">
					<!-- Axis 1 -->
					<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 2px;">AXIS 1</div>
					<div class="pattern-param-row">
						<label class="pattern-param-label">Direction</label>
						<div class="pattern-segmented-control">
							<button type="button" class="seg-btn rpat-dir1-btn ${direction1 === 'one_direction' ? 'active' : ''}" data-dir="one_direction">One Dir</button>
							<button type="button" class="seg-btn rpat-dir1-btn ${direction1 === 'symmetric' ? 'active' : ''}" data-dir="symmetric">Symmetric</button>
						</div>
					</div>

					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-rpat-dist1">Distance</label>
						<div class="pattern-input-suffix-wrapper">
							<input type="number" id="input-rpat-dist1" value="${distance1}" step="0.5" class="pattern-num-input" />
							<span class="pattern-input-suffix">mm</span>
						</div>
					</div>

					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-rpat-qty1">Quantity</label>
						<div class="pattern-quantity-wrapper">
							<input type="number" id="input-rpat-qty1" value="${quantity1}" min="1" max="100" step="1" class="pattern-num-input" />
						</div>
					</div>

					<!-- Axis 2 -->
					<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 6px;">AXIS 2</div>
					<div class="pattern-param-row">
						<label class="pattern-param-label">Direction</label>
						<div class="pattern-segmented-control">
							<button type="button" class="seg-btn rpat-dir2-btn ${direction2 === 'one_direction' ? 'active' : ''}" data-dir="one_direction">One Dir</button>
							<button type="button" class="seg-btn rpat-dir2-btn ${direction2 === 'symmetric' ? 'active' : ''}" data-dir="symmetric">Symmetric</button>
						</div>
					</div>

					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-rpat-dist2">Distance</label>
						<div class="pattern-input-suffix-wrapper">
							<input type="number" id="input-rpat-dist2" value="${distance2}" step="0.5" class="pattern-num-input" />
							<span class="pattern-input-suffix">mm</span>
						</div>
					</div>

					<div class="pattern-param-row">
						<label class="pattern-param-label" for="input-rpat-qty2">Quantity</label>
						<div class="pattern-quantity-wrapper">
							<input type="number" id="input-rpat-qty2" value="${quantity2}" min="1" max="100" step="1" class="pattern-num-input" />
						</div>
					</div>

					<div class="pattern-param-row pattern-suppress-row" style="margin-top: 6px;">
						<label class="pattern-checkbox-label">
							<input type="checkbox" id="check-rpat-suppression" ${suppression ? 'checked' : ''} />
							<span>Suppression</span>
						</label>
						${suppression ? `<span class="pattern-suppress-count">${activeCopies} of ${totalCopies} enabled</span>` : ''}
					</div>
				</div>

				<div class="mirror-actions">
					<button class="btn-mirror-ok" id="btn-rpat-ok" ${canApply ? '' : 'disabled'} title="Apply Pattern (Enter)">
						Apply Pattern
					</button>
					<button class="btn-mirror-cancel" id="btn-rpat-cancel" title="Cancel (Esc)">
						Cancel
					</button>
				</div>
				<div class="mirror-hint">
					${totalCopies === 0
						? 'Set a non-zero distance for Axis 1 or Axis 2 (or drag arrows).'
						: (objCount === 0 ? 'Select objects to pattern.' : 'Ready to apply! Press Enter or click Apply Pattern.')}
				</div>
			</div>
		`;
	}

	private renderInspector(): string {
		const sel = this.sketch.selection;
		const hasSelection =
			sel.pointIds.size > 0 ||
			sel.lineIds.size > 0 ||
			sel.circleIds.size > 0 ||
			sel.arcIds.size > 0 ||
			sel.ellipseIds.size > 0 ||
			sel.ellipticalArcIds.size > 0 ||
			sel.constraintIds.size > 0;

		if (!hasSelection) {
			return '';
		}

		let detailsHtml = '';

		if (
			sel.pointIds.size === 1 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const pid = [...sel.pointIds][0];
			const pt = this.sketch.points.get(pid);
			if (pt) {
				const relatedConstraints = this.sketch.getConstraintsForEntity('point', pt.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${pt.id}</div>
						<div class="inspector-row"><span>X:</span> <strong>${pt.x.toFixed(1)} mm</strong></div>
						<div class="inspector-row"><span>Y:</span> <strong>${pt.y.toFixed(1)} mm</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this point')}
					</div>
				`;
			}
		} else if (
			sel.lineIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const lid = [...sel.lineIds][0];
			const line = this.sketch.lines.get(lid);
			if (line) {
				const p1 = this.sketch.points.get(line.p1Id);
				const p2 = this.sketch.points.get(line.p2Id);
				const length = p1 && p2 ? dist(p1, p2).toFixed(1) : '?';
				const relatedConstraints = this.sketch.getConstraintsForEntity('line', line.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${line.id}</div>
						<div class="inspector-row"><span>Length:</span> <strong>${length} mm</strong></div>
						<div class="inspector-row"><span>Type:</span> <strong>${line.isConstruction ? 'Construction' : 'Solid'}</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this line')}
					</div>
				`;
			}
		} else if (
			sel.circleIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const cid = [...sel.circleIds][0];
			const circ = this.sketch.circles.get(cid);
			if (circ) {
				const relatedConstraints = this.sketch.getConstraintsForEntity('circle', circ.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${circ.id}</div>
						<div class="inspector-row"><span>Radius:</span> <strong>${circ.radius.toFixed(1)} mm</strong></div>
						<div class="inspector-row"><span>Diameter:</span> <strong>${(circ.radius * 2).toFixed(1)} mm</strong></div>
						<div class="inspector-row"><span>Type:</span> <strong>${circ.isConstruction ? 'Construction' : 'Solid'}</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this circle')}
					</div>
				`;
			}
		} else if (
			sel.arcIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const aid = [...sel.arcIds][0];
			const arc = this.sketch.arcs.get(aid);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const start = this.sketch.points.get(arc.startPointId);
				const end = this.sketch.points.get(arc.endPointId);
				let arcLen = '?';
				if (center && start && end) {
					const as = Math.atan2(start.y - center.y, start.x - center.x);
					const ae = Math.atan2(end.y - center.y, end.x - center.x);
					let sweep = arc.clockwise ? (as - ae) % (2 * Math.PI) : (ae - as) % (2 * Math.PI);
					if (sweep < 0) sweep += 2 * Math.PI;
					arcLen = (arc.radius * sweep).toFixed(1);
				}
				const relatedConstraints = this.sketch.getConstraintsForEntity('arc', arc.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${arc.id}</div>
						<div class="inspector-row"><span>Radius:</span> <strong>${arc.radius.toFixed(1)} mm</strong></div>
						<div class="inspector-row"><span>Length:</span> <strong>${arcLen} mm</strong></div>
						<div class="inspector-row"><span>Direction:</span> <strong>${arc.clockwise ? 'Clockwise' : 'Counter-Clockwise'}</strong></div>
						<div class="inspector-row"><span>Type:</span> <strong>${arc.isConstruction ? 'Construction' : 'Solid'}</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this arc')}
					</div>
				`;
			}
		} else if (
			sel.ellipseIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const eid = [...sel.ellipseIds][0];
			const ellipse = this.sketch.ellipses.get(eid);
			if (ellipse) {
				const center = this.sketch.points.get(ellipse.centerId);
				const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
				const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
				let rxStr = '?';
				let ryStr = '?';
				let rotStr = '?';
				if (center && majorPt && minorPt) {
					rxStr = dist(center, majorPt).toFixed(1);
					ryStr = dist(center, minorPt).toFixed(1);
					const angleDeg = (Math.atan2(majorPt.y - center.y, majorPt.x - center.x) * 180) / Math.PI;
					rotStr = `${angleDeg.toFixed(1)}°`;
				}
				const relatedConstraints = this.sketch.getConstraintsForEntity('ellipse', ellipse.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${ellipse.id}</div>
						<div class="inspector-row"><span>Major Radius (Rx):</span> <strong>${rxStr} mm</strong></div>
						<div class="inspector-row"><span>Minor Radius (Ry):</span> <strong>${ryStr} mm</strong></div>
						<div class="inspector-row"><span>Rotation:</span> <strong>${rotStr}</strong></div>
						<div class="inspector-row"><span>Type:</span> <strong>${ellipse.isConstruction ? 'Construction' : 'Solid'}</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this ellipse')}
					</div>
				`;
			}
		} else if (
			sel.ellipticalArcIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0
		) {
			const eaid = [...sel.ellipticalArcIds][0];
			const arc = this.sketch.ellipticalArcs.get(eaid);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const majorPt = this.sketch.points.get(arc.majorAxisPointId);
				const minorPt = this.sketch.points.get(arc.minorAxisPointId);
				let rxStr = '?';
				let ryStr = '?';
				let rotStr = '?';
				if (center && majorPt && minorPt) {
					rxStr = dist(center, majorPt).toFixed(1);
					ryStr = dist(center, minorPt).toFixed(1);
					const angleDeg = (Math.atan2(majorPt.y - center.y, majorPt.x - center.x) * 180) / Math.PI;
					rotStr = `${angleDeg.toFixed(1)}°`;
				}
				const relatedConstraints = this.sketch.getConstraintsForEntity('elliptical_arc', arc.id);
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${arc.id}</div>
						<div class="inspector-row"><span>Major Radius (Rx):</span> <strong>${rxStr} mm</strong></div>
						<div class="inspector-row"><span>Minor Radius (Ry):</span> <strong>${ryStr} mm</strong></div>
						<div class="inspector-row"><span>Rotation:</span> <strong>${rotStr}</strong></div>
						<div class="inspector-row"><span>Direction:</span> <strong>${arc.clockwise ? 'Clockwise' : 'Counter-Clockwise'}</strong></div>
						<div class="inspector-row"><span>Type:</span> <strong>${arc.isConstruction ? 'Construction' : 'Solid'}</strong></div>
						${this.renderConstraintsSublist(relatedConstraints, 'this elliptical arc')}
					</div>
				`;
			}
		} else if (
			sel.splineIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const sid = [...sel.splineIds][0];
			const spline = this.sketch.splines.get(sid);
			if (spline) {
				detailsHtml = `
					<div class="inspector-card">
						<div class="inspector-card-title">${spline.id}</div>
						<div class="inspector-row"><span>Type:</span> <strong>${spline.splineType === 'fit' ? 'Fit Point Spline' : 'Control Point Spline'}</strong></div>
						<div class="inspector-row"><span>Points:</span> <strong>${spline.pointIds.length} points</strong></div>
						<div class="inspector-row"><span>Closed:</span> <strong>${spline.isClosed ? 'Yes' : 'No'}</strong></div>
						<div class="inspector-row"><span>Style:</span> <strong>${spline.isConstruction ? 'Construction' : 'Solid'}</strong></div>
					</div>
				`;
			}
		} else if (
			sel.pointIds.size === 2 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const pIds = [...sel.pointIds];
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('point', pIds[0]),
				...this.sketch.getConstraintsForEntity('point', pIds[1]),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: 2 Points (${pIds.join(', ')})</div>
					${this.renderConstraintsSublist(related, 'selected points')}
				</div>
			`;
		} else if (
			sel.lineIds.size === 2 &&
			sel.pointIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const lIds = [...sel.lineIds];
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('line', lIds[0]),
				...this.sketch.getConstraintsForEntity('line', lIds[1]),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: 2 Lines (${lIds.join(', ')})</div>
					${this.renderConstraintsSublist(related, 'selected lines')}
				</div>
			`;
		} else if (
			sel.lineIds.size === 1 &&
			sel.circleIds.size === 1 &&
			sel.arcIds.size === 0 &&
			sel.pointIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const lid = [...sel.lineIds][0];
			const cid = [...sel.circleIds][0];
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('line', lid),
				...this.sketch.getConstraintsForEntity('circle', cid),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: Line & Circle</div>
					${this.renderConstraintsSublist(related, 'selected entities')}
				</div>
			`;
		} else if (
			sel.circleIds.size === 2 &&
			sel.lineIds.size === 0 &&
			sel.pointIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const cIds = [...sel.circleIds];
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('circle', cIds[0]),
				...this.sketch.getConstraintsForEntity('circle', cIds[1]),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: 2 Circles (${cIds.join(', ')})</div>
					${this.renderConstraintsSublist(related, 'selected circles')}
				</div>
			`;
		} else if (
			sel.pointIds.size === 1 &&
			sel.lineIds.size === 1 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const pid = [...sel.pointIds][0];
			const lid = [...sel.lineIds][0];
			const pt = this.sketch.points.get(pid);
			const line = this.sketch.lines.get(lid);
			let distHtml = '';
			if (pt && line) {
				const lp1 = this.sketch.points.get(line.p1Id);
				const lp2 = this.sketch.points.get(line.p2Id);
				if (lp1 && lp2) {
					const dx = lp2.x - lp1.x;
					const dy = lp2.y - lp1.y;
					const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);
					const cross = (pt.x - lp1.x) * dy - (pt.y - lp1.y) * dx;
					const perpDist = Math.abs(cross) / lineLen;
					distHtml = `<div class="inspector-row"><span>Perpendicular Distance:</span> <strong>${perpDist.toFixed(1)} mm</strong></div>`;
				}
			}
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('point', pid),
				...this.sketch.getConstraintsForEntity('line', lid),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: Point & Line</div>
					${distHtml}
					${this.renderConstraintsSublist(related, 'selected entities')}
				</div>
			`;
		} else if (
			sel.pointIds.size === 1 &&
			sel.circleIds.size + sel.arcIds.size === 1 &&
			sel.lineIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const pid = [...sel.pointIds][0];
			const cid = [...sel.circleIds, ...sel.arcIds][0];
			const isArc = sel.arcIds.size > 0;
			const related = [...new Set([
				...this.sketch.getConstraintsForEntity('point', pid),
				...this.sketch.getConstraintsForEntity(isArc ? 'arc' : 'circle', cid),
			])];
			detailsHtml = `
				<div class="inspector-card">
					<div class="inspector-card-title">Selected: Point & ${isArc ? 'Arc' : 'Circle'}</div>
					${this.renderConstraintsSublist(related, 'selected entities')}
				</div>
			`;
		} else if (
			sel.constraintIds.size === 1 &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		) {
			const cid = [...sel.constraintIds][0];
			const c = this.sketch.constraints.get(cid);
			if (c) {
				const relatedPrimitives = this.sketch.getEntitiesForConstraint(c);
				if (c instanceof CircularPatternConstraint) {
					const totalCopies = Math.max(1, c.quantity - 1);
					const activeCopies = totalCopies - c.suppressedIndices.length;
					detailsHtml = `
						<div class="inspector-card">
							<div class="inspector-card-title">
								<span class="panel-card-icon">${ICONS.circular_pattern}</span>
								<span>Circular Pattern</span>
							</div>
							
							<div class="pattern-params-card in-inspector">
								<div class="pattern-param-row">
									<label class="pattern-param-label">Distribution</label>
									<div class="pattern-segmented-control">
										<button type="button" class="seg-btn insp-cpat-dist-btn ${c.distribution === 'full' ? 'active' : ''}" data-dist="full">Full</button>
										<button type="button" class="seg-btn insp-cpat-dist-btn ${c.distribution === 'partial' ? 'active' : ''}" data-dist="partial">Partial</button>
										<button type="button" class="seg-btn insp-cpat-dist-btn ${c.distribution === 'symmetric' ? 'active' : ''}" data-dist="symmetric">Symmetric</button>
									</div>
								</div>

								${c.distribution !== 'full' ? `
								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-cpat-angle">Total Angle</label>
									<div class="pattern-input-suffix-wrapper">
										<input type="number" id="insp-cpat-angle" value="${c.totalAngle}" min="-360" max="360" step="5" class="pattern-num-input" />
										<span class="pattern-input-suffix">°</span>
									</div>
								</div>
								` : ''}

								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-cpat-quantity">Quantity</label>
									<div class="pattern-quantity-wrapper">
										<input type="number" id="insp-cpat-quantity" value="${c.quantity}" min="2" max="100" step="1" class="pattern-num-input" />
									</div>
								</div>

								<div class="pattern-param-row pattern-suppress-row">
									<label class="pattern-checkbox-label">
										<input type="checkbox" id="insp-cpat-suppression" ${c.suppression ? 'checked' : ''} />
										<span>Suppression</span>
									</label>
									${c.suppression ? `<span class="pattern-suppress-count">${activeCopies} of ${totalCopies} enabled</span>` : ''}
								</div>
							</div>

							${this.renderPrimitivesSublist(relatedPrimitives)}
						</div>
					`;
				} else if (c instanceof RectangularPatternConstraint) {
					const maxI = Math.abs(c.distance1) > 1e-6 ? c.quantity1 : 1;
					const maxJ = Math.abs(c.distance2) > 1e-6 ? c.quantity2 : 1;
					let totalCopies = 0;
					let suppressedCount = 0;
					const suppressedSet = new Set(c.suppressedIndices);
					for (let i = 0; i < maxI; i++) {
						for (let j = 0; j < maxJ; j++) {
							if (i === 0 && j === 0) continue;
							totalCopies++;
							if (c.suppression && suppressedSet.has(i * 1000 + j)) {
								suppressedCount++;
							}
						}
					}
					const activeCopies = totalCopies - suppressedCount;

					detailsHtml = `
						<div class="inspector-card">
							<div class="inspector-card-title">
								<span class="panel-card-icon">${ICONS.rectangular_pattern}</span>
								<span>Rectangular Pattern</span>
							</div>

							<div class="pattern-params-card in-inspector">
								<!-- Axis 1 -->
								<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 2px;">AXIS 1</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label">Direction</label>
									<div class="pattern-segmented-control">
										<button type="button" class="seg-btn insp-rpat-dir1-btn ${c.direction1 === 'one_direction' ? 'active' : ''}" data-dir="one_direction">One Dir</button>
										<button type="button" class="seg-btn insp-rpat-dir1-btn ${c.direction1 === 'symmetric' ? 'active' : ''}" data-dir="symmetric">Symmetric</button>
									</div>
								</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-rpat-dist1">Distance</label>
									<div class="pattern-input-suffix-wrapper">
										<input type="number" id="insp-rpat-dist1" value="${c.distance1}" step="0.5" class="pattern-num-input" />
										<span class="pattern-input-suffix">mm</span>
									</div>
								</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-rpat-qty1">Quantity</label>
									<div class="pattern-quantity-wrapper">
										<input type="number" id="insp-rpat-qty1" value="${c.quantity1}" min="1" max="100" step="1" class="pattern-num-input" />
									</div>
								</div>

								<!-- Axis 2 -->
								<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 6px;">AXIS 2</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label">Direction</label>
									<div class="pattern-segmented-control">
										<button type="button" class="seg-btn insp-rpat-dir2-btn ${c.direction2 === 'one_direction' ? 'active' : ''}" data-dir="one_direction">One Dir</button>
										<button type="button" class="seg-btn insp-rpat-dir2-btn ${c.direction2 === 'symmetric' ? 'active' : ''}" data-dir="symmetric">Symmetric</button>
									</div>
								</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-rpat-dist2">Distance</label>
									<div class="pattern-input-suffix-wrapper">
										<input type="number" id="insp-rpat-dist2" value="${c.distance2}" step="0.5" class="pattern-num-input" />
										<span class="pattern-input-suffix">mm</span>
									</div>
								</div>
								<div class="pattern-param-row">
									<label class="pattern-param-label" for="insp-rpat-qty2">Quantity</label>
									<div class="pattern-quantity-wrapper">
										<input type="number" id="insp-rpat-qty2" value="${c.quantity2}" min="1" max="100" step="1" class="pattern-num-input" />
									</div>
								</div>

								<div class="pattern-param-row pattern-suppress-row" style="margin-top: 6px;">
									<label class="pattern-checkbox-label">
										<input type="checkbox" id="insp-rpat-suppression" ${c.suppression ? 'checked' : ''} />
										<span>Suppression</span>
									</label>
									${c.suppression ? `<span class="pattern-suppress-count">${activeCopies} of ${totalCopies} enabled</span>` : ''}
								</div>
							</div>

							${this.renderPrimitivesSublist(relatedPrimitives)}
						</div>
					`;
				} else {
					detailsHtml = `
						<div class="inspector-card">
							<div class="inspector-card-title">${c instanceof DistanceConstraint ? (c.orientation === 'horizontal' ? 'Horizontal Distance' : c.orientation === 'vertical' ? 'Vertical Distance' : 'Distance') : c instanceof PointToLineDistanceConstraint ? 'Point-to-Line Distance' : c instanceof AngleConstraint ? 'Angle' : c.name}</div>
							${c instanceof DistanceConstraint ? `<div class="inspector-row"><span>${c.orientation === 'horizontal' ? 'Horizontal Distance' : c.orientation === 'vertical' ? 'Vertical Distance' : 'Distance'}:</span> <strong>${c.targetDistance.toFixed(1)} mm</strong></div>` : ''}
							${c instanceof PointToLineDistanceConstraint ? `<div class="inspector-row"><span>Distance:</span> <strong>${c.targetDistance.toFixed(1)} mm</strong></div>` : ''}
							${c instanceof AngleConstraint ? `<div class="inspector-row"><span>Angle:</span> <strong>${c.targetAngle.toFixed(1)}°</strong></div>` : ''}
							${c instanceof RadiusConstraint ? `<div class="inspector-row"><span>${c.displayMode === 'diameter' ? 'Diameter' : 'Radius'}:</span> <strong>${(c.displayMode === 'diameter' ? c.targetRadius * 2 : c.targetRadius).toFixed(1)} mm</strong></div>` : ''}
							${this.renderPrimitivesSublist(relatedPrimitives)}
						</div>
					`;
				}
			}
		}

		return detailsHtml;
	}

	private renderPrimitivesSublist(
		primitives: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
		}>
	): string {
		return `
			<div class="inspector-divider"></div>
			<div class="inspector-primitives-section">
				<div class="inspector-primitives-header">
					<span class="inspector-primitives-title">Primitives (${primitives.length})</span>
				</div>
				<div class="inspector-primitives-list">
					${primitives.map(p => this.renderPrimitiveSublistItem(p)).join('')}
					${primitives.length === 0 ? `<div class="inspector-empty-primitives">No primitives linked</div>` : ''}
				</div>
			</div>
		`;
	}

	private renderPrimitiveSublistItem(entityRef: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}): string {
		switch (entityRef.type) {
			case 'line': {
				const line = this.sketch.lines.get(entityRef.id);
				return line ? this.renderLineItem(line) : '';
			}
			case 'circle': {
				const circle = this.sketch.circles.get(entityRef.id);
				return circle ? this.renderCircleItem(circle) : '';
			}
			case 'arc': {
				const arc = this.sketch.arcs.get(entityRef.id);
				return arc ? this.renderArcItem(arc) : '';
			}
			case 'ellipse': {
				const ellipse = this.sketch.ellipses.get(entityRef.id);
				return ellipse ? this.renderEllipseItem(ellipse) : '';
			}
			case 'elliptical_arc': {
				const elArc = this.sketch.ellipticalArcs.get(entityRef.id);
				return elArc ? this.renderEllipticalArcItem(elArc) : '';
			}
			case 'point': {
				const pt = this.sketch.points.get(entityRef.id);
				return pt ? this.renderPointItem(pt) : '';
			}
			default:
				return '';
		}
	}

	private renderConstraintsSublist(constraints: any[], entityName: string): string {
		return `
			<div class="inspector-divider"></div>
			<div class="inspector-constraints-section">
				<div class="inspector-constraints-header">
					<span class="inspector-constraints-title">Constraints (${constraints.length})</span>
				</div>
				<div class="inspector-constraints-list">
					${constraints.map(c => this.renderConstraintItem(c)).join('')}
					${constraints.length === 0 ? `<div class="inspector-empty-constraints">No constraints on ${entityName}</div>` : ''}
				</div>
			</div>
		`;
	}

	private isItemMirrorSelected(id: string): { isSelected: boolean; extraClass: string } {
		if (this.interaction?.activeTool === 'mirror' && this.interaction.mirrorState) {
			if (this.interaction.mirrorState.mirrorLineId === id) {
				return { isSelected: true, extraClass: 'is-mirror-line' };
			}
			if (this.interaction.mirrorState.selectedObjectIds.has(id)) {
				return { isSelected: true, extraClass: 'is-mirror-obj' };
			}
		}
		if (this.interaction?.activeTool === 'circular_pattern' && this.interaction.circularPatternState) {
			if (this.interaction.circularPatternState.centerPointId === id) {
				return { isSelected: true, extraClass: 'is-pattern-center' };
			}
			if (this.interaction.circularPatternState.selectedObjectIds.has(id)) {
				return { isSelected: true, extraClass: 'is-pattern-obj' };
			}
		}
		if (this.interaction?.activeTool === 'rectangular_pattern' && this.interaction.rectangularPatternState) {
			if (this.interaction.rectangularPatternState.line1Id === id) {
				return { isSelected: true, extraClass: 'is-dir1-line' };
			}
			if (this.interaction.rectangularPatternState.line2Id === id) {
				return { isSelected: true, extraClass: 'is-dir2-line' };
			}
			if (this.interaction.rectangularPatternState.selectedObjectIds.has(id)) {
				return { isSelected: true, extraClass: 'is-pattern-obj' };
			}
		}
		return { isSelected: false, extraClass: '' };
	}

	private renderLineItem(line: any): string {
		const mirror = this.isItemMirrorSelected(line.id);
		const isSelected = mirror.isSelected || this.sketch.selection.lineIds.has(line.id);
		const p1 = this.sketch.points.get(line.p1Id);
		const p2 = this.sketch.points.get(line.p2Id);
		const len = p1 && p2 ? dist(p1, p2).toFixed(1) : '?';

		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="line" data-id="${line.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.line}</span>
					<span class="tree-name">${line.id}</span>
					<span class="tree-meta">${len} mm ${line.isConstruction ? '(aux)' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${line.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderCircleItem(circle: any): string {
		const mirror = this.isItemMirrorSelected(circle.id);
		const isSelected = mirror.isSelected || this.sketch.selection.circleIds.has(circle.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="circle" data-id="${circle.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.circle}</span>
					<span class="tree-name">${circle.id}</span>
					<span class="tree-meta">R ${circle.radius.toFixed(1)} mm</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${circle.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderArcItem(arc: any): string {
		const mirror = this.isItemMirrorSelected(arc.id);
		const isSelected = mirror.isSelected || this.sketch.selection.arcIds.has(arc.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="arc" data-id="${arc.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.arc}</span>
					<span class="tree-name">${arc.id}</span>
					<span class="tree-meta">R ${arc.radius.toFixed(1)} mm ${arc.isConstruction ? '(aux)' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${arc.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderEllipseItem(ellipse: any): string {
		const mirror = this.isItemMirrorSelected(ellipse.id);
		const isSelected = mirror.isSelected || this.sketch.selection.ellipseIds.has(ellipse.id);
		const center = this.sketch.points.get(ellipse.centerId);
		const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
		const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
		const rx = center && majorPt ? dist(center, majorPt).toFixed(1) : '?';
		const ry = center && minorPt ? dist(center, minorPt).toFixed(1) : '?';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="ellipse" data-id="${ellipse.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.ellipse}</span>
					<span class="tree-name">${ellipse.id}</span>
					<span class="tree-meta">Rx ${rx} / Ry ${ry} mm ${ellipse.isConstruction ? '(aux)' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${ellipse.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderEllipticalArcItem(arc: any): string {
		const mirror = this.isItemMirrorSelected(arc.id);
		const isSelected = mirror.isSelected || this.sketch.selection.ellipticalArcIds.has(arc.id);
		const center = this.sketch.points.get(arc.centerId);
		const majorPt = this.sketch.points.get(arc.majorAxisPointId);
		const minorPt = this.sketch.points.get(arc.minorAxisPointId);
		const rx = center && majorPt ? dist(center, majorPt).toFixed(1) : '?';
		const ry = center && minorPt ? dist(center, minorPt).toFixed(1) : '?';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="elliptical_arc" data-id="${arc.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.elliptical_arc}</span>
					<span class="tree-name">${arc.id}</span>
					<span class="tree-meta">Rx ${rx} / Ry ${ry} mm ${arc.isConstruction ? '(aux)' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${arc.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderSplineItem(spline: SketchSpline): string {
		const mirror = this.isItemMirrorSelected(spline.id);
		const isSelected = mirror.isSelected || this.sketch.selection.splineIds.has(spline.id);
		const typeLabel = spline.splineType === 'fit' ? 'Fit Spline' : 'Control Spline';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="spline" data-id="${spline.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${spline.splineType === 'fit' ? ICONS.spline_fit : ICONS.spline_control}</span>
					<span class="tree-name">${spline.id}</span>
					<span class="tree-meta">${typeLabel} (${spline.pointIds.length} pts) ${spline.isConstruction ? '(aux)' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${spline.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderPointItem(pt: any): string {
		const mirror = this.isItemMirrorSelected(pt.id);
		const isSelected = mirror.isSelected || this.sketch.selection.pointIds.has(pt.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''} ${mirror.extraClass}" data-type="point" data-id="${pt.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.point}</span>
					<span class="tree-name">${pt.id}</span>
					<span class="tree-meta">(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}) ${pt.fixed ? '🔒' : ''}</span>
				</div>
				<button class="tree-delete-btn" data-delete-id="${pt.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderConstraintItem(c: any): string {
		const isSelected = this.sketch.selection.constraintIds.has(c.id);
		let valBadge = '';
		let name = c.name;

		if (c instanceof DistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = c.orientation === 'horizontal'
				? 'Horizontal Distance'
				: c.orientation === 'vertical'
				? 'Vertical Distance'
				: 'Distance';
		} else if (c instanceof PointToLineDistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = 'Point-Line Distance';
		} else if (c instanceof AngleConstraint) {
			valBadge = `<span class="val-badge">${c.targetAngle.toFixed(1)}°</span>`;
			name = 'Angle';
		} else if (c instanceof RadiusConstraint) {
			valBadge = c.displayMode === 'diameter'
				? `<span class="val-badge">Ø ${(c.targetRadius * 2).toFixed(1)} mm</span>`
				: `<span class="val-badge">R ${c.targetRadius.toFixed(1)} mm</span>`;
			name = c.displayMode === 'diameter' ? 'Diameter' : 'Radius';
		} else if (c instanceof CircularPatternConstraint) {
			const label = c.distribution === 'full' ? `${c.quantity}x Full` : `${c.quantity}x ${c.totalAngle.toFixed(1)}°`;
			valBadge = `<span class="val-badge">${label}</span>`;
			name = 'Circular Pattern';
		}

		return `
			<div class="tree-item constraint-item ${isSelected ? 'selected' : ''}" data-type="constraint" data-id="${c.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${this.getConstraintIcon(c.type)}</span>
					<span class="tree-name">${name}</span>
					${valBadge}
				</div>
				<button class="tree-delete-btn" data-delete-id="${c.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private getConstraintIcon(type: string): string {
		switch (type) {
			case 'fixed': return ICONS.fixed;
			case 'coincident': return ICONS.coincident;
			case 'horizontal': return ICONS.horizontal;
			case 'vertical': return ICONS.vertical;
			case 'distance': return ICONS.distance;
			case 'point_to_line_distance': return ICONS.distance;
			case 'angle': return ICONS.angle;
			case 'radius': return ICONS.circle;
			case 'equal_length':
			case 'equal_radius': return ICONS.equal;
			case 'parallel': return ICONS.parallel;
			case 'collinear': return ICONS.collinear;
			case 'perpendicular': return ICONS.perpendicular;
			case 'tangent_line_circle':
			case 'tangent_circle_circle': return ICONS.tangent;
			case 'concentric': return ICONS.concentric;
			case 'point_on_line': return ICONS.pointOnLine;
			case 'point_on_circle': return ICONS.pointOnLine;
			case 'midpoint': return ICONS.midpoint;
			case 'symmetry': return ICONS.symmetry;
			case 'circular_pattern': return ICONS.circular_pattern;
			case 'rectangular_pattern': return ICONS.rectangular_pattern;
			default: return ICONS.coincident;
		}
	}

	private bindEvents(): void {
		// Tree item selection
		this.container.querySelectorAll<HTMLElement>('.tree-item').forEach(item => {
			item.addEventListener('click', e => {
				if ((e.target as HTMLElement).closest('.tree-delete-btn')) return;

				const id = item.getAttribute('data-id')!;
				const type = item.getAttribute('data-type')! as
					| 'point'
					| 'line'
					| 'circle'
					| 'arc'
					| 'ellipse'
					| 'elliptical_arc'
					| 'constraint';
				if (this.interaction?.activeTool === 'mirror' && this.interaction.mirrorState) {
					if (this.interaction.mirrorState.phase === 'mirror_line') {
						if (type === 'line') {
							this.interaction.mirrorState.mirrorLineId = id;
							this.interaction.mirrorState.selectedObjectIds.delete(id);
							this.interaction.onMirrorStateChange?.();
							this.interaction.render();
						}
					} else {
						if (type !== 'constraint') {
							if (this.interaction.mirrorState.selectedObjectIds.has(id)) {
								this.interaction.mirrorState.selectedObjectIds.delete(id);
							} else {
								if (this.interaction.mirrorState.mirrorLineId === id) {
									this.interaction.mirrorState.mirrorLineId = null;
								}
								this.interaction.mirrorState.selectedObjectIds.add(id);
							}
							this.interaction.onMirrorStateChange?.();
							this.interaction.render();
						}
					}
					return;
				}

				if (this.interaction?.activeTool === 'circular_pattern' && this.interaction.circularPatternState) {
					if (this.interaction.circularPatternState.phase === 'center_point') {
						if (type === 'point') {
							this.interaction.circularPatternState.centerPointId = id;
							this.interaction.onCircularPatternStateChange?.();
							this.interaction.render();
						}
					} else {
						if (type !== 'constraint') {
							if (this.interaction.circularPatternState.selectedObjectIds.has(id)) {
								this.interaction.circularPatternState.selectedObjectIds.delete(id);
							} else {
								this.interaction.circularPatternState.selectedObjectIds.add(id);
							}
							this.interaction.onCircularPatternStateChange?.();
							this.interaction.render();
						}
					}
					return;
				}

				if (this.interaction?.activeTool === 'rectangular_pattern' && this.interaction.rectangularPatternState) {
					if (this.interaction.rectangularPatternState.phase === 'direction1') {
						if (type === 'line') {
							if (this.interaction.rectangularPatternState.line1Id === id) {
								this.interaction.rectangularPatternState.line1Id = null;
							} else {
								this.interaction.rectangularPatternState.line1Id = id;
								this.interaction.rectangularPatternState.selectedObjectIds.delete(id);
								if (this.interaction.rectangularPatternState.line2Id === id) {
									this.interaction.rectangularPatternState.line2Id = null;
								}
								this.interaction.rectangularPatternState.phase = 'direction2';
							}
							this.interaction.onRectangularPatternStateChange?.();
							this.interaction.render();
						}
					} else if (this.interaction.rectangularPatternState.phase === 'direction2') {
						if (type === 'line') {
							if (this.interaction.rectangularPatternState.line2Id === id) {
								this.interaction.rectangularPatternState.line2Id = null;
							} else {
								this.interaction.rectangularPatternState.line2Id = id;
								this.interaction.rectangularPatternState.selectedObjectIds.delete(id);
								if (this.interaction.rectangularPatternState.line1Id === id) {
									this.interaction.rectangularPatternState.line1Id = null;
								}
							}
							this.interaction.onRectangularPatternStateChange?.();
							this.interaction.render();
						}
					} else {
						if (type !== 'constraint') {
							if (this.interaction.rectangularPatternState.selectedObjectIds.has(id)) {
								this.interaction.rectangularPatternState.selectedObjectIds.delete(id);
							} else {
								if (this.interaction.rectangularPatternState.line1Id === id) {
									this.interaction.rectangularPatternState.line1Id = null;
								}
								if (this.interaction.rectangularPatternState.line2Id === id) {
									this.interaction.rectangularPatternState.line2Id = null;
								}
								this.interaction.rectangularPatternState.selectedObjectIds.add(id);
							}
							this.interaction.onRectangularPatternStateChange?.();
							this.interaction.render();
						}
					}
					return;
				}

				this.sketch.selectEntity(id, type, false);

				if (type === 'constraint') {
					const c = this.sketch.constraints.get(id);
					if (c && (c instanceof DistanceConstraint || c instanceof RadiusConstraint || c instanceof AngleConstraint || c instanceof PointToLineDistanceConstraint)) {
						this.onEditDimension?.(c);
					}
				}
			});

			// Double-click on tree item to edit dimension / radius
			item.addEventListener('dblclick', e => {
				if ((e.target as HTMLElement).closest('.tree-delete-btn')) return;

				const id = item.getAttribute('data-id')!;
				const type = item.getAttribute('data-type')!;

				if (type === 'line') {
					const line = this.sketch.lines.get(id);
					if (line) {
						let distConstraint = [...this.sketch.constraints.values()].find(
							c =>
								c instanceof DistanceConstraint &&
								((c.p1Id === line.p1Id && c.p2Id === line.p2Id) ||
									(c.p1Id === line.p2Id && c.p2Id === line.p1Id))
						) as DistanceConstraint | undefined;

						if (!distConstraint) {
							distConstraint = this.sketch.addDistanceConstraint(line.p1Id, line.p2Id) ?? undefined;
						}

						if (distConstraint) {
							this.sketch.selectEntity(distConstraint.id, 'constraint', false);
							this.onEditDimension?.(distConstraint);
						}
					}
				} else if (type === 'circle') {
					const circle = this.sketch.circles.get(id);
					if (circle) {
						let radConstraint = [...this.sketch.constraints.values()].find(
							c => c instanceof RadiusConstraint && c.circleId === circle.id
						) as RadiusConstraint | undefined;

						if (!radConstraint) {
							radConstraint = this.sketch.addRadiusConstraint(circle.id) ?? undefined;
						}

						if (radConstraint) {
							this.sketch.selectEntity(radConstraint.id, 'constraint', false);
							this.onEditDimension?.(radConstraint);
						}
					}
				} else if (type === 'arc') {
					const arc = this.sketch.arcs.get(id);
					if (arc) {
						let radConstraint = [...this.sketch.constraints.values()].find(
							c => c instanceof RadiusConstraint && c.circleId === arc.id
						) as RadiusConstraint | undefined;

						if (!radConstraint) {
							radConstraint = this.sketch.addRadiusConstraint(arc.id) ?? undefined;
						}

						if (radConstraint) {
							this.sketch.selectEntity(radConstraint.id, 'constraint', false);
							this.onEditDimension?.(radConstraint);
						}
					}
				} else if (type === 'ellipse') {
					this.sketch.selectEntity(id, 'ellipse', false);
				} else if (type === 'elliptical_arc') {
					this.sketch.selectEntity(id, 'elliptical_arc', false);
				} else if (type === 'constraint') {
					const c = this.sketch.constraints.get(id);
					if (c && (c instanceof DistanceConstraint || c instanceof RadiusConstraint || c instanceof AngleConstraint || c instanceof PointToLineDistanceConstraint)) {
						this.sketch.selectEntity(c.id, 'constraint', false);
						this.onEditDimension?.(c);
					}
				}
			});
		});

		// Delete buttons
		this.container.querySelectorAll<HTMLButtonElement>('.tree-delete-btn').forEach(btn => {
			btn.addEventListener('click', e => {
				e.stopPropagation();
				const id = btn.getAttribute('data-delete-id')!;
				this.sketch.removeEntity(id);
			});
		});

		// Mirror Tool events
		const btnPhaseObjects = this.container.querySelector<HTMLButtonElement>('#btn-mirror-phase-objects');
		btnPhaseObjects?.addEventListener('click', () => {
			this.interaction?.setMirrorPhase('objects');
		});

		const btnPhaseLine = this.container.querySelector<HTMLButtonElement>('#btn-mirror-phase-line');
		btnPhaseLine?.addEventListener('click', () => {
			this.interaction?.setMirrorPhase('mirror_line');
		});

		const btnClearObjects = this.container.querySelector<HTMLButtonElement>('#btn-mirror-clear-objects');
		btnClearObjects?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.mirrorState) {
				this.interaction.mirrorState.selectedObjectIds.clear();
				this.interaction.onMirrorStateChange?.();
				this.interaction.render();
			}
		});

		const btnClearLine = this.container.querySelector<HTMLButtonElement>('#btn-mirror-clear-line');
		btnClearLine?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.mirrorState) {
				this.interaction.mirrorState.mirrorLineId = null;
				this.interaction.onMirrorStateChange?.();
				this.interaction.render();
			}
		});

		const btnOk = this.container.querySelector<HTMLButtonElement>('#btn-mirror-ok');
		btnOk?.addEventListener('click', () => {
			this.interaction?.executeMirror();
		});

		const btnCancel = this.container.querySelector<HTMLButtonElement>('#btn-mirror-cancel');
		btnCancel?.addEventListener('click', () => {
			this.interaction?.cancelMirror();
		});

		const btnCancelIcon = this.container.querySelector<HTMLButtonElement>('#btn-mirror-cancel-icon');
		btnCancelIcon?.addEventListener('click', () => {
			this.interaction?.cancelMirror();
		});

		// Circular Pattern Tool events
		const btnCpatPhaseObjects = this.container.querySelector<HTMLButtonElement>('#btn-cpat-phase-objects');
		btnCpatPhaseObjects?.addEventListener('click', () => {
			this.interaction?.setCircularPatternPhase('objects');
		});

		const btnCpatPhaseCenter = this.container.querySelector<HTMLButtonElement>('#btn-cpat-phase-center');
		btnCpatPhaseCenter?.addEventListener('click', () => {
			this.interaction?.setCircularPatternPhase('center_point');
		});

		const btnCpatClearObjects = this.container.querySelector<HTMLButtonElement>('#btn-cpat-clear-objects');
		btnCpatClearObjects?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.circularPatternState) {
				this.interaction.circularPatternState.selectedObjectIds.clear();
				this.interaction.onCircularPatternStateChange?.();
				this.interaction.render();
			}
		});

		const btnCpatClearCenter = this.container.querySelector<HTMLButtonElement>('#btn-cpat-clear-center');
		btnCpatClearCenter?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.circularPatternState) {
				this.interaction.circularPatternState.centerPointId = null;
				this.interaction.onCircularPatternStateChange?.();
				this.interaction.render();
			}
		});

		// Distribution buttons
		this.container.querySelectorAll<HTMLButtonElement>('.pattern-segmented-control .seg-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const dist = btn.getAttribute('data-dist') as 'full' | 'partial' | 'symmetric';
				if (dist && this.interaction?.circularPatternState) {
					this.interaction.circularPatternState.distribution = dist;
					this.interaction.onCircularPatternStateChange?.();
					this.interaction.render();
				}
			});
		});

		// Angle input
		const inputAngle = this.container.querySelector<HTMLInputElement>('#input-cpat-angle');
		inputAngle?.addEventListener('input', () => {
			const val = parseFloat(inputAngle.value);
			if (!isNaN(val) && isFinite(val) && this.interaction?.circularPatternState) {
				this.interaction.circularPatternState.angle = val;
				this.interaction.render();
			}
		});
		inputAngle?.addEventListener('change', () => {
			const val = parseFloat(inputAngle.value);
			if (isNaN(val) || !isFinite(val)) {
				if (this.interaction?.circularPatternState) {
					inputAngle.value = String(this.interaction.circularPatternState.angle);
				}
			}
			this.render();
		});

		// Quantity input
		const inputQty = this.container.querySelector<HTMLInputElement>('#input-cpat-quantity');
		inputQty?.addEventListener('input', () => {
			const val = parseInt(inputQty.value, 10);
			if (!isNaN(val) && val >= 2 && this.interaction?.circularPatternState) {
				this.interaction.circularPatternState.quantity = val;
				for (const idx of this.interaction.circularPatternState.suppressedIndices) {
					if (idx >= val) {
						this.interaction.circularPatternState.suppressedIndices.delete(idx);
					}
				}
				this.interaction.render();
			}
		});
		inputQty?.addEventListener('change', () => {
			this.render();
		});

		// Suppression checkbox
		const checkSuppression = this.container.querySelector<HTMLInputElement>('#check-cpat-suppression');
		checkSuppression?.addEventListener('change', () => {
			if (this.interaction?.circularPatternState) {
				this.interaction.circularPatternState.suppression = checkSuppression.checked;
				this.interaction.onCircularPatternStateChange?.();
				this.interaction.render();
			}
		});

		// OK & Cancel buttons
		const btnCpatOk = this.container.querySelector<HTMLButtonElement>('#btn-cpat-ok');
		btnCpatOk?.addEventListener('click', () => {
			this.interaction?.executeCircularPattern();
		});

		const btnCpatCancel = this.container.querySelector<HTMLButtonElement>('#btn-cpat-cancel');
		btnCpatCancel?.addEventListener('click', () => {
			this.interaction?.cancelCircularPattern();
		});

		const btnCpatCancelIcon = this.container.querySelector<HTMLButtonElement>('#btn-cpat-cancel-icon');
		btnCpatCancelIcon?.addEventListener('click', () => {
			this.interaction?.cancelCircularPattern();
		});

		// Inspector Circular Pattern Constraint editing
		const selectedConstraintId = [...this.sketch.selection.constraintIds][0];
		const selectedC = selectedConstraintId ? this.sketch.constraints.get(selectedConstraintId) : null;
		if (selectedC instanceof CircularPatternConstraint) {
			this.container.querySelectorAll<HTMLButtonElement>('.insp-cpat-dist-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const dist = btn.getAttribute('data-dist') as 'full' | 'partial' | 'symmetric';
					if (dist) {
						this.sketch.updateCircularPattern(selectedC.id, { distribution: dist });
						this.render();
						this.interaction?.render();
					}
				});
			});

			const inspAngle = this.container.querySelector<HTMLInputElement>('#insp-cpat-angle');
			inspAngle?.addEventListener('input', () => {
				const val = parseFloat(inspAngle.value);
				if (!isNaN(val) && isFinite(val) && Math.abs(val) > 1e-3) {
					this.sketch.updateCircularPattern(selectedC.id, { totalAngle: val });
					this.interaction?.render();
				}
			});
			inspAngle?.addEventListener('change', () => {
				this.render();
				this.interaction?.render();
			});

			const inspQty = this.container.querySelector<HTMLInputElement>('#insp-cpat-quantity');
			inspQty?.addEventListener('input', () => {
				const val = parseInt(inspQty.value, 10);
				if (!isNaN(val) && val >= 2) {
					this.sketch.updateCircularPattern(selectedC.id, { quantity: val });
					this.render();
					this.interaction?.render();
				}
			});

			const inspSuppress = this.container.querySelector<HTMLInputElement>('#insp-cpat-suppression');
			inspSuppress?.addEventListener('change', () => {
				this.sketch.updateCircularPattern(selectedC.id, { suppression: inspSuppress.checked });
				this.render();
				this.interaction?.render();
			});
		}

		// Rectangular Pattern Tool events
		const btnRpatPhaseObjects = this.container.querySelector<HTMLButtonElement>('#btn-rpat-phase-objects');
		btnRpatPhaseObjects?.addEventListener('click', () => {
			this.interaction?.setRectangularPatternPhase('objects');
		});

		const btnRpatPhaseDir1 = this.container.querySelector<HTMLButtonElement>('#btn-rpat-phase-dir1');
		btnRpatPhaseDir1?.addEventListener('click', () => {
			this.interaction?.setRectangularPatternPhase('direction1');
		});

		const btnRpatPhaseDir2 = this.container.querySelector<HTMLButtonElement>('#btn-rpat-phase-dir2');
		btnRpatPhaseDir2?.addEventListener('click', () => {
			this.interaction?.setRectangularPatternPhase('direction2');
		});

		const btnRpatClearObjects = this.container.querySelector<HTMLButtonElement>('#btn-rpat-clear-objects');
		btnRpatClearObjects?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.selectedObjectIds.clear();
				this.interaction.onRectangularPatternStateChange?.();
				this.interaction.render();
			}
		});

		const btnRpatClearDir1 = this.container.querySelector<HTMLButtonElement>('#btn-rpat-clear-dir1');
		btnRpatClearDir1?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.line1Id = null;
				this.interaction.onRectangularPatternStateChange?.();
				this.interaction.render();
			}
		});

		const btnRpatClearDir2 = this.container.querySelector<HTMLButtonElement>('#btn-rpat-clear-dir2');
		btnRpatClearDir2?.addEventListener('click', e => {
			e.stopPropagation();
			if (this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.line2Id = null;
				this.interaction.onRectangularPatternStateChange?.();
				this.interaction.render();
			}
		});

		// Direction 1 toggle
		this.container.querySelectorAll<HTMLButtonElement>('.rpat-dir1-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const dir = btn.getAttribute('data-dir') as 'one_direction' | 'symmetric';
				if (dir && this.interaction?.rectangularPatternState) {
					this.interaction.rectangularPatternState.direction1 = dir;
					this.interaction.onRectangularPatternStateChange?.();
					this.interaction.render();
				}
			});
		});

		// Distance 1 input
		const inputDist1 = this.container.querySelector<HTMLInputElement>('#input-rpat-dist1');
		inputDist1?.addEventListener('input', () => {
			const val = parseFloat(inputDist1.value);
			if (!isNaN(val) && isFinite(val) && this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.distance1 = val;
				this.interaction.render();
			}
		});
		inputDist1?.addEventListener('change', () => {
			this.render();
		});

		// Quantity 1 input
		const inputQty1 = this.container.querySelector<HTMLInputElement>('#input-rpat-qty1');
		inputQty1?.addEventListener('input', () => {
			const val = parseInt(inputQty1.value, 10);
			if (!isNaN(val) && val >= 1 && this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.quantity1 = val;
				this.interaction.render();
			}
		});
		inputQty1?.addEventListener('change', () => {
			this.render();
		});

		// Direction 2 toggle
		this.container.querySelectorAll<HTMLButtonElement>('.rpat-dir2-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const dir = btn.getAttribute('data-dir') as 'one_direction' | 'symmetric';
				if (dir && this.interaction?.rectangularPatternState) {
					this.interaction.rectangularPatternState.direction2 = dir;
					this.interaction.onRectangularPatternStateChange?.();
					this.interaction.render();
				}
			});
		});

		// Distance 2 input
		const inputDist2 = this.container.querySelector<HTMLInputElement>('#input-rpat-dist2');
		inputDist2?.addEventListener('input', () => {
			const val = parseFloat(inputDist2.value);
			if (!isNaN(val) && isFinite(val) && this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.distance2 = val;
				this.interaction.render();
			}
		});
		inputDist2?.addEventListener('change', () => {
			this.render();
		});

		// Quantity 2 input
		const inputQty2 = this.container.querySelector<HTMLInputElement>('#input-rpat-qty2');
		inputQty2?.addEventListener('input', () => {
			const val = parseInt(inputQty2.value, 10);
			if (!isNaN(val) && val >= 1 && this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.quantity2 = val;
				this.interaction.render();
			}
		});
		inputQty2?.addEventListener('change', () => {
			this.render();
		});

		// Suppression checkbox
		const checkRpatSuppression = this.container.querySelector<HTMLInputElement>('#check-rpat-suppression');
		checkRpatSuppression?.addEventListener('change', () => {
			if (this.interaction?.rectangularPatternState) {
				this.interaction.rectangularPatternState.suppression = checkRpatSuppression.checked;
				this.interaction.onRectangularPatternStateChange?.();
				this.interaction.render();
			}
		});

		// OK & Cancel buttons
		const btnRpatOk = this.container.querySelector<HTMLButtonElement>('#btn-rpat-ok');
		btnRpatOk?.addEventListener('click', () => {
			this.interaction?.executeRectangularPattern();
		});

		const btnRpatCancel = this.container.querySelector<HTMLButtonElement>('#btn-rpat-cancel');
		btnRpatCancel?.addEventListener('click', () => {
			this.interaction?.cancelRectangularPattern();
		});

		const btnRpatCancelIcon = this.container.querySelector<HTMLButtonElement>('#btn-rpat-cancel-icon');
		btnRpatCancelIcon?.addEventListener('click', () => {
			this.interaction?.cancelRectangularPattern();
		});

		// Inspector Rectangular Pattern Constraint editing
		if (selectedC instanceof RectangularPatternConstraint) {
			this.container.querySelectorAll<HTMLButtonElement>('.insp-rpat-dir1-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const dir = btn.getAttribute('data-dir') as 'one_direction' | 'symmetric';
					if (dir) {
						this.sketch.updateRectangularPattern(selectedC.id, { direction1: dir });
						this.render();
						this.interaction?.render();
					}
				});
			});

			const inspDist1 = this.container.querySelector<HTMLInputElement>('#insp-rpat-dist1');
			inspDist1?.addEventListener('input', () => {
				const val = parseFloat(inspDist1.value);
				if (!isNaN(val) && isFinite(val)) {
					this.sketch.updateRectangularPattern(selectedC.id, { distance1: val });
					this.interaction?.render();
				}
			});
			inspDist1?.addEventListener('change', () => {
				this.render();
				this.interaction?.render();
			});

			const inspQty1 = this.container.querySelector<HTMLInputElement>('#insp-rpat-qty1');
			inspQty1?.addEventListener('input', () => {
				const val = parseInt(inspQty1.value, 10);
				if (!isNaN(val) && val >= 1) {
					this.sketch.updateRectangularPattern(selectedC.id, { quantity1: val });
					this.render();
					this.interaction?.render();
				}
			});

			this.container.querySelectorAll<HTMLButtonElement>('.insp-rpat-dir2-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const dir = btn.getAttribute('data-dir') as 'one_direction' | 'symmetric';
					if (dir) {
						this.sketch.updateRectangularPattern(selectedC.id, { direction2: dir });
						this.render();
						this.interaction?.render();
					}
				});
			});

			const inspDist2 = this.container.querySelector<HTMLInputElement>('#insp-rpat-dist2');
			inspDist2?.addEventListener('input', () => {
				const val = parseFloat(inspDist2.value);
				if (!isNaN(val) && isFinite(val)) {
					this.sketch.updateRectangularPattern(selectedC.id, { distance2: val });
					this.interaction?.render();
				}
			});
			inspDist2?.addEventListener('change', () => {
				this.render();
				this.interaction?.render();
			});

			const inspQty2 = this.container.querySelector<HTMLInputElement>('#insp-rpat-qty2');
			inspQty2?.addEventListener('input', () => {
				const val = parseInt(inspQty2.value, 10);
				if (!isNaN(val) && val >= 1) {
					this.sketch.updateRectangularPattern(selectedC.id, { quantity2: val });
					this.render();
					this.interaction?.render();
				}
			});

			const inspRpatSuppress = this.container.querySelector<HTMLInputElement>('#insp-rpat-suppression');
			inspRpatSuppress?.addEventListener('change', () => {
				this.sketch.updateRectangularPattern(selectedC.id, { suppression: inspRpatSuppress.checked });
				this.render();
				this.interaction?.render();
			});
		}
	}
}

