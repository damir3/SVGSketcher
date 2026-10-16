import type { SketchDocument } from '../model/sketch';
import type { Viewport } from './viewport';
import {
  DistanceConstraint,
  RadiusConstraint,
  HorizontalConstraint,
  VerticalConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  EqualLengthConstraint,
  TangentLineCircleConstraint,
  FixedConstraint,
  CoincidentConstraint,
} from '../solver/constraints';
import type { Vec2 } from '../math/vector';

export interface RenderOptions {
  showGrid?: boolean;
  showConstraints?: boolean;
  showDimensions?: boolean;
}

export class SVGRenderer {
  private svg: SVGSVGElement;
  private defsEl: SVGDefsElement;
  private gridGroup: SVGGElement;
  private geometryGroup: SVGGElement;
  private constraintGroup: SVGGElement;
  private previewGroup: SVGGElement;
  private overlayGroup: SVGGElement;

  constructor(svgElement: SVGSVGElement) {
    this.svg = svgElement;
    this.svg.innerHTML = '';

    // Create defs for markers and filters
    this.defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    this.setupDefs();
    this.svg.appendChild(this.defsEl);

    this.gridGroup = this.createGroup('grid-layer');
    this.gridGroup.style.pointerEvents = 'none';

    this.geometryGroup = this.createGroup('geometry-layer');
    this.constraintGroup = this.createGroup('constraint-layer');

    this.previewGroup = this.createGroup('preview-layer');
    this.previewGroup.style.pointerEvents = 'none';

    this.overlayGroup = this.createGroup('overlay-layer');
    this.overlayGroup.style.pointerEvents = 'none';

    this.svg.appendChild(this.gridGroup);
    this.svg.appendChild(this.geometryGroup);
    this.svg.appendChild(this.constraintGroup);
    this.svg.appendChild(this.previewGroup);
    this.svg.appendChild(this.overlayGroup);
  }

