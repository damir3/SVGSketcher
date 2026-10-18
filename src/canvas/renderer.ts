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
  EqualRadiusConstraint,
  TangentLineCircleConstraint,
  ConcentricConstraint,
  MidpointConstraint,
  PointOnLineConstraint,
  PointOnCircleConstraint,
  FixedConstraint,
  CoincidentConstraint,
  AngleConstraint,
} from '../solver/constraints';
import { type Vec2, dist, projectPointOntoSegment } from '../math/vector';
import { getBadgeIcon } from './badgeIcons';

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
  private pointGroup: SVGGElement;
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
    this.pointGroup = this.createGroup('point-layer');

    this.previewGroup = this.createGroup('preview-layer');
    this.previewGroup.style.pointerEvents = 'none';

    this.overlayGroup = this.createGroup('overlay-layer');
    this.overlayGroup.style.pointerEvents = 'none';

    this.svg.appendChild(this.gridGroup);
    this.svg.appendChild(this.geometryGroup);
    this.svg.appendChild(this.constraintGroup);
    this.svg.appendChild(this.pointGroup);
    this.svg.appendChild(this.previewGroup);
    this.svg.appendChild(this.overlayGroup);
  }

  private createGroup(className: string): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    return g;
  }

  private setupDefs(): void {
    const createArrowMarker = (id: string, color: string) => {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 12.5 10');
      marker.setAttribute('refX', '12.5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '7.5');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 0 1.5 L 12.5 5 L 0 8.5 z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      this.defsEl.appendChild(marker);
    };

    createArrowMarker('dim-arrow', '#0284c7');
    createArrowMarker('dim-arrow-selected', '#0ea5e9');
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

    const { step, subStep } = viewport.getGridStep();
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

    const origin = viewport.worldToScreen(0, 0);
    const axisY = Math.max(8, Math.min(viewport.height - 40, origin.y));
    const axisX = Math.max(8, Math.min(viewport.width - 30, origin.x));

    const labelsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelsG.setAttribute('class', 'grid-labels');

    for (let x = startX; x <= endX; x += subStep) {
      const s = viewport.worldToScreen(x, 0);
      const isMajor = Math.abs(Math.round(x / subStep) % 5) === 0;
      if (isMajor) {
        dMajor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;

        const cleanVal = parseFloat((Math.round(x / step) * step).toFixed(6));
        if (Math.abs(cleanVal) > 1e-4) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const anchorX = s.x;
          const anchorY = axisY + 4;
          text.setAttribute('x', anchorX.toFixed(1));
          text.setAttribute('y', anchorY.toFixed(1));
          text.setAttribute('transform', `rotate(-90 ${anchorX.toFixed(1)} ${anchorY.toFixed(1)})`);
          text.setAttribute('text-anchor', 'end');
          text.setAttribute('dominant-baseline', 'central');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif");
          text.setAttribute('fill', 'rgba(0, 0, 0, 0.6)');
          text.setAttribute('paint-order', 'stroke fill');
          text.setAttribute('stroke', '#ffffff');
          text.setAttribute('stroke-width', '3');
          text.setAttribute('stroke-linejoin', 'round');
          text.textContent = cleanVal.toString();
          labelsG.appendChild(text);
        }
      } else if (showSubGrid) {
        dMinor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;
      }
    }

    for (let y = startY; y <= endY; y += subStep) {
      const s = viewport.worldToScreen(0, y);
      const isMajor = Math.abs(Math.round(y / subStep) % 5) === 0;
      if (isMajor) {
        dMajor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;

        const cleanVal = parseFloat((Math.round(y / step) * step).toFixed(6));
        if (Math.abs(cleanVal) > 1e-4) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const posX = axisX + 8;
          const posY = s.y;
          text.setAttribute('x', posX.toFixed(1));
          text.setAttribute('y', posY.toFixed(1));
          text.setAttribute('text-anchor', 'start');
          text.setAttribute('dominant-baseline', 'central');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif");
          text.setAttribute('fill', 'rgba(0, 0, 0, 0.6)');
          text.setAttribute('paint-order', 'stroke fill');
          text.setAttribute('stroke', '#ffffff');
          text.setAttribute('stroke-width', '3');
          text.setAttribute('stroke-linejoin', 'round');
          text.textContent = cleanVal.toString();
          labelsG.appendChild(text);
        }
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

    // Coordinate labels
    this.gridGroup.appendChild(labelsG);

    // Origin Axes
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

    // Origin marker target (CAD surveyor style matching reference image)
    const r = 8;
    const q1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    q1.setAttribute('d', `M ${origin.x} ${origin.y} L ${origin.x + r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y - r} Z`);
    q1.setAttribute('fill', 'rgba(100, 116, 139, 0.45)');
    originG.appendChild(q1);

    const q3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    q3.setAttribute('d', `M ${origin.x} ${origin.y} L ${origin.x - r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y + r} Z`);
    q3.setAttribute('fill', 'rgba(100, 116, 139, 0.45)');
    originG.appendChild(q3);

    const originRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    originRing.setAttribute('cx', origin.x.toString());
    originRing.setAttribute('cy', origin.y.toString());
    originRing.setAttribute('r', r.toString());
    originRing.setAttribute('fill', 'none');
    originRing.setAttribute('stroke', '#64748b');
    originRing.setAttribute('stroke-width', '1.5');
    originG.appendChild(originRing);

    this.gridGroup.appendChild(originG);
  }

  private renderGeometry(sketch: SketchDocument, viewport: Viewport): void {
    this.geometryGroup.innerHTML = '';
    this.pointGroup.innerHTML = '';

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
      lineG.setAttribute('class', `sketch-entity sketch-line ${isSelected ? 'is-selected' : ''}`);

      // Invisible generous hit target (18px wide)
      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('class', 'hit-area');
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
      lineEl.setAttribute('class', 'entity-visible visible-primitive');
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
      circleG.setAttribute('class', `sketch-entity sketch-circle ${isSelected ? 'is-selected' : ''}`);

      // Invisible generous hit target (18px stroke ring)
      const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitCircle.setAttribute('class', 'hit-area');
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
      circleEl.setAttribute('class', 'entity-visible visible-primitive');
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

    // 3. Render Arcs
    for (const arc of sketch.arcs.values()) {
      const center = sketch.points.get(arc.centerId);
      const start = sketch.points.get(arc.startPointId);
      const end = sketch.points.get(arc.endPointId);
      if (!center || !start || !end) continue;

      const sc = viewport.worldToScreen(center.x, center.y);
      const ss = viewport.worldToScreen(start.x, start.y);
      const se = viewport.worldToScreen(end.x, end.y);
      const sr = arc.radius * viewport.zoom;
      const isSelected = sketch.selection.arcIds.has(arc.id);

      const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
      const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
      const clockwise = !!arc.clockwise;

      let sweepAngle = 0;
      let sweepFlag = 0;
      if (clockwise) {
        sweepAngle = (ae - as) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sweepFlag = 1;
      } else {
        sweepAngle = (as - ae) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sweepFlag = 0;
      }
      const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;

      const d = `M ${ss.x.toFixed(1)} ${ss.y.toFixed(1)} A ${sr.toFixed(1)} ${sr.toFixed(1)} 0 ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(1)} ${se.y.toFixed(1)}`;

      const arcG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      arcG.setAttribute('data-id', arc.id);
      arcG.setAttribute('data-type', 'arc');
      arcG.setAttribute('class', `sketch-entity sketch-arc ${isSelected ? 'is-selected' : ''}`);

      // Invisible generous hit target (18px stroke)
      const hitArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitArc.setAttribute('class', 'hit-area');
      hitArc.setAttribute('d', d);
      hitArc.setAttribute('fill', 'none');
      hitArc.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
      hitArc.setAttribute('stroke-width', '18');
      hitArc.setAttribute('stroke-linecap', 'round');
      hitArc.setAttribute('pointer-events', 'stroke');
      hitArc.style.pointerEvents = 'stroke';
      arcG.appendChild(hitArc);

      // Visible arc path
      const arcEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arcEl.setAttribute('class', 'entity-visible visible-primitive');
      arcEl.setAttribute('d', d);
      arcEl.setAttribute('fill', 'none');
      arcEl.setAttribute('stroke', isSelected ? selectedColor : arc.isConstruction ? '#64748b' : baseColor);
      arcEl.setAttribute('stroke-width', isSelected ? '3.5' : '2');
      arcEl.setAttribute('stroke-linecap', 'round');
      arcEl.setAttribute('pointer-events', 'stroke');
      arcEl.style.pointerEvents = 'stroke';

      if (arc.isConstruction) {
        arcEl.setAttribute('stroke-dasharray', '6,6');
      }
      arcG.appendChild(arcEl);

      // Light dashed radial lines to center if selected
      if (isSelected) {
        const rad1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rad1.setAttribute('x1', sc.x.toFixed(1));
        rad1.setAttribute('y1', sc.y.toFixed(1));
        rad1.setAttribute('x2', ss.x.toFixed(1));
        rad1.setAttribute('y2', ss.y.toFixed(1));
        rad1.setAttribute('stroke', '#0284c7');
        rad1.setAttribute('stroke-width', '1');
        rad1.setAttribute('stroke-dasharray', '3,3');
        arcG.appendChild(rad1);

        const rad2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rad2.setAttribute('x1', sc.x.toFixed(1));
        rad2.setAttribute('y1', sc.y.toFixed(1));
        rad2.setAttribute('x2', se.x.toFixed(1));
        rad2.setAttribute('y2', se.y.toFixed(1));
        rad2.setAttribute('stroke', '#0284c7');
        rad2.setAttribute('stroke-width', '1');
        rad2.setAttribute('stroke-dasharray', '3,3');
        arcG.appendChild(rad2);
      }

      this.geometryGroup.appendChild(arcG);
    }

    // 4. Render Ellipses
    for (const ellipse of sketch.ellipses.values()) {
      const center = sketch.points.get(ellipse.centerId);
      const majorPt = sketch.points.get(ellipse.majorAxisPointId);
      const minorPt = sketch.points.get(ellipse.minorAxisPointId);
      if (!center || !majorPt || !minorPt) continue;

      const sc = viewport.worldToScreen(center.x, center.y);
      const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
      const smin = viewport.worldToScreen(minorPt.x, minorPt.y);

      const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
      const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
      if (rx < 0.1 || ry < 0.1) continue;

      const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
      const isSelected = sketch.selection.ellipseIds.has(ellipse.id);

      const ellipseG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ellipseG.setAttribute('data-id', ellipse.id);
      ellipseG.setAttribute('data-type', 'ellipse');
      ellipseG.setAttribute('class', `sketch-entity sketch-ellipse ${isSelected ? 'is-selected' : ''}`);

      // Invisible generous hit target (18px stroke)
      const hitEllipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      hitEllipse.setAttribute('class', 'hit-area');
      hitEllipse.setAttribute('cx', sc.x.toFixed(1));
      hitEllipse.setAttribute('cy', sc.y.toFixed(1));
      hitEllipse.setAttribute('rx', rx.toFixed(1));
      hitEllipse.setAttribute('ry', ry.toFixed(1));
      hitEllipse.setAttribute('transform', `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`);
      hitEllipse.setAttribute('fill', 'none');
      hitEllipse.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
      hitEllipse.setAttribute('stroke-width', '18');
      hitEllipse.setAttribute('pointer-events', 'stroke');
      hitEllipse.style.pointerEvents = 'stroke';
      ellipseG.appendChild(hitEllipse);

      // Visible ellipse
      const ellipseEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipseEl.setAttribute('class', 'entity-visible visible-primitive');
      ellipseEl.setAttribute('cx', sc.x.toFixed(1));
      ellipseEl.setAttribute('cy', sc.y.toFixed(1));
      ellipseEl.setAttribute('rx', rx.toFixed(1));
      ellipseEl.setAttribute('ry', ry.toFixed(1));
      ellipseEl.setAttribute('transform', `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`);
      ellipseEl.setAttribute('fill', 'none');
      ellipseEl.setAttribute('stroke', isSelected ? selectedColor : ellipse.isConstruction ? '#64748b' : baseColor);
      ellipseEl.setAttribute('stroke-width', isSelected ? '3.5' : '2');
      ellipseEl.setAttribute('pointer-events', 'stroke');
      ellipseEl.style.pointerEvents = 'stroke';

      if (ellipse.isConstruction) {
        ellipseEl.setAttribute('stroke-dasharray', '6,6');
      }
      ellipseG.appendChild(ellipseEl);

      // Subtle dashed conjugate axes if selected
      if (isSelected) {
        const ax1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ax1.setAttribute('x1', sc.x.toFixed(1));
        ax1.setAttribute('y1', sc.y.toFixed(1));
        ax1.setAttribute('x2', smaj.x.toFixed(1));
        ax1.setAttribute('y2', smaj.y.toFixed(1));
        ax1.setAttribute('stroke', '#0284c7');
        ax1.setAttribute('stroke-width', '1');
        ax1.setAttribute('stroke-dasharray', '3,3');
        ellipseG.appendChild(ax1);

        const ax2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ax2.setAttribute('x1', sc.x.toFixed(1));
        ax2.setAttribute('y1', sc.y.toFixed(1));
        ax2.setAttribute('x2', smin.x.toFixed(1));
        ax2.setAttribute('y2', smin.y.toFixed(1));
        ax2.setAttribute('stroke', '#0284c7');
        ax2.setAttribute('stroke-width', '1');
        ax2.setAttribute('stroke-dasharray', '3,3');
        ellipseG.appendChild(ax2);
      }

      this.geometryGroup.appendChild(ellipseG);
    }

    // 5. Render Elliptical Arcs
    for (const arc of sketch.ellipticalArcs.values()) {
      const center = sketch.points.get(arc.centerId);
      const majorPt = sketch.points.get(arc.majorAxisPointId);
      const minorPt = sketch.points.get(arc.minorAxisPointId);
      const startPt = sketch.points.get(arc.startPointId);
      const endPt = sketch.points.get(arc.endPointId);
      if (!center || !majorPt || !minorPt || !startPt || !endPt) continue;

      const sc = viewport.worldToScreen(center.x, center.y);
      const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
      const smin = viewport.worldToScreen(minorPt.x, minorPt.y);
      const ss = viewport.worldToScreen(startPt.x, startPt.y);
      const se = viewport.worldToScreen(endPt.x, endPt.y);

      const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
      const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
      if (rx < 0.1 || ry < 0.1) continue;

      const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
      const thetaDeg = (theta * 180) / Math.PI;

      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      const vx = -Math.sin(theta);
      const vy = Math.cos(theta);

      const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
      const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
      const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
      const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

      const ts = Math.atan2(vs / ry, us / rx);
      const te = Math.atan2(ve / ry, ue / rx);

      const clockwise = !!arc.clockwise;
      let sweepAngle = 0;
      let sweepFlag = 0;
      if (clockwise) {
        sweepAngle = (te - ts) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sweepFlag = 1;
      } else {
        sweepAngle = (ts - te) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sweepFlag = 0;
      }
      const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;

      const d = `M ${ss.x.toFixed(1)} ${ss.y.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} ${thetaDeg.toFixed(2)} ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(1)} ${se.y.toFixed(1)}`;
      const isSelected = sketch.selection.ellipticalArcIds.has(arc.id);

      const arcG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      arcG.setAttribute('data-id', arc.id);
      arcG.setAttribute('data-type', 'elliptical_arc');
      arcG.setAttribute('class', `sketch-entity sketch-elliptical-arc ${isSelected ? 'is-selected' : ''}`);

      // Invisible generous hit target (18px stroke)
      const hitArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitArc.setAttribute('class', 'hit-area');
      hitArc.setAttribute('d', d);
      hitArc.setAttribute('fill', 'none');
      hitArc.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
      hitArc.setAttribute('stroke-width', '18');
      hitArc.setAttribute('stroke-linecap', 'round');
      hitArc.setAttribute('pointer-events', 'stroke');
      hitArc.style.pointerEvents = 'stroke';
      arcG.appendChild(hitArc);

      // Visible arc path
      const arcEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arcEl.setAttribute('class', 'entity-visible visible-primitive');
      arcEl.setAttribute('d', d);
      arcEl.setAttribute('fill', 'none');
      arcEl.setAttribute('stroke', isSelected ? selectedColor : arc.isConstruction ? '#64748b' : baseColor);
      arcEl.setAttribute('stroke-width', isSelected ? '3.5' : '2');
      arcEl.setAttribute('stroke-linecap', 'round');
      arcEl.setAttribute('pointer-events', 'stroke');
      arcEl.style.pointerEvents = 'stroke';

      if (arc.isConstruction) {
        arcEl.setAttribute('stroke-dasharray', '6,6');
      }
      arcG.appendChild(arcEl);

      // Light dashed radial lines to center and axes if selected
      if (isSelected) {
        const rad1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rad1.setAttribute('x1', sc.x.toFixed(1));
        rad1.setAttribute('y1', sc.y.toFixed(1));
        rad1.setAttribute('x2', ss.x.toFixed(1));
        rad1.setAttribute('y2', ss.y.toFixed(1));
        rad1.setAttribute('stroke', '#0284c7');
        rad1.setAttribute('stroke-width', '1');
        rad1.setAttribute('stroke-dasharray', '3,3');
        arcG.appendChild(rad1);

        const rad2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rad2.setAttribute('x1', sc.x.toFixed(1));
        rad2.setAttribute('y1', sc.y.toFixed(1));
        rad2.setAttribute('x2', se.x.toFixed(1));
        rad2.setAttribute('y2', se.y.toFixed(1));
        rad2.setAttribute('stroke', '#0284c7');
        rad2.setAttribute('stroke-width', '1');
        rad2.setAttribute('stroke-dasharray', '3,3');
        arcG.appendChild(rad2);

        const ax1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ax1.setAttribute('x1', sc.x.toFixed(1));
        ax1.setAttribute('y1', sc.y.toFixed(1));
        ax1.setAttribute('x2', smaj.x.toFixed(1));
        ax1.setAttribute('y2', smaj.y.toFixed(1));
        ax1.setAttribute('stroke', '#0284c7');
        ax1.setAttribute('stroke-width', '1');
        ax1.setAttribute('stroke-dasharray', '2,2');
        arcG.appendChild(ax1);

        const ax2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ax2.setAttribute('x1', sc.x.toFixed(1));
        ax2.setAttribute('y1', sc.y.toFixed(1));
        ax2.setAttribute('x2', smin.x.toFixed(1));
        ax2.setAttribute('y2', smin.y.toFixed(1));
        ax2.setAttribute('stroke', '#0284c7');
        ax2.setAttribute('stroke-width', '1');
        ax2.setAttribute('stroke-dasharray', '2,2');
        arcG.appendChild(ax2);
      }

      this.geometryGroup.appendChild(arcG);
    }

    // 6. Render Points (Vertices)
    for (const pt of sketch.points.values()) {
      const s = viewport.worldToScreen(pt.x, pt.y);
      const isSelected = sketch.selection.pointIds.has(pt.id);

      const ptG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ptG.setAttribute('data-id', pt.id);
      ptG.setAttribute('data-type', 'point');
      ptG.setAttribute('class', `sketch-entity sketch-point ${isSelected ? 'is-selected' : ''}`);

      // Invisible larger hit target for easy clicking
      const hitTarget = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitTarget.setAttribute('class', 'hit-area');
      hitTarget.setAttribute('cx', s.x.toFixed(1));
      hitTarget.setAttribute('cy', s.y.toFixed(1));
      hitTarget.setAttribute('r', '14');
      hitTarget.setAttribute('fill', 'rgba(0, 0, 0, 0.001)');
      hitTarget.setAttribute('pointer-events', 'all');
      hitTarget.style.pointerEvents = 'all';
      ptG.appendChild(hitTarget);

      // Visible point handle
      const pointEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pointEl.setAttribute('class', 'entity-visible visible-point');
      pointEl.setAttribute('cx', s.x.toFixed(1));
      pointEl.setAttribute('cy', s.y.toFixed(1));
      pointEl.setAttribute('r', isSelected ? '4.5' : '3.5');
      pointEl.setAttribute('pointer-events', 'all');
      pointEl.style.pointerEvents = 'all';

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

      this.pointGroup.appendChild(ptG);
    }
  }

  private renderConstraints(sketch: SketchDocument, viewport: Viewport): void {
    this.constraintGroup.innerHTML = '';
    const lineBadgeCounts = new Map<string, number>();

    for (const constraint of sketch.constraints.values()) {
      const isSelected = sketch.selection.constraintIds.has(constraint.id);

      if (constraint instanceof DistanceConstraint) {
        this.renderDistanceDimension(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof RadiusConstraint) {
        this.renderRadiusDimension(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof HorizontalConstraint) {
        this.renderBadgeOnSegment(constraint.id, constraint.p1Id, constraint.p2Id, sketch, viewport, 'H', isSelected, lineBadgeCounts);
      } else if (constraint instanceof VerticalConstraint) {
        this.renderBadgeOnSegment(constraint.id, constraint.p1Id, constraint.p2Id, sketch, viewport, 'V', isSelected, lineBadgeCounts);
      } else if (constraint instanceof ParallelConstraint) {
        this.renderBadgeOnSegment(constraint.id, constraint.l1P1, constraint.l1P2, sketch, viewport, '//', isSelected, lineBadgeCounts);
        this.renderBadgeOnSegment(constraint.id, constraint.l2P1, constraint.l2P2, sketch, viewport, '//', isSelected, lineBadgeCounts);
      } else if (constraint instanceof PerpendicularConstraint) {
        this.renderPerpendicularBadge(constraint, sketch, viewport, isSelected, lineBadgeCounts);
      } else if (constraint instanceof EqualLengthConstraint) {
        this.renderBadgeOnSegment(constraint.id, constraint.line1P1, constraint.line1P2, sketch, viewport, '=', isSelected, lineBadgeCounts);
        this.renderBadgeOnSegment(constraint.id, constraint.line2P1, constraint.line2P2, sketch, viewport, '=', isSelected, lineBadgeCounts);
      } else if (constraint instanceof EqualRadiusConstraint) {
        this.renderBadgeOnCircle(constraint.id, constraint.circle1Id, sketch, viewport, '=', isSelected);
        this.renderBadgeOnCircle(constraint.id, constraint.circle2Id, sketch, viewport, '=', isSelected);
      } else if (constraint instanceof TangentLineCircleConstraint) {
        this.renderBadgeOnSegment(constraint.id, constraint.lineP1Id, constraint.lineP2Id, sketch, viewport, '⟂O', isSelected, lineBadgeCounts);
        this.renderBadgeOnCircle(constraint.id, constraint.circleId, sketch, viewport, '⟂O', isSelected);
      } else if (constraint instanceof ConcentricConstraint) {
        this.renderConcentricBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof MidpointConstraint) {
        this.renderMidpointBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof PointOnLineConstraint) {
        this.renderPointOnLineBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof PointOnCircleConstraint) {
        this.renderPointOnCircleBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof FixedConstraint) {
        this.renderFixedBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof CoincidentConstraint) {
        this.renderCoincidentBadge(constraint, sketch, viewport, isSelected);
      } else if (constraint instanceof AngleConstraint) {
        this.renderAngleDimension(constraint, sketch, viewport, isSelected);
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

    const orientation = constraint.orientation ?? 'aligned';
    const screenOffset = constraint.offset !== undefined ? constraint.offset * viewport.zoom : 32;

    let d1: Vec2;
    let d2: Vec2;
    let extEnd1: Vec2;
    let extEnd2: Vec2;
    let mid: Vec2;

    if (orientation === 'horizontal') {
      const midY = (s1.y + s2.y) * 0.5;
      const dimY = midY + screenOffset;
      d1 = { x: s1.x, y: dimY };
      d2 = { x: s2.x, y: dimY };
      const extDir = screenOffset >= 0 ? 1 : -1;
      extEnd1 = { x: s1.x, y: dimY + extDir * 5 };
      extEnd2 = { x: s2.x, y: dimY + extDir * 5 };
      mid = { x: (d1.x + d2.x) * 0.5, y: dimY };
    } else if (orientation === 'vertical') {
      const midX = (s1.x + s2.x) * 0.5;
      const dimX = midX + screenOffset;
      d1 = { x: dimX, y: s1.y };
      d2 = { x: dimX, y: s2.y };
      const extDir = screenOffset >= 0 ? 1 : -1;
      extEnd1 = { x: dimX + extDir * 5, y: s1.y };
      extEnd2 = { x: dimX + extDir * 5, y: s2.y };
      mid = { x: dimX, y: (d1.y + d2.y) * 0.5 };
    } else {
      const dx = s2.x - s1.x;
      const dy = s2.y - s1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return;

      const nx = -dy / len;
      const ny = dx / len;
      d1 = { x: s1.x + nx * screenOffset, y: s1.y + ny * screenOffset };
      d2 = { x: s2.x + nx * screenOffset, y: s2.y + ny * screenOffset };
      extEnd1 = { x: d1.x + nx * 5, y: d1.y + ny * 5 };
      extEnd2 = { x: d2.x + nx * 5, y: d2.y + ny * 5 };
      mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };
    }

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dimension-item');
    g.setAttribute('data-id', constraint.id);
    g.setAttribute('data-type', 'constraint');

    const color = isSelected ? '#0ea5e9' : '#0284c7';

    // Extension lines from points
    const extLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    extLine1.setAttribute('x1', s1.x.toFixed(1));
    extLine1.setAttribute('y1', s1.y.toFixed(1));
    extLine1.setAttribute('x2', extEnd1.x.toFixed(1));
    extLine1.setAttribute('y2', extEnd1.y.toFixed(1));
    extLine1.setAttribute('stroke', 'rgba(2, 132, 199, 0.45)');
    extLine1.setAttribute('stroke-width', '1');
    extLine1.style.pointerEvents = 'none';
    g.appendChild(extLine1);

    const extLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    extLine2.setAttribute('x1', s2.x.toFixed(1));
    extLine2.setAttribute('y1', s2.y.toFixed(1));
    extLine2.setAttribute('x2', extEnd2.x.toFixed(1));
    extLine2.setAttribute('y2', extEnd2.y.toFixed(1));
    extLine2.setAttribute('stroke', 'rgba(2, 132, 199, 0.45)');
    extLine2.setAttribute('stroke-width', '1');
    extLine2.style.pointerEvents = 'none';
    g.appendChild(extLine2);

    // Dimension line with arrowheads
    const dimLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    dimLine.setAttribute('x1', d1.x.toFixed(1));
    dimLine.setAttribute('y1', d1.y.toFixed(1));
    dimLine.setAttribute('x2', d2.x.toFixed(1));
    dimLine.setAttribute('y2', d2.y.toFixed(1));
    dimLine.setAttribute('stroke', color);
    dimLine.setAttribute('stroke-width', '1.5');
    const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';
    dimLine.setAttribute('marker-start', arrowUrl);
    dimLine.setAttribute('marker-end', arrowUrl);
    g.appendChild(dimLine);

    // Text label badge with background
    const textVal = Number.isInteger(constraint.targetDistance)
      ? constraint.targetDistance.toFixed(1)
      : Number(constraint.targetDistance.toFixed(2)).toString();
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

  private renderDashedExtensionLines(
    parentG: SVGElement,
    sCenter: Vec2,
    angleRad: number,
    rScreen: number,
    pA: Vec2,
    pB: Vec2,
    color: string
  ): void {
    const vx = Math.cos(angleRad);
    const vy = Math.sin(angleRad);

    const k1 = (pA.x - sCenter.x) * vx + (pA.y - sCenter.y) * vy;
    const k2 = (pB.x - sCenter.x) * vx + (pB.y - sCenter.y) * vy;
    const kMin = Math.min(k1, k2);
    const kMax = Math.max(k1, k2);

    const kEnd = rScreen + 6;
    if (kEnd <= 0) return;

    const intervals: Array<[number, number]> = [];
    if (kMax <= 0) {
      intervals.push([0, kEnd]);
    } else if (kMin <= 0) {
      if (kEnd > kMax) {
        intervals.push([kMax, kEnd]);
      }
    } else {
      intervals.push([0, Math.min(kMin, kEnd)]);
      if (kEnd > kMax) {
        intervals.push([kMax, kEnd]);
      }
    }

    for (const [startK, endK] of intervals) {
      if (endK - startK < 1) continue;
      const x1 = sCenter.x + startK * vx;
      const y1 = sCenter.y + startK * vy;
      const x2 = sCenter.x + endK * vx;
      const y2 = sCenter.y + endK * vy;

      const extLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      extLine.setAttribute('x1', x1.toFixed(1));
      extLine.setAttribute('y1', y1.toFixed(1));
      extLine.setAttribute('x2', x2.toFixed(1));
      extLine.setAttribute('y2', y2.toFixed(1));
      extLine.setAttribute('stroke', color);
      extLine.setAttribute('stroke-width', '1.2');
      extLine.setAttribute('stroke-dasharray', '4,4');
      extLine.style.pointerEvents = 'none';
      parentG.appendChild(extLine);
    }
  }

  private renderAngleDimension(
    constraint: AngleConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const l1 = sketch.lines.get(constraint.line1Id);
    const l2 = sketch.lines.get(constraint.line2Id);
    if (!l1 || !l2) return;

    const p1 = sketch.points.get(l1.p1Id);
    const p2 = sketch.points.get(l1.p2Id);
    const p3 = sketch.points.get(l2.p1Id);
    const p4 = sketch.points.get(l2.p2Id);
    if (!p1 || !p2 || !p3 || !p4) return;

    const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const v2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const l1Len = Math.max(Math.hypot(v1.x, v1.y), 1e-7);
    const l2Len = Math.max(Math.hypot(v2.x, v2.y), 1e-7);

    const s1Factor = constraint.s1 ?? geom.s1;
    const s2Factor = constraint.s2 ?? geom.s2;

    const u1 = { x: (s1Factor * v1.x) / l1Len, y: (s1Factor * v1.y) / l1Len };
    const u2 = { x: (s2Factor * v2.x) / l2Len, y: (s2Factor * v2.y) / l2Len };

    const sCenter = viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
    const sRay1 = viewport.worldToScreen(geom.pInt.x + u1.x * 20, geom.pInt.y + u1.y * 20);
    const sRay2 = viewport.worldToScreen(geom.pInt.x + u2.x * 20, geom.pInt.y + u2.y * 20);

    const a1 = Math.atan2(sRay1.y - sCenter.y, sRay1.x - sCenter.x);
    const a2 = Math.atan2(sRay2.y - sCenter.y, sRay2.x - sCenter.x);

    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const sweepFlag = delta > 0 ? 1 : 0;
    const rWorld = constraint.arcRadius ?? 40;
    const rScreen = Math.max(28, rWorld * viewport.zoom);

    const ax = sCenter.x + rScreen * Math.cos(a1);
    const ay = sCenter.y + rScreen * Math.sin(a1);
    const bx = sCenter.x + rScreen * Math.cos(a2);
    const by = sCenter.y + rScreen * Math.sin(a2);

    const midAngle = a1 + delta * 0.5;
    const midX = sCenter.x + rScreen * Math.cos(midAngle);
    const midY = sCenter.y + rScreen * Math.sin(midAngle);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dimension-item');
    g.setAttribute('data-id', constraint.id);
    g.setAttribute('data-type', 'constraint');

    const color = isSelected ? '#0ea5e9' : '#0284c7';

    // Dashed extension lines if arc points extend beyond the physical line segments
    const sp1 = viewport.worldToScreen(p1.x, p1.y);
    const sp2 = viewport.worldToScreen(p2.x, p2.y);
    const sp3 = viewport.worldToScreen(p3.x, p3.y);
    const sp4 = viewport.worldToScreen(p4.x, p4.y);

    this.renderDashedExtensionLines(g, sCenter, a1, rScreen, sp1, sp2, color);
    this.renderDashedExtensionLines(g, sCenter, a2, rScreen, sp3, sp4, color);

    // Arc path with arrowheads
    const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcPath.setAttribute(
      'd',
      `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`
    );
    arcPath.setAttribute('fill', 'none');
    arcPath.setAttribute('stroke', color);
    arcPath.setAttribute('stroke-width', '1.5');
    const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';
    arcPath.setAttribute('marker-start', arrowUrl);
    arcPath.setAttribute('marker-end', arrowUrl);
    g.appendChild(arcPath);

    // Text label badge with background
    const textVal = `${constraint.targetAngle.toFixed(1)}°`;
    const textLen = textVal.length * 8 + 14;

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', (midX - textLen * 0.5).toFixed(1));
    bgRect.setAttribute('y', (midY - 10).toFixed(1));
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#ffffff');
    bgRect.setAttribute('stroke', color);
    bgRect.setAttribute('stroke-width', '1.5');
    g.appendChild(bgRect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', midX.toFixed(1));
    text.setAttribute('y', (midY + 4).toFixed(1));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', 'ui-monospace, monospace');
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
    const arc = sketch.arcs.get(constraint.circleId);
    const entity = circle ?? arc;
    if (!entity) return;
    const center = sketch.points.get(entity.centerId);
    if (!center) return;

    const sc = viewport.worldToScreen(center.x, center.y);
    const sr = entity.radius * viewport.zoom;

    // Leader angle in screen space (screen Y is positive downwards)
    let screenAngle = -Math.PI / 4; // Default for circle: 45° up and right

    if (arc) {
      const start = sketch.points.get(arc.startPointId);
      const end = sketch.points.get(arc.endPointId);
      if (start && end) {
        const ss = viewport.worldToScreen(start.x, start.y);
        const se = viewport.worldToScreen(end.x, end.y);
        const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
        const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
        const clockwise = !!arc.clockwise;

        let sweepAngle = 0;
        if (clockwise) {
          sweepAngle = (ae - as) % (2 * Math.PI);
          if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
          if (constraint.leaderAngle !== undefined) {
            let rel = (constraint.leaderAngle - as) % (2 * Math.PI);
            if (rel < 0) rel += 2 * Math.PI;
            if (rel > sweepAngle) {
              rel = rel - sweepAngle < 2 * Math.PI - rel ? sweepAngle : 0;
            }
            screenAngle = as + rel;
          } else {
            screenAngle = as + sweepAngle / 2;
          }
        } else {
          sweepAngle = (as - ae) % (2 * Math.PI);
          if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
          if (constraint.leaderAngle !== undefined) {
            let rel = (as - constraint.leaderAngle) % (2 * Math.PI);
            if (rel < 0) rel += 2 * Math.PI;
            if (rel > sweepAngle) {
              rel = rel - sweepAngle < 2 * Math.PI - rel ? sweepAngle : 0;
            }
            screenAngle = as - rel;
          } else {
            screenAngle = as - sweepAngle / 2;
          }
        }
      }
    } else {
      if (constraint.leaderAngle !== undefined) {
        screenAngle = constraint.leaderAngle;
      }
    }

    const cosA = Math.cos(screenAngle);
    const sinA = Math.sin(screenAngle);
    const edge = {
      x: sc.x + cosA * sr,
      y: sc.y + sinA * sr,
    };

    const dirX = cosA >= 0 ? 1 : -1;
    const dirY = sinA >= 0 ? 1 : -1;
    const tip = {
      x: edge.x + dirX * 30,
      y: edge.y + dirY * 20,
    };

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dimension-item');
    g.setAttribute('data-id', constraint.id);
    g.setAttribute('data-type', 'constraint');

    const color = isSelected ? '#0ea5e9' : '#0284c7';
    const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';

    // Leader radial line from center to edge with arrow at circumference
    const radialLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    radialLine.setAttribute('x1', sc.x.toFixed(1));
    radialLine.setAttribute('y1', sc.y.toFixed(1));
    radialLine.setAttribute('x2', edge.x.toFixed(1));
    radialLine.setAttribute('y2', edge.y.toFixed(1));
    radialLine.setAttribute('stroke', color);
    radialLine.setAttribute('stroke-width', '1.5');
    radialLine.setAttribute('marker-end', arrowUrl);
    g.appendChild(radialLine);

    // Shelf line from edge to tip
    const shelf = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    shelf.setAttribute('x1', edge.x.toFixed(1));
    shelf.setAttribute('y1', edge.y.toFixed(1));
    shelf.setAttribute('x2', tip.x.toFixed(1));
    shelf.setAttribute('y2', tip.y.toFixed(1));
    shelf.setAttribute('stroke', color);
    shelf.setAttribute('stroke-width', '1.5');
    g.appendChild(shelf);

    const isDiameter = constraint.displayMode === 'diameter';
    const num = isDiameter ? constraint.targetRadius * 2 : constraint.targetRadius;
    const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
    const textVal = isDiameter ? `Ø ${numStr}` : `R ${numStr}`;
    const textLen = textVal.length * 8 + 14;

    const rectX = dirX > 0 ? tip.x : tip.x - textLen;
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', rectX.toFixed(1));
    bgRect.setAttribute('y', (tip.y - 12).toFixed(1));
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#ffffff');
    bgRect.setAttribute('stroke', color);
    bgRect.setAttribute('stroke-width', isSelected ? '2' : '1');
    g.appendChild(bgRect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', (rectX + textLen * 0.5).toFixed(1));
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

  private renderPerpendicularBadge(
    constraint: PerpendicularConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean,
    lineBadgeCounts: Map<string, number>
  ): void {
    const p1 = sketch.points.get(constraint.l1P1);
    const p2 = sketch.points.get(constraint.l1P2);
    const p3 = sketch.points.get(constraint.l2P1);
    const p4 = sketch.points.get(constraint.l2P2);
    if (!p1 || !p2 || !p3 || !p4) return;

    const isSharedPoint =
      p1.id === p3.id ||
      p1.id === p4.id ||
      p2.id === p3.id ||
      p2.id === p4.id ||
      dist(p1, p3) < 1e-3 ||
      dist(p1, p4) < 1e-3 ||
      dist(p2, p3) < 1e-3 ||
      dist(p2, p4) < 1e-3;

    const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

    const distToSeg1 = projectPointOntoSegment(geom.pInt, p1, p2).dist;
    const distToSeg2 = projectPointOntoSegment(geom.pInt, p3, p4).dist;
    const isNearSegments = distToSeg1 < 30 && distToSeg2 < 30;

    if (isSharedPoint || isNearSegments) {
      const sCenter = viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
      const sRay1 = viewport.worldToScreen(geom.pInt.x + geom.u1.x * 20, geom.pInt.y + geom.u1.y * 20);
      const sRay2 = viewport.worldToScreen(geom.pInt.x + geom.u2.x * 20, geom.pInt.y + geom.u2.y * 20);

      const d1 = { x: sRay1.x - sCenter.x, y: sRay1.y - sCenter.y };
      const d2 = { x: sRay2.x - sCenter.x, y: sRay2.y - sCenter.y };
      const l1 = Math.hypot(d1.x, d1.y);
      const l2 = Math.hypot(d2.x, d2.y);

      let dir = { x: 1, y: -1 };
      if (l1 > 1e-4 && l2 > 1e-4) {
        const u1 = { x: d1.x / l1, y: d1.y / l1 };
        const u2 = { x: d2.x / l2, y: d2.y / l2 };
        const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
        const bisLen = Math.hypot(bis.x, bis.y);
        if (bisLen > 1e-3) {
          dir = { x: bis.x / bisLen, y: bis.y / bisLen };
        } else {
          dir = { x: -u1.y, y: u1.x };
        }
      }

      const offset = 18;
      const badgeX = sCenter.x + dir.x * offset;
      const badgeY = sCenter.y + dir.y * offset;
      this.renderConstraintBadge(constraint.id, badgeX, badgeY, '⊥', isSelected);
      return;
    }

    // Fallback if segments are completely disconnected and far apart
    this.renderBadgeOnSegment(constraint.id, constraint.l1P1, constraint.l1P2, sketch, viewport, '⊥', isSelected, lineBadgeCounts);
    this.renderBadgeOnSegment(constraint.id, constraint.l2P1, constraint.l2P2, sketch, viewport, '⊥', isSelected, lineBadgeCounts);
  }

  private renderBadgeOnSegment(
    constraintId: string,
    p1Id: string,
    p2Id: string,
    sketch: SketchDocument,
    viewport: Viewport,
    label: string,
    isSelected: boolean,
    lineBadgeCounts?: Map<string, number>
  ): void {
    const p1 = sketch.points.get(p1Id);
    const p2 = sketch.points.get(p2Id);
    if (!p1 || !p2) return;

    const s1 = viewport.worldToScreen(p1.x, p1.y);
    const s2 = viewport.worldToScreen(p2.x, p2.y);

    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const len = Math.max(Math.hypot(dx, dy), 1);
    const ux = dx / len;
    const uy = dy / len;

    let nx = -uy;
    let ny = ux;
    if (ny > 0 || (Math.abs(ny) < 1e-4 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }

    let badgeIndex = 0;
    if (lineBadgeCounts) {
      const lineKey = p1Id < p2Id ? `${p1Id}_${p2Id}` : `${p2Id}_${p1Id}`;
      badgeIndex = lineBadgeCounts.get(lineKey) ?? 0;
      lineBadgeCounts.set(lineKey, badgeIndex + 1);
    }

    const offsetAlong =
      badgeIndex === 0
        ? 0
        : (badgeIndex % 2 === 1 ? Math.floor((badgeIndex + 1) / 2) : -Math.floor(badgeIndex / 2)) * 22;

    const midX = (s1.x + s2.x) * 0.5 + nx * 14 + ux * offsetAlong;
    const midY = (s1.y + s2.y) * 0.5 + ny * 14 + uy * offsetAlong;

    this.renderConstraintBadge(constraintId, midX, midY, label, isSelected);
  }

  private renderBadgeOnCircle(
    constraintId: string,
    circleId: string,
    sketch: SketchDocument,
    viewport: Viewport,
    label: string,
    isSelected: boolean
  ): void {
    const circle = sketch.circles.get(circleId);
    const arc = sketch.arcs.get(circleId);
    const entity = circle ?? arc;
    if (!entity) return;
    const center = sketch.points.get(entity.centerId);
    if (!center) return;

    const sc = viewport.worldToScreen(center.x, center.y);
    const rScreen = entity.radius * viewport.zoom;
    let bx = sc.x + rScreen * 0.7071;
    let by = sc.y - rScreen * 0.7071;

    if (arc) {
      const start = sketch.points.get(arc.startPointId);
      const end = sketch.points.get(arc.endPointId);
      if (start && end) {
        const ss = viewport.worldToScreen(start.x, start.y);
        const se = viewport.worldToScreen(end.x, end.y);
        const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
        const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
        const clockwise = !!arc.clockwise;

        let sweepAngle = 0;
        if (clockwise) {
          sweepAngle = (ae - as) % (2 * Math.PI);
          if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
          const midAngle = as + sweepAngle / 2;
          bx = sc.x + Math.cos(midAngle) * rScreen;
          by = sc.y + Math.sin(midAngle) * rScreen;
        } else {
          sweepAngle = (as - ae) % (2 * Math.PI);
          if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
          const midAngle = as - sweepAngle / 2;
          bx = sc.x + Math.cos(midAngle) * rScreen;
          by = sc.y + Math.sin(midAngle) * rScreen;
        }
      }
    }

    this.renderConstraintBadge(constraintId, bx, by, label, isSelected);
  }

  private renderConcentricBadge(
    constraint: ConcentricConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.c1CenterId);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x + 12, s.y + 12, '◎', isSelected, '#0284c7');
  }

  private renderMidpointBadge(
    constraint: MidpointConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.midId);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x, s.y - 14, 'M', isSelected, '#0284c7');
  }

  private renderPointOnLineBadge(
    constraint: PointOnLineConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.pointId);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, '#0284c7');
  }

  private renderPointOnCircleBadge(
    constraint: PointOnCircleConstraint,
    sketch: SketchDocument,
    viewport: Viewport,
    isSelected: boolean
  ): void {
    const pt = sketch.points.get(constraint.pointId);
    if (!pt) return;
    const s = viewport.worldToScreen(pt.x, pt.y);
    this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, '#0284c7');
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
    this.renderConstraintBadge(constraint.id, s.x + 12, s.y - 12, 'fixed', isSelected, '#d97706');
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

    const color = isSelected ? '#0284c7' : customColor ?? '#475569';
    const icon = getBadgeIcon(label, x, y, color);
    const width = icon ? 18 : Math.max(18, label.length * 8 + 8);

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

    if (icon) {
      g.appendChild(icon);
    } else {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x.toFixed(1));
      text.setAttribute('y', (y + 4).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', color);
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'sans-serif');
      text.textContent = label;
      g.appendChild(text);
    }

    this.constraintGroup.appendChild(g);
  }

  // Live drawing previews
  renderLinePreview(
    s1: Vec2,
    s2: Vec2,
    len: number,
    angleDeg: number,
    isConstruction = false,
    axisBadge?: 'H' | 'V'
  ): void {
    this.previewGroup.innerHTML = '';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', s1.x.toFixed(1));
    line.setAttribute('y1', s1.y.toFixed(1));
    line.setAttribute('x2', s2.x.toFixed(1));
    line.setAttribute('y2', s2.y.toFixed(1));
    line.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    if (isConstruction) {
      line.setAttribute('stroke-dasharray', '6,6');
    }
    this.previewGroup.appendChild(line);

    // Length & Angle Tooltip
    const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
    const badgeText = axisBadge ? ` [${axisBadge}]` : '';
    const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°${badgeText}`;
    this.renderTooltip(mid.x, mid.y, label);
  }

  renderDistancePreview(
    s1: Vec2,
    s2: Vec2,
    cursor: Vec2,
    distVal: number,
    orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
  ): void {
    this.previewGroup.innerHTML = '';

    let d1: Vec2;
    let d2: Vec2;
    let extEnd1: Vec2;
    let extEnd2: Vec2;
    let mid: Vec2;

    if (orientation === 'horizontal') {
      const dimY = cursor.y;
      d1 = { x: s1.x, y: dimY };
      d2 = { x: s2.x, y: dimY };
      const midY = (s1.y + s2.y) * 0.5;
      const extDir = dimY >= midY ? 1 : -1;
      extEnd1 = { x: s1.x, y: dimY + extDir * 4 };
      extEnd2 = { x: s2.x, y: dimY + extDir * 4 };
      mid = { x: (d1.x + d2.x) * 0.5, y: dimY };
    } else if (orientation === 'vertical') {
      const dimX = cursor.x;
      d1 = { x: dimX, y: s1.y };
      d2 = { x: dimX, y: s2.y };
      const midX = (s1.x + s2.x) * 0.5;
      const extDir = dimX >= midX ? 1 : -1;
      extEnd1 = { x: dimX + extDir * 4, y: s1.y };
      extEnd2 = { x: dimX + extDir * 4, y: s2.y };
      mid = { x: dimX, y: (d1.y + d2.y) * 0.5 };
    } else {
      const dx = s2.x - s1.x;
      const dy = s2.y - s1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return;

      const nx = -dy / len;
      const ny = dx / len;
      const midX = (s1.x + s2.x) * 0.5;
      const midY = (s1.y + s2.y) * 0.5;
      const offset = (cursor.x - midX) * nx + (cursor.y - midY) * ny;

      d1 = { x: s1.x + nx * offset, y: s1.y + ny * offset };
      d2 = { x: s2.x + nx * offset, y: s2.y + ny * offset };
      extEnd1 = { x: d1.x + nx * 4, y: d1.y + ny * 4 };
      extEnd2 = { x: d2.x + nx * 4, y: d2.y + ny * 4 };
      mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };
    }

    const ext1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ext1.setAttribute('x1', s1.x.toFixed(1));
    ext1.setAttribute('y1', s1.y.toFixed(1));
    ext1.setAttribute('x2', extEnd1.x.toFixed(1));
    ext1.setAttribute('y2', extEnd1.y.toFixed(1));
    ext1.setAttribute('stroke', '#0284c7');
    ext1.setAttribute('stroke-width', '1');
    ext1.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(ext1);

    const ext2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ext2.setAttribute('x1', s2.x.toFixed(1));
    ext2.setAttribute('y1', s2.y.toFixed(1));
    ext2.setAttribute('x2', extEnd2.x.toFixed(1));
    ext2.setAttribute('y2', extEnd2.y.toFixed(1));
    ext2.setAttribute('stroke', '#0284c7');
    ext2.setAttribute('stroke-width', '1');
    ext2.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(ext2);

    const dimLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    dimLine.setAttribute('x1', d1.x.toFixed(1));
    dimLine.setAttribute('y1', d1.y.toFixed(1));
    dimLine.setAttribute('x2', d2.x.toFixed(1));
    dimLine.setAttribute('y2', d2.y.toFixed(1));
    dimLine.setAttribute('stroke', '#0284c7');
    dimLine.setAttribute('stroke-width', '1.5');
    dimLine.setAttribute('marker-start', 'url(#dim-arrow)');
    dimLine.setAttribute('marker-end', 'url(#dim-arrow)');
    this.previewGroup.appendChild(dimLine);

    const labelPrefix = orientation === 'horizontal' ? 'H: ' : orientation === 'vertical' ? 'V: ' : '';
    this.renderTooltip(mid.x, mid.y, `${labelPrefix}${distVal.toFixed(1)} mm`);
  }

  renderAnglePreview(
    sCenter: Vec2,
    sRay1: Vec2,
    sRay2: Vec2,
    cursor: Vec2,
    angleDeg: number,
    sp1?: Vec2,
    sp2?: Vec2,
    sp3?: Vec2,
    sp4?: Vec2
  ): void {
    this.previewGroup.innerHTML = '';

    const a1 = Math.atan2(sRay1.y - sCenter.y, sRay1.x - sCenter.x);
    const a2 = Math.atan2(sRay2.y - sCenter.y, sRay2.x - sCenter.x);

    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const sweepFlag = delta > 0 ? 1 : 0;
    const rScreen = Math.max(28, Math.hypot(cursor.x - sCenter.x, cursor.y - sCenter.y));

    if (sp1 && sp2) {
      this.renderDashedExtensionLines(this.previewGroup, sCenter, a1, rScreen, sp1, sp2, '#0284c7');
    }
    if (sp3 && sp4) {
      this.renderDashedExtensionLines(this.previewGroup, sCenter, a2, rScreen, sp3, sp4, '#0284c7');
    }

    const ax = sCenter.x + rScreen * Math.cos(a1);
    const ay = sCenter.y + rScreen * Math.sin(a1);
    const bx = sCenter.x + rScreen * Math.cos(a2);
    const by = sCenter.y + rScreen * Math.sin(a2);

    const midAngle = a1 + delta * 0.5;
    const midX = sCenter.x + rScreen * Math.cos(midAngle);
    const midY = sCenter.y + rScreen * Math.sin(midAngle);

    const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcPath.setAttribute(
      'd',
      `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`
    );
    arcPath.setAttribute('fill', 'none');
    arcPath.setAttribute('stroke', '#0284c7');
    arcPath.setAttribute('stroke-width', '1.5');
    arcPath.setAttribute('marker-start', 'url(#dim-arrow)');
    arcPath.setAttribute('marker-end', 'url(#dim-arrow)');
    this.previewGroup.appendChild(arcPath);

    this.renderTooltip(midX, midY, `${angleDeg.toFixed(1)}°`);
  }

  renderCirclePreview(
    center: Vec2,
    current: Vec2,
    radius: number,
    isConstruction = false,
    isGuide = false
  ): void {
    this.previewGroup.innerHTML = '';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', center.x.toFixed(1));
    circle.setAttribute('cy', center.y.toFixed(1));
    const rPx = Math.hypot(current.x - center.x, current.y - center.y);
    circle.setAttribute('r', rPx.toFixed(1));
    if (isGuide) {
      circle.setAttribute('stroke', '#0284c7');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('stroke-dasharray', '4,4');
    } else {
      circle.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
      circle.setAttribute('stroke-width', '2');
      if (isConstruction) {
        circle.setAttribute('stroke-dasharray', '6,6');
      }
    }
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

  renderArcPreview(
    sc: Vec2,
    ss: Vec2,
    se: Vec2,
    sr: number,
    clockwise: boolean,
    radiusVal: number,
    sweepDeg?: number,
    isConstruction = false
  ): void {
    this.previewGroup.innerHTML = '';

    const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
    const ae = Math.atan2(se.y - sc.y, se.x - sc.x);

    let sweepAngle = 0;
    let sweepFlag = 0;
    if (clockwise) {
      sweepAngle = (ae - as) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
      sweepFlag = 1;
    } else {
      sweepAngle = (as - ae) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
      sweepFlag = 0;
    }
    const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;

    // Faint guide circle
    const guideCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    guideCircle.setAttribute('cx', sc.x.toFixed(1));
    guideCircle.setAttribute('cy', sc.y.toFixed(1));
    guideCircle.setAttribute('r', sr.toFixed(1));
    guideCircle.setAttribute('stroke', 'rgba(2, 132, 199, 0.25)');
    guideCircle.setAttribute('stroke-width', '1');
    guideCircle.setAttribute('stroke-dasharray', '2,4');
    guideCircle.setAttribute('fill', 'none');
    this.previewGroup.appendChild(guideCircle);

    const d = `M ${ss.x.toFixed(1)} ${ss.y.toFixed(1)} A ${sr.toFixed(1)} ${sr.toFixed(1)} 0 ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(1)} ${se.y.toFixed(1)}`;

    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('d', d);
    arc.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
    arc.setAttribute('stroke-width', '2');
    arc.setAttribute('stroke-linecap', 'round');
    if (isConstruction) {
      arc.setAttribute('stroke-dasharray', '6,6');
    }
    arc.setAttribute('fill', 'none');
    this.previewGroup.appendChild(arc);

    // Dashed center rays
    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    r1.setAttribute('x1', sc.x.toFixed(1));
    r1.setAttribute('y1', sc.y.toFixed(1));
    r1.setAttribute('x2', ss.x.toFixed(1));
    r1.setAttribute('y2', ss.y.toFixed(1));
    r1.setAttribute('stroke', '#0284c7');
    r1.setAttribute('stroke-width', '1');
    r1.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(r1);

    const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    r2.setAttribute('x1', sc.x.toFixed(1));
    r2.setAttribute('y1', sc.y.toFixed(1));
    r2.setAttribute('x2', se.x.toFixed(1));
    r2.setAttribute('y2', se.y.toFixed(1));
    r2.setAttribute('stroke', '#0284c7');
    r2.setAttribute('stroke-width', '1');
    r2.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(r2);

    // Tooltip at mid-arc
    const midAngle = clockwise ? as + sweepAngle * 0.5 : as - sweepAngle * 0.5;
    const midX = sc.x + sr * Math.cos(midAngle);
    const midY = sc.y + sr * Math.sin(midAngle);

    const deg = sweepDeg ?? (sweepAngle * 180 / Math.PI);
    this.renderTooltip(midX, midY, `R ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
  }

  renderRectanglePreview(s1: Vec2, s2: Vec2, w: number, h: number, isConstruction = false): void {
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
    rect.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
    rect.setAttribute('stroke-width', '2');
    if (isConstruction) {
      rect.setAttribute('stroke-dasharray', '6,6');
    }
    rect.setAttribute('fill', 'none');
    this.previewGroup.appendChild(rect);

    this.renderTooltip(s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
  }

  renderEllipseMajorAxisPreview(sc: Vec2, current: Vec2, radiusVal: number, _isConstruction = false): void {
    this.previewGroup.innerHTML = '';

    const axisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axisLine.setAttribute('x1', sc.x.toFixed(1));
    axisLine.setAttribute('y1', sc.y.toFixed(1));
    axisLine.setAttribute('x2', current.x.toFixed(1));
    axisLine.setAttribute('y2', current.y.toFixed(1));
    axisLine.setAttribute('stroke', '#0284c7');
    axisLine.setAttribute('stroke-width', '1.5');
    axisLine.setAttribute('stroke-dasharray', '3,3');
    this.previewGroup.appendChild(axisLine);

    const deg = (Math.atan2(current.y - sc.y, current.x - sc.x) * 180) / Math.PI;
    this.renderTooltip(current.x + 12, current.y - 12, `Rx ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
  }

  renderEllipsePreview(
    sc: Vec2,
    smaj: Vec2,
    smin: Vec2,
    rxVal: number,
    ryVal: number,
    isConstruction = false,
    isGuide = false
  ): void {
    this.previewGroup.innerHTML = '';

    const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
    const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
    const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', sc.x.toFixed(1));
    ellipse.setAttribute('cy', sc.y.toFixed(1));
    ellipse.setAttribute('rx', rx.toFixed(1));
    ellipse.setAttribute('ry', ry.toFixed(1));
    ellipse.setAttribute('transform', `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`);
    if (isGuide) {
      ellipse.setAttribute('stroke', '#0284c7');
      ellipse.setAttribute('stroke-width', '2');
      ellipse.setAttribute('stroke-dasharray', '4,4');
    } else {
      ellipse.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
      ellipse.setAttribute('stroke-width', '2');
      if (isConstruction) {
        ellipse.setAttribute('stroke-dasharray', '6,6');
      }
    }
    ellipse.setAttribute('fill', 'none');
    this.previewGroup.appendChild(ellipse);

    const lmaj = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lmaj.setAttribute('x1', sc.x.toFixed(1));
    lmaj.setAttribute('y1', sc.y.toFixed(1));
    lmaj.setAttribute('x2', smaj.x.toFixed(1));
    lmaj.setAttribute('y2', smaj.y.toFixed(1));
    lmaj.setAttribute('stroke', '#0284c7');
    lmaj.setAttribute('stroke-width', '1');
    lmaj.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(lmaj);

    const lmin = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lmin.setAttribute('x1', sc.x.toFixed(1));
    lmin.setAttribute('y1', sc.y.toFixed(1));
    lmin.setAttribute('x2', smin.x.toFixed(1));
    lmin.setAttribute('y2', smin.y.toFixed(1));
    lmin.setAttribute('stroke', '#0284c7');
    lmin.setAttribute('stroke-width', '1');
    lmin.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(lmin);

    this.renderTooltip(smin.x + 12, smin.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm`);
  }

  renderEllipticalArcStartPreview(
    sc: Vec2,
    smaj: Vec2,
    smin: Vec2,
    ss: Vec2,
    rxVal: number,
    ryVal: number,
    _isConstruction = false
  ): void {
    this.previewGroup.innerHTML = '';

    const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
    const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
    const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', sc.x.toFixed(1));
    ellipse.setAttribute('cy', sc.y.toFixed(1));
    ellipse.setAttribute('rx', rx.toFixed(1));
    ellipse.setAttribute('ry', ry.toFixed(1));
    ellipse.setAttribute('transform', `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`);
    ellipse.setAttribute('stroke', 'rgba(2, 132, 199, 0.3)');
    ellipse.setAttribute('stroke-width', '1.5');
    ellipse.setAttribute('stroke-dasharray', '3,3');
    ellipse.setAttribute('fill', 'none');
    this.previewGroup.appendChild(ellipse);

    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    r1.setAttribute('x1', sc.x.toFixed(1));
    r1.setAttribute('y1', sc.y.toFixed(1));
    r1.setAttribute('x2', ss.x.toFixed(1));
    r1.setAttribute('y2', ss.y.toFixed(1));
    r1.setAttribute('stroke', '#0284c7');
    r1.setAttribute('stroke-width', '1');
    r1.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(r1);

    const ptMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ptMarker.setAttribute('cx', ss.x.toFixed(1));
    ptMarker.setAttribute('cy', ss.y.toFixed(1));
    ptMarker.setAttribute('r', '4');
    ptMarker.setAttribute('fill', '#0284c7');
    this.previewGroup.appendChild(ptMarker);

    this.renderTooltip(ss.x + 12, ss.y - 12, `Start Angle | Rx ${rxVal.toFixed(1)} Ry ${ryVal.toFixed(1)}`);
  }

  renderEllipticalArcPreview(
    sc: Vec2,
    smaj: Vec2,
    smin: Vec2,
    ss: Vec2,
    se: Vec2,
    rxVal: number,
    ryVal: number,
    clockwise: boolean,
    isConstruction = false
  ): void {
    this.previewGroup.innerHTML = '';

    const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
    const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
    if (rx < 0.1 || ry < 0.1) return;

    const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
    const thetaDeg = (theta * 180) / Math.PI;

    // Faint guide ellipse
    const guideEllipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    guideEllipse.setAttribute('cx', sc.x.toFixed(1));
    guideEllipse.setAttribute('cy', sc.y.toFixed(1));
    guideEllipse.setAttribute('rx', rx.toFixed(1));
    guideEllipse.setAttribute('ry', ry.toFixed(1));
    guideEllipse.setAttribute('transform', `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`);
    guideEllipse.setAttribute('stroke', 'rgba(2, 132, 199, 0.25)');
    guideEllipse.setAttribute('stroke-width', '1');
    guideEllipse.setAttribute('stroke-dasharray', '2,4');
    guideEllipse.setAttribute('fill', 'none');
    this.previewGroup.appendChild(guideEllipse);

    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -Math.sin(theta);
    const vy = Math.cos(theta);

    const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
    const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
    const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
    const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

    const ts = Math.atan2(vs / ry, us / rx);
    const te = Math.atan2(ve / ry, ue / rx);

    let sweepAngle = 0;
    let sweepFlag = 0;
    if (clockwise) {
      sweepAngle = (te - ts) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
      sweepFlag = 1;
    } else {
      sweepAngle = (ts - te) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
      sweepFlag = 0;
    }
    const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;

    const d = `M ${ss.x.toFixed(1)} ${ss.y.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} ${thetaDeg.toFixed(2)} ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(1)} ${se.y.toFixed(1)}`;

    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('d', d);
    arc.setAttribute('stroke', isConstruction ? '#64748b' : '#1e293b');
    arc.setAttribute('stroke-width', '2');
    arc.setAttribute('stroke-linecap', 'round');
    if (isConstruction) {
      arc.setAttribute('stroke-dasharray', '6,6');
    }
    arc.setAttribute('fill', 'none');
    this.previewGroup.appendChild(arc);

    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    r1.setAttribute('x1', sc.x.toFixed(1));
    r1.setAttribute('y1', sc.y.toFixed(1));
    r1.setAttribute('x2', ss.x.toFixed(1));
    r1.setAttribute('y2', ss.y.toFixed(1));
    r1.setAttribute('stroke', '#0284c7');
    r1.setAttribute('stroke-width', '1');
    r1.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(r1);

    const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    r2.setAttribute('x1', sc.x.toFixed(1));
    r2.setAttribute('y1', sc.y.toFixed(1));
    r2.setAttribute('x2', se.x.toFixed(1));
    r2.setAttribute('y2', se.y.toFixed(1));
    r2.setAttribute('stroke', '#0284c7');
    r2.setAttribute('stroke-width', '1');
    r2.setAttribute('stroke-dasharray', '2,2');
    this.previewGroup.appendChild(r2);

    const sweepDeg = (sweepAngle * 180) / Math.PI;
    this.renderTooltip(se.x + 12, se.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm | ${sweepDeg.toFixed(1)}°`);
  }

  renderSnapIndicator(s: Vec2, type: 'point' | 'line' | 'circle' | 'grid' = 'point', clearFirst = true): void {
    if (clearFirst) {
      this.overlayGroup.innerHTML = '';
    }

    if (type === 'line' || type === 'circle') {
      // Emerald diamond on object - enlarged so it clearly surrounds points
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const d = 10;
      diamond.setAttribute(
        'points',
        `${s.x.toFixed(1)},${(s.y - d).toFixed(1)} ${(s.x + d).toFixed(1)},${s.y.toFixed(1)} ${s.x.toFixed(1)},${(s.y + d).toFixed(1)} ${(s.x - d).toFixed(1)},${s.y.toFixed(1)}`
      );
      diamond.setAttribute('fill', 'rgba(16, 185, 129, 0.25)');
      diamond.setAttribute('stroke', '#0e9c6dff');
      diamond.setAttribute('stroke-width', '1');
      diamond.setAttribute('pointer-events', 'none');
      diamond.style.pointerEvents = 'none';
      this.overlayGroup.appendChild(diamond);
    } else if (type === 'grid') {
      // Indigo square at grid intersection
      const size = 7;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', (s.x - size).toFixed(1));
      rect.setAttribute('y', (s.y - size).toFixed(1));
      rect.setAttribute('width', (size * 2).toString());
      rect.setAttribute('height', (size * 2).toString());
      rect.setAttribute('fill', 'rgba(99, 102, 241, 0.15)');
      rect.setAttribute('stroke', '#7cbdfaff');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('rx', '1');
      rect.setAttribute('pointer-events', 'none');
      rect.style.pointerEvents = 'none';
      this.overlayGroup.appendChild(rect);
    } else {
      // Circular blue ring for point
      const snapRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      snapRing.setAttribute('cx', s.x.toFixed(1));
      snapRing.setAttribute('cy', s.y.toFixed(1));
      snapRing.setAttribute('r', '9');
      snapRing.setAttribute('fill', 'rgba(2, 132, 199, 0.2)');
      snapRing.setAttribute('stroke', '#0284c7');
      snapRing.setAttribute('stroke-width', '1');
      snapRing.setAttribute('pointer-events', 'none');
      snapRing.style.pointerEvents = 'none';
      this.overlayGroup.appendChild(snapRing);
    }
  }

  renderDragLine(_s1: Vec2, _s2: Vec2): void {
    // Disabled: user requested not to display dashed displacement line or old ghost anchor dot
    this.overlayGroup.innerHTML = '';
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
