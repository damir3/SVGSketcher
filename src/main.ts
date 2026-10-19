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
				<div class="brand-title">SVG Sketcher</div>
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
				<button class="btn-header" id="btn-fit-view" title="Fit to View (Z)">
					${ICONS.fitView} Fit to View
				</button>
				<button class="btn-header" id="btn-clear" title="Clear Sketch">
					${ICONS.clear} Clear
				</button>
				<button class="btn-header" id="btn-import" title="Open SVG (with CAD metadata)">
					${ICONS.open} Open SVG
				</button>
				<input type="file" id="file-input-svg" accept=".svg,image/svg+xml" style="display: none;" />
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
	const btnImport = document.getElementById('btn-import') as HTMLButtonElement;
	const fileInputSvg = document.getElementById('file-input-svg') as HTMLInputElement;
	const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
	const canvasContainer = document.querySelector('.cad-canvas-container') as HTMLElement;

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
	interaction.updateConstructionState();

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
		const svgData = sketch.exportSVG({
			panX: viewport.panX,
			panY: viewport.panY,
			zoom: viewport.zoom,
		});
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

	function loadSvgFile(file: File): void {
		if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') {
			showToast('Please select a valid .svg file');
			return;
		}

		const reader = new FileReader();
		reader.onload = e => {
			const content = e.target?.result;
			if (typeof content !== 'string') return;

			const result = sketch.importSVG(content);
			if (result.success) {
				if (result.viewport) {
					viewport.panX = result.viewport.panX;
					viewport.panY = result.viewport.panY;
					viewport.zoom = result.viewport.zoom;
				} else {
					fitToView();
				}
				renderer.render(sketch, viewport);
				presetSelector.value = 'blank';
				showToast(`Opened: ${file.name}`);
			} else {
				alert(`Failed to load SVG: ${result.error || 'Unknown error'}`);
			}
		};
		reader.onerror = () => {
			showToast('Failed to read file');
		};
		reader.readAsText(file);
	}

	btnImport.addEventListener('click', () => {
		fileInputSvg.value = '';
		fileInputSvg.click();
	});

	fileInputSvg.addEventListener('change', () => {
		const file = fileInputSvg.files?.[0];
		if (file) {
			loadSvgFile(file);
		}
	});

	if (canvasContainer) {
		canvasContainer.addEventListener('dragover', e => {
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
			canvasContainer.classList.add('drag-over');
		});

		canvasContainer.addEventListener('dragleave', e => {
			e.preventDefault();
			canvasContainer.classList.remove('drag-over');
		});

		canvasContainer.addEventListener('drop', e => {
			e.preventDefault();
			canvasContainer.classList.remove('drag-over');
			const file = e.dataTransfer?.files?.[0];
			if (file) {
				loadSvgFile(file);
			}
		});
	}

	// Keyboard Shortcuts
	window.addEventListener('keydown', e => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		const isCtrlOrCmd = e.ctrlKey || e.metaKey;

		if (isCtrlOrCmd) {
			// Undo: Ctrl+Z / Cmd+Z (without Shift)
			if (
				(e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') &&
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
				(e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') &&
				e.shiftKey;
			const isRedoY =
				e.key === 'y' || e.key === 'Y' || e.code === 'KeyY';
			if (isRedoZ || isRedoY) {
				e.preventDefault();
				if (sketch.redo()) {
					renderer.render(sketch, viewport);
					showToast('Redo');
				}
				return;
			}
		}

		if (e.key === 'z' || e.key === 'Z') {
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
