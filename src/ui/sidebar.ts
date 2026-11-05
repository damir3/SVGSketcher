import type { SketchDocument } from '../model/sketch';
import type { SketchSpline, SketchText } from '../model/types';
import type { CanvasInteraction } from '../canvas/interaction';
import { parseNumericOrExpression } from '../math/expression';
import {
	DistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
	CircularPatternConstraint,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
} from '../solver/constraints';
import { ICONS } from './icons';
import { dist, type Vec2 } from '../math/vector';
import type { IInspectable, InspectorContext } from './panels/inspector/types';

export class Sidebar {
	private container: HTMLElement;
	private sketch: SketchDocument;
	private interaction?: CanvasInteraction;

	onEditDimension?: (
		constraint:
			| DistanceConstraint
			| RadiusConstraint
			| AngleConstraint
			| PointToLineDistanceConstraint
			| OffsetConstraint
			| OriginDistanceConstraint
			| LineToAxisDistanceConstraint,
		screenPos?: Vec2
	) => void;

	constructor(container: HTMLElement, sketch: SketchDocument, interaction?: CanvasInteraction) {
		this.container = container;
		this.sketch = sketch;
		this.interaction = interaction;
		if (this.interaction) {
			this.interaction.sidebar = this;
		}

		this.sketch.onChange(() => this.render());
		if (this.interaction) {
			const prevToolChange = this.interaction.onToolChange;
			this.interaction.onToolChange = tool => {
				prevToolChange?.(tool);
				this.render();
			};
		}
		this.render();
	}

