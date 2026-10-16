import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import { dist, vec, projectPointOntoSegment, type Vec2 } from '../math/vector';
import { DistanceConstraint, RadiusConstraint } from '../solver/constraints';
import type { SketchLine, SketchCircle } from '../model/types';
import { showToast } from '../ui/toast';

export type ConstraintToolType =
  | 'coincident'
  | 'fixed'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'equal'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'concentric'
  | 'point_on_line'
  | 'midpoint';

export const CONSTRAINT_TOOLS: Set<string> = new Set([
  'coincident',
  'fixed',
  'horizontal',
  'vertical',
  'distance',
  'equal',
  'parallel',
  'perpendicular',
  'tangent',
  'concentric',
  'point_on_line',
  'midpoint',
]);

export function isConstraintTool(tool: string): tool is ConstraintToolType {
  return CONSTRAINT_TOOLS.has(tool);
}

export type ToolType =
  | 'select'
  | 'pan'
  | 'point'
  | 'line'
  | 'circle'
  | 'rectangle'
  | ConstraintToolType;

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

  // Dragging history snapshot
  private preDragSnapshot: SketchSnapshot | null = null;
  private hasDragged = false;

  // Viewport panning state
  private isPanning = false;
  private isSpacePressed = false;
  private lastMouseScreen: Vec2 = { x: 0, y: 0 };

  // Double click tracking
  private lastClickTime = 0;
  private lastClickPos: Vec2 = { x: 0, y: 0 };

  // Dimension edit callback
  onEditDimension?: (constraint: DistanceConstraint | RadiusConstraint, screenPos: Vec2) => void;
  onToolChange?: (tool: ToolType) => void;

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
  }

  setTool(tool: ToolType): void {
    this.activeTool = tool;
    this.cancelDrawing();
    if (isConstraintTool(tool)) {
      this.pruneIncompatibleSelection(tool);
    }
    this.updateCursor();
    this.onToolChange?.(tool);
    this.render();
  }

  toggleConstructionMode(): void {
    this.isConstructionMode = !this.isConstructionMode;
    const hasSelection =
      this.sketch.selection.lineIds.size > 0 ||
      this.sketch.selection.circleIds.size > 0 ||
      this.sketch.selection.pointIds.size > 0;

    if (hasSelection) {
      this.sketch.beginTransaction();
      for (const lid of this.sketch.selection.lineIds) {
        this.sketch.toggleConstruction(lid);
      }
      for (const cid of this.sketch.selection.circleIds) {
        this.sketch.toggleConstruction(cid);
      }
      for (const pid of this.sketch.selection.pointIds) {
        this.sketch.toggleConstruction(pid);
      }
      this.sketch.commitTransaction();
    }
    this.render();
  }

  cancelDrawing(): void {
    if (this.drawingStep > 0) {
      this.sketch.rollbackTransaction();
    }
    this.drawingStep = 0;
    this.startPointId = null;
    this.startWorldPos = null;

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

    this.preDragSnapshot = null;
    this.hasDragged = false;

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
      if (this.drawingStep > 0) {
        this.cancelDrawing();
        this.setTool('select');
      }
    });

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        this.isSpacePressed = true;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'Escape') {
        this.cancelDrawing();
        this.setTool('select');
        this.sketch.clearSelection();
        this.render();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.sketch.deleteSelected();
        this.render();
      } else if (e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч') {
        this.toggleConstructionMode();
      } else if (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') {
        this.setTool('select');
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') {
        this.setTool('line');
      } else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
        this.setTool('circle');
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        this.setTool('rectangle');
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
        this.setTool('point');
      }
    });

    window.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
      }
    });
  }

  private getScreenPos(e: MouseEvent): Vec2 {
    const rect = this.svg.getBoundingClientRect();
    return vec(e.clientX - rect.left, e.clientY - rect.top);
  }

  private findSnappedPoint(screenPos: Vec2, excludePointId?: string): { id: string; worldPos: Vec2 } | null {
    const snapDistancePx = 14;
    let closestDist = snapDistancePx;
    let found: { id: string; worldPos: Vec2 } | null = null;

    for (const pt of this.sketch.points.values()) {
      if (excludePointId && pt.id === excludePointId) continue;
      const s = this.viewport.worldToScreen(pt.x, pt.y);
      const d = dist(screenPos, s);
      if (d < closestDist) {
        closestDist = d;
        found = { id: pt.id, worldPos: vec(pt.x, pt.y) };
      }
    }

    return found;
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

    // Fallback: click inside circle area if nothing on perimeter
    if (!foundCircle) {
      let minRadius = Infinity;
      for (const circle of this.sketch.circles.values()) {
        const center = this.sketch.points.get(circle.centerId);
        if (!center) continue;

        const sc = this.viewport.worldToScreen(center.x, center.y);
        const sr = circle.radius * this.viewport.zoom;
        const dToCenter = dist(screen, sc);
        if (dToCenter < sr && sr < minRadius) {
          minRadius = sr;
          foundCircle = circle;
        }
      }
    }

    return foundCircle;
  }

  private handleMouseDown(e: MouseEvent): void {
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

    if (timeDelta > 40 && timeDelta < 550 && distanceDelta < 28) {
      this.lastClickTime = 0;
      if (this.triggerDimensionEditAt(e, screen, clientPos)) {
        this.cancelDrawing();
        return;
      }
    } else {
      this.lastClickTime = now;
      this.lastClickPos = screen;
    }

    const world = this.viewport.screenToWorld(screen.x, screen.y);
    const snap = this.findSnappedPoint(screen);

    // --- ACTIVE CONSTRAINT TOOL MODE ---
    if (isConstraintTool(this.activeTool)) {
      const target = e.target as SVGElement;
      const targetG = target.closest('[data-id]') as SVGElement | null;
      let id = targetG?.getAttribute('data-id');
      let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | undefined;

      // Fallback geometric hit test if clicking close to point, line or circle
      if (!type || (type !== 'point' && type !== 'line' && type !== 'circle')) {
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
      let type = targetG?.getAttribute('data-type') as 'point' | 'line' | 'circle' | 'constraint' | undefined;

      // Fallback geometric hit test if clicking close to point, line or circle
      if (!type) {
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
            }
          }
        }
      }

      if (id && type) {
        // Dragging is activated ONLY if the entity was ALREADY selected before this click
        const wasAlreadySelected =
          (type === 'point' && this.sketch.selection.pointIds.has(id)) ||
          (type === 'line' && this.sketch.selection.lineIds.has(id)) ||
          (type === 'circle' && this.sketch.selection.circleIds.has(id));

        // Select entity and automatically select its associated constraints!
        this.sketch.selectEntity(id, type, e.shiftKey);

        if (wasAlreadySelected) {
          if (type === 'point') {
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
          }
        }

        this.render();
      } else {
        // Clicked background -> clear selection
        this.sketch.clearSelection();
        this.render();
      }
      return;
    }

    // --- TOOL: POINT ---
    if (this.activeTool === 'point') {
      const finalX = snap ? snap.worldPos.x : world.x;
      const finalY = snap ? snap.worldPos.y : world.y;
      this.sketch.addPoint(finalX, finalY, false, this.isConstructionMode);
      this.render();
      return;
    }

    // --- TOOL: LINE ---
    if (this.activeTool === 'line') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        // Step 1: Start Point
        let pId: string;
        if (snap) {
          pId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(world.x, world.y, false, this.isConstructionMode);
          pId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
        }
        this.startPointId = pId;
        this.drawingStep = 1;
      } else {
        // Step 2: End Point
        let p2Id: string;
        if (snap && snap.id !== this.startPointId) {
          p2Id = snap.id;
        } else {
          const pt = this.sketch.addPoint(world.x, world.y, false, this.isConstructionMode);
          p2Id = pt.id;
        }

        this.sketch.addLine(this.startPointId!, p2Id, this.isConstructionMode);
        this.sketch.commitTransaction();

        // Chain to next line
        this.sketch.beginTransaction();
        this.startPointId = p2Id;
        const p2 = this.sketch.getPoint(p2Id);
        this.startWorldPos = p2 ? vec(p2.x, p2.y) : world;
        this.render();
      }
      return;
    }

    // --- TOOL: CIRCLE ---
    if (this.activeTool === 'circle') {
      if (this.drawingStep === 0) {
        this.sketch.beginTransaction();
        let centerId: string;
        if (snap) {
          centerId = snap.id;
          this.startWorldPos = snap.worldPos;
        } else {
          const pt = this.sketch.addPoint(world.x, world.y, false, this.isConstructionMode);
          centerId = pt.id;
          this.startWorldPos = vec(pt.x, pt.y);
        }
        this.startPointId = centerId;
        this.drawingStep = 1;
      } else {
        const radius = Math.max(5, dist(this.startWorldPos!, world));
        this.sketch.addCircle(this.startPointId!, radius, this.isConstructionMode);
        this.sketch.commitTransaction();
        this.cancelDrawing();
        this.render();
      }
      return;
    }

    // --- TOOL: RECTANGLE ---
    if (this.activeTool === 'rectangle') {
      if (this.drawingStep === 0) {
        this.startWorldPos = snap ? snap.worldPos : world;
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
  }

  private handleMouseMove(e: MouseEvent): void {
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

    // Drag point handling (Live solver calculation!)
    if (this.isDraggingPoint && this.draggedPointId && this.dragPointStartWorld) {
      this.hasDragged = true;
      this.svg.style.cursor = 'grabbing';
      this.sketch.dragPoint(this.draggedPointId, world.x, world.y);
      this.render();
      const pt = this.sketch.points.get(this.draggedPointId);
      const s1 = this.viewport.worldToScreen(this.dragPointStartWorld.x, this.dragPointStartWorld.y);
      const s2 = this.viewport.worldToScreen(pt ? pt.x : world.x, pt ? pt.y : world.y);
      // Draw dashed line from original point to current dragged position
      this.renderer.renderDragLine(s1, s2);
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
      this.svg.style.cursor = 'grabbing';
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
      this.svg.style.cursor = 'grabbing';
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

        if (center) {
          const s1 = this.viewport.worldToScreen(this.circleCenterStart.x, this.circleCenterStart.y);
          const s2 = this.viewport.worldToScreen(center.x, center.y);
          this.renderer.renderDragLine(s1, s2);
        }
      }
      return;
    }

    // Snapping update during active drawing tools or constraint mode
    const isDrawingTool =
      this.activeTool === 'point' ||
      this.activeTool === 'line' ||
      this.activeTool === 'circle' ||
      this.activeTool === 'rectangle';
    const isConstraintWithPoints =
      isConstraintTool(this.activeTool) &&
      ['fixed', 'coincident', 'horizontal', 'vertical', 'distance', 'point_on_line', 'midpoint'].includes(
        this.activeTool
      );
    const snap = isDrawingTool || isConstraintWithPoints
      ? this.findSnappedPoint(screen, this.startPointId ?? undefined)
      : null;
    if (snap && !this.isDraggingPoint && !this.isDraggingLine && !this.isDraggingCircle) {
      const snapScreen = this.viewport.worldToScreen(snap.worldPos.x, snap.worldPos.y);
      this.renderer.renderSnapIndicator(snapScreen);
    } else {
      this.renderer.clearPreviews();
    }

    // Active tool drawing preview
    if (this.drawingStep === 1 && this.startWorldPos) {
      const s1 = this.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
      const effectiveWorld = snap ? snap.worldPos : world;
      const s2 = this.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

      if (this.activeTool === 'line') {
        const length = dist(this.startWorldPos, effectiveWorld);
        const angleDeg =
          (Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
          Math.PI;
        this.renderer.renderLinePreview(s1, s2, length, angleDeg);
      } else if (this.activeTool === 'circle') {
        const radius = dist(this.startWorldPos, effectiveWorld);
        this.renderer.renderCirclePreview(s1, s2, radius);
      } else if (this.activeTool === 'rectangle') {
        const w = Math.abs(effectiveWorld.x - this.startWorldPos.x);
        const h = Math.abs(effectiveWorld.y - this.startWorldPos.y);
        this.renderer.renderRectanglePreview(s1, s2, w, h);
      }
    }
  }

  private handleMouseUp(): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursor();
    }
    if (this.isDraggingPoint) {
      this.isDraggingPoint = false;
      this.draggedPointId = null;
      this.dragPointStartWorld = null;
      this.renderer.clearPreviews();
      // Final solve without soft drag constraint to ensure exact convergence
      this.sketch.solve();
      this.render();
      if (this.hasDragged && this.preDragSnapshot) {
        this.sketch.pushSnapshot(this.preDragSnapshot);
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
      this.sketch.solve();
      this.render();
      if (this.hasDragged && this.preDragSnapshot) {
        this.sketch.pushSnapshot(this.preDragSnapshot);
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
      this.sketch.solve();
      this.render();
      if (this.hasDragged && this.preDragSnapshot) {
        this.sketch.pushSnapshot(this.preDragSnapshot);
      }
      this.preDragSnapshot = null;
      this.hasDragged = false;
      this.updateCursor();
    }
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

    // If target didn't resolve to a line, circle, or constraint, use geometric hit test
    if (!type || (type !== 'line' && type !== 'circle' && type !== 'constraint')) {
      const hitLine = this.findLineNearScreen(screen, 16);
      if (hitLine) {
        id = hitLine.id;
        type = 'line';
      } else {
        const hitCircle = this.findCircleNearScreen(screen, 16);
        if (hitCircle) {
          id = hitCircle.id;
          type = 'circle';
        }
      }
    }

    if (!id || !type) return false;

    if (type === 'constraint') {
      const constraint = this.sketch.constraints.get(id);
      if (
        (constraint instanceof DistanceConstraint || constraint instanceof RadiusConstraint) &&
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
    } else if (type === 'circle') {
      const circle = this.sketch.circles.get(id);
      if (circle) {
        let radConstraint = [...this.sketch.constraints.values()].find(
          c => c instanceof RadiusConstraint && c.circleId === circle.id
        ) as RadiusConstraint | undefined;

        if (!radConstraint) {
          radConstraint = this.sketch.addRadiusConstraint(circle.id) ?? undefined;
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
    const screen = this.getScreenPos(e);
    const clientPos = vec(e.clientX, e.clientY);
    this.triggerDimensionEditAt(e, screen, clientPos);
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
      case 'fixed':
      case 'coincident': {
        sel.lineIds.clear();
        sel.circleIds.clear();
        sel.arcIds.clear();
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
      case 'distance': {
        sel.arcIds.clear();
        break;
      }
    }
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
  }

  isEntityCompatibleWithConstraint(
    constraintType: string,
    entityType: 'point' | 'line' | 'circle'
  ): boolean {
    switch (constraintType) {
      case 'fixed':
      case 'coincident':
        return entityType === 'point';
      case 'horizontal':
      case 'vertical':
        return entityType === 'line' || entityType === 'point';
      case 'distance':
        return entityType === 'line' || entityType === 'circle' || entityType === 'point';
      case 'equal':
        return entityType === 'line' || entityType === 'circle';
      case 'parallel':
      case 'perpendicular':
        return entityType === 'line';
      case 'tangent':
        return entityType === 'line' || entityType === 'circle';
      case 'concentric':
        return entityType === 'circle';
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
    const cCount = sel.circleIds.size;

    switch (type) {
      case 'fixed':
        return pCount >= 1 && lCount === 0 && cCount === 0;
      case 'coincident':
        return pCount === 2 && lCount === 0 && cCount === 0;
      case 'horizontal':
      case 'vertical':
        return (lCount === 1 && pCount === 0 && cCount === 0) || (pCount === 2 && lCount === 0 && cCount === 0);
      case 'distance':
        return (
          (lCount === 1 && pCount === 0 && cCount === 0) ||
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
    const cIds = [...sel.circleIds];

    let applied = false;
    let toastMsg = '';

    switch (type) {
      case 'fixed': {
        if (pIds.length >= 1) {
          for (const pid of pIds) this.sketch.addFixedConstraint(pid);
          applied = true;
          toastMsg = 'Fixed constraint applied';
        }
        break;
      }
      case 'coincident': {
        if (pIds.length === 2) {
          this.sketch.addCoincidentConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = 'Coincident constraint applied';
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
      case 'distance': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          const c = this.sketch.addDistanceConstraint(l.p1Id, l.p2Id);
          applied = true;
          toastMsg = 'Distance constraint applied';
          if (c && this.onEditDimension) {
            const p1 = this.sketch.points.get(l.p1Id);
            const p2 = this.sketch.points.get(l.p2Id);
            const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0;
            const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0;
            const s = this.viewport.worldToScreen(midX, midY);
            const rect = this.svg.getBoundingClientRect();
            this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
          }
        } else if (pIds.length === 2) {
          const c = this.sketch.addDistanceConstraint(pIds[0], pIds[1]);
          applied = true;
          toastMsg = 'Distance constraint applied';
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
          const c = this.sketch.addRadiusConstraint(cIds[0]);
          applied = true;
          toastMsg = 'Radius constraint applied';
          if (c && this.onEditDimension) {
            const circ = this.sketch.circles.get(cIds[0]);
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
          this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
          applied = true;
          toastMsg = 'Point on line constraint applied';
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

  deselectEntity(id: string, type: 'point' | 'line' | 'circle'): void {
    if (type === 'point') {
      this.sketch.selection.pointIds.delete(id);
    } else if (type === 'line') {
      this.sketch.selection.lineIds.delete(id);
    } else if (type === 'circle') {
      this.sketch.selection.circleIds.delete(id);
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
    this.sketch.notify();
  }

  private handleConstraintEntityClick(id: string, type: 'point' | 'line' | 'circle'): void {
    if (!isConstraintTool(this.activeTool)) return;
    const constraintType = this.activeTool;

    if (!this.isEntityCompatibleWithConstraint(constraintType, type)) {
      return;
    }

    const sel = this.sketch.selection;
    const isAlreadySelected =
      (type === 'point' && sel.pointIds.has(id)) ||
      (type === 'line' && sel.lineIds.has(id)) ||
      (type === 'circle' && sel.circleIds.has(id));

    if (isAlreadySelected) {
      this.deselectEntity(id, type);
      this.render();
      return;
    }

    // Prune incompatible combinations before adding new item
    switch (constraintType) {
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
      case 'distance': {
        if (type === 'line') {
          sel.pointIds.clear();
          sel.circleIds.clear();
          sel.lineIds.clear();
        } else if (type === 'circle') {
          sel.pointIds.clear();
          sel.lineIds.clear();
          sel.circleIds.clear();
        } else if (type === 'point') {
          sel.lineIds.clear();
          sel.circleIds.clear();
          if (sel.pointIds.size >= 2) sel.pointIds.clear();
        }
        break;
      }
      case 'equal': {
        if (type === 'line') {
          sel.circleIds.clear();
          if (sel.lineIds.size >= 2) sel.lineIds.clear();
        } else if (type === 'circle') {
          sel.lineIds.clear();
          if (sel.circleIds.size >= 2) sel.circleIds.clear();
        }
        break;
      }
      case 'parallel':
      case 'perpendicular': {
        if (sel.lineIds.size >= 2) sel.lineIds.clear();
        break;
      }
      case 'concentric': {
        if (sel.circleIds.size >= 2) sel.circleIds.clear();
        break;
      }
      case 'coincident': {
        if (sel.pointIds.size >= 2) sel.pointIds.clear();
        break;
      }
      case 'tangent': {
        if (type === 'line' && sel.lineIds.size >= 1) {
          sel.lineIds.clear();
        } else if (type === 'circle' && sel.circleIds.size >= 1) {
          sel.circleIds.clear();
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
}

