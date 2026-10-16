import { ICONS } from './icons';
import type { SketchDocument } from '../model/sketch';
import type { CanvasInteraction, ToolType } from '../canvas/interaction';

export class Toolbar {
  private container: HTMLElement;
  private sketch: SketchDocument;
  private interaction: CanvasInteraction;

  constructor(container: HTMLElement, sketch: SketchDocument, interaction: CanvasInteraction) {
    this.container = container;
    this.sketch = sketch;
    this.interaction = interaction;

    this.render();
  }

  render(): void {
    this.container.innerHTML = `
      <div class="toolbar-section">
        <div class="toolbar-title">Tools</div>
        <div class="toolbar-grid">
          <button class="tool-btn active" data-tool="select" title="Select & Drag (V)">
            ${ICONS.select}
            <span class="btn-tooltip">Select (V)</span>
          </button>
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-section">
        <div class="toolbar-title">Draw</div>
        <div class="toolbar-grid">
          <button class="tool-btn" data-tool="point" title="Point (P)">
            ${ICONS.point}
            <span class="btn-tooltip">Point (P)</span>
          </button>
          <button class="tool-btn" data-tool="line" title="Line (L)">
            ${ICONS.line}
            <span class="btn-tooltip">Line (L)</span>
          </button>
          <button class="tool-btn" data-tool="circle" title="Circle (C)">
            ${ICONS.circle}
            <span class="btn-tooltip">Circle (C)</span>
          </button>
          <button class="tool-btn" data-tool="rectangle" title="Rectangle (R)">
            ${ICONS.rectangle}
            <span class="btn-tooltip">Rectangle (R)</span>
          </button>
          <button class="tool-btn" id="btn-construction" title="Toggle Construction Mode (X)">
            ${ICONS.construction}
            <span class="btn-tooltip">Construction (X)</span>
          </button>
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-section">
        <div class="toolbar-title">Constraints</div>
        <div class="toolbar-grid">
          <button class="tool-btn" data-constraint="coincident" title="Coincident (2 points)">
            ${ICONS.coincident}
            <span class="btn-tooltip">Coincident</span>
          </button>
          <button class="tool-btn" data-constraint="fixed" title="Fix Point">
            ${ICONS.fixed}
            <span class="btn-tooltip">Fix Point</span>
          </button>
          <button class="tool-btn" data-constraint="horizontal" title="Horizontal (1 line / 2 points)">
            ${ICONS.horizontal}
            <span class="btn-tooltip">Horizontal</span>
          </button>
          <button class="tool-btn" data-constraint="vertical" title="Vertical (1 line / 2 points)">
            ${ICONS.vertical}
            <span class="btn-tooltip">Vertical</span>
          </button>
          <button class="tool-btn" data-constraint="distance" title="Distance / Length">
            ${ICONS.distance}
            <span class="btn-tooltip">Distance</span>
          </button>
          <button class="tool-btn" data-constraint="equal" title="Equal Length or Radius">
            ${ICONS.equal}
            <span class="btn-tooltip">Equal</span>
          </button>
          <button class="tool-btn" data-constraint="parallel" title="Parallel (2 lines)">
            ${ICONS.parallel}
            <span class="btn-tooltip">Parallel</span>
          </button>
          <button class="tool-btn" data-constraint="perpendicular" title="Perpendicular (2 lines)">
            ${ICONS.perpendicular}
            <span class="btn-tooltip">Perpendicular</span>
          </button>
          <button class="tool-btn" data-constraint="tangent" title="Tangent (1 line + 1 circle)">
            ${ICONS.tangent}
            <span class="btn-tooltip">Tangent</span>
          </button>
          <button class="tool-btn" data-constraint="concentric" title="Concentric (2 circles)">
            ${ICONS.concentric}
            <span class="btn-tooltip">Concentric</span>
          </button>
          <button class="tool-btn" data-constraint="point_on_line" title="Point on Line">
            ${ICONS.pointOnLine}
            <span class="btn-tooltip">Point on Line</span>
          </button>
          <button class="tool-btn" data-constraint="midpoint" title="Midpoint (1 point + 1 line)">
            ${ICONS.midpoint}
            <span class="btn-tooltip">Midpoint</span>
          </button>
        </div>
      </div>
    `;

    this.bindClicks();
  }

