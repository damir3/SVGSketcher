import './style.css';
import { DEFAULT_ZOOM } from './constants';
import { SketchDocument } from './model/sketch';
import { Viewport } from './canvas/viewport';
import { SVGRenderer } from './canvas/renderer';
import { CanvasInteraction } from './canvas/interaction';
import { Toolbar, showToast } from './ui/toolbar';
import { Sidebar } from './ui/sidebar';
import { DimensionModal } from './ui/modal';
import { ParametersPopup } from './ui/parameters-popup';
import { ICONS } from './ui/icons';
import { setToolIconProvider } from './ui/panels/tools/iconProvider';
import { preloadFonts, setOnFontLoaded } from './canvas/fonts';

setToolIconProvider(name => ICONS[name] ?? '');
preloadFonts();

const PIXELS_PER_INCH = 96;
const PIXELS_PER_MILLIMETER = PIXELS_PER_INCH / 25.4;
const SVG_EXPORT_UNITS = [
	{ id: 'px', label: 'Pixels (px)', scale: 1 },
	{ id: 'mm', label: 'Millimeters (mm)', scale: PIXELS_PER_MILLIMETER },
	{ id: 'cm', label: 'Centimeters (cm)', scale: 10 * PIXELS_PER_MILLIMETER },
	{ id: 'm', label: 'Meters (m)', scale: 1000 * PIXELS_PER_MILLIMETER },
	{ id: 'in', label: 'Inches (in)', scale: PIXELS_PER_INCH },
	{ id: 'ft', label: 'Feet (ft)', scale: 12 * PIXELS_PER_INCH },
];

