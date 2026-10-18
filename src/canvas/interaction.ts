import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import { dist, vec, projectPointOntoSegment, getCircumcircle, type Vec2 } from '../math/vector';
import {
  DistanceConstraint,
  RadiusConstraint,
  AngleConstraint,
  HorizontalConstraint,
  VerticalConstraint,
} from '../solver/constraints';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc } from '../model/types';
import { showToast } from '../ui/toast';

export const DRAWING_PRIMITIVE_TOOLS = [
  'point',
  'line',
  'circle',
  'arc',
  'arc_center',
  'rectangle',
  'ellipse',
  'elliptical_arc',
] as const;

export const CONSTRAINT_TOOLS = [
  'coincident',
  'fixed',
  'horizontal_vertical',
  'horizontal',
  'vertical',
  'dimension',
  'distance',
  'equal',
  'parallel',
  'perpendicular',
  'tangent',
  'concentric',
  'point_on_line',
  'midpoint',
] as const;

export type DrawingPrimitiveToolType = (typeof DRAWING_PRIMITIVE_TOOLS)[number];
export type ConstraintToolType = (typeof CONSTRAINT_TOOLS)[number];

const DRAWING_PRIMITIVE_TOOL_SET: ReadonlySet<string> = new Set(DRAWING_PRIMITIVE_TOOLS);
const CONSTRAINT_TOOL_SET: ReadonlySet<string> = new Set(CONSTRAINT_TOOLS);

export function isDrawingPrimitiveTool(tool: string): tool is DrawingPrimitiveToolType {
  return DRAWING_PRIMITIVE_TOOL_SET.has(tool);
}

export function isConstraintTool(tool: string): tool is ConstraintToolType {
  return CONSTRAINT_TOOL_SET.has(tool);
}

export type ToolType =
  | 'select'
  | 'pan'
  | DrawingPrimitiveToolType
  | ConstraintToolType;

export interface SnapResult {
  type: 'point' | 'line' | 'circle' | 'grid';
  id?: string;
  lineId?: string;
  circleId?: string;
  worldPos: Vec2;
  screenPos: Vec2;
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
    let d = Math.abs(a - b) % 360;
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

export class CanvasInteraction {
  private svg: SVGSVGElement;
  private sketch: SketchDocument;
  private viewport: Viewport;
  private renderer: SVGRenderer;

  activeTool: ToolType = 'select';
  isConstructionMode = false;

  // State machine for multi-step drawing
  private drawingStep = 0;
  private startPointId: string | null = null;
  private startWorldPos: Vec2 | null = null;
  private arcPoint2Id: string | null = null;
  private arcPoint2WorldPos: Vec2 | null = null;
  private ellipsePoint3Id: string | null = null;
  private ellipsePoint3WorldPos: Vec2 | null = null;
  private ellipseStartPointId: string | null = null;
  private ellipseStartPointWorldPos: Vec2 | null = null;
  private startSnapLineId: string | null = null;
  private startSnapCircleId: string | null = null;

  // Dragging point state
  private isDraggingPoint = false;
  private draggedPointId: string | null = null;
  private dragPointStartWorld: Vec2 | null = null;

  // Dragging line state
  private isDraggingLine = false;
  private draggedLineId: string | null = null;
  private dragLineStartWorld: Vec2 | null = null;
  private lineP1Start: Vec2 | null = null;
  private lineP2Start: Vec2 | null = null;

  // Dragging circle state
  private isDraggingCircle = false;
  private draggedCircleId: string | null = null;
  private dragCircleStartWorld: Vec2 | null = null;
  private circleCenterStart: Vec2 | null = null;

  // Dragging arc state
  private isDraggingArc = false;
  private draggedArcId: string | null = null;
  private dragArcStartWorld: Vec2 | null = null;
  private arcCenterStart: Vec2 | null = null;
  private arcStartPointStart: Vec2 | null = null;
  private arcEndPointStart: Vec2 | null = null;

  // Dragging ellipse state
  private isDraggingEllipse = false;
  private draggedEllipseId: string | null = null;
  private dragEllipseStartWorld: Vec2 | null = null;
  private ellipseCenterStart: Vec2 | null = null;
  private ellipseMajorPointStart: Vec2 | null = null;
  private ellipseMinorPointStart: Vec2 | null = null;

  // Dragging elliptical arc state
  private isDraggingEllipticalArc = false;
  private draggedEllipticalArcId: string | null = null;
  private dragEllipticalArcStartWorld: Vec2 | null = null;
  private ellipticalArcCenterStart: Vec2 | null = null;
  private ellipticalArcMajorPointStart: Vec2 | null = null;
  private ellipticalArcMinorPointStart: Vec2 | null = null;
  private ellipticalArcStartPointStart: Vec2 | null = null;
  private ellipticalArcEndPointStart: Vec2 | null = null;

  // Dragging constraint state
  private isDraggingConstraint = false;
  private draggedConstraintId: string | null = null;
  private dragConstraintStartScreen: Vec2 | null = null;

  // Box selection state
  private isBoxSelecting = false;
  private boxSelectStartScreen: Vec2 | null = null;
  private boxSelectCurrentScreen: Vec2 | null = null;
  private boxSelectShift = false;
  private pendingExclusiveSelection: {
    id: string;
    type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint';
  } | null = null;

  // Dragging history snapshot
  private preDragSnapshot: SketchSnapshot | null = null;
  private hasDragged = false;

  // Viewport panning state
  private isPanning = false;
  private isSpacePressed = false;
  private readonly isMac =
    typeof navigator !== 'undefined' &&
    ((navigator as any).userAgentData?.platform === 'macOS' ||
      /Mac|iPod|iPhone|iPad/.test(navigator.platform) ||
      /Macintosh/.test(navigator.userAgent));
  private isSnapModifierPressed = false;
  private lastMouseScreen: Vec2 = { x: 0, y: 0 };

  private isSnapModifier(e: MouseEvent | KeyboardEvent): boolean {
    return this.isMac ? e.metaKey : e.ctrlKey;
  }

  // Double click tracking
  private lastClickTime = 0;
  private lastClickPos: Vec2 = { x: 0, y: 0 };
  private lastDoubleClickedTime = 0;

  // Dimension edit callback
  onEditDimension?: (
    constraint: DistanceConstraint | RadiusConstraint | AngleConstraint,
    screenPos: Vec2
  ) => void;
  onToolChange?: (tool: ToolType) => void;
  onConstructionChange?: (isConstruction: boolean) => void;
  isSnappingEnabled = true;
  onSnappingChange?: (active: boolean) => void;

  // Dimension tool multi-step state: 0 = pick first entity, 1 = pick second entity / offset, 2 = place dimension / pick angle radius
  private dimensionState: {
    step: 0 | 1 | 2;
    line1Id: string | null;
    line2Id: string | null;
    point1Id: string | null;
    point2Id: string | null;
  } = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };

  constructor(
    svg: SVGSVGElement,
    sketch: SketchDocument,
    viewport: Viewport,
    renderer: SVGRenderer
  ) {
    this.svg = svg;
    this.sketch = sketch;
    this.viewport = viewport;
    this.renderer = renderer;

    this.bindEvents();
    this.sketch.onChange(() => {
      this.updateConstructionState();
    });
  }

  setTool(tool: ToolType): void {
    this.activeTool = tool;
    this.cancelDrawing();
    if (tool === 'dimension') {
      if (this.sketch.selection.lineIds.size === 1) {
        this.dimensionState = {
          step: 1,
          line1Id: [...this.sketch.selection.lineIds][0],
          line2Id: null,
          point1Id: null,
          point2Id: null,
        };
      } else if (this.sketch.selection.lineIds.size === 2) {
        const [l1, l2] = [...this.sketch.selection.lineIds];
        this.dimensionState = {
          step: 2,
          line1Id: l1,
          line2Id: l2,
          point1Id: null,
          point2Id: null,
        };
      } else if (this.sketch.selection.pointIds.size === 2) {
        const [p1, p2] = [...this.sketch.selection.pointIds];
        this.dimensionState = {
          step: 2,
          line1Id: null,
          line2Id: null,
          point1Id: p1,
          point2Id: p2,
        };
      } else if (this.sketch.selection.pointIds.size === 1) {
        const [p1] = [...this.sketch.selection.pointIds];
        this.dimensionState = {
          step: 1,
          line1Id: null,
          line2Id: null,
          point1Id: p1,
          point2Id: null,
        };
      } else {
        this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
      }
    }
    if (isConstraintTool(tool)) {
      this.pruneIncompatibleSelection(tool);
    }
    this.updateCursor();
    this.onToolChange?.(tool);
    this.render();
  }

  toggleConstructionMode(): void {
    const selected = this.sketch.getSelectedPrimitives();
    if (selected.length > 0) {
      this.sketch.beginTransaction();
      for (const p of selected) {
        this.sketch.toggleConstruction(p.id);
      }
      this.sketch.commitTransaction();
      this.updateConstructionState();
    } else {
      this.isConstructionMode = !this.isConstructionMode;
      this.updateConstructionState();
    }
    this.render();
  }

  getEffectiveConstructionState(): boolean {
    const selectedState = this.sketch.getSelectedConstructionState();
    if (selectedState !== null) {
      return selectedState;
    }
    return this.isConstructionMode;
  }

  updateConstructionState(): void {
    this.onConstructionChange?.(this.getEffectiveConstructionState());
  }

  toggleSnapping(): void {
    this.isSnappingEnabled = !this.isSnappingEnabled;
    this.onSnappingChange?.(this.isSnappingEnabled);
    this.renderer.clearPreviews();
    this.render();
  }

  setSnapping(enabled: boolean): void {
    if (this.isSnappingEnabled !== enabled) {
      this.isSnappingEnabled = enabled;
      this.onSnappingChange?.(this.isSnappingEnabled);
      this.renderer.clearPreviews();
      this.render();
    }
  }

  cancelDrawing(): void {
    if (this.drawingStep > 0) {
      this.sketch.rollbackTransaction();
    }
    this.drawingStep = 0;
    this.startPointId = null;
    this.startWorldPos = null;
    this.arcPoint2Id = null;
    this.arcPoint2WorldPos = null;
    this.ellipsePoint3Id = null;
    this.ellipsePoint3WorldPos = null;
    this.ellipseStartPointId = null;
    this.ellipseStartPointWorldPos = null;
    this.startSnapLineId = null;
    this.startSnapCircleId = null;

    this.isDraggingPoint = false;
    this.draggedPointId = null;
    this.dragPointStartWorld = null;

    this.isDraggingLine = false;
    this.draggedLineId = null;
    this.dragLineStartWorld = null;
    this.lineP1Start = null;
    this.lineP2Start = null;

    this.isDraggingCircle = false;
    this.draggedCircleId = null;
    this.dragCircleStartWorld = null;
    this.circleCenterStart = null;

    this.isDraggingArc = false;
    this.draggedArcId = null;
    this.dragArcStartWorld = null;
    this.arcCenterStart = null;
    this.arcStartPointStart = null;
    this.arcEndPointStart = null;

    this.isDraggingEllipse = false;
    this.draggedEllipseId = null;
    this.dragEllipseStartWorld = null;
    this.ellipseCenterStart = null;
    this.ellipseMajorPointStart = null;
    this.ellipseMinorPointStart = null;

    this.isDraggingEllipticalArc = false;
    this.draggedEllipticalArcId = null;
    this.dragEllipticalArcStartWorld = null;
    this.ellipticalArcCenterStart = null;
    this.ellipticalArcMajorPointStart = null;
    this.ellipticalArcMinorPointStart = null;
    this.ellipticalArcStartPointStart = null;
    this.ellipticalArcEndPointStart = null;

    this.isDraggingConstraint = false;
    this.draggedConstraintId = null;
    this.dragConstraintStartScreen = null;

    this.preDragSnapshot = null;
    this.hasDragged = false;
    this.svg.classList.remove('is-dragging');

    this.isBoxSelecting = false;
    this.boxSelectStartScreen = null;
    this.boxSelectCurrentScreen = null;
    this.boxSelectShift = false;
    this.pendingExclusiveSelection = null;

    this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };

    this.renderer.clearPreviews();
  }

  private render(): void {
    this.renderer.render(this.sketch, this.viewport);
  }

  private bindEvents(): void {
    this.svg.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.svg.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    this.svg.addEventListener('dblclick', this.handleDoubleClick.bind(this));

    // Prevent default context menu for smooth right-click panning
    this.svg.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.drawingStep > 0 || (this.activeTool === 'dimension' && this.dimensionState.step > 0)) {
        this.cancelDrawing();
        this.setTool('select');
      }
    });

    window.addEventListener('keydown', e => {
      if (this.isMac ? (e.key === 'Meta' || e.metaKey) : (e.key === 'Control' || e.ctrlKey)) {
        this.isSnapModifierPressed = true;
        this.renderer.clearPreviews();
        this.render();
      }
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        this.isSpacePressed = true;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'Escape') {
        if (this.activeTool === 'dimension' && this.dimensionState.step > 0) {
          this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
          this.sketch.clearSelection();
          this.renderer.clearPreviews();
          this.render();
          return;
        }
        this.cancelDrawing();
        this.setTool('select');
        this.sketch.clearSelection();
        this.render();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.sketch.deleteSelected();
        this.render();
      } else if (e.key === 'x' || e.key === 'X') {
        this.toggleConstructionMode();
      } else if (e.key === 'v' || e.key === 'V') {
        this.setTool('select');
      } else if (e.key === 'l' || e.key === 'L') {
        this.setTool('line');
      } else if (e.key === 'c' || e.key === 'C') {
        this.setTool('circle');
      } else if (e.key === 'a' || e.key === 'A') {
        this.setTool('arc_center');
      } else if (e.key === 'r' || e.key === 'R') {
        this.setTool('rectangle');
      } else if (e.key === 'p' || e.key === 'P') {
        this.setTool('point');
      } else if (e.key === 'e' || e.key === 'E') {
        this.setTool('ellipse');
      } else if (e.key === 'h' || e.key === 'H') {
        this.setTool(this.activeTool === 'horizontal_vertical' ? 'select' : 'horizontal_vertical');
      } else if (e.key === 'd' || e.key === 'D') {
        this.setTool(this.activeTool === 'dimension' ? 'select' : 'dimension');
      } else if (e.key === 'i' || e.key === 'I') {
        this.setTool(this.activeTool === 'coincident' ? 'select' : 'coincident');
      } else if (e.key === 'f' || e.key === 'F') {
        if (this.sketch.selection.pointIds.size > 0) {
          this.applyConstraint('fixed');
        } else {
          this.setTool(this.activeTool === 'fixed' ? 'select' : 'fixed');
        }
      } else if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey) {
          this.toggleSnapping();
        }
      }
    });

    window.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
      }
      if (this.isMac ? (e.key === 'Meta' || !e.metaKey) : (e.key === 'Control' || !e.ctrlKey)) {
        this.isSnapModifierPressed = this.isMac ? e.metaKey : e.ctrlKey;
      }
    });

    window.addEventListener('blur', () => {
      this.isSnapModifierPressed = false;
      this.isSpacePressed = false;
    });
  }

  private getScreenPos(e: MouseEvent): Vec2 {
    const rect = this.svg.getBoundingClientRect();
    return vec(e.clientX - rect.left, e.clientY - rect.top);
  }

  private findSnappedPoint(screenPos: Vec2, excludePointId?: string): { id: string; worldPos: Vec2; screenPos: Vec2 } | null {
    const snap = this.findSnap(screenPos, excludePointId);
    if (snap && snap.type === 'point' && snap.id) {
      return { id: snap.id, worldPos: snap.worldPos, screenPos: snap.screenPos };
    }
    return null;
  }

  private findSnap(screenPos: Vec2, excludePointId?: string): SnapResult | null {
    // Suppress all snapping if snap modifier is held (metaKey on Mac, ctrlKey on Windows)
    if (this.isSnapModifierPressed) {
      return null;
    }

    // Priority 1: Point snapping (Always active, highest priority)
    const pointSnapDistPx = 10;
    let closestPointDist = pointSnapDistPx;
    let foundPoint: { id: string; worldPos: Vec2; screenPos: Vec2 } | null = null;

    for (const pt of this.sketch.points.values()) {
      if (excludePointId && pt.id === excludePointId) continue;
      const s = this.viewport.worldToScreen(pt.x, pt.y);
      const d = dist(screenPos, s);
      if (d < closestPointDist) {
        closestPointDist = d;
        foundPoint = { id: pt.id, worldPos: vec(pt.x, pt.y), screenPos: s };
      }
    }

    if (foundPoint) {
      return {
        type: 'point',
        id: foundPoint.id,
        worldPos: foundPoint.worldPos,
        screenPos: foundPoint.screenPos,
      };
    }

    // Priority 2: Line & Circle/Arc snapping (Active independently of Snap button, closest geometry wins)
    const geomSnapDistPx = 10;
    let closestGeomDist = geomSnapDistPx;
    let foundGeom:
      | { type: 'line'; lineId: string; worldPos: Vec2; screenPos: Vec2 }
      | { type: 'circle'; circleId: string; worldPos: Vec2; screenPos: Vec2 }
      | null = null;

    for (const line of this.sketch.lines.values()) {
      if (excludePointId && (line.p1Id === excludePointId || line.p2Id === excludePointId)) {
        continue;
      }
      const p1 = this.sketch.points.get(line.p1Id);
      const p2 = this.sketch.points.get(line.p2Id);
      if (!p1 || !p2) continue;

      const s1 = this.viewport.worldToScreen(p1.x, p1.y);
      const s2 = this.viewport.worldToScreen(p2.x, p2.y);
      const proj = projectPointOntoSegment(screenPos, s1, s2);
      if (proj.dist < closestGeomDist) {
        closestGeomDist = proj.dist;
        const worldPos = vec(
          p1.x + proj.t * (p2.x - p1.x),
          p1.y + proj.t * (p2.y - p1.y)
        );
        foundGeom = {
          type: 'line',
          lineId: line.id,
          worldPos,
          screenPos: proj.point,
        };
      }
    }

    for (const circle of this.sketch.circles.values()) {
      if (excludePointId && circle.centerId === excludePointId) {
        continue;
      }
      const center = this.sketch.points.get(circle.centerId);
      if (!center) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const sr = circle.radius * this.viewport.zoom;
      const dToCenter = dist(screenPos, sc);
      const dToPerimeter = Math.abs(dToCenter - sr);

      if (dToPerimeter < closestGeomDist) {
        closestGeomDist = dToPerimeter;
        const dx = screenPos.x - sc.x;
        const dy = screenPos.y - sc.y;
        const d = Math.max(Math.hypot(dx, dy), 1e-6);
        const snappedScreen = vec(
          sc.x + (dx / d) * sr,
          sc.y + (dy / d) * sr
        );
        const worldPos = this.viewport.screenToWorld(snappedScreen.x, snappedScreen.y);
        foundGeom = {
          type: 'circle',
          circleId: circle.id,
          worldPos,
          screenPos: snappedScreen,
        };
      }
    }

    for (const arc of this.sketch.arcs.values()) {
      if (
        excludePointId &&
        (arc.centerId === excludePointId ||
          arc.startPointId === excludePointId ||
          arc.endPointId === excludePointId)
      ) {
        continue;
      }
      const center = this.sketch.points.get(arc.centerId);
      const start = this.sketch.points.get(arc.startPointId);
      const end = this.sketch.points.get(arc.endPointId);
      if (!center || !start || !end) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const ss = this.viewport.worldToScreen(start.x, start.y);
      const se = this.viewport.worldToScreen(end.x, end.y);
      const sr = arc.radius * this.viewport.zoom;

      const dToCenter = dist(screenPos, sc);
      const dToPerimeter = Math.abs(dToCenter - sr);
      if (dToPerimeter >= closestGeomDist) continue;

      const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
      const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
      const ap = Math.atan2(screenPos.y - sc.y, screenPos.x - sc.x);
      const clockwise = !!arc.clockwise;

      let sweepAngle = 0;
      let pAngle = 0;
      if (clockwise) {
        sweepAngle = (ae - as) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (ap - as) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      } else {
        sweepAngle = (as - ae) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (as - ap) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      }

      const angTolerance = geomSnapDistPx / Math.max(sr, 1);
      if (pAngle <= sweepAngle + angTolerance || pAngle >= 2 * Math.PI - angTolerance) {
        closestGeomDist = dToPerimeter;
        const clampedPAngle = Math.max(0, Math.min(sweepAngle, pAngle));
        const actualAng = clockwise ? as + clampedPAngle : as - clampedPAngle;
        const snappedScreen = vec(
          sc.x + Math.cos(actualAng) * sr,
          sc.y + Math.sin(actualAng) * sr
        );
        const worldPos = this.viewport.screenToWorld(snappedScreen.x, snappedScreen.y);
        foundGeom = {
          type: 'circle',
          circleId: arc.id,
          worldPos,
          screenPos: snappedScreen,
        };
      }
    }

    if (foundGeom) {
      if (foundGeom.type === 'line') {
        return {
          type: 'line',
          lineId: foundGeom.lineId,
          worldPos: foundGeom.worldPos,
          screenPos: foundGeom.screenPos,
        };
      } else {
        return {
          type: 'circle',
          circleId: foundGeom.circleId,
          worldPos: foundGeom.worldPos,
          screenPos: foundGeom.screenPos,
        };
      }
    }

    // Priority 3: Grid snapping (Active only when Snap button is enabled)
    if (!this.isSnappingEnabled) {
      return null;
    }

    const { step, subStep } = this.viewport.getGridStep();
    const subStepPx = subStep * this.viewport.zoom;
    const gridStep = subStepPx >= 6 ? subStep : step;

    const world = this.viewport.screenToWorld(screenPos.x, screenPos.y);
    const nearestWorldX = Math.round(world.x / gridStep) * gridStep;
    const nearestWorldY = Math.round(world.y / gridStep) * gridStep;
    const nearestWorld = vec(nearestWorldX, nearestWorldY);
    const nearestScreen = this.viewport.worldToScreen(nearestWorld.x, nearestWorld.y);
    const gridDist = dist(screenPos, nearestScreen);

    const gridSnapDistPx = 4;
    if (gridDist <= gridSnapDistPx) {
      return {
        type: 'grid',
        worldPos: nearestWorld,
        screenPos: nearestScreen,
      };
    }

    return null;
  }

  private applySnapConstraintIfNeeded(pointId: string, snap: SnapResult | null): void {
    if (!snap) return;
    if (snap.type === 'point' && snap.id && snap.id !== pointId) {
      const c = this.sketch.addCoincidentConstraint(pointId, snap.id);
      if (c) {
        showToast('Coincident constraint applied');
      }
    } else if (snap.type === 'line' && snap.lineId) {
      const c = this.sketch.addPointOnLineConstraint(pointId, snap.lineId);
      if (c) {
        showToast('Point constrained to line');
      }
    } else if (snap.type === 'circle' && snap.circleId) {
      const c = this.sketch.addPointOnCircleConstraint(pointId, snap.circleId);
      if (c) {
        showToast('Point constrained to circle');
      }
    }
  }

  private applyAutoOrientationConstraint(p1Id: string, p2Id: string): void {
    const p1 = this.sketch.getPoint(p1Id);
    const p2 = this.sketch.getPoint(p2Id);
    if (!p1 || !p2) return;

    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    if (dx < 1e-6 && dy < 1e-6) return;

    // Angle relative to X axis in degrees: [0, 90]
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Horizontal check: deviation from horizontal < 1 degree
    if (angleDeg < 1.0) {
      const alreadyHoriz = [...this.sketch.constraints.values()].some(
        c =>
          c instanceof HorizontalConstraint &&
          ((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
      );
      if (!alreadyHoriz) {
        this.sketch.addHorizontalConstraint(p1Id, p2Id);
        showToast('Horizontal constraint applied');
      }
      return;
    }

    // Vertical check: deviation from vertical < 1 degree
    if (90 - angleDeg < 1.0) {
      const alreadyVert = [...this.sketch.constraints.values()].some(
        c =>
          c instanceof VerticalConstraint &&
          ((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
      );
      if (!alreadyVert) {
        this.sketch.addVerticalConstraint(p1Id, p2Id);
        showToast('Vertical constraint applied');
      }
      return;
    }
  }

  private getAxisSnappedWorldPos(
    startPos: Vec2,
    targetPos: Vec2,
    snap: SnapResult | null
  ): { pos: Vec2; axis: 'horizontal' | 'vertical' | null } {
    if (this.isSnapModifierPressed) {
      return { pos: targetPos, axis: null };
    }
    if (snap && (snap.type === 'point' || snap.type === 'line' || snap.type === 'circle')) {
      return { pos: targetPos, axis: null };
    }

    const dx = Math.abs(targetPos.x - startPos.x);
    const dy = Math.abs(targetPos.y - startPos.y);
    if (dx < 1e-6 && dy < 1e-6) {
      return { pos: targetPos, axis: null };
    }

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Deviation from horizontal < 1 degree
    if (angleDeg < 1.0) {
      return {
        pos: vec(targetPos.x, startPos.y),
        axis: 'horizontal',
      };
    }

    // Deviation from vertical < 1 degree
    if (90 - angleDeg < 1.0) {
      return {
        pos: vec(startPos.x, targetPos.y),
        axis: 'vertical',
      };
    }

    return { pos: targetPos, axis: null };
  }

  private findPointNearScreen(screen: Vec2, thresholdPx = 16): SketchPoint | null {
    let closestDist = thresholdPx;
    let foundPoint: SketchPoint | null = null;

    for (const pt of this.sketch.points.values()) {
      const s = this.viewport.worldToScreen(pt.x, pt.y);
      const d = dist(screen, s);
      if (d < closestDist) {
        closestDist = d;
        foundPoint = pt;
      }
    }

    return foundPoint;
  }

  private findLineNearScreen(screen: Vec2, thresholdPx = 16): SketchLine | null {
    let closestDist = thresholdPx;
    let foundLine: SketchLine | null = null;

    for (const line of this.sketch.lines.values()) {
      const p1 = this.sketch.points.get(line.p1Id);
      const p2 = this.sketch.points.get(line.p2Id);
      if (!p1 || !p2) continue;

      const s1 = this.viewport.worldToScreen(p1.x, p1.y);
      const s2 = this.viewport.worldToScreen(p2.x, p2.y);
      const proj = projectPointOntoSegment(screen, s1, s2);
      if (proj.dist < closestDist) {
        closestDist = proj.dist;
        foundLine = line;
      }
    }

    return foundLine;
  }

  private findCircleNearScreen(screen: Vec2, thresholdPx = 18): SketchCircle | null {
    let closestDist = thresholdPx;
    let foundCircle: SketchCircle | null = null;

    for (const circle of this.sketch.circles.values()) {
      const center = this.sketch.points.get(circle.centerId);
      if (!center) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const sr = circle.radius * this.viewport.zoom;
      const dToCenter = dist(screen, sc);
      const dToPerimeter = Math.abs(dToCenter - sr);

      if (dToPerimeter < closestDist) {
        closestDist = dToPerimeter;
        foundCircle = circle;
      }
    }

    return foundCircle;
  }


  private findArcNearScreen(screen: Vec2, thresholdPx = 18): SketchArc | null {
    let closestDist = thresholdPx;
    let foundArc: SketchArc | null = null;

    for (const arc of this.sketch.arcs.values()) {
      const center = this.sketch.points.get(arc.centerId);
      const start = this.sketch.points.get(arc.startPointId);
      const end = this.sketch.points.get(arc.endPointId);
      if (!center || !start || !end) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const ss = this.viewport.worldToScreen(start.x, start.y);
      const se = this.viewport.worldToScreen(end.x, end.y);
      const sr = arc.radius * this.viewport.zoom;

      const dToCenter = dist(screen, sc);
      const dToPerimeter = Math.abs(dToCenter - sr);
      if (dToPerimeter > closestDist) continue;

      const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
      const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
      const ap = Math.atan2(screen.y - sc.y, screen.x - sc.x);
      const clockwise = !!arc.clockwise;

      let sweepAngle = 0;
      let pAngle = 0;
      if (clockwise) {
        sweepAngle = (ae - as) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (ap - as) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      } else {
        sweepAngle = (as - ae) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (as - ap) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      }

      const angTolerance = thresholdPx / Math.max(sr, 1);
      if (pAngle <= sweepAngle + angTolerance || pAngle >= 2 * Math.PI - angTolerance) {
        closestDist = dToPerimeter;
        foundArc = arc;
      }
    }

    return foundArc;
  }

  private findConstraintNearScreen(
    screen: Vec2,
    thresholdPx = 18
  ): DistanceConstraint | RadiusConstraint | AngleConstraint | null {
    let closestDist = thresholdPx;
    let foundConstraint: DistanceConstraint | RadiusConstraint | AngleConstraint | null = null;

    for (const constraint of this.sketch.constraints.values()) {
      if (constraint instanceof DistanceConstraint) {
        const p1 = this.sketch.points.get(constraint.p1Id);
        const p2 = this.sketch.points.get(constraint.p2Id);
        if (!p1 || !p2) continue;

        const s1 = this.viewport.worldToScreen(p1.x, p1.y);
        const s2 = this.viewport.worldToScreen(p2.x, p2.y);
        const screenOffset = constraint.offset !== undefined ? constraint.offset * this.viewport.zoom : 32;

        let d1: Vec2;
        let d2: Vec2;
        if (constraint.orientation === 'horizontal') {
          const midY = (s1.y + s2.y) * 0.5;
          d1 = { x: s1.x, y: midY + screenOffset };
          d2 = { x: s2.x, y: midY + screenOffset };
        } else if (constraint.orientation === 'vertical') {
          const midX = (s1.x + s2.x) * 0.5;
          d1 = { x: midX + screenOffset, y: s1.y };
          d2 = { x: midX + screenOffset, y: s2.y };
        } else {
          const dx = s2.x - s1.x;
          const dy = s2.y - s1.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-4) continue;

          const nx = -dy / len;
          const ny = dx / len;
          d1 = { x: s1.x + nx * screenOffset, y: s1.y + ny * screenOffset };
          d2 = { x: s2.x + nx * screenOffset, y: s2.y + ny * screenOffset };
        }

        const proj = projectPointOntoSegment(screen, d1, d2);
        if (proj.dist < closestDist) {
          closestDist = proj.dist;
          foundConstraint = constraint;
        }
      } else if (constraint instanceof RadiusConstraint) {
        const circle = this.sketch.circles.get(constraint.circleId);
        const arc = this.sketch.arcs.get(constraint.circleId);
        const entity = circle ?? arc;
        if (!entity) continue;
        const center = this.sketch.points.get(entity.centerId);
        if (!center) continue;

        const sc = this.viewport.worldToScreen(center.x, center.y);
        const sr = entity.radius * this.viewport.zoom;

        let screenAngle = -Math.PI / 4;
        if (arc) {
          const start = this.sketch.points.get(arc.startPointId);
          const end = this.sketch.points.get(arc.endPointId);
          if (start && end) {
            const ss = this.viewport.worldToScreen(start.x, start.y);
            const se = this.viewport.worldToScreen(end.x, end.y);
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
                if (rel > sweepAngle) rel = rel - sweepAngle < 2 * Math.PI - rel ? sweepAngle : 0;
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
                if (rel > sweepAngle) rel = rel - sweepAngle < 2 * Math.PI - rel ? sweepAngle : 0;
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
        const edge = { x: sc.x + cosA * sr, y: sc.y + sinA * sr };
        const dirX = cosA >= 0 ? 1 : -1;
        const dirY = sinA >= 0 ? 1 : -1;
        const tip = { x: edge.x + dirX * 30, y: edge.y + dirY * 20 };

        const dTip = dist(screen, tip);
        const dShelf = projectPointOntoSegment(screen, edge, tip).dist;
        const dRadial = projectPointOntoSegment(screen, sc, edge).dist;
        const minD = Math.min(dTip, dShelf, dRadial);

        if (minD < closestDist) {
          closestDist = minD;
          foundConstraint = constraint;
        }
      }
    }

    return foundConstraint;
  }

  private findEllipseNearScreen(screen: Vec2, thresholdPx = 18): SketchEllipse | null {
    let closestDist = thresholdPx;
    let foundEllipse: SketchEllipse | null = null;

    for (const ellipse of this.sketch.ellipses.values()) {
      const center = this.sketch.points.get(ellipse.centerId);
      const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
      const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
      if (!center || !majorPt || !minorPt) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const smaj = this.viewport.worldToScreen(majorPt.x, majorPt.y);
      const smin = this.viewport.worldToScreen(minorPt.x, minorPt.y);

      const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
      const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
      if (rx < 0.1 || ry < 0.1) continue;

      const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      const vx = -Math.sin(theta);
      const vy = Math.cos(theta);

      const dx = screen.x - sc.x;
      const dy = screen.y - sc.y;
      const u = dx * ux + dy * uy;
      const v = dx * vx + dy * vy;

      const t = Math.atan2(v / ry, u / rx);
      const ex = rx * Math.cos(t) * ux + ry * Math.sin(t) * vx;
      const ey = rx * Math.cos(t) * uy + ry * Math.sin(t) * vy;

      const dPerimeter = Math.hypot(dx - ex, dy - ey);
      if (dPerimeter < closestDist) {
        closestDist = dPerimeter;
        foundEllipse = ellipse;
      }
    }

    return foundEllipse;
  }

  private findEllipticalArcNearScreen(screen: Vec2, thresholdPx = 18): SketchEllipticalArc | null {
    let closestDist = thresholdPx;
    let foundArc: SketchEllipticalArc | null = null;

    for (const arc of this.sketch.ellipticalArcs.values()) {
      const center = this.sketch.points.get(arc.centerId);
      const majorPt = this.sketch.points.get(arc.majorAxisPointId);
      const minorPt = this.sketch.points.get(arc.minorAxisPointId);
      const startPt = this.sketch.points.get(arc.startPointId);
      const endPt = this.sketch.points.get(arc.endPointId);
      if (!center || !majorPt || !minorPt || !startPt || !endPt) continue;

      const sc = this.viewport.worldToScreen(center.x, center.y);
      const smaj = this.viewport.worldToScreen(majorPt.x, majorPt.y);
      const smin = this.viewport.worldToScreen(minorPt.x, minorPt.y);
      const ss = this.viewport.worldToScreen(startPt.x, startPt.y);
      const se = this.viewport.worldToScreen(endPt.x, endPt.y);

      const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
      const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
      if (rx < 0.1 || ry < 0.1) continue;

      const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      const vx = -Math.sin(theta);
      const vy = Math.cos(theta);

      const dx = screen.x - sc.x;
      const dy = screen.y - sc.y;
      const u = dx * ux + dy * uy;
      const v = dx * vx + dy * vy;

      const t = Math.atan2(v / ry, u / rx);
      const ex = rx * Math.cos(t) * ux + ry * Math.sin(t) * vx;
      const ey = rx * Math.cos(t) * uy + ry * Math.sin(t) * vy;

      const dPerimeter = Math.hypot(dx - ex, dy - ey);
      if (dPerimeter > closestDist) continue;

      const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
      const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
      const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
      const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

      const ts = Math.atan2(vs / ry, us / rx);
      const te = Math.atan2(ve / ry, ue / rx);

      const clockwise = !!arc.clockwise;
      let sweepAngle = 0;
      let pAngle = 0;
      if (clockwise) {
        sweepAngle = (te - ts) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (t - ts) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      } else {
        sweepAngle = (ts - te) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        pAngle = (ts - t) % (2 * Math.PI);
        if (pAngle < 0) pAngle += 2 * Math.PI;
      }

      const angTolerance = thresholdPx / Math.max(Math.min(rx, ry), 1);
      if (pAngle <= sweepAngle + angTolerance || pAngle >= 2 * Math.PI - angTolerance) {
        closestDist = dPerimeter;
        foundArc = arc;
      }
    }

    return foundArc;
  }

  private handleMouseDown(e: MouseEvent): void {
    this.isSnapModifierPressed = this.isSnapModifier(e);
    const screen = this.getScreenPos(e);
    const clientPos = vec(e.clientX, e.clientY);
    this.lastMouseScreen = screen;

    // Pan with Middle Click (1), Right Click (2), Pan Tool, or Space/Alt Key
    if (e.button === 1 || e.button === 2 || this.activeTool === 'pan' || this.isSpacePressed || e.altKey) {
      this.isPanning = true;
      this.svg.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return; // Only primary button for drawing/selection

    // Robust double-click detection (works even when DOM nodes are re-rendered)
    const now = performance.now();
    const timeDelta = now - this.lastClickTime;
    const distanceDelta = dist(screen, this.lastClickPos);

    if (this.activeTool === 'select' && timeDelta >= 50 && timeDelta <= 350 && distanceDelta < 30) {
      this.lastClickTime = 0;
      if (this.triggerDimensionEditAt(e, screen, clientPos)) {
        e.preventDefault();
        e.stopPropagation();
        this.lastDoubleClickedTime = now;
        this.cancelDrawing();
        return;
      }
    } else {
      this.lastClickTime = now;
      this.lastClickPos = screen;
    }

    const world = this.viewport.screenToWorld(screen.x, screen.y);
    const snap = this.findSnap(screen);

    // --- ACTIVE CONSTRAINT TOOL MODE ---
    if (isConstraintTool(this.activeTool)) {
      if (this.activeTool === 'dimension') {
        this.handleDimensionClick(e, screen, clientPos);
        return;
      }

      if (this.activeTool === 'fixed') {
        const nearPoint = this.findPointNearScreen(screen, 20);
        if (nearPoint) {
          const isNowFixed = this.sketch.toggleFixedConstraint(nearPoint.id);
          showToast(isNowFixed ? 'Fixed constraint applied' : 'Fixed constraint removed');
          this.render();
        } else {
          this.sketch.clearSelection();
          this.render();
        }
        return;
      }

      const target = e.target as SVGElement;
      const targetG = target.closest('[data-id]') as SVGElement | null;
      let id = targetG?.getAttribute('data-id');
      let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | undefined;

      // Priority 1: Points ALWAYS have top priority when clicking near a point!
      const nearPoint = this.findPointNearScreen(screen, 16);
      if (nearPoint) {
        id = nearPoint.id;
        type = 'point';
      } else if (!type || (type !== 'point' && type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'ellipse' && type !== 'elliptical_arc')) {
        if (snap && snap.type === 'point' && snap.id) {
          id = snap.id;
          type = 'point';
        } else {
          const hitLine = this.findLineNearScreen(screen, 18);
          if (hitLine) {
            id = hitLine.id;
            type = 'line';
          } else {
            const hitCircle = this.findCircleNearScreen(screen, 18);
            if (hitCircle) {
              id = hitCircle.id;
              type = 'circle';
            } else {
              const hitArc = this.findArcNearScreen(screen, 18);
              if (hitArc) {
                id = hitArc.id;
                type = 'arc';
              } else {
                const hitEllipse = this.findEllipseNearScreen(screen, 18);
                if (hitEllipse) {
                  id = hitEllipse.id;
                  type = 'ellipse';
                } else {
                  const hitEllipticalArc = this.findEllipticalArcNearScreen(screen, 18);
                  if (hitEllipticalArc) {
                    id = hitEllipticalArc.id;
                    type = 'elliptical_arc';
                  }
                }
              }
            }
          }
        }
      }

      if (id && type) {
        this.handleConstraintEntityClick(id, type);
      } else {
        // Clicked background -> clear selection
        this.sketch.clearSelection();
        this.render();
      }
      return;
    }

    // --- TOOL: SELECT ---
    if (this.activeTool === 'select') {
      const target = e.target as SVGElement;
      const targetG = target.closest('[data-id]') as SVGElement | null;
      let id = targetG?.getAttribute('data-id');
      let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint' | undefined;

      // Priority 1: Points ALWAYS have top priority! If cursor is near any point, select & drag the point!
      const nearPoint = this.findPointNearScreen(screen, 16);
      if (nearPoint) {
        id = nearPoint.id;
        type = 'point';
      } else if (!type) {
        if (snap && snap.type === 'point' && snap.id) {
          id = snap.id;
          type = 'point';
        } else {
          const hitLine = this.findLineNearScreen(screen, 18);
          if (hitLine) {
            id = hitLine.id;
            type = 'line';
          } else {
            const hitCircle = this.findCircleNearScreen(screen, 18);
            if (hitCircle) {
              id = hitCircle.id;
              type = 'circle';
            } else {
              const hitArc = this.findArcNearScreen(screen, 18);
              if (hitArc) {
                id = hitArc.id;
                type = 'arc';
              } else {
                const hitEllipse = this.findEllipseNearScreen(screen, 18);
                if (hitEllipse) {
                  id = hitEllipse.id;
                  type = 'ellipse';
                } else {
                  const hitEllipticalArc = this.findEllipticalArcNearScreen(screen, 18);
                  if (hitEllipticalArc) {
                    id = hitEllipticalArc.id;
                    type = 'elliptical_arc';
                  }
                }
              }
            }
          }
        }
      }

      if (id && type) {
        const isToggle = e.metaKey || e.ctrlKey;
        if (isToggle) {
          this.sketch.toggleEntitySelection(id, type);
          this.render();
          return;
        }

        const wasAlreadySelected = this.sketch.isEntitySelected(id, type);
        if (e.shiftKey) {
          this.sketch.selectEntity(id, type, true);
        } else if (!wasAlreadySelected) {
          this.sketch.selectEntity(id, type, false);
        } else {
          this.pendingExclusiveSelection = { id, type };
        }

        if (type === 'point') {
          this.renderer.clearPreviews();
          this.isDraggingPoint = true;
          this.draggedPointId = id;
          this.preDragSnapshot = this.sketch.takeSnapshot();
          this.hasDragged = false;
          const pt = this.sketch.points.get(id);
          if (pt) {
            this.dragPointStartWorld = vec(pt.x, pt.y);
          }
        } else if (type === 'line') {
          const line = this.sketch.lines.get(id);
          if (line) {
            const p1 = this.sketch.points.get(line.p1Id);
            const p2 = this.sketch.points.get(line.p2Id);
            if (p1 && p2) {
              this.isDraggingLine = true;
              this.draggedLineId = id;
              this.preDragSnapshot = this.sketch.takeSnapshot();
              this.hasDragged = false;
              this.dragLineStartWorld = world;
              this.lineP1Start = vec(p1.x, p1.y);
              this.lineP2Start = vec(p2.x, p2.y);
            }
          }
        } else if (type === 'circle') {
          const circle = this.sketch.circles.get(id);
          if (circle) {
            const center = this.sketch.points.get(circle.centerId);
            if (center) {
              this.isDraggingCircle = true;
              this.draggedCircleId = id;
              this.preDragSnapshot = this.sketch.takeSnapshot();
              this.hasDragged = false;
              this.dragCircleStartWorld = world;
              this.circleCenterStart = vec(center.x, center.y);
            }
          }
        } else if (type === 'arc') {
          const arc = this.sketch.arcs.get(id);
          if (arc) {
            const center = this.sketch.points.get(arc.centerId);
            const start = this.sketch.points.get(arc.startPointId);
            const end = this.sketch.points.get(arc.endPointId);
            if (center && start && end) {
              this.isDraggingArc = true;
              this.draggedArcId = id;
              this.preDragSnapshot = this.sketch.takeSnapshot();
              this.hasDragged = false;
              this.dragArcStartWorld = world;
              this.arcCenterStart = vec(center.x, center.y);
              this.arcStartPointStart = vec(start.x, start.y);
              this.arcEndPointStart = vec(end.x, end.y);
            }
          }
        } else if (type === 'ellipse') {
          const ellipse = this.sketch.ellipses.get(id);
          if (ellipse) {
            const center = this.sketch.points.get(ellipse.centerId);
            const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
            const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
            if (center && majorPt && minorPt) {
              this.isDraggingEllipse = true;
              this.draggedEllipseId = id;
              this.preDragSnapshot = this.sketch.takeSnapshot();
              this.hasDragged = false;
              this.dragEllipseStartWorld = world;
              this.ellipseCenterStart = vec(center.x, center.y);
              this.ellipseMajorPointStart = vec(majorPt.x, majorPt.y);
              this.ellipseMinorPointStart = vec(minorPt.x, minorPt.y);
            }
          }
        } else if (type === 'elliptical_arc') {
          const arc = this.sketch.ellipticalArcs.get(id);
          if (arc) {
            const center = this.sketch.points.get(arc.centerId);
            const majorPt = this.sketch.points.get(arc.majorAxisPointId);
            const minorPt = this.sketch.points.get(arc.minorAxisPointId);
            const start = this.sketch.points.get(arc.startPointId);
            const end = this.sketch.points.get(arc.endPointId);
            if (center && majorPt && minorPt && start && end) {
              this.isDraggingEllipticalArc = true;
              this.draggedEllipticalArcId = id;
              this.preDragSnapshot = this.sketch.takeSnapshot();
              this.hasDragged = false;
              this.dragEllipticalArcStartWorld = world;
              this.ellipticalArcCenterStart = vec(center.x, center.y);
              this.ellipticalArcMajorPointStart = vec(majorPt.x, majorPt.y);
              this.ellipticalArcMinorPointStart = vec(minorPt.x, minorPt.y);
              this.ellipticalArcStartPointStart = vec(start.x, start.y);
              this.ellipticalArcEndPointStart = vec(end.x, end.y);
            }
          }
        } else if (type === 'constraint') {
          const constraint = this.sketch.constraints.get(id);
          if (
            constraint instanceof DistanceConstraint ||
            constraint instanceof AngleConstraint ||
            constraint instanceof RadiusConstraint
          ) {
            this.isDraggingConstraint = true;
            this.draggedConstraintId = id;
            this.preDragSnapshot = this.sketch.takeSnapshot();
            this.hasDragged = false;
            this.dragConstraintStartScreen = screen;
          }
        }

        this.svg.classList.add('is-dragging');
        this.render();
      } else {
        // Clicked background -> start rectangular box selection
        this.isBoxSelecting = true;
        this.boxSelectStartScreen = screen;
        this.boxSelectCurrentScreen = screen;
        this.boxSelectShift = e.shiftKey;
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
          this.sketch.clearSelection();
          this.render();
        }
      }
      return;
    }

    // --- TOOL: POINT ---
    if (this.activeTool === 'point') {
      const finalX = snap ? snap.worldPos.x : world.x;
      const finalY = snap ? snap.worldPos.y : world.y;
      this.sketch.beginTransaction();
      const pt = this.sketch.addPoint(finalX, finalY, false, this.isConstructionMode);
      this.applySnapConstraintIfNeeded(pt.id, snap);
      this.sketch.commitTransaction();
      this.render();
      return;
    }

    // --- TOOL: LINE ---
    if (this.activeTool === 'line') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        // Step 1: Start Point
        let pId: string;
        if (snap && snap.type === 'point' && snap.id) {
          pId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          pId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = pId;
        this.drawingStep = 1;
      } else {
        // Step 2: End Point
        let p2Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
          p2Id = snap.id;
        } else {
          let ptPos = snap ? snap.worldPos : world;
          if (this.startWorldPos) {
            const axisSnap = this.getAxisSnappedWorldPos(this.startWorldPos, ptPos, snap);
            ptPos = axisSnap.pos;
          }
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          p2Id = pt.id;
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }

        this.sketch.addLine(this.startPointId!, p2Id, this.isConstructionMode);
        this.applyAutoOrientationConstraint(this.startPointId!, p2Id);
        this.sketch.commitTransaction();

        const hitPrimitive =
          snap !== null &&
          ((snap.type === 'point' && snap.id !== undefined && snap.id !== this.startPointId) ||
            snap.type === 'line' ||
            snap.type === 'circle');

        if (hitPrimitive) {
          this.drawingStep = 0;
          this.startPointId = null;
          this.startWorldPos = null;
          this.renderer.clearPreviews();
        } else {
          // Chain to next line
          this.sketch.beginTransaction();
          this.startPointId = p2Id;
          const p2 = this.sketch.getPoint(p2Id);
          this.startWorldPos = p2 ? vec(p2.x, p2.y) : (snap ? snap.worldPos : world);
        }
        this.render();
      }
      return;
    }

    // --- TOOL: CIRCLE ---
    if (this.activeTool === 'circle') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let centerId: string;
        if (snap && snap.type === 'point' && snap.id) {
          centerId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          centerId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = centerId;
        this.drawingStep = 1;
      } else {
        const curPos = snap ? snap.worldPos : world;
        const radius = Math.max(5, dist(this.startWorldPos!, curPos));
        this.sketch.addCircle(this.startPointId!, radius, this.isConstructionMode);
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
      }
      return;
    }

    // --- TOOL: ARC (3-Point Arc) ---
    if (this.activeTool === 'arc') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let pId: string;
        if (snap && snap.type === 'point' && snap.id) {
          pId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          pId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = pId;
        this.drawingStep = 1;
        this.render();
      } else if (this.drawingStep === 1) {
        const p1World = this.startWorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;
        if (dist(p1World, effectiveWorld) < 2) {
          return;
        }

        let p2Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
          p2Id = snap.id;
          this.arcPoint2WorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(effectiveWorld.x, effectiveWorld.y, false, this.isConstructionMode);
          p2Id = pt.id;
          this.arcPoint2WorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.arcPoint2Id = p2Id;
        this.drawingStep = 2;
        this.render();
      } else if (this.drawingStep === 2) {
        const p1 = this.startWorldPos!;
        const p2 = this.arcPoint2WorldPos!;
        const p3 = snap ? snap.worldPos : world;

        const circum = getCircumcircle(p1, p2, p3);
        if (!circum || circum.radius < 1 || circum.radius > 50000) {
          showToast('Cannot form arc from collinear points');
          return;
        }

        const s1 = this.viewport.worldToScreen(p1.x, p1.y);
        const s2 = this.viewport.worldToScreen(p2.x, p2.y);
        const s3 = this.viewport.worldToScreen(p3.x, p3.y);
        const sc = this.viewport.worldToScreen(circum.center.x, circum.center.y);

        const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
        const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
        const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

        let sweepCW = (ae - as) % (2 * Math.PI);
        if (sweepCW < 0) sweepCW += 2 * Math.PI;
        let testCW = (a3 - as) % (2 * Math.PI);
        if (testCW < 0) testCW += 2 * Math.PI;

        const clockwise = testCW > 0 && testCW < sweepCW;

        const centerPt = this.sketch.addPoint(circum.center.x, circum.center.y, false, this.isConstructionMode);
        this.sketch.addArc(
          centerPt.id,
          this.startPointId!,
          this.arcPoint2Id!,
          circum.radius,
          clockwise,
          this.isConstructionMode
        );
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
        showToast('3-point arc created');
      }
      return;
    }

    // --- TOOL: ARC_CENTER (Centerpoint Arc) ---
    if (this.activeTool === 'arc_center') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let cId: string;
        if (snap && snap.type === 'point' && snap.id) {
          cId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          cId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = cId;
        this.drawingStep = 1;
        this.render();
      } else if (this.drawingStep === 1) {
        const centerWorld = this.startWorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;
        if (dist(centerWorld, effectiveWorld) < 2) {
          return;
        }

        let p1Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
          p1Id = snap.id;
          this.arcPoint2WorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(effectiveWorld.x, effectiveWorld.y, false, this.isConstructionMode);
          p1Id = pt.id;
          this.arcPoint2WorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.arcPoint2Id = p1Id;
        this.drawingStep = 2;
        this.render();
      } else if (this.drawingStep === 2) {
        const centerWorld = this.startWorldPos!;
        const startWorld = this.arcPoint2WorldPos!;
        const radius = Math.max(1, dist(centerWorld, startWorld));

        const effectiveWorld = snap ? snap.worldPos : world;
        const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
        const sStart = this.viewport.worldToScreen(startWorld.x, startWorld.y);
        const sCur = this.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

        const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
        const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

        let delta = acur - as;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const clockwise = delta >= 0;

        const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
        const endWorldX = centerWorld.x + radius * Math.cos(worldAngle);
        const endWorldY = centerWorld.y + radius * Math.sin(worldAngle);

        let endPointId: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId && snap.id !== this.arcPoint2Id) {
          endPointId = snap.id;
        } else {
          const pt = this.sketch.addPoint(endWorldX, endWorldY, false, this.isConstructionMode);
          endPointId = pt.id;
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }

        this.sketch.addArc(
          this.startPointId!,
          this.arcPoint2Id!,
          endPointId,
          radius,
          clockwise,
          this.isConstructionMode
        );
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
        showToast('Centerpoint arc created');
      }
      return;
    }

    // --- TOOL: RECTANGLE ---
    if (this.activeTool === 'rectangle') {
      if (this.drawingStep === 0) {
        this.startWorldPos = snap ? snap.worldPos : world;
        this.startSnapLineId = (snap && snap.type === 'line') ? snap.lineId ?? null : null;
        this.startSnapCircleId = (snap && snap.type === 'circle') ? snap.circleId ?? null : null;
        this.drawingStep = 1;
      } else {
        const c1 = this.startWorldPos!;
        const c2 = snap ? snap.worldPos : world;

        this.sketch.beginTransaction();

        // Create 4 corners
        const p0 = this.sketch.addPoint(c1.x, c1.y, false, this.isConstructionMode);
        const p1 = this.sketch.addPoint(c2.x, c1.y, false, this.isConstructionMode);
        const p2 = this.sketch.addPoint(c2.x, c2.y, false, this.isConstructionMode);
        const p3 = this.sketch.addPoint(c1.x, c2.y, false, this.isConstructionMode);

        if (this.startSnapLineId) {
          this.sketch.addPointOnLineConstraint(p0.id, this.startSnapLineId);
        } else if (this.startSnapCircleId) {
          this.sketch.addPointOnCircleConstraint(p0.id, this.startSnapCircleId);
        }
        if (snap && snap.type === 'line' && snap.lineId) {
          this.sketch.addPointOnLineConstraint(p2.id, snap.lineId);
        } else if (snap && snap.type === 'circle' && snap.circleId) {
          this.sketch.addPointOnCircleConstraint(p2.id, snap.circleId);
        }
        this.startSnapLineId = null;
        this.startSnapCircleId = null;

        // Create 4 lines
        this.sketch.addLine(p0.id, p1.id, this.isConstructionMode);
        this.sketch.addLine(p1.id, p2.id, this.isConstructionMode);
        this.sketch.addLine(p2.id, p3.id, this.isConstructionMode);
        this.sketch.addLine(p3.id, p0.id, this.isConstructionMode);

        // Add standard rectangular constraints
        this.sketch.addHorizontalConstraint(p0.id, p1.id);
        this.sketch.addVerticalConstraint(p1.id, p2.id);
        this.sketch.addHorizontalConstraint(p3.id, p2.id);
        this.sketch.addVerticalConstraint(p0.id, p3.id);

        this.sketch.commitTransaction();

        this.cancelDrawing();
        this.render();
      }
      return;
    }

    // --- TOOL: ELLIPSE (3 clicks: Center -> Major axis -> Minor axis) ---
    if (this.activeTool === 'ellipse') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let cId: string;
        if (snap && snap.type === 'point' && snap.id) {
          cId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          cId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = cId;
        this.drawingStep = 1;
        this.render();
      } else if (this.drawingStep === 1) {
        const centerWorld = this.startWorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;
        if (dist(centerWorld, effectiveWorld) < 2) {
          return;
        }

        let p1Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
          p1Id = snap.id;
          this.arcPoint2WorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(effectiveWorld.x, effectiveWorld.y, false, this.isConstructionMode);
          p1Id = pt.id;
          this.arcPoint2WorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.arcPoint2Id = p1Id;
        this.drawingStep = 2;
        this.render();
      } else if (this.drawingStep === 2) {
        const centerWorld = this.startWorldPos!;
        const majWorld = this.arcPoint2WorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;

        const majLen = dist(centerWorld, majWorld);
        if (majLen < 0.1) return;

        const ux = (majWorld.x - centerWorld.x) / majLen;
        const uy = (majWorld.y - centerWorld.y) / majLen;
        const vx = -uy;
        const vy = ux;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        let ryVal = Math.abs(dx * vx + dy * vy);
        if (ryVal < 1) ryVal = 1;
        const sign = dx * vx + dy * vy < 0 ? -1 : 1;

        const minX = centerWorld.x + sign * ryVal * vx;
        const minY = centerWorld.y + sign * ryVal * vy;

        let p2Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId && snap.id !== this.arcPoint2Id) {
          p2Id = snap.id;
        } else {
          const pt = this.sketch.addPoint(minX, minY, false, this.isConstructionMode);
          p2Id = pt.id;
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }

        this.sketch.addEllipse(
          this.startPointId!,
          this.arcPoint2Id!,
          p2Id,
          this.isConstructionMode
        );
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
        showToast('Ellipse created');
      }
      return;
    }

    // --- TOOL: ELLIPTICAL_ARC (5 clicks: Center -> Major -> Minor -> Arc Start -> Arc End) ---
    if (this.activeTool === 'elliptical_arc') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let cId: string;
        if (snap && snap.type === 'point' && snap.id) {
          cId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const ptPos = snap ? snap.worldPos : world;
          const pt = this.sketch.addPoint(ptPos.x, ptPos.y, false, this.isConstructionMode);
          cId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.startPointId = cId;
        this.drawingStep = 1;
        this.render();
      } else if (this.drawingStep === 1) {
        const centerWorld = this.startWorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;
        if (dist(centerWorld, effectiveWorld) < 2) return;

        let p1Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
          p1Id = snap.id;
          this.arcPoint2WorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(effectiveWorld.x, effectiveWorld.y, false, this.isConstructionMode);
          p1Id = pt.id;
          this.arcPoint2WorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.arcPoint2Id = p1Id;
        this.drawingStep = 2;
        this.render();
      } else if (this.drawingStep === 2) {
        const centerWorld = this.startWorldPos!;
        const majWorld = this.arcPoint2WorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;

        const majLen = dist(centerWorld, majWorld);
        if (majLen < 0.1) return;

        const ux = (majWorld.x - centerWorld.x) / majLen;
        const uy = (majWorld.y - centerWorld.y) / majLen;
        const vx = -uy;
        const vy = ux;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        let ryVal = Math.abs(dx * vx + dy * vy);
        if (ryVal < 1) ryVal = 1;
        const sign = dx * vx + dy * vy < 0 ? -1 : 1;

        const minX = centerWorld.x + sign * ryVal * vx;
        const minY = centerWorld.y + sign * ryVal * vy;

        let p2Id: string;
        if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId && snap.id !== this.arcPoint2Id) {
          p2Id = snap.id;
          this.ellipsePoint3WorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(minX, minY, false, this.isConstructionMode);
          p2Id = pt.id;
          this.ellipsePoint3WorldPos = vec(pt.x, pt.y);
          if (snap && snap.type === 'line' && snap.lineId) {
            this.sketch.addPointOnLineConstraint(pt.id, snap.lineId);
            showToast('Point constrained to line');
          }
        }
        this.ellipsePoint3Id = p2Id;
        this.drawingStep = 3;
        this.render();
      } else if (this.drawingStep === 3) {
        const centerWorld = this.startWorldPos!;
        const majWorld = this.arcPoint2WorldPos!;
        const minWorld = this.ellipsePoint3WorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;

        const rxVal = dist(centerWorld, majWorld);
        const ryVal = dist(centerWorld, minWorld);
        if (rxVal < 0.1 || ryVal < 0.1) return;

        const ux = (majWorld.x - centerWorld.x) / rxVal;
        const uy = (majWorld.y - centerWorld.y) / rxVal;
        const vx = (minWorld.x - centerWorld.x) / ryVal;
        const vy = (minWorld.y - centerWorld.y) / ryVal;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        const u = dx * ux + dy * uy;
        const v = dx * vx + dy * vy;
        const t = Math.atan2(v / ryVal, u / rxVal);

        const projX = centerWorld.x + rxVal * Math.cos(t) * ux + ryVal * Math.sin(t) * vx;
        const projY = centerWorld.y + rxVal * Math.cos(t) * uy + ryVal * Math.sin(t) * vy;

        let startPtId: string;
        if (
          snap &&
          snap.type === 'point' &&
          snap.id &&
          snap.id !== this.startPointId &&
          snap.id !== this.arcPoint2Id &&
          snap.id !== this.ellipsePoint3Id
        ) {
          startPtId = snap.id;
          this.ellipseStartPointWorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(projX, projY, false, this.isConstructionMode);
          startPtId = pt.id;
          this.ellipseStartPointWorldPos = vec(pt.x, pt.y);
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }
        this.ellipseStartPointId = startPtId;
        this.drawingStep = 4;
        this.render();
      } else if (this.drawingStep === 4) {
        const centerWorld = this.startWorldPos!;
        const majWorld = this.arcPoint2WorldPos!;
        const minWorld = this.ellipsePoint3WorldPos!;
        const startWorld = this.ellipseStartPointWorldPos!;
        const effectiveWorld = snap ? snap.worldPos : world;

        const rxVal = dist(centerWorld, majWorld);
        const ryVal = dist(centerWorld, minWorld);
        if (rxVal < 0.1 || ryVal < 0.1) return;

        const ux = (majWorld.x - centerWorld.x) / rxVal;
        const uy = (majWorld.y - centerWorld.y) / rxVal;
        const vx = (minWorld.x - centerWorld.x) / ryVal;
        const vy = (minWorld.y - centerWorld.y) / ryVal;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        const u = dx * ux + dy * uy;
        const v = dx * vx + dy * vy;
        const te = Math.atan2(v / ryVal, u / rxVal);

        const projX = centerWorld.x + rxVal * Math.cos(te) * ux + ryVal * Math.sin(te) * vx;
        const projY = centerWorld.y + rxVal * Math.cos(te) * uy + ryVal * Math.sin(te) * vy;

        // Screen orientation calculation for clockwise flag
        const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
        const sMaj = this.viewport.worldToScreen(majWorld.x, majWorld.y);
        const sStart = this.viewport.worldToScreen(startWorld.x, startWorld.y);
        const sCur = this.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

        const theta = Math.atan2(sMaj.y - sCenter.y, sMaj.x - sCenter.x);
        const ux_s = Math.cos(theta);
        const uy_s = Math.sin(theta);
        const vx_s = -Math.sin(theta);
        const vy_s = Math.cos(theta);

        const us = (sStart.x - sCenter.x) * ux_s + (sStart.y - sCenter.y) * uy_s;
        const vs = (sStart.x - sCenter.x) * vx_s + (sStart.y - sCenter.y) * vy_s;
        const ue = (sCur.x - sCenter.x) * ux_s + (sCur.y - sCenter.y) * uy_s;
        const ve = (sCur.x - sCenter.x) * vx_s + (sCur.y - sCenter.y) * vy_s;

        const ts_sc = Math.atan2(vs, us);
        const te_sc = Math.atan2(ve, ue);
        let delta = te_sc - ts_sc;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const clockwise = delta >= 0;

        let endPtId: string;
        if (
          snap &&
          snap.type === 'point' &&
          snap.id &&
          snap.id !== this.startPointId &&
          snap.id !== this.arcPoint2Id &&
          snap.id !== this.ellipsePoint3Id &&
          snap.id !== this.ellipseStartPointId
        ) {
          endPtId = snap.id;
        } else {
          const pt = this.sketch.addPoint(projX, projY, false, this.isConstructionMode);
          endPtId = pt.id;
          this.applySnapConstraintIfNeeded(pt.id, snap);
        }

        this.sketch.addEllipticalArc(
          this.startPointId!,
          this.arcPoint2Id!,
          this.ellipsePoint3Id!,
          this.ellipseStartPointId!,
          endPtId,
          clockwise,
          this.isConstructionMode
        );
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
        showToast('Elliptical arc created');
      }
      return;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    this.isSnapModifierPressed = this.isSnapModifier(e);
    const screen = this.getScreenPos(e);
    const world = this.viewport.screenToWorld(screen.x, screen.y);

    // Pan handling
    if (this.isPanning) {
      const dx = screen.x - this.lastMouseScreen.x;
      const dy = screen.y - this.lastMouseScreen.y;
      this.viewport.pan(dx, dy);
      this.lastMouseScreen = screen;
      this.render();
      return;
    }

    // Box selection handling
    if (this.isBoxSelecting && this.boxSelectStartScreen) {
      this.boxSelectCurrentScreen = screen;
      this.renderer.renderSelectionBox(this.boxSelectStartScreen, this.boxSelectCurrentScreen);
      return;
    }

    // Drag constraint handling (Distance offset & Angle radius/quadrant)
    if (this.isDraggingConstraint && this.draggedConstraintId) {
      if (this.dragConstraintStartScreen && dist(screen, this.dragConstraintStartScreen) > 3) {
        this.hasDragged = true;
      }
      if (this.hasDragged) {
        const constraint = this.sketch.constraints.get(this.draggedConstraintId);
        if (constraint instanceof DistanceConstraint) {
          const p1 = this.sketch.points.get(constraint.p1Id);
          const p2 = this.sketch.points.get(constraint.p2Id);
          if (p1 && p2) {
            const s1 = this.viewport.worldToScreen(p1.x, p1.y);
            const s2 = this.viewport.worldToScreen(p2.x, p2.y);
            const midX = (s1.x + s2.x) * 0.5;
            const midY = (s1.y + s2.y) * 0.5;
            if (constraint.orientation === 'horizontal') {
              const screenOffset = screen.y - midY;
              constraint.offset = screenOffset / this.viewport.zoom;
              this.render();
            } else if (constraint.orientation === 'vertical') {
              const screenOffset = screen.x - midX;
              constraint.offset = screenOffset / this.viewport.zoom;
              this.render();
            } else {
              const dx = s2.x - s1.x;
              const dy = s2.y - s1.y;
              const len = Math.hypot(dx, dy);
              if (len > 1e-4) {
                const nx = -dy / len;
                const ny = dx / len;
                const screenOffset = (screen.x - midX) * nx + (screen.y - midY) * ny;
                constraint.offset = screenOffset / this.viewport.zoom;
                this.render();
              }
            }
          }
        } else if (constraint instanceof AngleConstraint) {
          const l1 = this.sketch.lines.get(constraint.line1Id);
          const l2 = this.sketch.lines.get(constraint.line2Id);
          if (l1 && l2) {
            const p1 = this.sketch.points.get(l1.p1Id);
            const p2 = this.sketch.points.get(l1.p2Id);
            const p3 = this.sketch.points.get(l2.p1Id);
            const p4 = this.sketch.points.get(l2.p2Id);
            if (p1 && p2 && p3 && p4) {
              const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
              const arcRadiusWorld = Math.max(10, Math.hypot(world.x - geom.pInt.x, world.y - geom.pInt.y));
              constraint.arcRadius = arcRadiusWorld;

              // If dragged into a different quadrant/sector:
              if (geom.s1 !== constraint.s1 || geom.s2 !== constraint.s2) {
                constraint.s1 = geom.s1;
                constraint.s2 = geom.s2;
                constraint.sign = geom.sign;
                const newAngle = Math.round(geom.initialAngleDeg * 10) / 10;
                constraint.targetAngle = newAngle;
                constraint.value = newAngle;
                constraint.name = 'Angle';
                this.sketch.solve();
              }
              this.render();
            }
          }
        } else if (constraint instanceof RadiusConstraint) {
          const entity = this.sketch.circles.get(constraint.circleId) ?? this.sketch.arcs.get(constraint.circleId);
          if (entity) {
            const center = this.sketch.points.get(entity.centerId);
            if (center) {
              const sc = this.viewport.worldToScreen(center.x, center.y);
              constraint.leaderAngle = Math.atan2(screen.y - sc.y, screen.x - sc.x);
              this.render();
            }
          }
        }
      }
      return;
    }

    // Drag point handling (Live solver calculation!)
    if (this.isDraggingPoint && this.draggedPointId && this.dragPointStartWorld) {
      this.hasDragged = true;
      const snap = this.findSnap(screen, this.draggedPointId);
      const targetWorld = snap ? snap.worldPos : world;
      this.sketch.dragPoint(this.draggedPointId, targetWorld.x, targetWorld.y);
      this.render();
      if (snap) {
        this.renderer.renderSnapIndicator(snap.screenPos, snap.type, true);
      } else {
        this.renderer.clearPreviews();
      }
      return;
    }

    // Drag line handling (Translates both endpoints simultaneously)
    if (
      this.isDraggingLine &&
      this.draggedLineId &&
      this.dragLineStartWorld &&
      this.lineP1Start &&
      this.lineP2Start
    ) {
      this.hasDragged = true;
      const dx = world.x - this.dragLineStartWorld.x;
      const dy = world.y - this.dragLineStartWorld.y;
      this.sketch.dragLine(
        this.draggedLineId,
        this.lineP1Start.x + dx,
        this.lineP1Start.y + dy,
        this.lineP2Start.x + dx,
        this.lineP2Start.y + dy
      );
      this.render();
      return;
    }

    // Drag circle handling (Translates circle center point or resizes if fixed/shifted)
    if (
      this.isDraggingCircle &&
      this.draggedCircleId &&
      this.dragCircleStartWorld &&
      this.circleCenterStart
    ) {
      this.hasDragged = true;
      const circle = this.sketch.circles.get(this.draggedCircleId);
      const center = circle ? this.sketch.points.get(circle.centerId) : null;
      const isFixed = center ? this.sketch.isPointFixed(center.id) : false;
      const hasRadConst = this.sketch.hasRadiusConstraint(this.draggedCircleId);

      // If Shift or Alt is held, or if center is fixed while radius is unconstrained, adjust radius
      if ((e.shiftKey || e.altKey || (isFixed && !hasRadConst)) && center) {
        const newRadius = Math.max(1, dist(center, world));
        this.sketch.dragCircleRadius(this.draggedCircleId, newRadius);
        this.render();
      } else {
        const dx = world.x - this.dragCircleStartWorld.x;
        const dy = world.y - this.dragCircleStartWorld.y;
        this.sketch.dragCircle(
          this.draggedCircleId,
          this.circleCenterStart.x + dx,
          this.circleCenterStart.y + dy
        );
        this.render();
      }
      return;
    }

    // Drag arc handling (Translates center, start point, and end point simultaneously)
    if (
      this.isDraggingArc &&
      this.draggedArcId &&
      this.dragArcStartWorld &&
      this.arcCenterStart &&
      this.arcStartPointStart &&
      this.arcEndPointStart
    ) {
      this.hasDragged = true;
      const dx = world.x - this.dragArcStartWorld.x;
      const dy = world.y - this.dragArcStartWorld.y;

      const arc = this.sketch.arcs.get(this.draggedArcId);
      if (arc) {
        const center = this.sketch.points.get(arc.centerId);
        const start = this.sketch.points.get(arc.startPointId);
        const end = this.sketch.points.get(arc.endPointId);
        if (center && !center.fixed) {
          center.x = this.arcCenterStart.x + dx;
          center.y = this.arcCenterStart.y + dy;
        }
        if (start && !start.fixed) {
          start.x = this.arcStartPointStart.x + dx;
          start.y = this.arcStartPointStart.y + dy;
        }
        if (end && !end.fixed) {
          end.x = this.arcEndPointStart.x + dx;
          end.y = this.arcEndPointStart.y + dy;
        }
        this.sketch.solve();
        this.render();
      }
      return;
    }

    // Drag ellipse handling (Translates center, major axis point, and minor axis point simultaneously)
    if (
      this.isDraggingEllipse &&
      this.draggedEllipseId &&
      this.dragEllipseStartWorld &&
      this.ellipseCenterStart &&
      this.ellipseMajorPointStart &&
      this.ellipseMinorPointStart
    ) {
      this.hasDragged = true;
      const dx = world.x - this.dragEllipseStartWorld.x;
      const dy = world.y - this.dragEllipseStartWorld.y;

      const ellipse = this.sketch.ellipses.get(this.draggedEllipseId);
      if (ellipse) {
        const center = this.sketch.points.get(ellipse.centerId);
        const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
        const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
        if (center && !center.fixed) {
          center.x = this.ellipseCenterStart.x + dx;
          center.y = this.ellipseCenterStart.y + dy;
        }
        if (majorPt && !majorPt.fixed) {
          majorPt.x = this.ellipseMajorPointStart.x + dx;
          majorPt.y = this.ellipseMajorPointStart.y + dy;
        }
        if (minorPt && !minorPt.fixed) {
          minorPt.x = this.ellipseMinorPointStart.x + dx;
          minorPt.y = this.ellipseMinorPointStart.y + dy;
        }
        this.sketch.solve();
        this.render();
      }
      return;
    }

    // Drag elliptical arc handling (Translates center, major, minor, start, and end points)
    if (
      this.isDraggingEllipticalArc &&
      this.draggedEllipticalArcId &&
      this.dragEllipticalArcStartWorld &&
      this.ellipticalArcCenterStart &&
      this.ellipticalArcMajorPointStart &&
      this.ellipticalArcMinorPointStart &&
      this.ellipticalArcStartPointStart &&
      this.ellipticalArcEndPointStart
    ) {
      this.hasDragged = true;
      const dx = world.x - this.dragEllipticalArcStartWorld.x;
      const dy = world.y - this.dragEllipticalArcStartWorld.y;

      const arc = this.sketch.ellipticalArcs.get(this.draggedEllipticalArcId);
      if (arc) {
        const center = this.sketch.points.get(arc.centerId);
        const majorPt = this.sketch.points.get(arc.majorAxisPointId);
        const minorPt = this.sketch.points.get(arc.minorAxisPointId);
        const start = this.sketch.points.get(arc.startPointId);
        const end = this.sketch.points.get(arc.endPointId);
        if (center && !center.fixed) {
          center.x = this.ellipticalArcCenterStart.x + dx;
          center.y = this.ellipticalArcCenterStart.y + dy;
        }
        if (majorPt && !majorPt.fixed) {
          majorPt.x = this.ellipticalArcMajorPointStart.x + dx;
          majorPt.y = this.ellipticalArcMajorPointStart.y + dy;
        }
        if (minorPt && !minorPt.fixed) {
          minorPt.x = this.ellipticalArcMinorPointStart.x + dx;
          minorPt.y = this.ellipticalArcMinorPointStart.y + dy;
        }
        if (start && !start.fixed) {
          start.x = this.ellipticalArcStartPointStart.x + dx;
          start.y = this.ellipticalArcStartPointStart.y + dy;
        }
        if (end && !end.fixed) {
          end.x = this.ellipticalArcEndPointStart.x + dx;
          end.y = this.ellipticalArcEndPointStart.y + dy;
        }
        this.sketch.solve();
        this.render();
      }
      return;
    }

    // Snapping indicator is shown during primitive creation (both first and subsequent points)
    // or when dragging points (handled in point drag block above).
    const snap = isDrawingPrimitiveTool(this.activeTool)
      ? this.findSnap(screen, this.drawingStep > 0 ? (this.startPointId ?? undefined) : undefined)
      : null;

    if (
      snap &&
      !this.isDraggingPoint &&
      !this.isDraggingLine &&
      !this.isDraggingCircle &&
      !this.isDraggingArc &&
      !this.isDraggingEllipse &&
      !this.isDraggingEllipticalArc
    ) {
      this.renderer.renderSnapIndicator(snap.screenPos, snap.type);
    } else {
      this.renderer.clearPreviews();
    }

    // Active tool drawing preview: Step 1
    if (this.drawingStep === 1 && this.startWorldPos) {
      const s1 = this.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
      let effectiveWorld = snap ? snap.worldPos : world;
      let axisBadge: 'H' | 'V' | undefined;

      if (this.activeTool === 'line') {
        const axisSnap = this.getAxisSnappedWorldPos(this.startWorldPos, effectiveWorld, snap);
        effectiveWorld = axisSnap.pos;
        axisBadge = axisSnap.axis === 'horizontal' ? 'H' : axisSnap.axis === 'vertical' ? 'V' : undefined;
      }
      const s2 = this.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

      if (this.activeTool === 'line' || this.activeTool === 'arc') {
        const length = dist(this.startWorldPos, effectiveWorld);
        const angleDeg =
          (Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
          Math.PI;
        this.renderer.renderLinePreview(s1, s2, length, angleDeg, this.isConstructionMode, axisBadge);
      } else if (this.activeTool === 'circle' || this.activeTool === 'arc_center') {
        const radius = dist(this.startWorldPos, effectiveWorld);
        const isGuide = this.activeTool === 'arc_center';
        this.renderer.renderCirclePreview(s1, s2, radius, this.isConstructionMode, isGuide);
      } else if (this.activeTool === 'rectangle') {
        const w = Math.abs(effectiveWorld.x - this.startWorldPos.x);
        const h = Math.abs(effectiveWorld.y - this.startWorldPos.y);
        this.renderer.renderRectanglePreview(s1, s2, w, h, this.isConstructionMode);
      } else if (this.activeTool === 'ellipse' || this.activeTool === 'elliptical_arc') {
        const rx = dist(this.startWorldPos, effectiveWorld);
        this.renderer.renderEllipseMajorAxisPreview(s1, s2, rx, this.isConstructionMode);
      }
    }

    // Active tool drawing preview: Step 2 (Arcs & Ellipses)
    if (this.drawingStep === 2 && this.startWorldPos && this.arcPoint2WorldPos) {
      const effectiveWorld = snap ? snap.worldPos : world;

      if (this.activeTool === 'arc') {
        const p1 = this.startWorldPos;
        const p2 = this.arcPoint2WorldPos;
        const p3 = effectiveWorld;
        const circum = getCircumcircle(p1, p2, p3);

        const s1 = this.viewport.worldToScreen(p1.x, p1.y);
        const s2 = this.viewport.worldToScreen(p2.x, p2.y);

        if (!circum || circum.radius < 1 || circum.radius > 50000) {
          const length = dist(p1, p2);
          const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
          this.renderer.renderLinePreview(s1, s2, length, angleDeg, this.isConstructionMode);
        } else {
          const sc = this.viewport.worldToScreen(circum.center.x, circum.center.y);
          const s3 = this.viewport.worldToScreen(p3.x, p3.y);
          const sr = circum.radius * this.viewport.zoom;

          const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
          const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
          const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

          let sweepCW = (ae - as) % (2 * Math.PI);
          if (sweepCW < 0) sweepCW += 2 * Math.PI;
          let testCW = (a3 - as) % (2 * Math.PI);
          if (testCW < 0) testCW += 2 * Math.PI;

          const clockwise = testCW > 0 && testCW < sweepCW;
          this.renderer.renderArcPreview(sc, s1, s2, sr, clockwise, circum.radius, undefined, this.isConstructionMode);
        }
      } else if (this.activeTool === 'arc_center') {
        const centerWorld = this.startWorldPos;
        const startWorld = this.arcPoint2WorldPos;
        const radius = Math.max(1, dist(centerWorld, startWorld));

        const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
        const sStart = this.viewport.worldToScreen(startWorld.x, startWorld.y);
        const sCur = this.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
        const sr = radius * this.viewport.zoom;

        const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
        const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

        let delta = acur - as;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const clockwise = delta >= 0;

        const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
        const endWorld = vec(
          centerWorld.x + radius * Math.cos(worldAngle),
          centerWorld.y + radius * Math.sin(worldAngle)
        );
        const sEnd = this.viewport.worldToScreen(endWorld.x, endWorld.y);

        this.renderer.renderArcPreview(
          sCenter,
          sStart,
          sEnd,
          sr,
          clockwise,
          radius,
          (Math.abs(delta) * 180) / Math.PI,
          this.isConstructionMode
        );
      } else if (this.activeTool === 'ellipse' || this.activeTool === 'elliptical_arc') {
        const centerWorld = this.startWorldPos;
        const majWorld = this.arcPoint2WorldPos;
        const majLen = dist(centerWorld, majWorld);
        if (majLen > 0.01) {
          const ux = (majWorld.x - centerWorld.x) / majLen;
          const uy = (majWorld.y - centerWorld.y) / majLen;
          const vx = -uy;
          const vy = ux;
          const dx = effectiveWorld.x - centerWorld.x;
          const dy = effectiveWorld.y - centerWorld.y;
          let ryVal = Math.abs(dx * vx + dy * vy);
          if (ryVal < 1) ryVal = 1;
          const sign = dx * vx + dy * vy < 0 ? -1 : 1;
          const minWorld = vec(centerWorld.x + sign * ryVal * vx, centerWorld.y + sign * ryVal * vy);
          const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
          const sMaj = this.viewport.worldToScreen(majWorld.x, majWorld.y);
          const sMin = this.viewport.worldToScreen(minWorld.x, minWorld.y);
          const isGuide = this.activeTool === 'elliptical_arc';
          this.renderer.renderEllipsePreview(sCenter, sMaj, sMin, majLen, ryVal, this.isConstructionMode, isGuide);
        }
      }
    }

    // Active tool drawing preview: Step 3 (Elliptical Arc start point)
    if (
      this.drawingStep === 3 &&
      this.activeTool === 'elliptical_arc' &&
      this.startWorldPos &&
      this.arcPoint2WorldPos &&
      this.ellipsePoint3WorldPos
    ) {
      const effectiveWorld = snap ? snap.worldPos : world;
      const centerWorld = this.startWorldPos;
      const majWorld = this.arcPoint2WorldPos;
      const minWorld = this.ellipsePoint3WorldPos;

      const rxVal = dist(centerWorld, majWorld);
      const ryVal = dist(centerWorld, minWorld);
      if (rxVal > 0.1 && ryVal > 0.1) {
        const ux = (majWorld.x - centerWorld.x) / rxVal;
        const uy = (majWorld.y - centerWorld.y) / rxVal;
        const vx = (minWorld.x - centerWorld.x) / ryVal;
        const vy = (minWorld.y - centerWorld.y) / ryVal;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        const u = dx * ux + dy * uy;
        const v = dx * vx + dy * vy;
        const t = Math.atan2(v / ryVal, u / rxVal);

        const startWorld = vec(
          centerWorld.x + rxVal * Math.cos(t) * ux + ryVal * Math.sin(t) * vx,
          centerWorld.y + rxVal * Math.cos(t) * uy + ryVal * Math.sin(t) * vy
        );

        const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
        const sMaj = this.viewport.worldToScreen(majWorld.x, majWorld.y);
        const sMin = this.viewport.worldToScreen(minWorld.x, minWorld.y);
        const sStart = this.viewport.worldToScreen(startWorld.x, startWorld.y);
        this.renderer.renderEllipticalArcStartPreview(sCenter, sMaj, sMin, sStart, rxVal, ryVal, this.isConstructionMode);
      }
    }

    // Active tool drawing preview: Step 4 (Elliptical Arc end point)
    if (
      this.drawingStep === 4 &&
      this.activeTool === 'elliptical_arc' &&
      this.startWorldPos &&
      this.arcPoint2WorldPos &&
      this.ellipsePoint3WorldPos &&
      this.ellipseStartPointWorldPos
    ) {
      const effectiveWorld = snap ? snap.worldPos : world;
      const centerWorld = this.startWorldPos;
      const majWorld = this.arcPoint2WorldPos;
      const minWorld = this.ellipsePoint3WorldPos;
      const startWorld = this.ellipseStartPointWorldPos;

      const rxVal = dist(centerWorld, majWorld);
      const ryVal = dist(centerWorld, minWorld);
      if (rxVal > 0.1 && ryVal > 0.1) {
        const ux = (majWorld.x - centerWorld.x) / rxVal;
        const uy = (majWorld.y - centerWorld.y) / rxVal;
        const vx = (minWorld.x - centerWorld.x) / ryVal;
        const vy = (minWorld.y - centerWorld.y) / ryVal;

        const dx = effectiveWorld.x - centerWorld.x;
        const dy = effectiveWorld.y - centerWorld.y;
        const u = dx * ux + dy * uy;
        const v = dx * vx + dy * vy;
        const te = Math.atan2(v / ryVal, u / rxVal);

        const endWorld = vec(
          centerWorld.x + rxVal * Math.cos(te) * ux + ryVal * Math.sin(te) * vx,
          centerWorld.y + rxVal * Math.cos(te) * uy + ryVal * Math.sin(te) * vy
        );

        const sCenter = this.viewport.worldToScreen(centerWorld.x, centerWorld.y);
        const sMaj = this.viewport.worldToScreen(majWorld.x, majWorld.y);
        const sMin = this.viewport.worldToScreen(minWorld.x, minWorld.y);
        const sStart = this.viewport.worldToScreen(startWorld.x, startWorld.y);
        const sEnd = this.viewport.worldToScreen(endWorld.x, endWorld.y);

        const theta = Math.atan2(sMaj.y - sCenter.y, sMaj.x - sCenter.x);
        const ux_s = Math.cos(theta);
        const uy_s = Math.sin(theta);
        const vx_s = -Math.sin(theta);
        const vy_s = Math.cos(theta);

        const us = (sStart.x - sCenter.x) * ux_s + (sStart.y - sCenter.y) * uy_s;
        const vs = (sStart.x - sCenter.x) * vx_s + (sStart.y - sCenter.y) * vy_s;
        const ue = (sEnd.x - sCenter.x) * ux_s + (sEnd.y - sCenter.y) * uy_s;
        const ve = (sEnd.x - sCenter.x) * vx_s + (sEnd.y - sCenter.y) * vy_s;

        const ts_sc = Math.atan2(vs, us);
        const te_sc = Math.atan2(ve, ue);
        let delta = te_sc - ts_sc;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const clockwise = delta >= 0;

        this.renderer.renderEllipticalArcPreview(
          sCenter,
          sMaj,
          sMin,
          sStart,
          sEnd,
          rxVal,
          ryVal,
          clockwise,
          this.isConstructionMode
        );
      }
    }

    // Dimension tool live preview
    if (this.activeTool === 'dimension') {
      let p1Id: string | null = null;
      let p2Id: string | null = null;

      if (this.dimensionState.step === 1 && this.dimensionState.line1Id) {
        const l1 = this.sketch.lines.get(this.dimensionState.line1Id);
        if (l1) {
          p1Id = l1.p1Id;
          p2Id = l1.p2Id;
        }
      } else if (this.dimensionState.step === 2 && this.dimensionState.point1Id && this.dimensionState.point2Id) {
        p1Id = this.dimensionState.point1Id;
        p2Id = this.dimensionState.point2Id;
      } else if (this.dimensionState.step === 1 && this.dimensionState.point1Id) {
        const p1 = this.sketch.points.get(this.dimensionState.point1Id);
        if (p1) {
          const s1 = this.viewport.worldToScreen(p1.x, p1.y);
          const snapPt = this.findSnappedPoint(screen, this.dimensionState.point1Id);
          const targetScreen = snapPt ? snapPt.screenPos : screen;
          const targetWorld = snapPt ? snapPt.worldPos : world;
          const currentDist = dist(p1, targetWorld);
          const angleDeg = ((Math.atan2(targetWorld.y - p1.y, targetWorld.x - p1.x) * 180) / Math.PI + 360) % 360;
          this.renderer.renderLinePreview(s1, targetScreen, currentDist, angleDeg);
        }
      }

      if (p1Id && p2Id) {
        const p1 = this.sketch.points.get(p1Id);
        const p2 = this.sketch.points.get(p2Id);
        if (p1 && p2) {
          const s1 = this.viewport.worldToScreen(p1.x, p1.y);
          const s2 = this.viewport.worldToScreen(p2.x, p2.y);
          const { orientation } = determineDistanceOrientation(s1, s2, screen);
          let currentDist = dist(p1, p2);
          if (orientation === 'horizontal') {
            currentDist = Math.abs(p2.x - p1.x);
          } else if (orientation === 'vertical') {
            currentDist = Math.abs(p2.y - p1.y);
          }
          this.renderer.renderDistancePreview(s1, s2, screen, currentDist, orientation);
        }
      } else if (this.dimensionState.step === 2 && this.dimensionState.line1Id && this.dimensionState.line2Id) {
        const l1 = this.sketch.lines.get(this.dimensionState.line1Id);
        const l2 = this.sketch.lines.get(this.dimensionState.line2Id);
        if (l1 && l2) {
          const p1 = this.sketch.points.get(l1.p1Id);
          const p2 = this.sketch.points.get(l1.p2Id);
          const p3 = this.sketch.points.get(l2.p1Id);
          const p4 = this.sketch.points.get(l2.p2Id);
          if (p1 && p2 && p3 && p4) {
            const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
            const sCenter = this.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
            const sRay1 = this.viewport.worldToScreen(geom.pInt.x + geom.u1.x * 20, geom.pInt.y + geom.u1.y * 20);
            const sRay2 = this.viewport.worldToScreen(geom.pInt.x + geom.u2.x * 20, geom.pInt.y + geom.u2.y * 20);
            const sp1 = this.viewport.worldToScreen(p1.x, p1.y);
            const sp2 = this.viewport.worldToScreen(p2.x, p2.y);
            const sp3 = this.viewport.worldToScreen(p3.x, p3.y);
            const sp4 = this.viewport.worldToScreen(p4.x, p4.y);
            this.renderer.renderAnglePreview(sCenter, sRay1, sRay2, screen, geom.initialAngleDeg, sp1, sp2, sp3, sp4);
          }
        }
      }
    }
  }

  private handleMouseUp(e?: MouseEvent): void {
    if (e) {
      this.isSnapModifierPressed = this.isSnapModifier(e);
    }
    this.svg.classList.remove('is-dragging');
    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursor();
    }
    if (this.isDraggingPoint) {
      const draggedPtId = this.draggedPointId;
      this.isDraggingPoint = false;
      this.draggedPointId = null;
      this.dragPointStartWorld = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        if (draggedPtId) {
          const screen = e ? this.getScreenPos(e) : this.lastMouseScreen;
          const snap = this.findSnap(screen, draggedPtId);
          if (
            snap &&
            ((snap.type === 'point' && snap.id && snap.id !== draggedPtId) ||
              (snap.type === 'line' && snap.lineId) ||
              (snap.type === 'circle' && snap.circleId))
          ) {
            const pt = this.sketch.getPoint(draggedPtId);
            if (pt) {
              pt.x = snap.worldPos.x;
              pt.y = snap.worldPos.y;
            }
            if (this.preDragSnapshot) {
              this.sketch.beginTransactionWithSnapshot(this.preDragSnapshot);
              this.preDragSnapshot = null;
            } else {
              this.sketch.beginTransaction();
            }
            if (snap.type === 'point' && snap.id) {
              const c = this.sketch.addCoincidentConstraint(draggedPtId, snap.id);
              if (c) {
                showToast('Coincident constraint applied');
              }
            } else if (snap.type === 'line' && snap.lineId) {
              const c = this.sketch.addPointOnLineConstraint(draggedPtId, snap.lineId);
              if (c) {
                showToast('Point constrained to line');
              }
            } else if (snap.type === 'circle' && snap.circleId) {
              const c = this.sketch.addPointOnCircleConstraint(draggedPtId, snap.circleId);
              if (c) {
                showToast('Point constrained to circle');
              }
            }
            this.sketch.commitTransaction();
          }
        }
        // Final solve without soft drag constraint to ensure exact convergence
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingLine) {
      this.isDraggingLine = false;
      this.draggedLineId = null;
      this.dragLineStartWorld = null;
      this.lineP1Start = null;
      this.lineP2Start = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingCircle) {
      this.isDraggingCircle = false;
      this.draggedCircleId = null;
      this.dragCircleStartWorld = null;
      this.circleCenterStart = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingArc) {
      this.isDraggingArc = false;
      this.draggedArcId = null;
      this.dragArcStartWorld = null;
      this.arcCenterStart = null;
      this.arcStartPointStart = null;
      this.arcEndPointStart = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingEllipse) {
      this.isDraggingEllipse = false;
      this.draggedEllipseId = null;
      this.dragEllipseStartWorld = null;
      this.ellipseCenterStart = null;
      this.ellipseMajorPointStart = null;
      this.ellipseMinorPointStart = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingEllipticalArc) {
      this.isDraggingEllipticalArc = false;
      this.draggedEllipticalArcId = null;
      this.dragEllipticalArcStartWorld = null;
      this.ellipticalArcCenterStart = null;
      this.ellipticalArcMajorPointStart = null;
      this.ellipticalArcMinorPointStart = null;
      this.ellipticalArcStartPointStart = null;
      this.ellipticalArcEndPointStart = null;
      this.renderer.clearPreviews();
      if (this.hasDragged) {
        this.sketch.solve();
        this.render();
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
    if (this.isDraggingConstraint) {
      const hadDragged = this.hasDragged;

      this.isDraggingConstraint = false;
      this.draggedConstraintId = null;
      this.dragConstraintStartScreen = null;

      if (hadDragged) {
        if (this.preDragSnapshot) {
          this.sketch.pushSnapshot(this.preDragSnapshot);
        }
        this.preDragSnapshot = null;
        this.hasDragged = false;
        this.render();
      } else {
        this.preDragSnapshot = null;
        this.hasDragged = false;
      }
      this.updateCursor();
    }

    if (this.isBoxSelecting) {
      const startScreen = this.boxSelectStartScreen;
      const endScreen = e ? this.getScreenPos(e) : (this.boxSelectCurrentScreen ?? startScreen);
      const isShift = this.boxSelectShift || (e ? e.shiftKey : false);

      this.isBoxSelecting = false;
      this.boxSelectStartScreen = null;
      this.boxSelectCurrentScreen = null;
      this.boxSelectShift = false;
      this.renderer.clearPreviews();

      if (startScreen && endScreen && dist(startScreen, endScreen) > 4) {
        this.finishBoxSelection(startScreen, endScreen, isShift);
      }
      this.render();
    }

    if (!this.hasDragged && this.pendingExclusiveSelection) {
      this.sketch.selectEntity(
        this.pendingExclusiveSelection.id,
        this.pendingExclusiveSelection.type,
        false
      );
      this.render();
    }
    this.pendingExclusiveSelection = null;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const screen = this.getScreenPos(e);
    // Smooth continuous zoom factor depending exponentially on deltaY via Math.pow
    const zoomFactor = Math.pow(2, -e.deltaY * 0.0015);
    this.viewport.zoomAt(screen.x, screen.y, zoomFactor);
    this.render();
  }

  private triggerDimensionEditAt(e: MouseEvent, screen: Vec2, clientPos: Vec2): boolean {
    const target = e.target as SVGElement;
    const targetG = target.closest('[data-id]') as SVGElement | null;
    let id = targetG?.getAttribute('data-id');
    let type = targetG?.getAttribute('data-type');

    // If target didn't resolve to a line, circle, arc, or constraint, use geometric hit test
    if (!type || (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'constraint')) {
      const hitConstraint = this.findConstraintNearScreen(screen, 18);
      if (hitConstraint) {
        id = hitConstraint.id;
        type = 'constraint';
      } else {
        const hitLine = this.findLineNearScreen(screen, 18);
        if (hitLine) {
          id = hitLine.id;
          type = 'line';
        } else {
          const hitCircle = this.findCircleNearScreen(screen, 18);
          if (hitCircle) {
            id = hitCircle.id;
            type = 'circle';
          } else {
            const hitArc = this.findArcNearScreen(screen, 18);
            if (hitArc) {
              id = hitArc.id;
              type = 'arc';
            }
          }
        }
      }
    }

    if (!id || !type) return false;

    if (type === 'constraint') {
      const constraint = this.sketch.constraints.get(id);
      if (
        (constraint instanceof DistanceConstraint ||
          constraint instanceof RadiusConstraint ||
          constraint instanceof AngleConstraint) &&
        this.onEditDimension
      ) {
        this.sketch.selectEntity(constraint.id, 'constraint', false);
        this.render();
        this.onEditDimension(constraint, clientPos);
        return true;
      }
    } else if (type === 'line') {
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

        if (distConstraint && this.onEditDimension) {
          this.sketch.selectEntity(distConstraint.id, 'constraint', false);
          this.render();
          this.onEditDimension(distConstraint, clientPos);
          return true;
        }
      }
    } else if (type === 'circle' || type === 'arc') {
      const isCircle = this.sketch.circles.has(id);
      const entity = this.sketch.circles.get(id) ?? this.sketch.arcs.get(id);
      if (entity) {
        let radConstraint = [...this.sketch.constraints.values()].find(
          c => c instanceof RadiusConstraint && c.circleId === entity.id
        ) as RadiusConstraint | undefined;

        if (!radConstraint) {
          // Circle defaults to diameter, arc defaults to radius
          radConstraint =
            this.sketch.addRadiusConstraint(entity.id, undefined, isCircle ? 'diameter' : 'radius') ??
            undefined;
        }

        if (radConstraint && this.onEditDimension) {
          this.sketch.selectEntity(radConstraint.id, 'constraint', false);
          this.render();
          this.onEditDimension(radConstraint, clientPos);
          return true;
        }
      }
    }

    return false;
  }

  private handleDoubleClick(e: MouseEvent): void {
    if (this.activeTool !== 'select') return;
    const now = performance.now();
    if (now - this.lastDoubleClickedTime < 600) {
      return;
    }
    this.isSnapModifierPressed = this.isSnapModifier(e);
    const screen = this.getScreenPos(e);
    const clientPos = vec(e.clientX, e.clientY);
    if (this.triggerDimensionEditAt(e, screen, clientPos)) {
      e.preventDefault();
      e.stopPropagation();
      this.lastDoubleClickedTime = now;
      this.cancelDrawing();
    }
  }

  private handleDimensionClick(e: MouseEvent, screen: Vec2, clientPos: Vec2): void {
    const world = this.viewport.screenToWorld(screen.x, screen.y);
    const snap = this.findSnappedPoint(screen);

    const target = e.target as SVGElement;
    const targetG = target.closest('[data-id]') as SVGElement | null;
    let id = targetG?.getAttribute('data-id');
    let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'arc' | 'constraint' | undefined;

    // Priority 1: When selecting points in step 0 or step 1, points ALWAYS have top priority!
    if (this.dimensionState.step === 0 || this.dimensionState.step === 1) {
      const nearPoint = this.findPointNearScreen(screen, 16);
      if (nearPoint) {
        id = nearPoint.id;
        type = 'point';
      }
    }

    // Geometric hit test fallback if not clicking directly on entity
    if (!type || (type !== 'point' && type !== 'line' && type !== 'circle' && type !== 'arc')) {
      if (snap) {
        id = snap.id;
        type = 'point';
      } else {
        const hitLine = this.findLineNearScreen(screen, 18);
        if (hitLine) {
          id = hitLine.id;
          type = 'line';
        } else {
          const hitCircle = this.findCircleNearScreen(screen, 18);
          if (hitCircle) {
            id = hitCircle.id;
            type = 'circle';
          } else {
            const hitArc = this.findArcNearScreen(screen, 18);
            if (hitArc) {
              id = hitArc.id;
              type = 'arc';
            }
          }
        }
      }
    }

    // If waiting for second point in step 1, snap to point has priority
    if (this.dimensionState.step === 1 && this.dimensionState.point1Id) {
      if (snap && snap.id !== this.dimensionState.point1Id) {
        id = snap.id;
        type = 'point';
      }
    }

    // STEP 0: Select first entity (point, line, or circle/arc)
    if (this.dimensionState.step === 0) {
      if (type === 'point' && id) {
        this.sketch.clearSelection();
        this.sketch.selectEntity(id, 'point', false);
        this.dimensionState = { step: 1, line1Id: null, line2Id: null, point1Id: id, point2Id: null };
        this.render();
      } else if (type === 'line' && id) {
        this.sketch.clearSelection();
        this.sketch.selectEntity(id, 'line', false);
        this.dimensionState = { step: 1, line1Id: id, line2Id: null, point1Id: null, point2Id: null };
        this.render();
      } else if ((type === 'circle' || type === 'arc') && id) {
        const existed = this.sketch.hasRadiusConstraint(id);
        const c = this.sketch.addRadiusConstraint(id);
        if (c) {
          showToast(existed ? 'Editing radius constraint' : 'Radius constraint applied');
          this.sketch.clearSelection();
          this.sketch.selectEntity(c.id, 'constraint', false);
          this.render();
          if (this.onEditDimension) {
            this.onEditDimension(c, clientPos);
          }
        }
      } else {
        this.sketch.clearSelection();
        this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
        this.renderer.clearPreviews();
        this.render();
      }
      return;
    }

    // STEP 1: First point OR first line was selected
    if (this.dimensionState.step === 1) {
      // Subcase 1: First point was selected. Now picking second point!
      if (this.dimensionState.point1Id) {
        if (type === 'point' && id && id !== this.dimensionState.point1Id) {
          this.sketch.selectEntity(id, 'point', true);
          this.dimensionState = {
            step: 2,
            line1Id: null,
            line2Id: null,
            point1Id: this.dimensionState.point1Id,
            point2Id: id,
          };
          this.render();
        }
        return;
      }

      // Subcase 2: First line was selected.
      const l1 = this.dimensionState.line1Id ? this.sketch.lines.get(this.dimensionState.line1Id) : null;
      if (!l1) {
        this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
        this.renderer.clearPreviews();
        this.render();
        return;
      }

      // If clicked on another line -> switch to Angle constraint mode!
      if (type === 'line' && id && id !== l1.id) {
        this.sketch.selectEntity(id, 'line', true);
        this.dimensionState = { step: 2, line1Id: l1.id, line2Id: id, point1Id: null, point2Id: null };
        this.render();
        return;
      }

      // Second click sets offset & orientation for line distance constraint
      const p1 = this.sketch.points.get(l1.p1Id);
      const p2 = this.sketch.points.get(l1.p2Id);
      if (p1 && p2) {
        const s1 = this.viewport.worldToScreen(p1.x, p1.y);
        const s2 = this.viewport.worldToScreen(p2.x, p2.y);
        const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
        const offsetWorld = offsetScreen / this.viewport.zoom;

        const existed = this.sketch.hasDistanceConstraint(l1.p1Id, l1.p2Id, orientation);
        const c = this.sketch.addDistanceConstraint(l1.p1Id, l1.p2Id, undefined, offsetWorld, orientation);
        if (c) {
          const toastMsg = existed
            ? 'Editing distance constraint'
            : orientation === 'horizontal'
            ? 'Horizontal distance constraint applied'
            : orientation === 'vertical'
            ? 'Vertical distance constraint applied'
            : 'Distance constraint applied';
          showToast(toastMsg);
          this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
          this.renderer.clearPreviews();
          this.sketch.clearSelection();
          this.render();
          if (this.onEditDimension) {
            this.onEditDimension(c, clientPos);
          }
        }
      }
      return;
    }

    // STEP 2: Either two points were selected OR two lines were selected
    if (this.dimensionState.step === 2) {
      // Subcase 1: Two points selected! 3rd click sets offset & places distance constraint!
      if (this.dimensionState.point1Id && this.dimensionState.point2Id) {
        const p1 = this.sketch.points.get(this.dimensionState.point1Id);
        const p2 = this.sketch.points.get(this.dimensionState.point2Id);
        if (p1 && p2) {
          const s1 = this.viewport.worldToScreen(p1.x, p1.y);
          const s2 = this.viewport.worldToScreen(p2.x, p2.y);
          const { orientation, offsetScreen } = determineDistanceOrientation(s1, s2, screen);
          const offsetWorld = offsetScreen / this.viewport.zoom;

          const existed = this.sketch.hasDistanceConstraint(
            this.dimensionState.point1Id,
            this.dimensionState.point2Id,
            orientation
          );
          const c = this.sketch.addDistanceConstraint(
            this.dimensionState.point1Id,
            this.dimensionState.point2Id,
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
            showToast(toastMsg);
            this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
            this.renderer.clearPreviews();
            this.sketch.clearSelection();
            this.render();
            if (this.onEditDimension) {
              this.onEditDimension(c, clientPos);
            }
          }
        }
        return;
      }

      // Subcase 2: Two lines selected (Angle mode)
      const l1 = this.dimensionState.line1Id ? this.sketch.lines.get(this.dimensionState.line1Id) : null;
      const l2 = this.dimensionState.line2Id ? this.sketch.lines.get(this.dimensionState.line2Id) : null;
      if (!l1 || !l2) {
        this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
        this.renderer.clearPreviews();
        this.render();
        return;
      }

      const p1 = this.sketch.points.get(l1.p1Id);
      const p2 = this.sketch.points.get(l1.p2Id);
      const p3 = this.sketch.points.get(l2.p1Id);
      const p4 = this.sketch.points.get(l2.p2Id);
      if (p1 && p2 && p3 && p4) {
        const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
        const arcRadiusWorld = Math.max(10, Math.hypot(world.x - geom.pInt.x, world.y - geom.pInt.y));
        const existed = this.sketch.hasAngleConstraint(l1.id, l2.id);
        const c = this.sketch.addAngleConstraint(l1.id, l2.id, undefined, arcRadiusWorld, world);
        if (c) {
          showToast(existed ? 'Editing angle constraint' : 'Angle constraint applied');
          this.dimensionState = { step: 0, line1Id: null, line2Id: null, point1Id: null, point2Id: null };
          this.renderer.clearPreviews();
          this.sketch.clearSelection();
          this.render();
          if (this.onEditDimension) {
            this.onEditDimension(c, clientPos);
          }
        }
      }
      return;
    }
  }

  private updateCursor(): void {
    if (this.activeTool === 'select') {
      this.svg.style.cursor = 'default';
    } else if (this.activeTool === 'pan') {
      this.svg.style.cursor = 'grab';
    } else {
      this.svg.style.cursor = 'crosshair';
    }
  }

  pruneIncompatibleSelection(type: string): void {
    const sel = this.sketch.selection;
    switch (type) {
      case 'fixed': {
        sel.lineIds.clear();
        sel.circleIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'coincident': {
        if (sel.lineIds.size > 0 && sel.circleIds.size + sel.arcIds.size > 0) {
          sel.circleIds.clear();
          sel.arcIds.clear();
        }
        break;
      }
      case 'parallel':
      case 'perpendicular': {
        sel.pointIds.clear();
        sel.circleIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'concentric': {
        sel.pointIds.clear();
        sel.lineIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'tangent': {
        sel.pointIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'point_on_line':
      case 'midpoint': {
        sel.circleIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'horizontal_vertical':
      case 'horizontal':
      case 'vertical': {
        if (sel.lineIds.size > 0) {
          sel.pointIds.clear();
        }
        sel.circleIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'equal': {
        if (sel.lineIds.size > 0) {
          sel.circleIds.clear();
        } else if (sel.circleIds.size > 0) {
          sel.lineIds.clear();
        }
        sel.pointIds.clear();
        sel.arcIds.clear();
        break;
      }
      case 'dimension':
      case 'distance': {
        sel.arcIds.clear();
        break;
      }
    }
    sel.ellipseIds.clear();
    sel.ellipticalArcIds.clear();
    // Clean up constraintIds
    sel.constraintIds.clear();
    for (const pid of sel.pointIds) {
      for (const c of this.sketch.getConstraintsForEntity('point', pid)) {
        sel.constraintIds.add(c.id);
      }
    }
    for (const lid of sel.lineIds) {
      for (const c of this.sketch.getConstraintsForEntity('line', lid)) {
        sel.constraintIds.add(c.id);
      }
    }
    for (const cid of sel.circleIds) {
      for (const c of this.sketch.getConstraintsForEntity('circle', cid)) {
        sel.constraintIds.add(c.id);
      }
    }
    for (const aid of sel.arcIds) {
      for (const c of this.sketch.getConstraintsForEntity('arc', aid)) {
        sel.constraintIds.add(c.id);
      }
    }
    for (const eid of sel.ellipseIds) {
      for (const c of this.sketch.getConstraintsForEntity('ellipse', eid)) {
        sel.constraintIds.add(c.id);
      }
    }
    for (const eaid of sel.ellipticalArcIds) {
      for (const c of this.sketch.getConstraintsForEntity('elliptical_arc', eaid)) {
        sel.constraintIds.add(c.id);
      }
    }
  }

  isEntityCompatibleWithConstraint(
    constraintType: string,
    entityType: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
  ): boolean {
    switch (constraintType) {
      case 'fixed':
        return entityType === 'point';
      case 'coincident':
        return entityType === 'point' || entityType === 'line' || entityType === 'circle' || entityType === 'arc';
      case 'horizontal_vertical':
      case 'horizontal':
      case 'vertical':
        return entityType === 'line' || entityType === 'point';
      case 'dimension':
      case 'distance':
        return entityType === 'line' || entityType === 'circle' || entityType === 'arc' || entityType === 'point';
      case 'equal':
        return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
      case 'parallel':
      case 'perpendicular':
        return entityType === 'line';
      case 'tangent':
        return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
      case 'concentric':
        return entityType === 'circle' || entityType === 'arc';
      case 'point_on_line':
      case 'midpoint':
        return entityType === 'point' || entityType === 'line';
      default:
        return false;
    }
  }

  canApplyConstraint(type: string): boolean {
    const sel = this.sketch.selection;
    const pCount = sel.pointIds.size;
    const lCount = sel.lineIds.size;
    const cCount = sel.circleIds.size + sel.arcIds.size;

    switch (type) {
      case 'fixed':
        return pCount >= 1;
      case 'coincident':
        return (
          (pCount === 2 && lCount === 0 && cCount === 0) ||
          (pCount === 1 && lCount === 1 && cCount === 0) ||
          (pCount === 1 && cCount === 1 && lCount === 0)
        );
      case 'horizontal_vertical':
      case 'horizontal':
      case 'vertical':
        return (lCount === 1 && pCount === 0 && cCount === 0) || (pCount === 2 && lCount === 0 && cCount === 0);
      case 'dimension':
      case 'distance':
        return (
          (lCount === 1 && pCount === 0 && cCount === 0) ||
          (lCount === 2 && pCount === 0 && cCount === 0) ||
          (pCount === 2 && lCount === 0 && cCount === 0) ||
          (cCount === 1 && pCount === 0 && lCount === 0)
        );
      case 'equal':
        return (lCount === 2 && pCount === 0 && cCount === 0) || (cCount === 2 && pCount === 0 && lCount === 0);
      case 'parallel':
      case 'perpendicular':
        return lCount === 2 && pCount === 0 && cCount === 0;
      case 'tangent':
        return lCount === 1 && cCount === 1 && pCount === 0;
      case 'concentric':
        return cCount === 2 && pCount === 0 && lCount === 0;
      case 'point_on_line':
      case 'midpoint':
        return pCount === 1 && lCount === 1 && cCount === 0;
      default:
        return false;
    }
  }

  applyConstraint(type: string): boolean {
    const sel = this.sketch.selection;
    const pIds = [...sel.pointIds];
    const lIds = [...sel.lineIds];
    const cIds = [...sel.circleIds, ...sel.arcIds];

    let applied = false;
    let toastMsg = '';

    switch (type) {
      case 'fixed': {
        if (pIds.length >= 1) {
          const appliedNow = this.sketch.toggleFixedConstraints(pIds);
          applied = true;
          toastMsg = appliedNow ? 'Fixed constraint applied' : 'Fixed constraint removed';
        }
        break;
      }
      case 'coincident': {
        if (pIds.length === 2 && lIds.length === 0 && cIds.length === 0) {
          this.sketch.addCoincidentConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = 'Coincident constraint applied';
        } else if (pIds.length === 1 && lIds.length === 1 && cIds.length === 0) {
          const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
          if (c) {
            applied = true;
            toastMsg = 'Point on line constraint applied';
          } else {
            showToast('Cannot constrain point to this line');
          }
        } else if (pIds.length === 1 && cIds.length === 1 && lIds.length === 0) {
          const c = this.sketch.addPointOnCircleConstraint(pIds[0], cIds[0]);
          if (c) {
            applied = true;
            toastMsg = 'Point on circle constraint applied';
          } else {
            showToast('Cannot constrain point to this circle/arc');
          }
        }
        break;
      }
      case 'horizontal_vertical': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          const p1 = this.sketch.points.get(l.p1Id);
          const p2 = this.sketch.points.get(l.p2Id);
          if (p1 && p2) {
            const dx = Math.abs(p2.x - p1.x);
            const dy = Math.abs(p2.y - p1.y);
            if (dx >= dy) {
              this.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
              applied = true;
              toastMsg = 'Horizontal constraint applied';
            } else {
              this.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
              applied = true;
              toastMsg = 'Vertical constraint applied';
            }
          }
        } else if (pIds.length === 2) {
          const p1 = this.sketch.points.get(pIds[0]);
          const p2 = this.sketch.points.get(pIds[1]);
          if (p1 && p2) {
            const dx = Math.abs(p2.x - p1.x);
            const dy = Math.abs(p2.y - p1.y);
            if (dx >= dy) {
              this.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
              applied = true;
              toastMsg = 'Horizontal constraint applied';
            } else {
              this.sketch.addVerticalConstraint(pIds[0], pIds[1]);
              applied = true;
              toastMsg = 'Vertical constraint applied';
            }
          }
        }
        break;
      }
      case 'horizontal': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          this.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
          applied = true;
          toastMsg = 'Horizontal constraint applied';
        } else if (pIds.length === 2) {
          this.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = 'Horizontal constraint applied';
        }
        break;
      }
      case 'vertical': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          this.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
          applied = true;
          toastMsg = 'Vertical constraint applied';
        } else if (pIds.length === 2) {
          this.sketch.addVerticalConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = 'Vertical constraint applied';
        }
        break;
      }
      case 'dimension':
      case 'distance': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          const existed = this.sketch.hasDistanceConstraint(l.p1Id, l.p2Id);
          const c = this.sketch.addDistanceConstraint(l.p1Id, l.p2Id);
          applied = true;
          toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
          if (c && this.onEditDimension) {
            const p1 = this.sketch.points.get(l.p1Id);
            const p2 = this.sketch.points.get(l.p2Id);
            const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0;
            const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0;
            const s = this.viewport.worldToScreen(midX, midY);
            const rect = this.svg.getBoundingClientRect();
            this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
          }
        } else if (lIds.length === 2) {
          const existed = this.sketch.hasAngleConstraint(lIds[0], lIds[1]);
          const c = this.sketch.addAngleConstraint(lIds[0], lIds[1]);
          applied = true;
          toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
          if (c && this.onEditDimension) {
            const l1 = this.sketch.lines.get(lIds[0])!;
            const l2 = this.sketch.lines.get(lIds[1])!;
            const p1 = this.sketch.points.get(l1.p1Id)!;
            const p2 = this.sketch.points.get(l1.p2Id)!;
            const p3 = this.sketch.points.get(l2.p1Id)!;
            const p4 = this.sketch.points.get(l2.p2Id)!;
            const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);
            const s = this.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
            const rect = this.svg.getBoundingClientRect();
            this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
          }
        } else if (pIds.length === 2) {
          const existed = this.sketch.hasDistanceConstraint(pIds[0], pIds[1]);
          const c = this.sketch.addDistanceConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
          if (c && this.onEditDimension) {
            const p1 = this.sketch.points.get(pIds[0]);
            const p2 = this.sketch.points.get(pIds[1]);
            const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0;
            const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0;
            const s = this.viewport.worldToScreen(midX, midY);
            const rect = this.svg.getBoundingClientRect();
            this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
          }
        } else if (cIds.length === 1) {
          const existed = this.sketch.hasRadiusConstraint(cIds[0]);
          const c = this.sketch.addRadiusConstraint(cIds[0]);
          applied = true;
          toastMsg = existed ? 'Editing radius constraint' : 'Radius constraint applied';
          if (c && this.onEditDimension) {
            const circ = this.sketch.circles.get(cIds[0]) ?? this.sketch.arcs.get(cIds[0]);
            const center = circ ? this.sketch.points.get(circ.centerId) : null;
            const s = center ? this.viewport.worldToScreen(center.x, center.y) : { x: 100, y: 100 };
            const rect = this.svg.getBoundingClientRect();
            this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
          }
        }
        break;
      }
      case 'equal': {
        if (lIds.length === 2) {
          this.sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
          applied = true;
          toastMsg = 'Equal length constraint applied';
        } else if (cIds.length === 2) {
          this.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
          applied = true;
          toastMsg = 'Equal radius constraint applied';
        }
        break;
      }
      case 'parallel': {
        if (lIds.length === 2) {
          this.sketch.addParallelConstraint(lIds[0], lIds[1]);
          applied = true;
          toastMsg = 'Parallel constraint applied';
        }
        break;
      }
      case 'perpendicular': {
        if (lIds.length === 2) {
          this.sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
          applied = true;
          toastMsg = 'Perpendicular constraint applied';
        }
        break;
      }
      case 'tangent': {
        if (lIds.length === 1 && cIds.length === 1) {
          this.sketch.addTangentConstraint(lIds[0], cIds[0]);
          applied = true;
          toastMsg = 'Tangent constraint applied';
        }
        break;
      }
      case 'concentric': {
        if (cIds.length === 2) {
          this.sketch.addConcentricConstraint(cIds[0], cIds[1]);
          applied = true;
          toastMsg = 'Concentric constraint applied';
        }
        break;
      }
      case 'point_on_line': {
        if (pIds.length === 1 && lIds.length === 1) {
          const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
          if (c) {
            applied = true;
            toastMsg = 'Point on line constraint applied';
          } else {
            showToast('Cannot constrain point to this line');
          }
        }
        break;
      }
      case 'midpoint': {
        if (pIds.length === 1 && lIds.length === 1) {
          this.sketch.addMidpointConstraint(pIds[0], lIds[0]);
          applied = true;
          toastMsg = 'Midpoint constraint applied';
        }
        break;
      }
    }

    if (applied) {
      if (toastMsg) showToast(toastMsg);
      this.sketch.solve();
      this.render();
    }

    return applied;
  }

  deselectEntity(id: string, type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'): void {
    if (type === 'point') {
      this.sketch.selection.pointIds.delete(id);
    } else if (type === 'line') {
      this.sketch.selection.lineIds.delete(id);
    } else if (type === 'circle') {
      this.sketch.selection.circleIds.delete(id);
    } else if (type === 'arc') {
      this.sketch.selection.arcIds.delete(id);
    } else if (type === 'ellipse') {
      this.sketch.selection.ellipseIds.delete(id);
    } else if (type === 'elliptical_arc') {
      this.sketch.selection.ellipticalArcIds.delete(id);
    }
    this.sketch.selection.constraintIds.clear();
    for (const pid of this.sketch.selection.pointIds) {
      for (const c of this.sketch.getConstraintsForEntity('point', pid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    for (const lid of this.sketch.selection.lineIds) {
      for (const c of this.sketch.getConstraintsForEntity('line', lid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    for (const cid of this.sketch.selection.circleIds) {
      for (const c of this.sketch.getConstraintsForEntity('circle', cid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    for (const aid of this.sketch.selection.arcIds) {
      for (const c of this.sketch.getConstraintsForEntity('arc', aid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    for (const eid of this.sketch.selection.ellipseIds) {
      for (const c of this.sketch.getConstraintsForEntity('ellipse', eid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    for (const eaid of this.sketch.selection.ellipticalArcIds) {
      for (const c of this.sketch.getConstraintsForEntity('elliptical_arc', eaid)) {
        this.sketch.selection.constraintIds.add(c.id);
      }
    }
    this.sketch.notify();
  }

  private handleConstraintEntityClick(
    id: string,
    type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
  ): void {
    if (!isConstraintTool(this.activeTool)) return;
    const constraintType = this.activeTool;

    if (!this.isEntityCompatibleWithConstraint(constraintType, type)) {
      return;
    }

    if (constraintType === 'fixed') {
      if (type === 'point') {
        const isNowFixed = this.sketch.toggleFixedConstraint(id);
        showToast(isNowFixed ? 'Fixed constraint applied' : 'Fixed constraint removed');
        this.render();
      }
      return;
    }

    const sel = this.sketch.selection;
    const isAlreadySelected =
      (type === 'point' && sel.pointIds.has(id)) ||
      (type === 'line' && sel.lineIds.has(id)) ||
      (type === 'circle' && sel.circleIds.has(id)) ||
      (type === 'arc' && sel.arcIds.has(id)) ||
      (type === 'ellipse' && sel.ellipseIds.has(id)) ||
      (type === 'elliptical_arc' && sel.ellipticalArcIds.has(id));

    if (isAlreadySelected) {
      this.deselectEntity(id, type);
      this.render();
      return;
    }

    // Prune incompatible combinations before adding new item
    switch (constraintType) {
      case 'horizontal_vertical':
      case 'horizontal':
      case 'vertical': {
        if (type === 'line') {
          sel.pointIds.clear();
          sel.lineIds.clear();
        } else if (type === 'point') {
          sel.lineIds.clear();
          if (sel.pointIds.size >= 2) sel.pointIds.clear();
        }
        break;
      }
      case 'dimension': {
        if (type === 'line') {
          sel.pointIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
          if (sel.lineIds.size >= 2) sel.lineIds.clear();
        } else if (type === 'circle' || type === 'arc') {
          sel.pointIds.clear();
          sel.lineIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
        } else if (type === 'point') {
          sel.lineIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
          if (sel.pointIds.size >= 2) sel.pointIds.clear();
        }
        break;
      }
      case 'distance': {
        if (type === 'line') {
          sel.pointIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
          sel.lineIds.clear();
        } else if (type === 'circle' || type === 'arc') {
          sel.pointIds.clear();
          sel.lineIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
        } else if (type === 'point') {
          sel.lineIds.clear();
          sel.circleIds.clear();
          sel.arcIds.clear();
          if (sel.pointIds.size >= 2) sel.pointIds.clear();
        }
        break;
      }
      case 'equal': {
        if (type === 'line') {
          sel.circleIds.clear();
          sel.arcIds.clear();
          if (sel.lineIds.size >= 2) sel.lineIds.clear();
        } else if (type === 'circle' || type === 'arc') {
          sel.lineIds.clear();
          if (sel.circleIds.size + sel.arcIds.size >= 2) {
            sel.circleIds.clear();
            sel.arcIds.clear();
          }
        }
        break;
      }
      case 'parallel':
      case 'perpendicular': {
        if (sel.lineIds.size >= 2) sel.lineIds.clear();
        break;
      }
      case 'concentric': {
        if (sel.circleIds.size + sel.arcIds.size >= 2) {
          sel.circleIds.clear();
          sel.arcIds.clear();
        }
        break;
      }
      case 'coincident': {
        if (type === 'point') {
          if (
            sel.pointIds.size >= 2 ||
            (sel.pointIds.size >= 1 && (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1))
          ) {
            sel.pointIds.clear();
            sel.lineIds.clear();
            sel.circleIds.clear();
            sel.arcIds.clear();
          }
        } else if (type === 'line') {
          if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1 || sel.pointIds.size >= 2) {
            sel.lineIds.clear();
            sel.circleIds.clear();
            sel.arcIds.clear();
            if (sel.pointIds.size >= 2) sel.pointIds.clear();
          }
        } else if (type === 'circle' || type === 'arc') {
          if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1 || sel.pointIds.size >= 2) {
            sel.lineIds.clear();
            sel.circleIds.clear();
            sel.arcIds.clear();
            if (sel.pointIds.size >= 2) sel.pointIds.clear();
          }
        }
        break;
      }
      case 'tangent': {
        if (type === 'line' && sel.lineIds.size >= 1) {
          sel.lineIds.clear();
        } else if ((type === 'circle' || type === 'arc') && (sel.circleIds.size + sel.arcIds.size >= 1)) {
          sel.circleIds.clear();
          sel.arcIds.clear();
        }
        break;
      }
      case 'point_on_line':
      case 'midpoint': {
        if (type === 'point' && sel.pointIds.size >= 1) {
          sel.pointIds.clear();
        } else if (type === 'line' && sel.lineIds.size >= 1) {
          sel.lineIds.clear();
        }
        break;
      }
    }

    this.sketch.selectEntity(id, type, true);

    if (this.canApplyConstraint(constraintType)) {
      const applied = this.applyConstraint(constraintType);
      if (applied) {
        this.sketch.clearSelection();
      }
    }

    this.render();
  }

  private finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void {
    const minScreenX = Math.min(s1.x, s2.x);
    const maxScreenX = Math.max(s1.x, s2.x);
    const minScreenY = Math.min(s1.y, s2.y);
    const maxScreenY = Math.max(s1.y, s2.y);

    const w1 = this.viewport.screenToWorld(minScreenX, minScreenY);
    const w2 = this.viewport.screenToWorld(maxScreenX, maxScreenY);

    const minX = Math.min(w1.x, w2.x);
    const maxX = Math.max(w1.x, w2.x);
    const minY = Math.min(w1.y, w2.y);
    const maxY = Math.max(w1.y, w2.y);

    const itemsToSelect: Array<{
      id: string;
      type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint';
    }> = [];

    // 1. Points
    for (const pt of this.sketch.points.values()) {
      if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
        itemsToSelect.push({ id: pt.id, type: 'point' });
      }
    }

    // 2. Lines
    for (const line of this.sketch.lines.values()) {
      const p1 = this.sketch.points.get(line.p1Id);
      const p2 = this.sketch.points.get(line.p2Id);
      if (p1 && p2) {
        if (this.segmentIntersectsAABB(p1.x, p1.y, p2.x, p2.y, minX, minY, maxX, maxY)) {
          itemsToSelect.push({ id: line.id, type: 'line' });
        }
      }
    }

    // 3. Circles
    for (const circle of this.sketch.circles.values()) {
      const center = this.sketch.points.get(circle.centerId);
      if (center) {
        if (this.circleIntersectsAABB(center.x, center.y, circle.radius, minX, minY, maxX, maxY)) {
          itemsToSelect.push({ id: circle.id, type: 'circle' });
        }
      }
    }

    // 4. Arcs
    for (const arc of this.sketch.arcs.values()) {
      if (this.arcIntersectsAABB(arc, minX, minY, maxX, maxY)) {
        itemsToSelect.push({ id: arc.id, type: 'arc' });
      }
    }

    // 5. Ellipses
    for (const ellipse of this.sketch.ellipses.values()) {
      if (this.ellipseIntersectsAABB(ellipse, minX, minY, maxX, maxY)) {
        itemsToSelect.push({ id: ellipse.id, type: 'ellipse' });
      }
    }

    // 6. Elliptical Arcs
    for (const elArc of this.sketch.ellipticalArcs.values()) {
      if (this.ellipticalArcIntersectsAABB(elArc, minX, minY, maxX, maxY)) {
        itemsToSelect.push({ id: elArc.id, type: 'elliptical_arc' });
      }
    }

    this.sketch.selectEntities(itemsToSelect, shiftKey);
  }

  private segmentIntersectsAABB(
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    if (p1x >= minX && p1x <= maxX && p1y >= minY && p1y <= maxY) return true;
    if (p2x >= minX && p2x <= maxX && p2y >= minY && p2y <= maxY) return true;

    if (Math.max(p1x, p2x) < minX || Math.min(p1x, p2x) > maxX) return false;
    if (Math.max(p1y, p2y) < minY || Math.min(p1y, p2y) > maxY) return false;

    const dx = p2x - p1x;
    const dy = p2y - p1y;
    let t0 = 0.0;
    let t1 = 1.0;

    const p = [-dx, dx, -dy, dy];
    const q = [p1x - minX, maxX - p1x, p1y - minY, maxY - p1y];

    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
      }
    }
    return t0 <= t1;
  }

  private circleIntersectsAABB(
    cx: number,
    cy: number,
    r: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) return true;

    const closestX = Math.max(minX, Math.min(cx, maxX));
    const closestY = Math.max(minY, Math.min(cy, maxY));
    const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2;

    if (distSq > r * r) return false;

    const maxDx = Math.max(Math.abs(cx - minX), Math.abs(cx - maxX));
    const maxDy = Math.max(Math.abs(cy - minY), Math.abs(cy - maxY));
    const furthestDistSq = maxDx * maxDx + maxDy * maxDy;

    if (furthestDistSq < r * r) return false;

    return true;
  }

  private arcIntersectsAABB(
    arc: SketchArc,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    const center = this.sketch.points.get(arc.centerId);
    const start = this.sketch.points.get(arc.startPointId);
    const end = this.sketch.points.get(arc.endPointId);
    if (!center || !start || !end) return false;

    if (start.x >= minX && start.x <= maxX && start.y >= minY && start.y <= maxY) return true;
    if (end.x >= minX && end.x <= maxX && end.y >= minY && end.y <= maxY) return true;
    if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;

    const as = Math.atan2(start.y - center.y, start.x - center.x);
    const ae = Math.atan2(end.y - center.y, end.x - center.x);
    const clockwise = !!arc.clockwise;

    let sweepAngle = 0;
    if (clockwise) {
      sweepAngle = (ae - as) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
    } else {
      sweepAngle = (as - ae) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
    }

    const steps = 32;
    let prevX = start.x;
    let prevY = start.y;

    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const angle = clockwise ? as + frac * sweepAngle : as - frac * sweepAngle;
      const currX = center.x + arc.radius * Math.cos(angle);
      const currY = center.y + arc.radius * Math.sin(angle);

      if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
      if (this.segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

      prevX = currX;
      prevY = currY;
    }

    return false;
  }

  private ellipseIntersectsAABB(
    ellipse: SketchEllipse,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    const center = this.sketch.points.get(ellipse.centerId);
    const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
    const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
    if (!center || !majorPt || !minorPt) return false;

    if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;
    if (majorPt.x >= minX && majorPt.x <= maxX && majorPt.y >= minY && majorPt.y <= maxY) return true;
    if (minorPt.x >= minX && minorPt.x <= maxX && minorPt.y >= minY && minorPt.y <= maxY) return true;

    const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
    const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
    if (rx < 0.01 || ry < 0.01) return false;

    const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -Math.sin(theta);
    const vy = Math.cos(theta);

    const steps = 36;
    let prevX = center.x + rx * ux;
    let prevY = center.y + rx * uy;

    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const currX = center.x + rx * cosT * ux + ry * sinT * vx;
      const currY = center.y + rx * cosT * uy + ry * sinT * vy;

      if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
      if (this.segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

      prevX = currX;
      prevY = currY;
    }

    return false;
  }

  private ellipticalArcIntersectsAABB(
    arc: SketchEllipticalArc,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    const center = this.sketch.points.get(arc.centerId);
    const majorPt = this.sketch.points.get(arc.majorAxisPointId);
    const minorPt = this.sketch.points.get(arc.minorAxisPointId);
    const startPt = this.sketch.points.get(arc.startPointId);
    const endPt = this.sketch.points.get(arc.endPointId);
    if (!center || !majorPt || !minorPt || !startPt || !endPt) return false;

    if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;
    if (startPt.x >= minX && startPt.x <= maxX && startPt.y >= minY && startPt.y <= maxY) return true;
    if (endPt.x >= minX && endPt.x <= maxX && endPt.y >= minY && endPt.y <= maxY) return true;

    const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
    const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
    if (rx < 0.01 || ry < 0.01) return false;

    const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -Math.sin(theta);
    const vy = Math.cos(theta);

    const us = (startPt.x - center.x) * ux + (startPt.y - center.y) * uy;
    const vs = (startPt.x - center.x) * vx + (startPt.y - center.y) * vy;
    const ue = (endPt.x - center.x) * ux + (endPt.y - center.y) * uy;
    const ve = (endPt.x - center.x) * vx + (endPt.y - center.y) * vy;

    const ts = Math.atan2(vs / ry, us / rx);
    const te = Math.atan2(ve / ry, ue / rx);

    const clockwise = !!arc.clockwise;
    let sweepAngle = 0;
    if (clockwise) {
      sweepAngle = (te - ts) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
    } else {
      sweepAngle = (ts - te) % (2 * Math.PI);
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
    }

    const steps = 36;
    let prevX = startPt.x;
    let prevY = startPt.y;

    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const t = clockwise ? ts + frac * sweepAngle : ts - frac * sweepAngle;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const currX = center.x + rx * cosT * ux + ry * sinT * vx;
      const currY = center.y + rx * cosT * uy + ry * sinT * vy;

      if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
      if (this.segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

      prevX = currX;
      prevY = currY;
    }

    return false;
  }
}

