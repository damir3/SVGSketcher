import { Vec2 } from './math/vector';
import './style.css';
import { DEFAULT_ZOOM } from './constants';
import { SketchDocument } from './model/sketch';
import { getImageBounds } from './model/image';
import { Viewport } from './canvas/viewport';
import { SVGRenderer } from './canvas/renderer';
import { SVG_EXPORT_STYLE } from './canvas/styles';
import { CanvasInteraction } from './canvas/interaction';
import type { SnapReferences } from './canvas/snapping';
import { Toolbar, showToast } from './ui/toolbar';
import { Sidebar } from './ui/sidebar';
import { DimensionModal } from './ui/modal';
import { DeleteConstraintDialog, type ConfirmConstraintDelete } from './ui/delete-constraint-dialog';
import { ParametersPopup } from './ui/parameters-popup';
import { ICONS } from './ui/icons';
import { setupGridToggle } from './ui/gridToggle';
import { setToolIconProvider } from './ui/panels/tools/iconProvider';
import { preloadFonts, setOnFontLoaded } from './canvas/fonts';
import { initializeGeometryKernel } from './kernel/browser';
import { cycleTheme, getNextTheme, initTheme, onThemeChange } from './theme/themeController';

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
const LINE_TYPE_OPTIONS = [
	{ type: 'construction', label: 'Construction Line' },
	{ type: 'centerline', label: 'Centerline' },
	{ type: 'hidden', label: 'Hidden Line' },
	{ type: 'phantom', label: 'Phantom Line' },
	{ type: 'cutting_plane', label: 'Cutting Plane' },
] as const;

export interface SketcherApp {
	readonly sketch: SketchDocument;
	readonly canvas: SVGSVGElement;
	readonly viewport: Viewport;
	fit(): void;
	setSketchName(name: string): void;
	redraw(): void;
	setGridVisible(visible: boolean): void;
	setReferenceGeometry(references: SnapReferences): void;
	getHoveredId(): string | null;
}

export interface SketcherOptions {
	/** Use the imported or exported filename as the header title. Defaults to true. */
	useFileNameAsSketchName?: boolean;
	onReady?: (editor: SketcherApp) => void;
	/** Called when the grid button is pressed. */
	onGridVisibilityChange?: (visible: boolean) => void;
}