function initApp(): void {
	const app = document.getElementById('app');
	if (!app) return;

	const isMac =
		typeof navigator !== 'undefined' &&
		(/Mac|iPhone|iPod|iPad/.test(navigator.platform) || /Macintosh|Mac OS X/.test(navigator.userAgent));

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
			</div>

			<div class="header-actions">
				<button class="btn-header btn-icon" id="btn-undo" title="Undo (Ctrl+Z / Cmd+Z)" aria-label="Undo" disabled>
					${ICONS.undo}
				</button>
				<button class="btn-header btn-icon" id="btn-redo" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo" disabled>
					${ICONS.redo}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon active" id="btn-snap-header" title="Toggle Snapping" aria-label="Toggle Snapping">
					${ICONS.snap}
				</button>
				<button class="btn-header btn-icon active" id="btn-regions-header" title="Toggle Region Fill" aria-label="Toggle Region Fill" aria-pressed="true">
					${ICONS.regions}
				</button>
				<button class="btn-header btn-icon active" id="btn-constraint-badges-header" title="Toggle Constraints" aria-label="Toggle Constraints" aria-pressed="true">
					${ICONS.constraintBadges}
				</button>
				<button class="btn-header btn-icon active" id="btn-dimensions-header" title="Toggle Dimensions" aria-label="Toggle Dimensions" aria-pressed="true">
					${ICONS.dimensionsToggle}
				</button>
				<button class="btn-header btn-icon" id="btn-construction-header" title="Toggle Construction Mode (X)" aria-label="Toggle Construction Mode">
					${ICONS.construction}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-fit-view" title="Fit to View (Z)" aria-label="Fit to View">
					${ICONS.fitView}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-parameters" title="Parameters (${isMac ? 'Cmd+P' : 'Ctrl+P'})" aria-label="Parameters">
					${ICONS.parameters}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-clear" title="Clear Sketch" aria-label="Clear Sketch">
					${ICONS.clear}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-add-image" title="Add Image" aria-label="Add Image">
					${ICONS.image}
				</button>
				<input type="file" id="file-input-image" accept="image/*" hidden />
				<button class="btn-header" id="btn-import" title="Open SVG (with CAD metadata)">
					${ICONS.open} Open SVG
				</button>
				<input type="file" id="file-input-svg" accept=".svg,image/svg+xml" style="display: none;" />
				<button class="btn-header primary" id="btn-export" title="Export as SVG" aria-haspopup="dialog">
					${ICONS.export} Export SVG
				</button>
				<a class="btn-header btn-icon" href="https://github.com/damir3/SVGSketcher" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">
					${ICONS.github}
				</a>
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
				<span>Zoom: <strong id="zoom-level">${Math.round(DEFAULT_ZOOM * 100)}%</strong></span>
			</div>
			<div class="footer-status">
				<span>Constraint Solver: <strong id="solver-time">0.0 ms</strong></span>
				<span>Region Solver: <strong id="region-solver-time" title="Time for the last region calculation">0.0 ms</strong></span>
			</div>
		</footer>

		<dialog class="svg-export-dialog" id="svg-export-dialog" aria-labelledby="svg-export-title">
			<form method="dialog">
				<h2 id="svg-export-title">Export SVG</h2>
				<label class="svg-export-units">
					Units
					<select name="units" autofocus>
						${SVG_EXPORT_UNITS.map(
							({ id, label }) => `<option value="${id}"${id === 'mm' ? ' selected' : ''}>${label}</option>`
						).join('')}
					</select>
				</label>
				<fieldset>
					<legend>Include in SVG</legend>
					<label><input type="checkbox" name="layers" value="solid" checked /> Solid geometry</label>
					<label><input type="checkbox" name="layers" value="construction" checked /> Construction geometry</label>
					<label><input type="checkbox" name="layers" value="regions" checked /> Region fills</label>
					<label><input type="checkbox" name="layers" value="images" checked /> Reference images</label>
				</fieldset>
				<p>The editable Sketcher data is saved with the SVG.</p>
				<div class="svg-export-actions">
					<button type="button" class="btn-header" id="btn-cancel-svg-export">Cancel</button>
					<button type="submit" class="btn-header primary">Export SVG</button>
				</div>
			</form>
		</dialog>
	`;

	// Elements
	const svg = document.getElementById('cad-svg') as unknown as SVGSVGElement;
	const toolbarContainer = document.getElementById('toolbar') as HTMLElement;
	const sidebarContainer = document.getElementById('sidebar') as HTMLElement;
	const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
	const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
	const btnSnapHeader = document.getElementById('btn-snap-header') as HTMLButtonElement;
	const btnRegionsHeader = document.getElementById('btn-regions-header') as HTMLButtonElement;
	const btnConstraintBadgesHeader = document.getElementById('btn-constraint-badges-header') as HTMLButtonElement;
	const btnDimensionsHeader = document.getElementById('btn-dimensions-header') as HTMLButtonElement;
	const btnConstructionHeader = document.getElementById('btn-construction-header') as HTMLButtonElement;
	const btnFitView = document.getElementById('btn-fit-view') as HTMLButtonElement;
	const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
	const btnImport = document.getElementById('btn-import') as HTMLButtonElement;
	const fileInputSvg = document.getElementById('file-input-svg') as HTMLInputElement;
	const fileInputImage = document.getElementById('file-input-image') as HTMLInputElement;
	const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
	const canvasContainer = document.querySelector('.cad-canvas-container') as HTMLElement;

	const coordX = document.getElementById('coord-x') as HTMLElement;
	const coordY = document.getElementById('coord-y') as HTMLElement;
	const zoomLevel = document.getElementById('zoom-level') as HTMLElement;
	const solverTime = document.getElementById('solver-time') as HTMLElement;
	const regionSolverTime = document.getElementById('region-solver-time') as HTMLElement;

	// Initialization of Architecture
	const sketch = new SketchDocument();
	const canvasRect = svg.getBoundingClientRect();
	const viewport = new Viewport(canvasRect.width || 800, canvasRect.height || 600);
	const renderer = new SVGRenderer(svg);
	renderer.onRegionSolve = elapsedMs => {
		regionSolverTime.textContent = `${elapsedMs.toFixed(2)} ms`;
	};
	const interaction = new CanvasInteraction(svg, sketch, viewport, renderer);
	const toolbar = new Toolbar(toolbarContainer, sketch, interaction);
	const sidebar = new Sidebar(sidebarContainer, sketch, interaction);
	const dimModal = new DimensionModal(sketch);
	const paramModal = new ParametersPopup(sketch);

	const btnParameters = document.getElementById('btn-parameters') as HTMLButtonElement;
	btnParameters?.addEventListener('click', () => {
		paramModal.toggle();
	});

	// Connect callbacks
	interaction.onEditDimension = (constraint, screenPos) => {
		dimModal.open(constraint, screenPos);
	};

	sidebar.onEditDimension = (constraint, screenPos) => {
		dimModal.open(constraint, screenPos);
	};

	interaction.onToolChange = tool => {
		toolbar.setActiveButton(tool);
		sidebar.render();
	};

	interaction.onViewportChange = () => {
		zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
	};

	interaction.onConstructionChange = active => {
		toolbar.setConstructionActive(active);
		btnConstructionHeader?.classList.toggle('active', active);
	};
	interaction.updateConstructionState();

	interaction.onSnappingChange = active => {
		toolbar.setSnappingActive(active);
		btnSnapHeader?.classList.toggle('active', active);
	};
	btnSnapHeader?.classList.toggle('active', interaction.isSnappingEnabled);
	btnConstructionHeader?.classList.toggle('active', interaction.getEffectiveConstructionState());

	// Resize handling
	function handleResize(): void {
		const rect = svg.getBoundingClientRect();
		if (!viewport.resize(rect.width, rect.height)) return;
		interaction.cancelAnimation();
		interaction.render();
		interaction.onViewportChange?.();
	}

	new ResizeObserver(handleResize).observe(svg);

	setOnFontLoaded(() => {
		renderer.render(sketch, viewport);
	});

	// Track cursor coordinates
	svg.addEventListener('mousemove', e => {
		const rect = svg.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const snap = interaction.isSnappingEnabled ? interaction.findSnap(screen) : null;
		const world = snap ? snap.worldPos : viewport.screenToWorld(screen);
		const { subStep } = viewport.getGridStep();
		const decimals = subStep < 0.1 ? 2 : 1;
		coordX.textContent = world.x.toFixed(decimals);
		coordY.textContent = world.y.toFixed(decimals);
		zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
	});

	function updateUndoRedoButtons(): void {
		if (interaction.isDrawingSpline()) {
			btnUndo.disabled = !interaction.canUndoSplinePoint();
			btnRedo.disabled = !interaction.canRedoSplinePoint();
		} else {
			btnUndo.disabled = !sketch.canUndo();
			btnRedo.disabled = !sketch.canRedo();
		}
	}

	sketch.onChange(() => {
		solverTime.textContent = `${sketch.lastSolveTimeMs.toFixed(2)} ms`;
		if (interaction.activeTool === 'transform' || interaction.activeTool === 'image') interaction.render();
		else renderer.render(sketch, viewport);
		zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
		updateUndoRedoButtons();
	});

	// Header Actions
	function undo(): void {
		if (interaction.isDrawingSpline()) {
			if (interaction.undoSplinePoint()) {
				showToast('Spline: Undo point');
			}
			return;
		}
		if (interaction.undoSketch()) {
			showToast('Undo');
		}
	}
	btnUndo.addEventListener('click', undo);

	btnRedo.addEventListener('click', () => {
		if (interaction.isDrawingSpline()) {
			if (interaction.redoSplinePoint()) {
				showToast('Spline: Redo point');
			}
			return;
		}
		if (sketch.redo()) {
			renderer.render(sketch, viewport);
			showToast('Redo');
		}
	});

	function fitToView(smooth = true): void {
		interaction.fitToView(smooth);
	}

	btnFitView.addEventListener('click', () => fitToView(true));

	btnSnapHeader?.addEventListener('click', () => {
		interaction.toggleSnapping();
	});

	btnRegionsHeader?.addEventListener('click', () => {
		const visible = btnRegionsHeader.getAttribute('aria-pressed') !== 'true';
		btnRegionsHeader.setAttribute('aria-pressed', String(visible));
		btnRegionsHeader.classList.toggle('active', visible);
		renderer.setRegionsVisible(visible);
	});

	btnConstraintBadgesHeader?.addEventListener('click', () => {
		const visible = btnConstraintBadgesHeader.getAttribute('aria-pressed') !== 'true';
		btnConstraintBadgesHeader.setAttribute('aria-pressed', String(visible));
		btnConstraintBadgesHeader.classList.toggle('active', visible);
		renderer.setConstraintBadgesVisible(visible);
	});

	btnDimensionsHeader?.addEventListener('click', () => {
		const visible = btnDimensionsHeader.getAttribute('aria-pressed') !== 'true';
		btnDimensionsHeader.setAttribute('aria-pressed', String(visible));
		btnDimensionsHeader.classList.toggle('active', visible);
		renderer.setDimensionsVisible(visible);
	});

	btnConstructionHeader?.addEventListener('click', () => {
		interaction.toggleConstructionMode();
	});

	let imageRequest = 0;
	btnClear.addEventListener('click', () => {
		if (confirm('Clear sketch canvas?')) {
			imageRequest++;
			if (interaction.activeTool === 'image') interaction.setTool('select');
			sketch.clear();
			renderer.render(sketch, viewport);
			showToast('Sketch cleared');
		}
	});

	let replaceImageId: string | null = null;
	function pickImage(id: string | null): void {
		imageRequest++;
		replaceImageId = id;
		fileInputImage.value = '';
		fileInputImage.click();
	}

	document.getElementById('btn-add-image')?.addEventListener('click', () => pickImage(null));
	interaction.onReplaceImage = id => pickImage(id);
	fileInputImage.addEventListener('change', () => {
		const file = fileInputImage.files?.[0];
		if (!file) return;
		const request = imageRequest;
		const replacement = replaceImageId ? sketch.images.get(replaceImageId) : undefined;
		if (replaceImageId && !replacement) return;
		if (/[\\/]/.test(file.name) || file.name === '.' || file.name === '..') {
			showToast('Choose an image with a valid local file name.');
			return;
		}
		const objectUrl = URL.createObjectURL(file);
		const decoded = new Image();
		decoded.onload = () => {
			if (request !== imageRequest || (replacement && sketch.images.get(replacement.id) !== replacement)) {
				URL.revokeObjectURL(objectUrl);
				return;
			}
			const { naturalWidth, naturalHeight } = decoded;
			if (!naturalWidth || !naturalHeight) {
				URL.revokeObjectURL(objectUrl);
				showToast('The selected image has no dimensions.');
				return;
			}
			const source = { fileName: file.name, objectUrl, naturalWidth, naturalHeight };
			if (replacement) {
				const relinking = !replacement.objectUrl && file.name === replacement.fileName;
				sketch.updateImage(replacement.id, {
					...source,
					height: relinking ? replacement.height : (replacement.width * naturalHeight) / naturalWidth,
				});
				interaction.selectImage(replacement.id);
			} else {
				const center = viewport.screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 });
				const image = sketch.addImage({
					...center,
					...source,
					width: naturalWidth / viewport.zoom,
					height: naturalHeight / viewport.zoom,
					angle: 0,
					opacity: 1,
				});
				interaction.selectImage(image.id);
			}
		};
		decoded.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			if (request === imageRequest) showToast('Could not open the selected image.');
		};
		decoded.src = objectUrl;
	});

	const exportDialog = document.getElementById('svg-export-dialog') as HTMLDialogElement;
	const exportForm = exportDialog.querySelector('form')!;
	btnExport.addEventListener('click', () => exportDialog.showModal());
	exportDialog.querySelector('#btn-cancel-svg-export')?.addEventListener('click', () => exportDialog.close());
	exportDialog.addEventListener('keydown', e => e.stopPropagation());

	exportForm.addEventListener('submit', e => {
		e.preventDefault();
		const settings = new FormData(exportForm);
		const unit = settings.get('units');
		const scale = SVG_EXPORT_UNITS.find(({ id }) => id === unit)?.scale ?? PIXELS_PER_MILLIMETER;
		const layers = settings.getAll('layers');
		const svgData = sketch.exportSVG({ panX: viewport.panX, panY: viewport.panY, zoom: viewport.zoom }, scale, {
			regions: layers.includes('regions'),
			solid: layers.includes('solid'),
			construction: layers.includes('construction'),
			images: layers.includes('images'),
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
		exportDialog.close();
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
				imageRequest++;
				if (interaction.activeTool === 'image') interaction.setTool('select');
				if (result.viewport) {
					viewport.panX = result.viewport.panX;
					viewport.panY = result.viewport.panY;
					viewport.zoom = result.viewport.zoom;
					renderer.render(sketch, viewport);
					zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
				} else {
					fitToView(false);
				}
				showToast(
					sketch.images.size
						? `Opened: ${file.name}. Use Replace Image to relink local images.`
						: `Opened: ${file.name}`
				);
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
		const target = e.target as HTMLElement | null;
		const isCtrlOrCmd = e.ctrlKey || e.metaKey;
		const isUndo = isCtrlOrCmd && !e.shiftKey && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ');
		if (
			isUndo &&
			((interaction.activeTool === 'fillet' && target?.closest?.('.fillet-popup')) ||
				(interaction.activeTool === 'chamfer' && target?.closest?.('.chamfer-popup')))
		) {
			e.preventDefault();
			undo();
			return;
		}
		const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		if (
			(target &&
				((typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) ||
					(typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
					target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable)) ||
			(activeEl &&
				((typeof HTMLInputElement !== 'undefined' && activeEl instanceof HTMLInputElement) ||
					(typeof HTMLTextAreaElement !== 'undefined' && activeEl instanceof HTMLTextAreaElement) ||
					activeEl.tagName === 'INPUT' ||
					activeEl.tagName === 'TEXTAREA' ||
					activeEl.tagName === 'SELECT' ||
					activeEl.isContentEditable))
		) {
			return;
		}

		if (isCtrlOrCmd) {
			// Undo: Ctrl+Z / Cmd+Z (without Shift)
			if (isUndo) {
				e.preventDefault();
				undo();
				return;
			}

			// Redo: Ctrl+Y / Cmd+Y OR Ctrl+Shift+Z / Cmd+Shift+Z
			const isRedoZ = (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') && e.shiftKey;
			const isRedoY = e.key === 'y' || e.key === 'Y' || e.code === 'KeyY';
			if (isRedoZ || isRedoY) {
				e.preventDefault();
				if (interaction.isDrawingSpline()) {
					if (interaction.redoSplinePoint()) {
						showToast('Spline: Redo point');
					}
					return;
				}
				if (sketch.redo()) {
					renderer.render(sketch, viewport);
					showToast('Redo');
				}
				return;
			}
		}

		if (e.code === 'KeyZ') {
			if (!isCtrlOrCmd) {
				fitToView();
			}
		}

		if (e.code === 'KeyP' && (isMac ? e.metaKey : e.ctrlKey)) {
			e.preventDefault();
			paramModal.toggle();
		}
	});

	updateUndoRedoButtons();
	renderer.render(sketch, viewport);
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
