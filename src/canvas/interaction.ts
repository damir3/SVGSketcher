import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import { dist, vec, projectPointOntoSegment, type Vec2 } from '../math/vector';
import { DistanceConstraint, RadiusConstraint } from '../solver/constraints';
import type { SketchLine, SketchCircle } from '../model/types';

export type ToolType = 'select' | 'pan' | 'point' | 'line' | 'circle' | 'rectangle';

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

    // Snapping update during active drawing tools
    const isDrawingTool = this.activeTool !== 'select' && this.activeTool !== 'pan';
    const snap = isDrawingTool ? this.findSnappedPoint(screen, this.startPointId ?? undefined) : null;
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
}