  private bindClicks(): void {
    // Tool buttons
    this.container.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as ToolType;
        this.setActiveToolButton(tool);
        this.interaction.setTool(tool);
      });
    });

    // Construction toggle
    const constrBtn = this.container.querySelector('#btn-construction');
    constrBtn?.addEventListener('click', () => {
      this.interaction.toggleConstructionMode();
      constrBtn.classList.toggle('active', this.interaction.isConstructionMode);
    });

    // Constraint buttons
    this.container.querySelectorAll<HTMLButtonElement>('[data-constraint]').forEach(btn => {
      btn.addEventListener('click', () => {
        const constraintType = btn.getAttribute('data-constraint');
        this.applyConstraint(constraintType!);
      });
    });
  }

  setActiveToolButton(tool: ToolType): void {
    this.container.querySelectorAll('[data-tool]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
  }

  private applyConstraint(type: string): void {
    const sel = this.sketch.selection;
    const pIds = [...sel.pointIds];
    const lIds = [...sel.lineIds];
    const cIds = [...sel.circleIds];

    let applied = false;

    switch (type) {
      case 'fixed': {
        if (pIds.length >= 1) {
          for (const pid of pIds) this.sketch.addFixedConstraint(pid);
          applied = true;
        } else {
          showToast('Select 1 or more points to fix');
        }
        break;
      }
      case 'coincident': {
        if (pIds.length === 2) {
          this.sketch.addCoincidentConstraint(pIds[0], pIds[1]);
          applied = true;
        } else {
          showToast('Select exactly 2 points to make coincident');
        }
        break;
      }
      case 'horizontal': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          this.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
          applied = true;
        } else if (pIds.length === 2) {
          this.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
          applied = true;
        } else {
          showToast('Select 1 line or 2 points to make horizontal');
        }
        break;
      }
      case 'vertical': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          this.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
          applied = true;
        } else if (pIds.length === 2) {
          this.sketch.addVerticalConstraint(pIds[0], pIds[1]);
          applied = true;
        } else {
          showToast('Select 1 line or 2 points to make vertical');
        }
        break;
      }
      case 'distance': {
        if (lIds.length === 1) {
          const l = this.sketch.lines.get(lIds[0])!;
          this.sketch.addDistanceConstraint(l.p1Id, l.p2Id);
          applied = true;
        } else if (pIds.length === 2) {
          this.sketch.addDistanceConstraint(pIds[0], pIds[1]);
          applied = true;
        } else if (cIds.length === 1) {
          this.sketch.addRadiusConstraint(cIds[0]);
          applied = true;
        } else {
          showToast('Select a line, 2 points, or a circle to add distance/radius');
        }
        break;
      }
      case 'equal': {
        if (lIds.length === 2) {
          this.sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
          applied = true;
        } else if (cIds.length === 2) {
          this.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
          applied = true;
        } else {
          showToast('Select 2 lines (for equal length) or 2 circles (for equal radius)');
        }
        break;
      }
      case 'parallel': {
        if (lIds.length === 2) {
          this.sketch.addParallelConstraint(lIds[0], lIds[1]);
          applied = true;
        } else {
          showToast('Select 2 lines to make parallel');
        }
        break;
      }
      case 'perpendicular': {
        if (lIds.length === 2) {
          this.sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
          applied = true;
        } else {
          showToast('Select 2 lines to make perpendicular');
        }
        break;
      }
      case 'tangent': {
        if (lIds.length === 1 && cIds.length === 1) {
          this.sketch.addTangentConstraint(lIds[0], cIds[0]);
          applied = true;
        } else {
          showToast('Select 1 line and 1 circle to make tangent');
        }
        break;
      }
      case 'concentric': {
        if (cIds.length === 2) {
          this.sketch.addConcentricConstraint(cIds[0], cIds[1]);
          applied = true;
        } else {
          showToast('Select 2 circles to make concentric');
        }
        break;
      }
      case 'point_on_line': {
        if (pIds.length === 1 && lIds.length === 1) {
          this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
          applied = true;
        } else {
          showToast('Select 1 point and 1 line');
        }
        break;
      }
      case 'midpoint': {
        if (pIds.length === 1 && lIds.length === 1) {
          this.sketch.addMidpointConstraint(pIds[0], lIds[0]);
          applied = true;
        } else {
          showToast('Select 1 point and 1 line for midpoint');
        }
        break;
      }
    }

    if (applied) {
      this.interaction.setTool('select');
    }
  }
}

export function showToast(msg: string): void {
  const existing = document.getElementById('cad-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'cad-toast';
  toast.className = 'cad-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}