	render(): void {
		const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		if (
			activeEl &&
			this.container.contains(activeEl) &&
			(activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')
		) {
			return;
		}

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
		const texts = [...this.sketch.texts.values()];
		const totalPrimitives =
			points.length +
			lines.length +
			circles.length +
			arcs.length +
			ellipses.length +
			ellipticalArcs.length +
			splines.length +
			texts.length;

		this.container.innerHTML = `
			<div class="sidebar-header">
				<div class="sidebar-title">Inspector & Tree</div>
				<div class="dof-badge ${statusClass}">
					<span class="dof-indicator"></span>
					${statusLabel}
				</div>
			</div>

			<div class="sidebar-content">
				<!-- Active Tool Panel (delegated to active tool) -->
				${this.renderActiveToolCard()}

				<!-- Selected item inspector -->
				${this.renderInspector()}

				<!-- Primitives Tree -->
				<div class="tree-group">
					<div class="tree-header">
						<span class="tree-title">Primitives (${totalPrimitives})</span>
					</div>
					<div class="tree-list">
						${texts.map(t => this.renderTextItem(t)).join('')}
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

	private renderActiveToolCard(): string {
		return this.interaction?.activeToolInstance?.sidebarPanel?.render() ?? '';
	}

	private renderInspector(): string {
		if (this.interaction?.activeTool === 'text') {
			return '';
		}
		const entity = this.getSelectedInspectableEntity();
		if (!entity?.sidebarPanel) return '';
		return entity.sidebarPanel.render(this.createInspectorContext());
	}

	private createInspectorContext(): InspectorContext {
		return {
			sketch: this.sketch,
			onEditDimension: (c, screenPos) => this.onEditDimension?.(c, screenPos),
			renderConstraintsSublist: (constraints, label, entityIds) =>
				this.renderConstraintsSublist(constraints, label, entityIds),
			renderPrimitivesSublist: primitives => this.renderPrimitivesSublist(primitives),
			bindInspectorNumberInput: (selector, onCommit, validator) =>
				this.bindInspectorNumberInput(selector, onCommit, validator),
			requestRender: () => {
				this.render();
				this.interaction?.render();
			},
			getIcon: (name: string) => ICONS[name] ?? '',
		};
	}

	private getSelectedInspectableEntity(): IInspectable | null {
		const sel = this.sketch.selection;
		const totalCount =
			sel.pointIds.size +
			sel.lineIds.size +
			sel.circleIds.size +
			sel.arcIds.size +
			sel.ellipseIds.size +
			sel.ellipticalArcIds.size +
			sel.splineIds.size +
			sel.textIds.size +
			sel.constraintIds.size;

		if (totalCount !== 1) {
			return null;
		}

		if (sel.pointIds.size === 1) {
			const pid = [...sel.pointIds][0];
			if (pid === 'origin') {
				return null;
			}
			return this.sketch.points.get(pid) ?? null;
		}

		if (sel.lineIds.size === 1) {
			const lid = [...sel.lineIds][0];
			if (lid === 'axis_x' || lid === 'axis_y') {
				return null;
			}
			return this.sketch.lines.get(lid) ?? null;
		}

		if (sel.circleIds.size === 1) {
			return this.sketch.circles.get([...sel.circleIds][0]) ?? null;
		}

		if (sel.arcIds.size === 1) {
			return this.sketch.arcs.get([...sel.arcIds][0]) ?? null;
		}

		if (sel.ellipseIds.size === 1) {
			return this.sketch.ellipses.get([...sel.ellipseIds][0]) ?? null;
		}

		if (sel.ellipticalArcIds.size === 1) {
			return this.sketch.ellipticalArcs.get([...sel.ellipticalArcIds][0]) ?? null;
		}

		if (sel.splineIds.size === 1) {
			return this.sketch.splines.get([...sel.splineIds][0]) ?? null;
		}

		if (sel.textIds.size === 1) {
			return this.sketch.texts.get([...sel.textIds][0]) ?? null;
		}

		if (sel.constraintIds.size === 1) {
			return this.sketch.constraints.get([...sel.constraintIds][0]) ?? null;
		}

		return null;
	}

	private renderPrimitivesSublist(
		primitives: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
		}>
	): string {
		const visiblePrimitives = primitives.filter(p => p.id !== 'origin' && p.id !== 'axis_x' && p.id !== 'axis_y');
		return `
			<div class="inspector-divider"></div>
			<div class="inspector-primitives-section">
				<div class="inspector-primitives-header">
					<span class="inspector-primitives-title">Primitives (${visiblePrimitives.length})</span>
				</div>
				<div class="inspector-primitives-list">
					${visiblePrimitives.map(p => this.renderPrimitiveSublistItem(p)).join('')}
					${visiblePrimitives.length === 0 ? `<div class="inspector-empty-primitives">No primitives linked</div>` : ''}
				</div>
			</div>
		`;
	}

	private renderPrimitiveSublistItem(entityRef: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
	}): string {
		switch (entityRef.type) {
			case 'line': {
				const line = this.sketch.lines.get(entityRef.id);
				return line ? this.renderLineItem(line, false) : '';
			}
			case 'circle': {
				const circle = this.sketch.circles.get(entityRef.id);
				return circle ? this.renderCircleItem(circle, false) : '';
			}
			case 'arc': {
				const arc = this.sketch.arcs.get(entityRef.id);
				return arc ? this.renderArcItem(arc, false) : '';
			}
			case 'ellipse': {
				const ellipse = this.sketch.ellipses.get(entityRef.id);
				return ellipse ? this.renderEllipseItem(ellipse, false) : '';
			}
			case 'elliptical_arc': {
				const elArc = this.sketch.ellipticalArcs.get(entityRef.id);
				return elArc ? this.renderEllipticalArcItem(elArc, false) : '';
			}
			case 'spline': {
				const spline = this.sketch.splines.get(entityRef.id);
				return spline ? this.renderSplineItem(spline, false) : '';
			}
			case 'point': {
				const pt = this.sketch.points.get(entityRef.id);
				return pt ? this.renderPointItem(pt, false) : '';
			}
			default:
				return '';
		}
	}

	private renderConstraintsSublist(constraints: any[], entityName: string, currentEntityIds: string[] = []): string {
		const visibleConstraints = constraints.filter(
			c => c.type !== 'arc_endpoints' && c.type !== 'elliptical_arc_endpoints'
		);
		return `
			<div class="inspector-divider"></div>
			<div class="inspector-constraints-section">
				<div class="inspector-constraints-header">
					<span class="inspector-constraints-title">Constraints (${visibleConstraints.length})</span>
				</div>
				<div class="inspector-constraints-list">
					${visibleConstraints.map(c => this.renderConstraintItem(c, currentEntityIds)).join('')}
					${visibleConstraints.length === 0 ? `<div class="inspector-empty-constraints">No constraints on ${entityName}</div>` : ''}
				</div>
			</div>
		`;
	}

	private renderLineItem(line: any, showDelete = true): string {
		const isSelected = this.sketch.selection.lineIds.has(line.id);
		const p1 = this.sketch.points.get(line.p1Id);
		const p2 = this.sketch.points.get(line.p2Id);
		const len = p1 && p2 ? dist(p1, p2).toFixed(1) : '?';

		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="line" data-id="${line.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.line}</span>
					<span class="tree-name">${line.id}</span>
					<span class="tree-meta">${len} mm ${line.isConstruction ? '(aux)' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${line.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderCircleItem(circle: any, showDelete = true): string {
		const isSelected = this.sketch.selection.circleIds.has(circle.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="circle" data-id="${circle.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.circle}</span>
					<span class="tree-name">${circle.id}</span>
					<span class="tree-meta">R ${circle.radius.toFixed(1)} mm</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${circle.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderArcItem(arc: any, showDelete = true): string {
		const isSelected = this.sketch.selection.arcIds.has(arc.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="arc" data-id="${arc.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.arc}</span>
					<span class="tree-name">${arc.id}</span>
					<span class="tree-meta">R ${arc.radius.toFixed(1)} mm ${arc.isConstruction ? '(aux)' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${arc.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderEllipseItem(ellipse: any, showDelete = true): string {
		const isSelected = this.sketch.selection.ellipseIds.has(ellipse.id);
		const center = this.sketch.points.get(ellipse.centerId);
		const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
		const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
		const rx = center && majorPt ? dist(center, majorPt).toFixed(1) : '?';
		const ry = center && minorPt ? dist(center, minorPt).toFixed(1) : '?';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="ellipse" data-id="${ellipse.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.ellipse}</span>
					<span class="tree-name">${ellipse.id}</span>
					<span class="tree-meta">Rx ${rx} / Ry ${ry} mm ${ellipse.isConstruction ? '(aux)' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${ellipse.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderEllipticalArcItem(arc: any, showDelete = true): string {
		const isSelected = this.sketch.selection.ellipticalArcIds.has(arc.id);
		const center = this.sketch.points.get(arc.centerId);
		const majorPt = this.sketch.points.get(arc.majorAxisPointId);
		const minorPt = this.sketch.points.get(arc.minorAxisPointId);
		const rx = center && majorPt ? dist(center, majorPt).toFixed(1) : '?';
		const ry = center && minorPt ? dist(center, minorPt).toFixed(1) : '?';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="elliptical_arc" data-id="${arc.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.elliptical_arc}</span>
					<span class="tree-name">${arc.id}</span>
					<span class="tree-meta">Rx ${rx} / Ry ${ry} mm ${arc.isConstruction ? '(aux)' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${arc.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderTextItem(text: SketchText, showDelete = true): string {
		const isSelected = this.sketch.selection.textIds.has(text.id);
		const label = text.text ? `"${text.text.slice(0, 15)}"` : text.id;
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="text" data-id="${text.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.text || 'T'}</span>
					<span class="tree-name">${text.id}</span>
					<span class="tree-meta">${label} (${text.mode === 'text' ? 'Box' : 'Path'})</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${text.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderSplineItem(spline: SketchSpline, showDelete = true): string {
		const isSelected = this.sketch.selection.splineIds.has(spline.id);
		const typeLabel = spline.splineType === 'fit' ? 'Fit Spline' : 'Control Spline';
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="spline" data-id="${spline.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${spline.splineType === 'fit' ? ICONS.spline_fit : ICONS.spline_control}</span>
					<span class="tree-name">${spline.id}</span>
					<span class="tree-meta">${typeLabel} (${spline.pointIds.length} pts) ${spline.isConstruction ? '(aux)' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${spline.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderPointItem(pt: any, showDelete = true): string {
		const isSelected = this.sketch.selection.pointIds.has(pt.id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="point" data-id="${pt.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.point}</span>
					<span class="tree-name">${pt.id}</span>
					<span class="tree-meta">(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}) ${pt.fixed ? '🔒' : ''}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${pt.id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private renderConstraintItem(c: any, currentEntityIds: string[] = []): string {
		const isSelected = this.sketch.selection.constraintIds.has(c.id);
		let valBadge = '';
		let name = c.name;

		if (c instanceof DistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name =
				c.orientation === 'horizontal'
					? 'Horizontal Distance'
					: c.orientation === 'vertical'
						? 'Vertical Distance'
						: 'Distance';
		} else if (c instanceof PointToLineDistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = 'Point-Line Distance';
		} else if (c instanceof OffsetConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = 'Offset';
		} else if (c instanceof AngleConstraint) {
			valBadge = `<span class="val-badge">${c.targetAngle.toFixed(1)}°</span>`;
			name = 'Angle';
		} else if (c instanceof RadiusConstraint) {
			valBadge =
				c.displayMode === 'diameter'
					? `<span class="val-badge">Ø ${(c.targetRadius * 2).toFixed(1)} mm</span>`
					: `<span class="val-badge">R ${c.targetRadius.toFixed(1)} mm</span>`;
			name = c.displayMode === 'diameter' ? 'Diameter' : 'Radius';
		} else if (c instanceof CircularPatternConstraint) {
			const label = c.isReadOnly
				? `${c.quantity} Vertices`
				: c.distribution === 'full'
					? `${c.quantity}x Full`
					: `${c.quantity}x ${c.totalAngle.toFixed(1)}°`;
			valBadge = `<span class="val-badge">${label}</span>`;
			name = c.isReadOnly ? 'Polygon Pattern' : 'Circular Pattern';
		} else if (c instanceof OriginDistanceConstraint) {
			if (c.isCoincident) {
				name = 'Coincident with (0,0)';
			} else if (c.targetDistance === 0) {
				const axisName = c.orientation === 'vertical' ? 'X-Axis' : 'Y-Axis';
				name = `Point on ${axisName}`;
			} else {
				valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
				name =
					c.orientation === 'horizontal'
						? 'Distance to Y-Axis'
						: c.orientation === 'vertical'
							? 'Distance to X-Axis'
							: 'Distance to (0,0)';
			}
		} else if (c instanceof LineToAxisDistanceConstraint) {
			const axisName = c.axis === 'x' ? 'X-Axis' : 'Y-Axis';
			if (c.isCollinear) {
				name = `Collinear with ${axisName}`;
			} else {
				valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
				name = `Distance to ${axisName}`;
			}
		}

		const allEntities = this.sketch.getEntitiesForConstraint(c);
		const targetEntities = (
			currentEntityIds.length === 1 ? allEntities.filter(e => e.id !== currentEntityIds[0]) : allEntities
		).filter(e => e.id !== 'origin' && e.id !== 'axis_x' && e.id !== 'axis_y');

		const linkedEntitiesHtml =
			targetEntities.length > 0
				? `<div class="constraint-linked-entities">${targetEntities
						.map(
							ent => `
						<button type="button" class="constraint-entity-chip" data-entity-id="${ent.id}" data-entity-type="${ent.type}" title="Switch to ${ent.id}">
							<span class="chip-icon">${this.getPrimitiveIcon(ent.type, ent.id)}</span>
							<span>${ent.id}</span>
						</button>
					`
						)
						.join('')}</div>`
				: '';

		return `
			<div class="tree-item constraint-item ${isSelected ? 'selected' : ''}" data-type="constraint" data-id="${c.id}">
				<div class="tree-item-info">
					<span class="tree-icon">${c instanceof CircularPatternConstraint && c.isReadOnly ? ICONS.polygon : this.getConstraintIcon(c.type)}</span>
					<span class="tree-name">${name}</span>
					${valBadge}
					${linkedEntitiesHtml}
				</div>
				<button class="tree-delete-btn" data-delete-id="${c.id}" title="Delete">${ICONS.delete}</button>
			</div>
		`;
	}

	private getPrimitiveIcon(
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline',
		id: string
	): string {
		switch (type) {
			case 'line':
				return ICONS.line;
			case 'circle':
				return ICONS.circle;
			case 'arc':
				return ICONS.arc;
			case 'ellipse':
				return ICONS.ellipse;
			case 'elliptical_arc':
				return ICONS.elliptical_arc;
			case 'spline': {
				const s = this.sketch.splines.get(id);
				return s?.splineType === 'control' ? ICONS.spline_control : ICONS.spline_fit;
			}
			case 'point':
			default:
				return ICONS.point;
		}
	}

	private getConstraintIcon(type: string): string {
		switch (type) {
			case 'fixed':
				return ICONS.fixed;
			case 'coincident':
				return ICONS.coincident;
			case 'horizontal':
				return ICONS.horizontal;
			case 'vertical':
				return ICONS.vertical;
			case 'distance':
				return ICONS.distance;
			case 'point_to_line_distance':
				return ICONS.distance;
			case 'angle':
				return ICONS.angle;
			case 'radius':
				return ICONS.circle;
			case 'equal_length':
			case 'equal_radius':
				return ICONS.equal;
			case 'parallel':
				return ICONS.parallel;
			case 'collinear':
				return ICONS.collinear;
			case 'perpendicular':
				return ICONS.perpendicular;
			case 'tangent_line_circle':
			case 'tangent_circle_circle':
				return ICONS.tangent;
			case 'concentric':
				return ICONS.concentric;
			case 'point_on_line':
				return ICONS.pointOnLine;
			case 'point_on_circle':
				return ICONS.pointOnLine;
			case 'point_on_ellipse':
				return ICONS.pointOnLine;
			case 'point_on_spline':
				return ICONS.pointOnLine;
			case 'midpoint':
				return ICONS.midpoint;
			case 'symmetry':
				return ICONS.symmetry;
			case 'circular_pattern':
				return ICONS.circular_pattern;
			case 'rectangular_pattern':
				return ICONS.rectangular_pattern;
			case 'origin_distance':
				return ICONS.distance;
			case 'line_to_axis_distance':
				return ICONS.distance;
			default:
				return ICONS.coincident;
		}
	}

	private bindEvents(): void {
		// Tree item selection
		this.container.querySelectorAll<HTMLElement>('.tree-item').forEach(item => {
			item.addEventListener('click', e => {
				if ((e.target as HTMLElement).closest('.tree-delete-btn, .constraint-entity-chip')) return;

				const id = item.getAttribute('data-id')!;
				const type = item.getAttribute('data-type')! as
					| 'point'
					| 'line'
					| 'circle'
					| 'arc'
					| 'ellipse'
					| 'elliptical_arc'
					| 'spline'
					| 'text'
					| 'constraint';

				this.sketch.selectEntity(id, type, false);
			});

			item.addEventListener('dblclick', () => {
				const id = item.getAttribute('data-id')!;
				const type = item.getAttribute('data-type')!;
				if (type === 'text') {
					const t = this.sketch.texts.get(id);
					if (t) {
						this.sketch.selectEntity(id, 'text', false);
						this.render();
						const textarea = this.container.querySelector<HTMLTextAreaElement>('#text-tool-input-text');
						textarea?.focus();
					}
				}
			});
		});

		// Quick-switch primitive chips inside constraint items
		this.container.querySelectorAll<HTMLButtonElement>('.constraint-entity-chip').forEach(chip => {
			chip.addEventListener('click', e => {
				e.stopPropagation();
				const entityId = chip.getAttribute('data-entity-id');
				const entityType = chip.getAttribute('data-entity-type') as
					| 'point'
					| 'line'
					| 'circle'
					| 'arc'
					| 'ellipse'
					| 'elliptical_arc'
					| 'spline';
				if (entityId && entityType) {
					this.sketch.selectEntity(entityId, entityType, false);
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

		// Active Tool Panel events
		this.interaction?.activeToolInstance?.sidebarPanel?.bindEvents(this.container);

		// Inspector entity events
		if (this.interaction?.activeTool !== 'text') {
			const entity = this.getSelectedInspectableEntity();
			const ctx = this.createInspectorContext();
			entity?.sidebarPanel?.bindEvents(this.container, ctx);
		}
	}

	private bindInspectorNumberInput(
		selector: string,
		onValidInput: (val: number, inputEl: HTMLInputElement) => void,
		validate: (val: number) => boolean = val => !isNaN(val) && isFinite(val)
	): void {
		const input = this.container.querySelector<HTMLInputElement>(selector);
		if (!input) return;

		let committed = false;

		input.addEventListener('focus', () => {
			committed = false;
			input.select();
		});

		input.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				const text = input.value.trim();
				const val = parseNumericOrExpression(text, NaN, this.sketch.getParameterValuesMap());
				committed = true;
				if (validate(val)) {
					this.sketch.pushHistory();
					onValidInput(val, input);
					this.render();
					this.interaction?.render();
				} else {
					this.render();
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				committed = true;
				this.render();
			}
		});

		input.addEventListener('blur', () => {
			if (!committed) {
				this.render();
			}
		});
	}
}
