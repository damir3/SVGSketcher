import { ICONS } from './icons';
import type { SketchDocument } from '../model/sketch';
import type { CanvasInteraction, ToolType, ConstraintToolType } from '../canvas/interaction';
import { showToast } from './toast';
export { showToast };

export class Toolbar {
  private container: HTMLElement;
  private interaction: CanvasInteraction;

  constructor(container: HTMLElement, _sketch: SketchDocument, interaction: CanvasInteraction) {
    this.container = container;
    this.interaction = interaction;

    this.render();
    this.setupListeners();
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
          <button class="tool-btn" data-tool="arc" title="3-Point Arc (A)">
            ${ICONS.arc}
            <span class="btn-tooltip">3-Pt Arc (A)</span>
          </button>
          <button class="tool-btn" data-tool="arc_center" title="Centerpoint Arc">
            ${ICONS.arc_center}
            <span class="btn-tooltip">Center Arc</span>
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
          <button class="tool-btn" data-constraint="horizontal_vertical" title="Horizontal / Vertical (H)">
            ${ICONS.horizontalVertical}
            <span class="btn-tooltip">Horiz / Vert (H)</span>
          </button>
          <button class="tool-btn" data-constraint="dimension" title="Dimension (D)">
            ${ICONS.dimension}
            <span class="btn-tooltip">Dimension (D)</span>
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

  private setupListeners(): void {
    this.interaction.onToolChange = tool => {
      this.setActiveButton(tool);
    };
    this.interaction.onConstructionChange = isConst => {
      this.setConstructionActive(isConst);
    };
  }

  private bindClicks(): void {
    // Tool buttons (select, point, line, circle, rectangle)
    this.container.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as ToolType;
        this.interaction.setTool(tool);
      });
    });

    // Construction toggle
    const constrBtn = this.container.querySelector('#btn-construction');
    constrBtn?.addEventListener('click', () => {
      this.interaction.toggleConstructionMode();
    });

    // Constraint buttons
    this.container.querySelectorAll<HTMLButtonElement>('[data-constraint]').forEach(btn => {
      btn.addEventListener('click', () => {
        const constraintType = btn.getAttribute('data-constraint') as ConstraintToolType;

        // 1. If required primitives are ALREADY selected, immediately apply constraint (except dimension which needs offset placement)!
        if (constraintType !== 'dimension' && this.interaction.canApplyConstraint(constraintType)) {
          this.interaction.applyConstraint(constraintType);
          this.interaction.setTool('select');
          return;
        }

        // 2. Toggle constraint tool
        if (this.interaction.activeTool === constraintType) {
          // Toggle off -> revert to select
          this.interaction.setTool('select');
        } else {
          // Toggle on
          this.interaction.setTool(constraintType);
        }
      });
    });
  }

  setActiveButton(tool: ToolType): void {
    this.container.querySelectorAll('[data-tool]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
    this.container.querySelectorAll('[data-constraint]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-constraint') === tool);
    });
  }

  setConstructionActive(active: boolean): void {
    const constrBtn = this.container.querySelector('#btn-construction');
    constrBtn?.classList.toggle('active', active);
  }

  setActiveToolButton(tool: ToolType): void {
    this.setActiveButton(tool);
  }
}