  private createGroup(className: string): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    return g;
  }

  private setupDefs(): void {
    // Arrow marker for dimension lines
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'dim-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '5');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 0 1.5 L 10 5 L 0 8.5 z');
    path.setAttribute('fill', '#0284c7');
    marker.appendChild(path);
    this.defsEl.appendChild(marker);
  }

  render(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
    this.renderGrid(viewport, options.showGrid ?? true);
    this.renderGeometry(sketch, viewport);
    if (options.showConstraints !== false) {
      this.renderConstraints(sketch, viewport);
    }
  }

  private renderGrid(viewport: Viewport, showGrid: boolean): void {
    this.gridGroup.innerHTML = '';
    if (!showGrid) return;

    const { subStep } = viewport.getGridStep();
    const minWorld = viewport.screenToWorld(0, viewport.height);
    const maxWorld = viewport.screenToWorld(viewport.width, 0);

    const startX = Math.floor(minWorld.x / subStep) * subStep;
    const endX = Math.ceil(maxWorld.x / subStep) * subStep;
    const startY = Math.floor(minWorld.y / subStep) * subStep;
    const endY = Math.ceil(maxWorld.y / subStep) * subStep;

    const subStepPx = subStep * viewport.zoom;
    const showSubGrid = subStepPx >= 6;

    // 1. Minor grid lines (every subStep)
    let dMinor = '';
    // 2. Major grid lines (every step = 5 * subStep)
    let dMajor = '';

    for (let x = startX; x <= endX; x += subStep) {
      const s = viewport.worldToScreen(x, 0);
      const isMajor = Math.abs(Math.round(x / subStep) % 5) === 0;
      if (isMajor) {
        dMajor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;
      } else if (showSubGrid) {
        dMinor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;
      }
    }

    for (let y = startY; y <= endY; y += subStep) {
      const s = viewport.worldToScreen(0, y);
      const isMajor = Math.abs(Math.round(y / subStep) % 5) === 0;
      if (isMajor) {
        dMajor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;
      } else if (showSubGrid) {
        dMinor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;
      }
    }

    // Minor grid (subStep) - light subtle lines
    if (showSubGrid && dMinor) {
      const minorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      minorPath.setAttribute('d', dMinor);
      minorPath.setAttribute('stroke', 'rgba(0, 0, 0, 0.08)');
      minorPath.setAttribute('stroke-width', '0.75');
      minorPath.setAttribute('fill', 'none');
      this.gridGroup.appendChild(minorPath);
    }

    // Major grid (step = 5 * subStep) - distinct darker lines
    if (dMajor) {
      const majorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      majorPath.setAttribute('d', dMajor);
      majorPath.setAttribute('stroke', 'rgba(0, 0, 0, 0.20)');
      majorPath.setAttribute('stroke-width', '1.2');
      majorPath.setAttribute('fill', 'none');
      this.gridGroup.appendChild(majorPath);
    }

    // Origin Axes
    const origin = viewport.worldToScreen(0, 0);
    const originG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // X Axis (Red)
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', '0');
    xAxis.setAttribute('y1', origin.y.toString());
    xAxis.setAttribute('x2', viewport.width.toString());
    xAxis.setAttribute('y2', origin.y.toString());
    xAxis.setAttribute('stroke', 'rgba(220, 38, 38, 0.65)');
    xAxis.setAttribute('stroke-width', '1.5');
    originG.appendChild(xAxis);

    // Y Axis (Green)
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', origin.x.toString());
    yAxis.setAttribute('y1', '0');
    yAxis.setAttribute('x2', origin.x.toString());
    yAxis.setAttribute('y2', viewport.height.toString());
    yAxis.setAttribute('stroke', 'rgba(22, 163, 74, 0.65)');
    yAxis.setAttribute('stroke-width', '1.5');
    originG.appendChild(yAxis);

    // Origin marker ring
    const originDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    originDot.setAttribute('cx', origin.x.toString());
    originDot.setAttribute('cy', origin.y.toString());
    originDot.setAttribute('r', '5');
    originDot.setAttribute('fill', 'rgba(217, 119, 6, 0.15)');
    originDot.setAttribute('stroke', '#d97706');
    originDot.setAttribute('stroke-width', '2');
    originG.appendChild(originDot);

    this.gridGroup.appendChild(originG);
  }

  private renderGeometry(sketch: SketchDocument, viewport: Viewport): void {
    this.geometryGroup.innerHTML = '';

    const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
    const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';

    // Light Theme: Unconstrained is bold slate (#1e293b), fully constrained is green (#16a34a), conflict is red (#dc2626)
    const baseColor = hasConflict ? '#dc2626' : isFullyConstrained ? '#16a34a' : '#1e293b';
    const selectedColor = '#0284c7';

    // 1. Render Lines
    for (const line of sketch.lines.values()) {
      const p1 = sketch.points.get(line.p1Id);
      const p2 = sketch.points.get(line.p2Id);
      if (!p1 || !p2) continue;

      const s1 = viewport.worldToScreen(p1.x, p1.y);
      const s2 = viewport.worldToScreen(p2.x, p2.y);
      const isSelected = sketch.selection.lineIds.has(line.id);

      const lineG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      lineG.setAttribute('data-id', line.id);
      lineG.setAttribute('data-type', 'line');
      lineG.style.cursor = isSelected ? 'grab' : 'pointer';

      // Invisible generous hit target (18px wide)
      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('x1', s1.x.toFixed(1));
      hitLine.setAttribute('y1', s1.y.toFixed(1));
      hitLine.setAttribute('x2', s2.x.toFixed(1));
      hitLine.setAttribute('y2', s2.y.toFixed(1));
      hitLine.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
      hitLine.setAttribute('stroke-width', '18');
      hitLine.setAttribute('stroke-linecap', 'round');
      hitLine.setAttribute('pointer-events', 'stroke');
      hitLine.style.pointerEvents = 'stroke';
      lineG.appendChild(hitLine);

      // Visible line
      const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineEl.setAttribute('x1', s1.x.toFixed(1));
      lineEl.setAttribute('y1', s1.y.toFixed(1));
      lineEl.setAttribute('x2', s2.x.toFixed(1));
      lineEl.setAttribute('y2', s2.y.toFixed(1));
      lineEl.setAttribute('stroke', isSelected ? selectedColor : line.isConstruction ? '#64748b' : baseColor);
      lineEl.setAttribute('stroke-width', isSelected ? '3.5' : '2');
      lineEl.setAttribute('stroke-linecap', 'round');
      lineEl.setAttribute('pointer-events', 'stroke');
      lineEl.style.pointerEvents = 'stroke';

      if (line.isConstruction) {
        lineEl.setAttribute('stroke-dasharray', '6,6');
      }
      lineG.appendChild(lineEl);

      this.geometryGroup.appendChild(lineG);
    }

    // 2. Render Circles
    for (const circle of sketch.circles.values()) {
      const center = sketch.points.get(circle.centerId);
      if (!center) continue;

      const sc = viewport.worldToScreen(center.x, center.y);
      const sr = circle.radius * viewport.zoom;
      const isSelected = sketch.selection.circleIds.has(circle.id);

      const circleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      circleG.setAttribute('data-id', circle.id);
      circleG.setAttribute('data-type', 'circle');
      circleG.style.cursor = isSelected ? 'grab' : 'pointer';

      // Invisible generous hit target (18px stroke ring)
      const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitCircle.setAttribute('cx', sc.x.toFixed(1));
      hitCircle.setAttribute('cy', sc.y.toFixed(1));
      hitCircle.setAttribute('r', sr.toFixed(1));
      hitCircle.setAttribute('fill', 'none');
      hitCircle.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
      hitCircle.setAttribute('stroke-width', '18');
      hitCircle.setAttribute('pointer-events', 'stroke');
      hitCircle.style.pointerEvents = 'stroke';
      circleG.appendChild(hitCircle);

      // Visible circle
      const circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circleEl.setAttribute('cx', sc.x.toFixed(1));
      circleEl.setAttribute('cy', sc.y.toFixed(1));
      circleEl.setAttribute('r', sr.toFixed(1));
      circleEl.setAttribute('fill', 'none');
      circleEl.setAttribute('stroke', isSelected ? selectedColor : circle.isConstruction ? '#64748b' : baseColor);
      circleEl.setAttribute('stroke-width', isSelected ? '3.5' : '2');
      circleEl.setAttribute('pointer-events', 'stroke');
      circleEl.style.pointerEvents = 'stroke';

      if (circle.isConstruction) {
        circleEl.setAttribute('stroke-dasharray', '6,6');
      }
      circleG.appendChild(circleEl);

      this.geometryGroup.appendChild(circleG);
    }

    // 3. Render Points (Vertices)
    for (const pt of sketch.points.values()) {
      const s = viewport.worldToScreen(pt.x, pt.y);
      const isSelected = sketch.selection.pointIds.has(pt.id);

      const ptG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ptG.setAttribute('data-id', pt.id);
      ptG.setAttribute('data-type', 'point');
      ptG.style.cursor = isSelected ? 'grab' : 'pointer';

      // Invisible larger hit target for easy clicking
      const hitTarget = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitTarget.setAttribute('cx', s.x.toFixed(1));
      hitTarget.setAttribute('cy', s.y.toFixed(1));
      hitTarget.setAttribute('r', '14');
      hitTarget.setAttribute('fill', 'rgba(0, 0, 0, 0.001)');
      hitTarget.setAttribute('pointer-events', 'all');
      hitTarget.style.pointerEvents = 'all';
      hitTarget.style.cursor = isSelected ? 'grab' : 'pointer';
      ptG.appendChild(hitTarget);

      // Visible point handle
      const pointEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pointEl.setAttribute('cx', s.x.toFixed(1));
      pointEl.setAttribute('cy', s.y.toFixed(1));
      pointEl.setAttribute('r', isSelected ? '6' : '4.5');
      pointEl.setAttribute('pointer-events', 'all');
      pointEl.style.pointerEvents = 'all';
      pointEl.style.cursor = isSelected ? 'grab' : 'pointer';

      let fillColor = '#0284c7'; // Default interactive CAD vertex color
      let strokeColor = '#ffffff';

      if (pt.fixed) {
        fillColor = '#d97706'; // Fixed points highlighted amber
      } else if (isFullyConstrained) {
        fillColor = '#16a34a'; // Fully defined
      }

      if (isSelected) {
        fillColor = '#0ea5e9';
        strokeColor = '#0f172a';
      }

      pointEl.setAttribute('fill', fillColor);
      pointEl.setAttribute('stroke', strokeColor);
      pointEl.setAttribute('stroke-width', '2');
      ptG.appendChild(pointEl);

      this.geometryGroup.appendChild(ptG);
    }
  }

  private renderConstraints(sketch: SketchDocument, viewport: Viewport): void {
    this.constraintGroup.innerHTML = '';

    for (const constraint of sketch.constraints.values()) {
      const isSelected = sketch.selection.constraintIds.has(constraint.id);

      if (constraint instanceof DistanceConstraint) {
        this.renderDistanceDimension(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof RadiusConstraint) {
        this.renderRadiusDimension(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof HorizontalConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, 'H', isSelected);
      } else if (constraint instanceof VerticalConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, 'V', isSelected);
      } else if (constraint instanceof ParallelConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, '//', isSelected);
      } else if (constraint instanceof PerpendicularConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, '⊥', isSelected);
      } else if (constraint instanceof EqualLengthConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, '=', isSelected);
      } else if (constraint instanceof TangentLineCircleConstraint) {
        this.renderBadgeOnLine(constraint, sketch, viewport, '⟂O', isSelected);
      } else if (constraint instanceof FixedConstraint) {
        this.renderFixedBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof CoincidentConstraint) {
        this.renderCoincidentBadge(constraint, sketch, viewport, isSelected);
      }
    }
  }

  private renderDistanceDimension(
    constraint: DistanceConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const p1 = sketch.points.get(constraint.p1Id);
    const p2 = sketch.points.get(constraint.p2Id);
    if (!p1 || !p2) return;

    const s1 = viewport.worldToScreen(p1.x, p1.y);
    const s2 = viewport.worldToScreen(p2.x, p2.y);

    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;

    // Normal vector perpendicular to the line (offset dimension line by 32px)
    const nx = -dy / len;
    const ny = dx / len;
    const offset = 32;

    const d1 = { x: s1.x + nx * offset, y: s1.y + ny * offset };
    const d2 = { x: s2.x + nx * offset, y: s2.y + ny * offset };
    const mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dimension-item');
    g.setAttribute('data-id', constraint.id);
    g.setAttribute('data-type', 'constraint');
    g.style.cursor = 'pointer';

    const color = isSelected ? '#0ea5e9' : '#0284c7';

    // Extension lines from points
    const extLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    extLine1.setAttribute('x1', s1.x.toFixed(1));
    extLine1.setAttribute('y1', s1.y.toFixed(1));
    extLine1.setAttribute('x2', (d1.x + nx * 5).toFixed(1));
    extLine1.setAttribute('y2', (d1.y + ny * 5).toFixed(1));
    extLine1.setAttribute('stroke', 'rgba(2, 132, 199, 0.45)');
    extLine1.setAttribute('stroke-width', '1');
    g.appendChild(extLine1);

    const extLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    extLine2.setAttribute('x1', s2.x.toFixed(1));
    extLine2.setAttribute('y1', s2.y.toFixed(1));
    extLine2.setAttribute('x2', (d2.x + nx * 5).toFixed(1));
    extLine2.setAttribute('y2', (d2.y + ny * 5).toFixed(1));
    extLine2.setAttribute('stroke', 'rgba(2, 132, 199, 0.45)');
    extLine2.setAttribute('stroke-width', '1');
    g.appendChild(extLine2);

    // Dimension line with arrowheads
    const dimLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    dimLine.setAttribute('x1', d1.x.toFixed(1));
    dimLine.setAttribute('y1', d1.y.toFixed(1));
    dimLine.setAttribute('x2', d2.x.toFixed(1));
    dimLine.setAttribute('y2', d2.y.toFixed(1));
    dimLine.setAttribute('stroke', color);
    dimLine.setAttribute('stroke-width', '1.5');
    dimLine.setAttribute('marker-start', 'url(#dim-arrow)');
    dimLine.setAttribute('marker-end', 'url(#dim-arrow)');
    g.appendChild(dimLine);

    // Text label badge with background
    const textVal = `${constraint.targetDistance.toFixed(1)}`;
    const textLen = textVal.length * 8 + 14;

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', (mid.x - textLen * 0.5).toFixed(1));
    bgRect.setAttribute('y', (mid.y - 10).toFixed(1));
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#ffffff');
    bgRect.setAttribute('stroke', color);
    bgRect.setAttribute('stroke-width', isSelected ? '2' : '1');
    g.appendChild(bgRect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', mid.x.toFixed(1));
    text.setAttribute('y', (mid.y + 4).toFixed(1));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', '600');
    text.setAttribute('font-family', 'monospace');
    text.textContent = textVal;
    g.appendChild(text);

    this.constraintGroup.appendChild(g);
  }

  private renderRadiusDimension(
    constraint: RadiusConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const circle = sketch.circles.get(constraint.circleId);
    if (!circle) return;
    const center = sketch.points.get(circle.centerId);
    if (!center) return;

    const sc = viewport.worldToScreen(center.x, center.y);
    const sr = circle.radius * viewport.zoom;

    // Leader at 45 degree angle
    const angleRad = Math.PI / 4;
    const edge = {
      x: sc.x + Math.cos(angleRad) * sr,
      y: sc.y - Math.sin(angleRad) * sr,
    };
    const tip = {
      x: edge.x + 30,
      y: edge.y - 20,
    };

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dimension-item');
    g.setAttribute('data-id', constraint.id);
    g.setAttribute('data-type', 'constraint');
    g.style.cursor = 'pointer';

    const color = isSelected ? '#0ea5e9' : '#0284c7';

    // Leader line
    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    leader.setAttribute('points', `${sc.x.toFixed(1)},${sc.y.toFixed(1)} ${edge.x.toFixed(1)},${edge.y.toFixed(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)}`);
    leader.setAttribute('stroke', color);
    leader.setAttribute('stroke-width', '1.5');
    leader.setAttribute('fill', 'none');
    leader.setAttribute('marker-end', 'url(#dim-arrow)');
    g.appendChild(leader);

    const textVal = `R ${constraint.targetRadius.toFixed(1)}`;
    const textLen = textVal.length * 8 + 14;

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', tip.x.toFixed(1));
    bgRect.setAttribute('y', (tip.y - 12).toFixed(1));
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#ffffff');
    bgRect.setAttribute('stroke', color);
    bgRect.setAttribute('stroke-width', isSelected ? '2' : '1');
    g.appendChild(bgRect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', (tip.x + textLen * 0.5).toFixed(1));
    text.setAttribute('y', (tip.y + 3).toFixed(1));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', '600');
    text.setAttribute('font-family', 'monospace');
    text.textContent = textVal;
    g.appendChild(text);

    this.constraintGroup.appendChild(g);
  }

  private renderBadgeOnLine(
    constraint: any,
    sketch: SketchDocument,
    viewport: Viewport,
    label: string,
    isSelected: boolean
  ): void {
    const p1Id = constraint.p1Id ?? constraint.l1P1 ?? constraint.line1P1 ?? constraint.lineP1Id;
    const p2Id = constraint.p2Id ?? constraint.l1P2 ?? constraint.line1P2 ?? constraint.lineP2Id;
    if (!p1Id || !p2Id) return;

    const p1 = sketch.points.get(p1Id);
    const p2 = sketch.points.get(p2Id);
    if (!p1 || !p2) return;

    const s1 = viewport.worldToScreen(p1.x, p1.y);
    const s2 = viewport.worldToScreen(p2.x, p2.y);
    const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 };

    this.renderConstraintBadge(constraint.id, mid.x, mid.y - 12, label, isSelected);
  }

  private renderFixedBadge(
    constraint: FixedConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.pointId);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x + 12, s.y - 12, '⚓', isSelected, '#d97706');
  }

  private renderCoincidentBadge(
    constraint: CoincidentConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.p1Id);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x - 12, s.y - 12, '●', isSelected, '#0284c7');
  }

  private renderConstraintBadge(
    id: string,
    x: number,
    y: number,
    label: string,
    isSelected: boolean,
    customColor?: string
  ): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'constraint-badge');
    g.setAttribute('data-id', id);
    g.setAttribute('data-type', 'constraint');
    g.style.cursor = 'pointer';

    const color = isSelected ? '#0284c7' : customColor ?? '#475569';
    const width = Math.max(18, label.length * 8 + 8);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (x - width * 0.5).toFixed(1));
    rect.setAttribute('y', (y - 9).toFixed(1));
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', isSelected ? '#e0f2fe' : '#ffffff');
    rect.setAttribute('stroke', isSelected ? '#0284c7' : '#cbd5e1');
    rect.setAttribute('stroke-width', isSelected ? '1.5' : '1');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x.toFixed(1));
    text.setAttribute('y', (y + 4).toFixed(1));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', isSelected ? '#0284c7' : color);
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', 'sans-serif');
    text.textContent = label;
    g.appendChild(text);

    this.constraintGroup.appendChild(g);
  }

  // Live drawing previews
  renderLinePreview(s1: Vec2, s2: Vec2, len: number, angleDeg: number): void {
    this.previewGroup.innerHTML = '';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', s1.x.toFixed(1));
    line.setAttribute('y1', s1.y.toFixed(1));
    line.setAttribute('x2', s2.x.toFixed(1));
    line.setAttribute('y2', s2.y.toFixed(1));
    line.setAttribute('stroke', '#0284c7');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4,4');
    this.previewGroup.appendChild(line);

    // Length & Angle Tooltip
    const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
    const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°`;
    this.renderTooltip(mid.x, mid.y, label);
  }

  renderCirclePreview(center: Vec2, current: Vec2, radius: number): void {
    this.previewGroup.innerHTML = '';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', center.x.toFixed(1));
    circle.setAttribute('cy', center.y.toFixed(1));
    const rPx = Math.hypot(current.x - center.x, current.y - center.y);
    circle.setAttribute('r', rPx.toFixed(1));
    circle.setAttribute('stroke', '#0284c7');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('stroke-dasharray', '4,4');
    circle.setAttribute('fill', 'none');
    this.previewGroup.appendChild(circle);

    const radiusLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    radiusLine.setAttribute('x1', center.x.toFixed(1));
    radiusLine.setAttribute('y1', center.y.toFixed(1));
    radiusLine.setAttribute('x2', current.x.toFixed(1));
    radiusLine.setAttribute('y2', current.y.toFixed(1));
    radiusLine.setAttribute('stroke', '#0284c7');
    radiusLine.setAttribute('stroke-width', '1');
    radiusLine.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(radiusLine);

    this.renderTooltip(current.x + 12, current.y - 12, `R ${radius.toFixed(1)} mm`);
  }

  renderRectanglePreview(s1: Vec2, s2: Vec2, w: number, h: number): void {
    this.previewGroup.innerHTML = '';

    const rx = Math.min(s1.x, s2.x);
    const ry = Math.min(s1.y, s2.y);
    const rw = Math.abs(s2.x - s1.x);
    const rh = Math.abs(s2.y - s1.y);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', rx.toFixed(1));
    rect.setAttribute('y', ry.toFixed(1));
    rect.setAttribute('width', rw.toFixed(1));
    rect.setAttribute('height', rh.toFixed(1));
    rect.setAttribute('stroke', '#0284c7');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', '4,4');
    rect.setAttribute('fill', 'rgba(2, 132, 199, 0.06)');
    this.previewGroup.appendChild(rect);

    this.renderTooltip(s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
  }

  renderSnapIndicator(s: Vec2): void {
    this.overlayGroup.innerHTML = '';
    const snapRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    snapRing.setAttribute('cx', s.x.toFixed(1));
    snapRing.setAttribute('cy', s.y.toFixed(1));
    snapRing.setAttribute('r', '8');
    snapRing.setAttribute('fill', 'rgba(2, 132, 199, 0.12)');
    snapRing.setAttribute('stroke', '#0284c7');
    snapRing.setAttribute('stroke-width', '2');
    snapRing.setAttribute('pointer-events', 'none');
    snapRing.style.pointerEvents = 'none';
    this.overlayGroup.appendChild(snapRing);
  }

  renderDragLine(s1: Vec2, s2: Vec2): void {
    this.overlayGroup.innerHTML = '';

    // Initial origin anchor dot
    const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    anchor.setAttribute('cx', s1.x.toFixed(1));
    anchor.setAttribute('cy', s1.y.toFixed(1));
    anchor.setAttribute('r', '4');
    anchor.setAttribute('fill', '#0284c7');
    anchor.setAttribute('stroke', '#ffffff');
    anchor.setAttribute('stroke-width', '1.5');
    anchor.setAttribute('pointer-events', 'none');
    anchor.style.pointerEvents = 'none';
    this.overlayGroup.appendChild(anchor);

    // Dashed displacement line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', s1.x.toFixed(1));
    line.setAttribute('y1', s1.y.toFixed(1));
    line.setAttribute('x2', s2.x.toFixed(1));
    line.setAttribute('y2', s2.y.toFixed(1));
    line.setAttribute('stroke', '#0284c7');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4,4');
    line.setAttribute('pointer-events', 'none');
    line.style.pointerEvents = 'none';
    this.overlayGroup.appendChild(line);
  }

  clearPreviews(): void {
    this.previewGroup.innerHTML = '';
    this.overlayGroup.innerHTML = '';
  }

  private renderTooltip(x: number, y: number, textStr: string): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const width = textStr.length * 7.5 + 14;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (x - width * 0.5).toFixed(1));
    rect.setAttribute('y', (y - 11).toFixed(1));
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', '22');
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', '#0f172a');
    rect.setAttribute('stroke', '#0284c7');
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x.toFixed(1));
    text.setAttribute('y', (y + 4).toFixed(1));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '500');
    text.setAttribute('font-family', 'monospace');
    text.textContent = textStr;
    g.appendChild(text);

    this.previewGroup.appendChild(g);
  }
}
