import type { SketchImage } from '../model/image';
import type { SketchDocument } from '../model/sketch';
import { getSelectionCount } from '../model/selection';
import type { SketchSpline, SketchText } from '../model/types';
import type { CanvasInteraction } from '../canvas/interaction';
import type { HoverTarget } from '../canvas/tools/hoverTarget';
import { parseNumericOrExpression } from '../math/expression';
import {
	DistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import { ICONS } from './icons';
import { type Vec2 } from '../math/vector';
import type { IInspectable, InspectorContext } from './panels/inspector/types';

const CHEVRON_DOWN_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const MAX_SELECTED_INSPECTOR_ITEMS = 200;

const CONSTRAINT_ICON_MAP: Record<string, string> = {
	fixed: ICONS.fixed,
	coincident: ICONS.coincident,
	horizontal: ICONS.horizontal,
	vertical: ICONS.vertical,
	distance: ICONS.distance,
	point_to_line_distance: ICONS.distance,
	angle: ICONS.angle,
	radius: ICONS.circle,
	equal_length: ICONS.equal,
	equal_radius: ICONS.equal,
	parallel: ICONS.parallel,
	collinear: ICONS.collinear,
	perpendicular: ICONS.perpendicular,
	tangent_line_circle: ICONS.tangent,
	tangent_circle_circle: ICONS.tangent,
	concentric: ICONS.concentric,
	point_on_line: ICONS.pointOnLine,
	point_on_circle: ICONS.pointOnLine,
	point_on_ellipse: ICONS.pointOnLine,
	point_on_spline: ICONS.pointOnLine,
	midpoint: ICONS.midpoint,
	symmetry: ICONS.symmetry,
	circular_pattern: ICONS.circular_pattern,
	rectangular_pattern: ICONS.rectangular_pattern,
};

export class Sidebar {
	private container: HTMLElement;
	private sketch: SketchDocument;
	private interaction?: CanvasInteraction;
	private isPrimitivesExpanded = false;
	private hoveredSelectedTargetId: string | null = null;

	onEditDimension?: (
		constraint:
			| DistanceConstraint
			| RadiusConstraint
			| AngleConstraint
			| PointToLineDistanceConstraint
			| OffsetConstraint,
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

		const handlePointIds = this.getSplineHandlePointIds();
		const images = [...this.sketch.images.values()];
		const totalPrimitives = this.getPrimitivesCount(handlePointIds);

		this.container.innerHTML = `
			<div class="sidebar-header">
				<div class="sidebar-title">Inspector & Tree</div>
			</div>

			<div class="sidebar-content">
				<!-- Active Tool Panel (delegated to active tool) -->
				${this.renderActiveToolCard()}

				<!-- Selected item(s) inspector -->
				${this.renderInspector(handlePointIds)}

				<!-- Primitives Tree (collapsed by default to save resources) -->
				<div class="tree-group ${this.isPrimitivesExpanded ? 'is-expanded' : 'is-collapsed'}">
					<button
						type="button"
						class="tree-header tree-toggle-btn"
						id="primitives-tree-toggle"
						aria-expanded="${this.isPrimitivesExpanded}"
					>
						<span class="tree-title">
							<span class="tree-chevron">${CHEVRON_DOWN_SVG}</span>
							Primitives (${totalPrimitives})
						</span>
					</button>
					${this.isPrimitivesExpanded ? this.renderPrimitivesTreeList(handlePointIds, totalPrimitives, images.length) : ''}
				</div>
				${
					images.length
						? `
					<div class="tree-group">
						<div class="tree-header"><span class="tree-title">Images (${images.length})</span></div>
						<div class="tree-list">${images.map(image => this.renderImageItem(image)).join('')}</div>
					</div>
				`
						: ''
				}
			</div>
		`;

		this.bindEvents();
	}

	private getSplineHandlePointIds(): Set<string> {
		const handleIds = new Set<string>();
		if (this.sketch.splines.size === 0) return handleIds;
		for (const line of this.sketch.lines.values()) {
			if (!line.isSplineHandle) continue;
			const parentSpline = line.parentSplineId ? this.sketch.splines.get(line.parentSplineId) : undefined;
			if ((!parentSpline || !parentSpline.pointIds.includes(line.p1Id)) && this.sketch.points.has(line.p1Id)) {
				handleIds.add(line.p1Id);
			}
			if ((!parentSpline || !parentSpline.pointIds.includes(line.p2Id)) && this.sketch.points.has(line.p2Id)) {
				handleIds.add(line.p2Id);
			}
		}
		return handleIds;
	}

	private getPrimitivesCount(handlePointIds: Set<string>): number {
		let splineHandleLines = 0;
		if (this.sketch.splines.size > 0) {
			for (const line of this.sketch.lines.values()) {
				if (line.isSplineHandle) splineHandleLines++;
			}
		}
		return (
			this.sketch.points.size -
			handlePointIds.size +
			(this.sketch.lines.size - splineHandleLines) +
			this.sketch.circles.size +
			this.sketch.arcs.size +
			this.sketch.ellipses.size +
			this.sketch.ellipticalArcs.size +
			this.sketch.splines.size +
			this.sketch.texts.size
		);
	}

	private renderPrimitivesTreeList(handlePointIds: Set<string>, totalPrimitives: number, imagesCount: number): string {
		const points = [...this.sketch.points.values()].filter(p => !handlePointIds.has(p.id));
		const lines = [...this.sketch.lines.values()].filter(l => !l.isSplineHandle);
		const circles = [...this.sketch.circles.values()];
		const arcs = [...this.sketch.arcs.values()];
		const ellipses = [...this.sketch.ellipses.values()];
		const ellipticalArcs = [...this.sketch.ellipticalArcs.values()];
		const splines = [...this.sketch.splines.values()];
		const texts = [...this.sketch.texts.values()];

		return `
			<div class="tree-list">
				${texts.map(t => this.renderTextItem(t)).join('')}
				${splines.map(s => this.renderSplineItem(s)).join('')}
				${lines.map(l => this.renderLineItem(l)).join('')}
				${circles.map(c => this.renderCircleItem(c)).join('')}
				${arcs.map(a => this.renderArcItem(a)).join('')}
				${ellipses.map(e => this.renderEllipseItem(e)).join('')}
				${ellipticalArcs.map(ea => this.renderEllipticalArcItem(ea)).join('')}
				${points.map(p => this.renderPointItem(p)).join('')}
				${totalPrimitives === 0 && imagesCount === 0 ? '<div class="tree-empty">No primitives yet. Use the left toolbar to draw.</div>' : ''}
			</div>
		`;
	}

	private renderActiveToolCard(): string {
		return this.interaction?.activeToolInstance?.sidebarPanel?.render() ?? '';
	}

	private renderInspector(handlePointIds: Set<string>): string {
		const activeTool = this.interaction?.activeTool;
		if (activeTool === 'text' || activeTool === 'image') {
			return '';
		}

		const totalSelectedCount = getSelectionCount(this.sketch);

		if (totalSelectedCount === 0) return '';

		if (totalSelectedCount === 1) {
			if (activeTool === 'transform') return '';
			const entity = this.getSelectedInspectableEntity();
			if (!entity?.sidebarPanel) return '';
			return entity.sidebarPanel.render(this.createInspectorContext());
		}

		return this.renderMultiSelectionInspector(handlePointIds);
	}

	private renderMultiSelectionInspector(handlePointIds: Set<string>): string {
		const sel = this.sketch.selection;
		const renderedItems: string[] = [];
		let totalVisibleCount = 0;
		let primitiveCount = 0;
		let constraintCount = 0;

		const pushItem = (html: string, isConstraint = false) => {
			totalVisibleCount++;
			if (isConstraint) constraintCount++;
			else primitiveCount++;
			if (renderedItems.length < MAX_SELECTED_INSPECTOR_ITEMS) {
				renderedItems.push(html);
			}
		};

		const groups: Array<
			[Iterable<string>, ReadonlyMap<string, any>, (ent: any) => string, ((ent: any, id: string) => boolean)?]
		> = [
			[sel.textIds, this.sketch.texts, t => this.renderTextItem(t)],
			[sel.splineIds, this.sketch.splines, s => this.renderSplineItem(s)],
			[
				sel.lineIds,
				this.sketch.lines,
				l => this.renderLineItem(l),
				(l, id) => id === 'axis_x' || id === 'axis_y' || l.isSplineHandle,
			],
			[sel.circleIds, this.sketch.circles, c => this.renderCircleItem(c)],
			[sel.arcIds, this.sketch.arcs, a => this.renderArcItem(a)],
			[sel.ellipseIds, this.sketch.ellipses, e => this.renderEllipseItem(e)],
			[sel.ellipticalArcIds, this.sketch.ellipticalArcs, ea => this.renderEllipticalArcItem(ea)],
			[
				sel.pointIds,
				this.sketch.points,
				p => this.renderPointItem(p),
				(_p, id) => id === 'origin' || handlePointIds.has(id),
			],
		];
		for (const [ids, map, renderFn, skip] of groups) {
			for (const id of ids) {
				const ent = map.get(id);
				if (ent && !skip?.(ent, id)) pushItem(renderFn(ent));
			}
		}
		for (const id of sel.constraintIds) {
			const c = this.sketch.constraints.get(id);
			if (c && c.type !== 'arc_endpoints' && c.type !== 'elliptical_arc_endpoints') {
				pushItem(this.renderConstraintItem(c), true);
			}
		}

		if (totalVisibleCount === 0) return '';

		const title =
			primitiveCount === 0 && constraintCount > 0
				? `Selected Constraints (${totalVisibleCount})`
				: `Selected Primitives (${totalVisibleCount})`;
		const remaining = totalVisibleCount - renderedItems.length;

		return `
			<div class="inspector-card">
				<div class="inspector-card-title">
					<span>${title}</span>
					<button type="button" class="btn-insp-clear-selection" id="btn-clear-selection" title="Clear selection">Clear</button>
				</div>
				<div class="inspector-selected-list">
					${renderedItems.join('')}
					${remaining > 0 ? `<div class="inspector-empty-primitives">...and ${remaining} more selected</div>` : ''}
				</div>
			</div>
		`;
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
		if (getSelectionCount(this.sketch) !== 1) {
			return null;
		}

		const sel = this.sketch.selection;
		const sources: Array<[Set<string>, Map<string, IInspectable>, ReadonlySet<string>?]> = [
			[sel.pointIds, this.sketch.points, new Set(['origin'])],
			[sel.lineIds, this.sketch.lines, new Set(['axis_x', 'axis_y'])],
			[sel.circleIds, this.sketch.circles],
			[sel.arcIds, this.sketch.arcs],
			[sel.ellipseIds, this.sketch.ellipses],
			[sel.ellipticalArcIds, this.sketch.ellipticalArcs],
			[sel.splineIds, this.sketch.splines],
			[sel.textIds, this.sketch.texts],
			[sel.constraintIds, this.sketch.constraints],
		];

		for (const [ids, map, ignoredIds] of sources) {
			if (ids.size !== 1) continue;
			const [id] = ids;
			if (ignoredIds?.has(id)) return null;
			return map.get(id) ?? null;
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

	private renderTreeItem(
		type: string,
		id: string,
		selectedIds: ReadonlySet<string>,
		icon: string,
		meta: string,
		showDelete = true
	): string {
		const isSelected = selectedIds.has(id);
		return `
			<div class="tree-item ${isSelected ? 'selected' : ''}" data-type="${type}" data-id="${id}">
				<div class="tree-item-info">
					<span class="tree-icon">${icon}</span>
					<span class="tree-name">${id}</span>
					<span class="tree-meta">${meta}</span>
				</div>
				${showDelete ? `<button class="tree-delete-btn" data-delete-id="${id}" title="Delete">${ICONS.delete}</button>` : ''}
			</div>
		`;
	}

	private formatEllipseMeta(ent: any): string {
		const center = this.sketch.points.get(ent.centerId);
		const majorPt = this.sketch.points.get(ent.majorAxisPointId);
		const minorPt = this.sketch.points.get(ent.minorAxisPointId);
		const rx = center && majorPt ? center.distanceTo(majorPt).toFixed(1) : '?';
		const ry = center && minorPt ? center.distanceTo(minorPt).toFixed(1) : '?';
		return `Rx ${rx} / Ry ${ry} mm ${ent.isConstruction ? '(aux)' : ''}`;
	}

	private renderLineItem(line: any, showDelete = true): string {
		const p1 = this.sketch.points.get(line.p1Id);
		const p2 = this.sketch.points.get(line.p2Id);
		const len = p1 && p2 ? p1.distanceTo(p2).toFixed(1) : '?';
		return this.renderTreeItem(
			'line',
			line.id,
			this.sketch.selection.lineIds,
			ICONS.line,
			`${len} mm ${line.isConstruction ? '(aux)' : ''}`,
			showDelete
		);
	}

	private renderCircleItem(circle: any, showDelete = true): string {
		return this.renderTreeItem(
			'circle',
			circle.id,
			this.sketch.selection.circleIds,
			ICONS.circle,
			`R ${circle.radius.toFixed(1)} mm`,
			showDelete
		);
	}

	private renderArcItem(arc: any, showDelete = true): string {
		return this.renderTreeItem(
			'arc',
			arc.id,
			this.sketch.selection.arcIds,
			ICONS.arc,
			`R ${arc.radius.toFixed(1)} mm ${arc.isConstruction ? '(aux)' : ''}`,
			showDelete
		);
	}

	private renderEllipseItem(ellipse: any, showDelete = true): string {
		return this.renderTreeItem(
			'ellipse',
			ellipse.id,
			this.sketch.selection.ellipseIds,
			ICONS.ellipse,
			this.formatEllipseMeta(ellipse),
			showDelete
		);
	}

	private renderEllipticalArcItem(arc: any, showDelete = true): string {
		return this.renderTreeItem(
			'elliptical_arc',
			arc.id,
			this.sketch.selection.ellipticalArcIds,
			ICONS.elliptical_arc,
			this.formatEllipseMeta(arc),
			showDelete
		);
	}

	private renderImageItem(image: SketchImage): string {
		return `
			<div class="tree-item ${this.interaction?.selectedImageId === image.id ? 'selected' : ''}" data-image-row>
				<div class="tree-item-info">
					<span class="tree-icon">${ICONS.image}</span>
					<span class="tree-name" data-image-name></span>
					${image.objectUrl ? '' : '<span class="tree-meta">Missing file</span>'}
				</div>
				<button type="button" class="tree-delete-btn" data-image-delete title="Delete Image">${ICONS.delete}</button>
			</div>
		`;
	}

	private renderTextItem(text: SketchText, showDelete = true): string {
		const label = text.text ? `"${text.text.slice(0, 15)}"` : text.id;
		return this.renderTreeItem(
			'text',
			text.id,
			this.sketch.selection.textIds,
			ICONS.text || 'T',
			`${label} (${text.mode === 'text' ? 'Box' : 'Path'})`,
			showDelete
		);
	}

	private renderSplineItem(spline: SketchSpline, showDelete = true): string {
		const typeLabel = spline.splineType === 'fit' ? 'Fit Spline' : 'Control Spline';
		const icon = spline.splineType === 'fit' ? ICONS.spline_fit : ICONS.spline_control;
		return this.renderTreeItem(
			'spline',
			spline.id,
			this.sketch.selection.splineIds,
			icon,
			`${typeLabel} (${spline.pointIds.length} pts) ${spline.isConstruction ? '(aux)' : ''}`,
			showDelete
		);
	}

	private renderPointItem(pt: any, showDelete = true): string {
		return this.renderTreeItem(
			'point',
			pt.id,
			this.sketch.selection.pointIds,
			ICONS.point,
			`(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}) ${pt.fixed ? '🔒' : ''}`,
			showDelete
		);
	}

	private renderConstraintItem(c: any, currentEntityIds: string[] = []): string {
		const isSelected = this.sketch.selection.constraintIds.has(c.id);
		let valBadge = '';
		let name = c.name;

		if (c instanceof DistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = c.displayName;
		} else if (c instanceof PointToLineDistanceConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = c.displayName;
		} else if (c instanceof OffsetConstraint) {
			valBadge = `<span class="val-badge">${c.targetDistance.toFixed(1)} mm</span>`;
			name = 'Offset';
		} else if (c instanceof AngleConstraint) {
			valBadge = `<span class="val-badge">${c.targetAngle.toFixed(1)}°</span>`;
			name = 'Angle';
		} else if (c instanceof RadiusConstraint) {
			valBadge =
				c.displayMode === 'diameter'
					? `<span class="val-badge">Ø${(c.targetRadius * 2).toFixed(1)} mm</span>`
					: `<span class="val-badge">R${c.targetRadius.toFixed(1)} mm</span>`;
			name = c.displayMode === 'diameter' ? 'Diameter' : 'Radius';
		} else if (c instanceof CircularPatternConstraint) {
			const label = c.isReadOnly
				? `${c.quantity} Vertices`
				: c.distribution === 'full'
					? `${c.quantity}x Full`
					: `${c.quantity}x ${c.totalAngle.toFixed(1)}°`;
			valBadge = `<span class="val-badge">${label}</span>`;
			name = c.isReadOnly ? 'Polygon Pattern' : 'Circular Pattern';
		} else if (c instanceof RectangularPatternConstraint) {
			const columns = Math.abs(c.distance1) > 1e-6 ? c.quantity1 : 1;
			const rows = Math.abs(c.distance2) > 1e-6 ? c.quantity2 : 1;
			valBadge = `<span class="val-badge">${columns}x${rows}</span>`;
		}

		const hideLinkedEntities = (c.type === 'circular_pattern' && !c.isReadOnly) || c.type === 'rectangular_pattern';
		const allEntities = hideLinkedEntities ? [] : this.sketch.getEntitiesForConstraint(c);
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
		if (type === 'spline') {
			return this.sketch.splines.get(id)?.splineType === 'control' ? ICONS.spline_control : ICONS.spline_fit;
		}
		return ICONS[type] ?? ICONS.point;
	}

	private getConstraintIcon(type: string): string {
		return CONSTRAINT_ICON_MAP[type] ?? ICONS.coincident;
	}

	private bindEvents(): void {
		// Collapsible Primitives tree toggle
		this.container.querySelector<HTMLButtonElement>('#primitives-tree-toggle')?.addEventListener('click', () => {
			this.isPrimitivesExpanded = !this.isPrimitivesExpanded;
			this.render();
		});

		// Clear multi-selection button
		this.container.querySelector<HTMLButtonElement>('#btn-clear-selection')?.addEventListener('click', e => {
			e.stopPropagation();
			this.sketch.clearSelection();
		});

		// Hover highlight on canvas when hovering items in Selected Primitives
		const selectedList = this.container.querySelector<HTMLElement>('.inspector-selected-list');
		if (
			this.hoveredSelectedTargetId &&
			!selectedList?.querySelector(`.tree-item[data-id="${this.hoveredSelectedTargetId}"]`)
		) {
			this.hoveredSelectedTargetId = null;
			this.interaction?.highlightManager?.setExternalTarget(null);
		}
		if (selectedList) {
			selectedList.querySelectorAll<HTMLElement>('.tree-item[data-type]').forEach(item => {
				const id = item.getAttribute('data-id')!;
				const type = item.getAttribute('data-type')! as HoverTarget['type'];
				item.addEventListener('mouseenter', () => {
					this.hoveredSelectedTargetId = id;
					this.interaction?.highlightManager?.setExternalTarget({ id, type });
				});
				item.addEventListener('mouseleave', () => {
					if (this.hoveredSelectedTargetId === id) {
						this.hoveredSelectedTargetId = null;
						this.interaction?.highlightManager?.setExternalTarget(null);
					}
				});
			});
			selectedList.addEventListener('mouseleave', () => {
				if (this.hoveredSelectedTargetId !== null) {
					this.hoveredSelectedTargetId = null;
					this.interaction?.highlightManager?.setExternalTarget(null);
				}
			});
		}

		// Tree item selection
		this.container.querySelectorAll<HTMLElement>('.tree-item[data-type]').forEach(item => {
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

				if (this.interaction?.activeTool === 'image') this.interaction.setTool('select');
				if (this.interaction?.activeTool === 'transform') {
					if (type !== 'constraint') this.sketch.toggleEntitySelection(id, type);
				} else if (e.shiftKey || e.metaKey || e.ctrlKey) {
					this.sketch.toggleEntitySelection(id, type);
				} else {
					this.sketch.selectEntity(id, type, false);
				}
			});

			item.addEventListener('dblclick', () => {
				if (this.interaction?.activeTool === 'transform') return;
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

		const images = [...this.sketch.images.values()];
		this.container.querySelectorAll<HTMLElement>('[data-image-row]').forEach((row, index) => {
			const image = images[index];
			const name = row.querySelector('[data-image-name]');
			if (name) name.textContent = image.fileName;
			row.addEventListener('click', () => this.interaction?.selectImage(image.id));
			row.querySelector('[data-image-delete]')?.addEventListener('click', event => {
				event.stopPropagation();
				if (this.interaction?.selectedImageId === image.id) this.interaction.setTool('select');
				this.sketch.removeImage(image.id);
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
		this.container.querySelectorAll<HTMLButtonElement>('.tree-delete-btn[data-delete-id]').forEach(btn => {
			btn.addEventListener('click', e => {
				e.stopPropagation();
				const id = btn.getAttribute('data-delete-id')!;
				this.sketch.removeEntity(id);
			});
		});

		// Active Tool Panel events
		this.interaction?.activeToolInstance?.sidebarPanel?.bindEvents(this.container);

		// Inspector entity events
		if (
			this.interaction?.activeTool !== 'text' &&
			this.interaction?.activeTool !== 'transform' &&
			this.interaction?.activeTool !== 'image'
		) {
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
