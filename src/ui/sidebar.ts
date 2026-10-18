import type { SketchDocument } from '../model/sketch';
import { DistanceConstraint, RadiusConstraint, AngleConstraint } from '../solver/constraints';
import { ICONS } from './icons';
import { dist } from '../math/vector';

export class Sidebar {
  private container: HTMLElement;
  private sketch: SketchDocument;

  onEditDimension?: (constraint: DistanceConstraint | RadiusConstraint | AngleConstraint) => void;

  constructor(container: HTMLElement, sketch: SketchDocument) {
    this.container = container;
    this.sketch = sketch;

    this.sketch.onChange(() => this.render());
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

    const points = [...this.sketch.points.values()];
    const lines = [...this.sketch.lines.values()];
    const circles = [...this.sketch.circles.values()];
    const arcs = [...this.sketch.arcs.values()];
    const ellipses = [...this.sketch.ellipses.values()];
    const ellipticalArcs = [...this.sketch.ellipticalArcs.values()];
    const totalPrimitives =
      points.length +
      lines.length +
      circles.length +
      arcs.length +
      ellipses.length +
      ellipticalArcs.length;

    this.container.innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-title">Inspector & Tree</div>
        <div class="dof-badge ${statusClass}">
          <span class="dof-indicator"></span>
          ${statusLabel}
        </div>
      </div>

      <div class="sidebar-content">
        <!-- Selected item inspector -->
        ${this.renderInspector()}

        <!-- Primitives Tree -->
        <div class="tree-group">
          <div class="tree-header">
            <span class="tree-title">Primitives (${totalPrimitives})</span>
          </div>
          <div class="tree-list">
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
            <div class="inspector-row"><span>Fixed:</span> <strong>${pt.fixed ? 'Yes' : 'No'}</strong></div>
            <div class="inspector-row"><span>Type:</span> <strong>${pt.isConstruction ? 'Construction' : 'Solid'}</strong></div>
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
      const related = [...new Set([
        ...this.sketch.getConstraintsForEntity('point', pid),
        ...this.sketch.getConstraintsForEntity('line', lid),
      ])];
      detailsHtml = `
        <div class="inspector-card">
          <div class="inspector-card-title">Selected: Point & Line</div>
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
        detailsHtml = `
          <div class="inspector-card">
            <div class="inspector-card-title">${c instanceof DistanceConstraint ? (c.orientation === 'horizontal' ? 'Horizontal Distance' : c.orientation === 'vertical' ? 'Vertical Distance' : 'Distance') : c instanceof AngleConstraint ? 'Angle' : c.name}</div>
            <div class="inspector-row"><span>Type:</span> <strong>${c.type}</strong></div>
            ${c instanceof DistanceConstraint ? `<div class="inspector-row"><span>${c.orientation === 'horizontal' ? 'Horizontal Distance' : c.orientation === 'vertical' ? 'Vertical Distance' : 'Distance'}:</span> <strong>${c.targetDistance.toFixed(1)} mm</strong></div>` : ''}
            ${c instanceof AngleConstraint ? `<div class="inspector-row"><span>Angle:</span> <strong>${c.targetAngle.toFixed(1)}°</strong></div>` : ''}
            ${c instanceof RadiusConstraint ? `<div class="inspector-row"><span>${c.displayMode === 'diameter' ? 'Diameter' : 'Radius'}:</span> <strong>${(c.displayMode === 'diameter' ? c.targetRadius * 2 : c.targetRadius).toFixed(1)} mm</strong></div>` : ''}
            ${this.renderPrimitivesSublist(relatedPrimitives)}
          </div>
        `;
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

  private renderLineItem(line: any): string {
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
        <button class="tree-delete-btn" data-delete-id="${line.id}" title="Delete">${ICONS.delete}</button>
      </div>
    `;
  }

  private renderCircleItem(circle: any): string {
    const isSelected = this.sketch.selection.circleIds.has(circle.id);
    return `
      <div class="tree-item ${isSelected ? 'selected' : ''}" data-type="circle" data-id="${circle.id}">
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
    const isSelected = this.sketch.selection.arcIds.has(arc.id);
    return `
      <div class="tree-item ${isSelected ? 'selected' : ''}" data-type="arc" data-id="${arc.id}">
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
        <button class="tree-delete-btn" data-delete-id="${ellipse.id}" title="Delete">${ICONS.delete}</button>
      </div>
    `;
  }

  private renderEllipticalArcItem(arc: any): string {
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
        <button class="tree-delete-btn" data-delete-id="${arc.id}" title="Delete">${ICONS.delete}</button>
      </div>
    `;
  }

  private renderPointItem(pt: any): string {
    const isSelected = this.sketch.selection.pointIds.has(pt.id);
    return `
      <div class="tree-item ${isSelected ? 'selected' : ''}" data-type="point" data-id="${pt.id}">
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
    } else if (c instanceof AngleConstraint) {
      valBadge = `<span class="val-badge">${c.targetAngle.toFixed(1)}°</span>`;
      name = 'Angle';
    } else if (c instanceof RadiusConstraint) {
      valBadge = c.displayMode === 'diameter'
        ? `<span class="val-badge">Ø ${(c.targetRadius * 2).toFixed(1)} mm</span>`
        : `<span class="val-badge">R ${c.targetRadius.toFixed(1)} mm</span>`;
      name = c.displayMode === 'diameter' ? 'Diameter' : 'Radius';
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
      case 'angle': return ICONS.angle;
      case 'radius': return ICONS.circle;
      case 'equal_length':
      case 'equal_radius': return ICONS.equal;
      case 'parallel': return ICONS.parallel;
      case 'perpendicular': return ICONS.perpendicular;
      case 'tangent_line_circle': return ICONS.tangent;
      case 'concentric': return ICONS.concentric;
      case 'point_on_line': return ICONS.pointOnLine;
      case 'point_on_circle': return ICONS.pointOnLine;
      case 'midpoint': return ICONS.midpoint;
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

        this.sketch.selectEntity(id, type, false);

        if (type === 'constraint') {
          const c = this.sketch.constraints.get(id);
          if (c && (c instanceof DistanceConstraint || c instanceof RadiusConstraint || c instanceof AngleConstraint)) {
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
          if (c && (c instanceof DistanceConstraint || c instanceof RadiusConstraint || c instanceof AngleConstraint)) {
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
  }
}

