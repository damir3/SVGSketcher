import './style.css';
import { SketchDocument } from './model/sketch';
import { Viewport } from './canvas/viewport';
import { SVGRenderer } from './canvas/renderer';
import { CanvasInteraction } from './canvas/interaction';
import { Toolbar, showToast } from './ui/toolbar';
import { Sidebar } from './ui/sidebar';
import { DimensionModal } from './ui/modal';
import {
  loadTrianglePreset,
  loadBracketPreset,
  loadFourBarLinkagePreset,
  loadCircleTangentPreset,
} from './model/presets';
import { ICONS } from './ui/icons';

function initApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <!-- TOP HEADER -->
    <header class="cad-header">
      <div class="brand">
        <div class="brand-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
            <polygon points="12 2 2 22 22 22"/>
          </svg>
        </div>
        <div class="brand-title">Sketcher CAD</div>
        <div class="brand-badge">Parametric 2D</div>
      </div>

      <div class="header-center">
        <select class="preset-select" id="preset-selector" title="Load CAD Example">
          <option value="triangle">Demo: Constrained Triangle</option>
          <option value="bracket">Demo: Parametric L-Bracket</option>
          <option value="linkage">Demo: Four-Bar Linkage</option>
          <option value="tangent">Demo: Circle & Tangent Line</option>
          <option value="blank">— Blank Sketch —</option>
        </select>
      </div>

      <div class="header-actions">
        <button class="btn-header" id="btn-undo" title="Undo (Ctrl+Z / Cmd+Z)" disabled>
          ${ICONS.undo} Undo
        </button>
        <button class="btn-header" id="btn-redo" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled>
          ${ICONS.redo} Redo
        </button>
        <div class="header-divider"></div>
        <button class="btn-header active" id="btn-snap-header" title="Toggle Snapping (S)">
          ${ICONS.snap} Snap
        </button>
        <button class="btn-header" id="btn-fit-view" title="Fit to View (Z)">
          ${ICONS.fitView} Fit to View
        </button>
        <button class="btn-header" id="btn-clear" title="Clear Sketch">
          ${ICONS.clear} Clear
        </button>
        <button class="btn-header primary" id="btn-export" title="Export as SVG">
          ${ICONS.export} Export SVG
        </button>
      </div>
    </header>

    <!-- MAIN WORKSPACE -->
    <div class="cad-workspace">
      <!-- LEFT TOOLBAR -->
      <aside class="cad-toolbar" id="toolbar"></aside>

      <!-- CANVAS VIEWPORT -->
      <main class="cad-canvas-container">
        <svg id="cad-svg"></svg>
      </main>

      <!-- RIGHT SIDEBAR -->
      <aside class="cad-sidebar" id="sidebar"></aside>
    </div>

    <!-- BOTTOM STATUS BAR -->
    <footer class="cad-footer">
      <div class="footer-coords">
        <span>X: <strong id="coord-x">0.0</strong> mm</span>
        <span>Y: <strong id="coord-y">0.0</strong> mm</span>
        <span>Zoom: <strong id="zoom-level">100%</strong></span>
      </div>
      <div class="footer-status">
        <span>Solver: <strong id="solver-time">0.0 ms</strong></span>
        <span>TypeScript Levenberg-Marquardt Engine</span>
      </div>
    </footer>
  `;

  // Elements
  const svg = document.getElementById('cad-svg') as unknown as SVGSVGElement;
  const toolbarContainer = document.getElementById('toolbar') as HTMLElement;
  const sidebarContainer = document.getElementById('sidebar') as HTMLElement;
  const presetSelector = document.getElementById('preset-selector') as HTMLSelectElement;
  const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
  const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
  const btnFitView = document.getElementById('btn-fit-view') as HTMLButtonElement;
  const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
  const btnExport = document.getElementById('btn-export') as HTMLButtonElement;

  const coordX = document.getElementById('coord-x') as HTMLElement;
  const coordY = document.getElementById('coord-y') as HTMLElement;
  const zoomLevel = document.getElementById('zoom-level') as HTMLElement;
  const solverTime = document.getElementById('solver-time') as HTMLElement;

  // Initialization of Architecture
  const sketch = new SketchDocument();
  const viewport = new Viewport(svg.clientWidth || 800, svg.clientHeight || 600);
  const renderer = new SVGRenderer(svg);
  const interaction = new CanvasInteraction(svg, sketch, viewport, renderer);
  const toolbar = new Toolbar(toolbarContainer, sketch, interaction);
  const sidebar = new Sidebar(sidebarContainer, sketch);
  const dimModal = new DimensionModal(sketch);

  // Connect callbacks
  interaction.onEditDimension = (constraint, screenPos) => {
    dimModal.open(constraint, screenPos);
  };

  sidebar.onEditDimension = constraint => {
    dimModal.open(constraint);
  };

  interaction.onToolChange = tool => {
    toolbar.setActiveButton(tool);
  };

  interaction.onConstructionChange = active => {
    toolbar.setConstructionActive(active);
  };

  interaction.onSnappingChange = active => {
    toolbar.setSnappingActive(active);
    const btnSnapHeader = document.getElementById('btn-snap-header');
    btnSnapHeader?.classList.toggle('active', active);
  };

  // Resize handling
  function handleResize(): void {
    const rect = svg.getBoundingClientRect();
    viewport.resize(rect.width, rect.height);
    renderer.render(sketch, viewport);
  }

  window.addEventListener('resize', handleResize);
  setTimeout(handleResize, 50);

  // Track cursor coordinates and solver benchmark
  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = viewport.screenToWorld(sx, sy);
    coordX.textContent = world.x.toFixed(1);
    coordY.textContent = world.y.toFixed(1);
    zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
  });

  function updateUndoRedoButtons(): void {
    btnUndo.disabled = !sketch.canUndo();
    btnRedo.disabled = !sketch.canRedo();
  }

  // Benchmark solver execution on each solve
  sketch.onChange(() => {
    const t0 = performance.now();
    renderer.render(sketch, viewport);
    const dt = performance.now() - t0;
    solverTime.textContent = `${dt.toFixed(2)} ms`;
    zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
    updateUndoRedoButtons();
  });

  // Preset Selector
  presetSelector.addEventListener('change', () => {
    const val = presetSelector.value;
    if (val === 'triangle') loadTrianglePreset(sketch);
    else if (val === 'bracket') loadBracketPreset(sketch);
    else if (val === 'linkage') loadFourBarLinkagePreset(sketch);
    else if (val === 'tangent') loadCircleTangentPreset(sketch);
    else if (val === 'blank') sketch.clear();

    renderer.render(sketch, viewport);
    showToast(`Loaded ${presetSelector.options[presetSelector.selectedIndex].text}`);
  });

  // Header Actions
  btnUndo.addEventListener('click', () => {
    if (sketch.undo()) {
      renderer.render(sketch, viewport);
      showToast('Undo');
    }
  });

  btnRedo.addEventListener('click', () => {
    if (sketch.redo()) {
      renderer.render(sketch, viewport);
      showToast('Redo');
    }
  });

  function fitToView(): void {
    const bbox = sketch.getBoundingBox();
    if (bbox) {
      viewport.fitToBounds(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
    } else {
      viewport.centerOrigin();
      viewport.zoom = 1.0;
    }
    renderer.render(sketch, viewport);
    zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
  }

  btnFitView.addEventListener('click', fitToView);

  const btnSnapHeader = document.getElementById('btn-snap-header') as HTMLButtonElement;
  btnSnapHeader?.addEventListener('click', () => {
    interaction.toggleSnapping();
  });

  btnClear.addEventListener('click', () => {
    if (confirm('Clear sketch canvas?')) {
      sketch.clear();
      renderer.render(sketch, viewport);
      showToast('Sketch cleared');
    }
  });

  btnExport.addEventListener('click', () => {
    const svgData = sketch.exportSVG();
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sketch_${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('SVG exported successfully');
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd) {
      // Undo: Ctrl+Z / Cmd+Z (without Shift)
      if (
        (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я' || e.code === 'KeyZ') &&
        !e.shiftKey
      ) {
        e.preventDefault();
        if (sketch.undo()) {
          renderer.render(sketch, viewport);
          showToast('Undo');
        }
        return;
      }

      // Redo: Ctrl+Y / Cmd+Y OR Ctrl+Shift+Z / Cmd+Shift+Z
      const isRedoZ =
        (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я' || e.code === 'KeyZ') &&
        e.shiftKey;
      const isRedoY =
        e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н' || e.code === 'KeyY';
      if (isRedoZ || isRedoY) {
        e.preventDefault();
        if (sketch.redo()) {
          renderer.render(sketch, viewport);
          showToast('Redo');
        }
        return;
      }
    }

    if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
      if (!isCtrlOrCmd) {
        fitToView();
      }
    }
  });

  // Load Initial Constrained Triangle Demo
  loadTrianglePreset(sketch);
  sketch.clearHistory();
  updateUndoRedoButtons();
  renderer.render(sketch, viewport);
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