function initApp(options: SketcherOptions): void {
	const app = document.getElementById('app');
	if (!app) return;

	const isMac =
		typeof navigator !== 'undefined' &&
		(/Mac|iPhone|iPod|iPad/.test(navigator.platform) || /Macintosh|Mac OS X/.test(navigator.userAgent));

	app.innerHTML = `
		<!-- TOP HEADER -->
		<header class="cad-header">
			<div class="header-start">
				<div class="brand">
					<div class="brand-icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
							<polygon points="12 2 2 22 22 22"/>
						</svg>
					</div>
					<div class="brand-title">SVG Sketcher</div>
				</div>
				<button class="btn-header btn-icon" id="btn-import" type="button" title="Open SVG (with CAD metadata)" aria-label="Open SVG">
					${ICONS.open}
				</button>
				<input type="file" id="file-input-svg" accept=".svg,image/svg+xml" hidden />
				<button class="btn-header btn-icon" id="btn-export" type="button" title="Export as SVG" aria-label="Export SVG" aria-haspopup="dialog">
					${ICONS.export}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-undo" type="button" title="Undo (Ctrl+Z / Cmd+Z)" aria-label="Undo" disabled>
					${ICONS.undo}
				</button>
				<button class="btn-header btn-icon" id="btn-redo" type="button" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo" disabled>
					${ICONS.redo}
				</button>
			</div>

			<div class="sketch-name" id="sketch-name">Untitled Sketch</div>

			<div class="header-actions">
				<button class="btn-header btn-icon active" id="btn-snap-header" title="Toggle Snapping" aria-label="Toggle Snapping">
					${ICONS.snap}
				</button>
				<button class="btn-header btn-icon" id="grid-toggle" type="button"></button>
				<button class="btn-header btn-icon active" id="btn-regions-header" title="Toggle Region Fill" aria-label="Toggle Region Fill" aria-pressed="true">
					${ICONS.regions}
				</button>
				<button class="btn-header btn-icon active" id="btn-constraint-badges-header" title="Toggle Constraints" aria-label="Toggle Constraints" aria-pressed="true">
					${ICONS.constraintBadges}
				</button>
				<button class="btn-header btn-icon active" id="btn-dimensions-header" title="Toggle Dimensions" aria-label="Toggle Dimensions" aria-pressed="true">
					${ICONS.dimensionsToggle}
				</button>
				<div class="construction-control">
					<button class="btn-header btn-icon" id="btn-construction-header" title="Toggle Construction Line (X)" aria-label="Toggle Construction Line" aria-pressed="false">
						${ICONS.construction}
					</button>
					<button class="btn-header btn-icon construction-menu-toggle" id="btn-construction-menu" title="Choose line type" aria-label="Choose line type" aria-controls="construction-menu" aria-expanded="false">
						<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 5 3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
					</button>
					<div class="construction-menu" id="construction-menu" role="group" aria-label="Line type" hidden>
						${LINE_TYPE_OPTIONS.map(
							({ type, label }) =>
								`<button type="button" id="construction-mode-${type}" aria-pressed="false">${ICONS[type]}${label}</button>`
						).join('')}
					</div>
				</div>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-fit-view" title="Fit to View (Z)" aria-label="Fit to View">
					${ICONS.fitView}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-parameters" title="Parameters (${isMac ? 'Cmd+P' : 'Ctrl+P'})" aria-label="Parameters">
					${ICONS.parameters}
				</button>
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-add-image" title="Add Image" aria-label="Add Image">
					${ICONS.image}
				</button>
				<input type="file" id="file-input-image" accept="image/*" hidden />
				<div class="header-divider"></div>
				<button class="btn-header btn-icon" id="btn-theme" type="button"></button>
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
			<aside class="cad-sidebar" id="sidebar" aria-label="Inspector"></aside>
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
				<div class="dof-badge status-fully" id="dof-status-badge">
					<span class="dof-indicator"></span>
					<span id="dof-status-label">Fully Defined (0 DoF)</span>
				</div>
			</div>
		</footer>

		<dialog class="svg-export-dialog" id="svg-export-dialog" aria-labelledby="svg-export-title">
			<form method="dialog">
				<h2 id="svg-export-title">Export SVG</h2>
				<label class="svg-export-row">
					File name
					<input type="text" name="fileName" autocomplete="off" spellcheck="false" pattern=".*\\S.*" required />
				</label>
				<label class="svg-export-row">
					Units
					<select name="units" autofocus>
						${SVG_EXPORT_UNITS.map(
							({ id, label }) => `<option value="${id}"${id === 'mm' ? ' selected' : ''}>${label}</option>`
						).join('')}
					</select>
				</label>
				<label class="svg-export-row">
					Line width (mm)
					<input type="number" name="strokeWidth" min="0.001" step="any" value="${SVG_EXPORT_STYLE.strokeWidth}" required />
				</label>
				<fieldset>
					<legend>Include in SVG</legend>
					<label><input type="checkbox" name="layers" value="solid" checked /> Solid geometry</label>
					<label><input type="checkbox" name="layers" value="engineeringLines" checked /> Engineering lines</label>
					<label><input type="checkbox" name="layers" value="regions" checked /> Region fills</label>
					<label><input type="checkbox" name="layers" value="images" checked /> Reference images</label>
					<label><input type="checkbox" name="layers" value="dimensions" /> Dimensions and angles</label>
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
	const btnConstructionMenu = document.querySelector<HTMLButtonElement>('#btn-construction-menu')!;
	const constructionMenu = document.querySelector<HTMLElement>('#construction-menu')!;
	const constructionControl = constructionMenu.parentElement!;
	const constructionOptions = LINE_TYPE_OPTIONS.map(mode => ({
		...mode,
		button: constructionMenu.querySelector<HTMLButtonElement>(`#construction-mode-${mode.type}`)!,
	}));
	const btnFitView = document.getElementById('btn-fit-view') as HTMLButtonElement;
	const btnImport = document.getElementById('btn-import') as HTMLButtonElement;
	const fileInputSvg = document.getElementById('file-input-svg') as HTMLInputElement;
	const fileInputImage = document.getElementById('file-input-image') as HTMLInputElement;
	const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
	const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement;
	const canvasContainer = document.querySelector('.cad-canvas-container') as HTMLElement;

	const coordX = document.getElementById('coord-x') as HTMLElement;
	const coordY = document.getElementById('coord-y') as HTMLElement;
	const zoomLevel = document.getElementById('zoom-level') as HTMLElement;
	const solverTime = document.getElementById('solver-time') as HTMLElement;
	const regionSolverTime = document.getElementById('region-solver-time') as HTMLElement;
	const dofStatusBadge = document.getElementById('dof-status-badge') as HTMLElement;
	const dofStatusLabel = document.getElementById('dof-status-label') as HTMLElement;

	// Initialization of Architecture
	const sketch = new SketchDocument();
	sketch.solverCoordinator.onConstraintRejected(() => {
		queueMicrotask(() => showToast('Failed to solve'));
	});
	sketch.solverCoordinator.onReferenceCreated(() => {
		queueMicrotask(() => showToast('Reference dimension created'));
	});
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
	const deleteConstraintDialog = new DeleteConstraintDialog();
	const paramModal = new ParametersPopup(sketch);

	const confirmConstraintDelete: ConfirmConstraintDelete = constraints => deleteConstraintDialog.open(constraints);
	interaction.onConfirmConstraintDelete = confirmConstraintDelete;
	sidebar.onConfirmConstraintDelete = confirmConstraintDelete;

	const btnParameters = document.getElementById('btn-parameters') as HTMLButtonElement;
	btnParameters?.addEventListener('click', () => {
		paramModal.toggle();
	});

	// Connect callbacks
	interaction.onEditDimension = (constraint, screenPos, isNew) => {
		dimModal.open(constraint, screenPos, isNew);
		return isNew && !constraint.isReference;
	};

	interaction.onToolChange = tool => {
		toolbar.setActiveButton(tool);
		sidebar.render();
	};

	interaction.onViewportChange = () => {
		zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
	};

	interaction.onConstructionChange = (active, lineType) => {
		toolbar.setConstructionActive(active);
		btnConstructionHeader.classList.toggle('active', active);
		btnConstructionHeader.setAttribute('aria-pressed', String(active));
		for (const { type, button } of constructionOptions) {
			button.setAttribute('aria-pressed', String(type === lineType));
		}
		if (btnConstructionHeader.dataset.lineType === lineType) return;
		const { label } = constructionOptions.find(option => option.type === lineType)!;
		btnConstructionHeader.dataset.lineType = lineType;
		btnConstructionHeader.innerHTML = ICONS[lineType];
		btnConstructionHeader.title = `Toggle ${label} (X)`;
		btnConstructionHeader.setAttribute('aria-label', `Toggle ${label}`);
	};
	interaction.updateConstructionState();

	interaction.onSnappingChange = active => {
		toolbar.setSnappingActive(active);
		btnSnapHeader?.classList.toggle('active', active);
	};
	btnSnapHeader?.classList.toggle('active', interaction.isSnappingEnabled);

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
		const screen = new Vec2(e.clientX - rect.left, e.clientY - rect.top);
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

	function updateDofStatus(): void {
		const res = sketch.lastSolverResult;
		const dof = res ? res.degreesOfFreedom : 0;
		const status = res ? res.status : 'CONVERGED';

		let statusClass = 'status-under';
		let statusLabel = `Under-constrained (${dof} DoF)`;

		if (status === 'OVER_CONSTRAINED') {
			statusClass = 'status-conflict';
			statusLabel = 'Over-constrained / Conflict';
		} else if (status === 'CONVERGED' && dof === 0) {
			statusClass = 'status-fully';
			statusLabel = 'Fully Defined (0 DoF)';
		}

		dofStatusBadge.className = `dof-badge ${statusClass}`;
		dofStatusLabel.textContent = statusLabel;
	}

	updateDofStatus();

	sketch.onChange(() => {
		solverTime.textContent = `${sketch.lastSolveTimeMs.toFixed(2)} ms`;
		if (interaction.activeTool === 'transform' || interaction.activeTool === 'image') interaction.render();
		else renderer.render(sketch, viewport);
		zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
		updateUndoRedoButtons();
		updateDofStatus();
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

	function redo(): void {
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
	}

	btnRedo.addEventListener('click', redo);

	function fitToView(smooth = true): void {
		interaction.fitToView(smooth);
	}

	btnFitView.addEventListener('click', () => fitToView(true));

	const gridToggle = setupGridToggle(document.getElementById('grid-toggle') as HTMLButtonElement, visible => {
		updateGridVisibility(visible);
		options.onGridVisibilityChange?.(visible);
	});

	function setGridVisible(visible: boolean): void {
		gridToggle.setVisible(visible);
		updateGridVisibility(visible);
	}

	function updateGridVisibility(visible: boolean): void {
		renderer.setGridVisible(visible);
		interaction.render();
	}

	btnSnapHeader?.addEventListener('click', () => {
		interaction.toggleSnapping();
	});

	// The button shows the theme it switches to.
	function updateThemeButton(): void {
		const next = getNextTheme();
		const label = `Switch to ${next.label} Theme`;
		btnTheme.innerHTML = ICONS[`theme_${next.id}` as keyof typeof ICONS] ?? ICONS.theme_light;
		btnTheme.title = label;
		btnTheme.setAttribute('aria-label', label);
	}
	onThemeChange(updateThemeButton);
	updateThemeButton();
	btnTheme.addEventListener('click', () => {
		cycleTheme();
	});

	for (const [btn, setVisible] of [
		[btnRegionsHeader, (v: boolean) => renderer.setRegionsVisible(v)],
		[btnConstraintBadgesHeader, (v: boolean) => renderer.setConstraintBadgesVisible(v)],
		[btnDimensionsHeader, (v: boolean) => renderer.setDimensionsVisible(v)],
	] as const) {
		btn?.addEventListener('click', () => {
			const visible = btn.getAttribute('aria-pressed') !== 'true';
			btn.setAttribute('aria-pressed', String(visible));
			btn.classList.toggle('active', visible);
			setVisible(visible);
		});
	}

	btnConstructionHeader.addEventListener('click', () => {
		setConstructionMenuOpen(false);
		interaction.toggleConstructionMode();
	});
	function setConstructionMenuOpen(open: boolean): void {
		constructionMenu.hidden = !open;
		btnConstructionMenu.setAttribute('aria-expanded', String(open));
	}
	btnConstructionMenu.addEventListener('click', () => {
		const open = constructionMenu.hidden;
		setConstructionMenuOpen(open);
		if (open) {
			const lineType = btnConstructionHeader.dataset.lineType;
			const option = constructionOptions.find(option => option.type === lineType) ?? constructionOptions[0];
			option.button.focus();
		}
	});
	for (const { type, button } of constructionOptions) {
		button.addEventListener('click', () => {
			interaction.setConstructionLineType(type);
			setConstructionMenuOpen(false);
			btnConstructionMenu.focus();
		});
	}
	constructionControl.addEventListener('keydown', e => {
		if (constructionMenu.hidden) return;
		e.stopPropagation();
		if (e.key === 'Escape') {
			setConstructionMenuOpen(false);
			btnConstructionMenu.focus();
		}
	});
	constructionControl.addEventListener('focusout', e => {
		if (!constructionControl.contains(e.relatedTarget as Node | null)) setConstructionMenuOpen(false);
	});
	document.addEventListener('pointerdown', e => {
		if (!constructionControl.contains(e.target as Node)) setConstructionMenuOpen(false);
	});

	let imageRequest = 0;
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
				interaction.cancelAnimation();
				const center = viewport.screenToWorld(new Vec2(viewport.width / 2, viewport.height / 2));
				const image = sketch.addImage({
					...center,
					...source,
					width: naturalWidth / viewport.zoom,
					height: naturalHeight / viewport.zoom,
					angle: 0,
					opacity: 1,
				});
				interaction.selectImage(image.id);
				if (naturalWidth > viewport.width || naturalHeight > viewport.height) {
					const target = viewport.getTargetFit(getImageBounds(image), undefined, 0);
					interaction.animateViewportTo(target.panX, target.panY, target.zoom);
				}
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
	const exportSettingsKey = 'sketcher.svgExportSettings';
	const exportFileName = exportForm.querySelector<HTMLInputElement>('[name="fileName"]')!;
	const exportUnits = exportForm.querySelector<HTMLSelectElement>('[name="units"]')!;
	const exportStrokeWidth = exportForm.querySelector<HTMLInputElement>('[name="strokeWidth"]')!;
	const exportLayers = exportForm.querySelectorAll<HTMLInputElement>('[name="layers"]');
	let sceneFileName: string | undefined;
	const sketchName = document.getElementById('sketch-name')!;
	function setSketchName(name: string): void {
		sketchName.textContent = name;
		sketchName.title = name;
	}
	try {
		const saved = JSON.parse(localStorage.getItem(exportSettingsKey) ?? 'null');
		if (saved && typeof saved === 'object') {
			if (SVG_EXPORT_UNITS.some(({ id }) => id === saved.units)) exportUnits.value = saved.units;
			if (Number.isFinite(saved.strokeWidth) && saved.strokeWidth >= Number(exportStrokeWidth.min)) {
				exportStrokeWidth.value = String(saved.strokeWidth);
			}
			exportLayers.forEach(input => {
				if (typeof saved.layers?.[input.value] === 'boolean') input.checked = saved.layers[input.value];
			});
		}
	} catch {
		// Keep the defaults when stored settings are invalid or storage is unavailable.
	}
	function saveExportSettings(): void {
		if (!exportStrokeWidth.validity.valid) return;
		const layers: Record<string, boolean> = {};
		exportLayers.forEach(input => {
			layers[input.value] = input.checked;
		});
		try {
			localStorage.setItem(
				exportSettingsKey,
				JSON.stringify({ units: exportUnits.value, strokeWidth: exportStrokeWidth.valueAsNumber, layers })
			);
		} catch {
			// Export remains available when browser storage is unavailable.
		}
	}
	exportForm.addEventListener('change', saveExportSettings);
	btnExport.addEventListener('click', () => {
		exportFileName.value = sceneFileName ?? `sketch_${Date.now()}.svg`;
		exportDialog.showModal();
	});
	exportDialog.querySelector('#btn-cancel-svg-export')?.addEventListener('click', () => exportDialog.close());
	exportDialog.addEventListener('keydown', e => e.stopPropagation());

	exportForm.addEventListener('submit', e => {
		e.preventDefault();
		const fileName = exportFileName.value.trim();
		const downloadName = /\.svg$/i.test(fileName) ? fileName : `${fileName}.svg`;
		const settings = new FormData(exportForm);
		const unit = settings.get('units');
		const scale = SVG_EXPORT_UNITS.find(({ id }) => id === unit)?.scale ?? PIXELS_PER_MILLIMETER;
		const layers = settings.getAll('layers');
		const strokeWidth = exportStrokeWidth.valueAsNumber;
		const svgData = sketch.exportSVG(
			{ panX: viewport.panX, panY: viewport.panY, zoom: viewport.zoom },
			scale,
			{
				strokeWidth,
				regions: layers.includes('regions'),
				solid: layers.includes('solid'),
				engineeringLines: layers.includes('engineeringLines'),
				images: layers.includes('images'),
				dimensions: layers.includes('dimensions'),
			},
			layers.includes('dimensions') ? renderer.exportDimensions(sketch, viewport, strokeWidth) : undefined
		);
		const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = downloadName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		sceneFileName = downloadName;
		if (options.useFileNameAsSketchName !== false) setSketchName(downloadName.replace(/\.svg$/i, ''));
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
				sceneFileName = file.name;
				if (options.useFileNameAsSketchName !== false) setSketchName(file.name.replace(/\.svg$/i, ''));
				if (result.exportSettings) {
					exportStrokeWidth.value = String(result.exportSettings.strokeWidth);
					saveExportSettings();
				}
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
		const isEditable = (el: HTMLElement | null) =>
			Boolean(
				el &&
					((typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) ||
						(typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) ||
						el.tagName === 'INPUT' ||
						el.tagName === 'TEXTAREA' ||
						el.tagName === 'SELECT' ||
						el.isContentEditable)
			);
		if (isEditable(target) || isEditable(activeEl)) {
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
				redo();
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
	options.onReady?.({
		sketch,
		canvas: svg,
		viewport,
		fit: () => fitToView(false),
		setSketchName,
		redraw: () => interaction.render(),
		setGridVisible,
		setReferenceGeometry: references => {
			renderer.externalRegionCurves = references.curves;
			interaction.snapReferences = references;
		},
		getHoveredId: () => interaction.highlightManager.getHoveredId(),
	});
}

export async function startSketcher(options: SketcherOptions = {}): Promise<void> {
	setToolIconProvider(name => ICONS[name] ?? '');
	preloadFonts();
	// Apply the saved theme before rendering the canvas.
	initTheme();
	try {
		await initializeGeometryKernel();
	} catch (error) {
		console.error('Failed to initialize Rust/WASM geometry kernel.', error);
		const app = document.getElementById('app');
		if (app) {
			app.textContent = `Failed to load Rust/WASM geometry kernel: ${error instanceof Error ? error.message : String(error)}`;
		}
		return;
	}
	initApp(options);
}
