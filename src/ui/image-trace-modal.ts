import type { SketchImage } from '../model/image';
import {
	buildTraceGeometry,
	cloneTraceSettings,
	decodeImageForTrace,
	DEFAULT_TRACE_SETTINGS,
	getAutoMinSegment,
	getTracePrimitiveCount,
	ImageTraceRunner,
	TRACE_PRIMITIVE_WARNING,
	type CenterlineAlgorithm,
	type ImageAfterConvert,
	type ImageTraceSettings,
	type OutlineAlgorithm,
	type TraceMode,
	type TraceResult,
} from '../model/imageTrace';
import type { SketchDocument } from '../model/sketch';
import { getToolIcon } from './panels/tools/iconProvider';
import { showToast } from './toast';

export interface ImageTraceModalCallbacks {
	onPreviewChange: (
		preview: { imageId: string; result: TraceResult | null; settings: ImageTraceSettings } | null
	) => void;
	onConverted: (imageId: string) => void;
}

const DEBOUNCE_MS = 60;

export class ImageTraceModal {
	private container: HTMLElement | null = null;
	private dialogEl: HTMLElement | null = null;
	private sketch: SketchDocument;
	private callbacks: ImageTraceModalCallbacks;
	private runner = new ImageTraceRunner();
	private settings: ImageTraceSettings = cloneTraceSettings(DEFAULT_TRACE_SETTINGS);
	private currentImageId: string | null = null;
	private latestResult: TraceResult | null = null;
	private isTracing = false;
	private isOpen = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private traceEpoch = 0;
	private dragOffset: { x: number; y: number } | null = null;

	constructor(sketch: SketchDocument, callbacks: ImageTraceModalCallbacks) {
		this.sketch = sketch;
		this.callbacks = callbacks;
		if (typeof document !== 'undefined') {
			this.container = document.createElement('div');
			this.container.className = 'trace-modal-layer hidden';
			document.body.appendChild(this.container);
			this.render();
			this.bindEvents();
		}
	}

	get openState(): boolean {
		return this.isOpen;
	}

	open(imageId: string): void {
		const image = this.sketch.images.get(imageId);
		if (!image || !image.objectUrl) {
			showToast('Choose the local image file first to convert it.');
			return;
		}
		this.currentImageId = imageId;
		this.latestResult = null;
		this.isOpen = true;
		this.container?.classList.remove('hidden');
		this.syncControlsFromSettings();
		this.scheduleTrace(true);
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.traceEpoch++;
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.runner.dispose();
		this.currentImageId = null;
		this.latestResult = null;
		this.isTracing = false;
		this.container?.classList.add('hidden');
		this.callbacks.onPreviewChange(null);
	}

	private get currentImage(): SketchImage | undefined {
		return this.currentImageId ? this.sketch.images.get(this.currentImageId) : undefined;
	}

	private render(): void {
		if (!this.container) return;
		this.container.innerHTML = `
			<div class="trace-modal-dialog" role="dialog" aria-modal="false" aria-labelledby="trace-modal-title">
				<div class="trace-modal-header" data-trace-drag-handle>
					<div class="param-modal-title-wrap">
						<div class="param-modal-icon">${getToolIcon('image')}</div>
						<div>
							<h2 id="trace-modal-title" class="param-modal-title">Convert Image to Primitives</h2>
							<div class="trace-modal-subtitle" id="trace-modal-image-name"></div>
						</div>
					</div>
					<button type="button" class="btn-modal-close" id="btn-close-trace-modal" title="Close (Esc)" aria-label="Close">✕</button>
				</div>

				<div class="trace-modal-body">
					<div class="trace-section">
						<div class="trace-section-title">Trace Mode & Algorithm</div>
						<div class="trace-row">
							<span class="trace-label">Mode</span>
							<div class="tool-mode-selector trace-mode-selector">
								<button type="button" class="tool-mode-button trace-mode-button" data-trace-mode="outline" title="Trace boundary contours of filled regions">
									<span class="tool-mode-label">Outline</span>
								</button>
								<button type="button" class="tool-mode-button trace-mode-button" data-trace-mode="centerline" title="Thin lines to a skeleton and trace centerlines">
									<span class="tool-mode-label">Centerline</span>
								</button>
							</div>
						</div>
						<div class="trace-row" id="trace-outline-algo-row">
							<label class="trace-label" for="trace-outline-algo">Contour Algorithm</label>
							<select class="trace-select" id="trace-outline-algo">
								<option value="marching-squares">Marching Squares (Subpixel)</option>
								<option value="pixel-edges">Pixel Edges (Exact)</option>
							</select>
						</div>
						<div class="trace-row hidden" id="trace-centerline-algo-row">
							<label class="trace-label" for="trace-centerline-algo">Skeleton Algorithm</label>
							<select class="trace-select" id="trace-centerline-algo">
								<option value="zhang-suen">Zhang–Suen Thinning</option>
								<option value="guo-hall">Guo–Hall Thinning</option>
							</select>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-max-res">Max Resolution</label>
							<select class="trace-select" id="trace-max-res">
								<option value="500">500 px (Fast)</option>
								<option value="1000">1000 px (Balanced)</option>
								<option value="1500">1500 px (Detailed)</option>
								<option value="2000">2000 px (High)</option>
							</select>
						</div>
					</div>

					<div class="trace-section">
						<div class="trace-section-title">Binarization & Cleanup</div>
						<div class="trace-row">
							<div class="trace-label-with-toggle">
								<label class="trace-label" for="trace-threshold">Threshold</label>
								<label class="trace-inline-check" title="Compute threshold automatically using Otsu's method">
									<input type="checkbox" id="trace-auto-threshold" />
									<span>Auto</span>
								</label>
							</div>
							<div class="trace-slider-group">
								<input type="range" id="trace-threshold-range" min="1" max="255" step="1" />
								<input type="number" class="trace-num-input" id="trace-threshold" min="1" max="255" step="1" />
							</div>
						</div>
						<div class="trace-row">
							<label class="trace-check-row">
								<input type="checkbox" id="trace-invert" />
								<span>Invert (light lines on dark background)</span>
							</label>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-blur">Blur</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-blur-range" min="0" max="5" step="0.5" />
								<input type="number" class="trace-num-input" id="trace-blur" min="0" max="5" step="0.5" />
								<span class="trace-unit">px</span>
							</div>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-despeckle" title="Ignore specks and holes smaller than this area">Despeckle</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-despeckle-range" min="0" max="200" step="1" />
								<input type="number" class="trace-num-input" id="trace-despeckle" min="0" max="500" step="1" />
								<span class="trace-unit">px²</span>
							</div>
						</div>
					</div>

					<div class="trace-section">
						<div class="trace-section-title">Curve Fitting & Primitives</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-tolerance" title="Maximum deviation of fitted lines, arcs and splines from the contour">Tolerance</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-tolerance-range" min="0.3" max="8" step="0.1" />
								<input type="number" class="trace-num-input" id="trace-tolerance" min="0.1" max="25" step="0.1" />
								<span class="trace-unit">px</span>
							</div>
						</div>
						<div class="trace-row">
							<div class="trace-label-with-toggle">
								<label class="trace-label" for="trace-min-segment" title="Minimum length for lines and arcs; shorter curved runs stay splines">Min Segment</label>
								<label class="trace-inline-check" title="Determine minimum segment length automatically from tolerance and image size">
									<input type="checkbox" id="trace-auto-min-segment" />
									<span>Auto</span>
								</label>
							</div>
							<div class="trace-slider-group">
								<input type="range" id="trace-min-segment-range" min="2" max="80" step="1" />
								<input type="number" class="trace-num-input" id="trace-min-segment" min="2" max="300" step="1" />
								<span class="trace-unit">px</span>
							</div>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-smoothing">Smoothing</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-smoothing-range" min="0" max="4" step="0.2" />
								<input type="number" class="trace-num-input" id="trace-smoothing" min="0" max="10" step="0.2" />
								<span class="trace-unit">px</span>
							</div>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-corner-angle">Corner Angle</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-corner-angle-range" min="15" max="90" step="5" />
								<input type="number" class="trace-num-input" id="trace-corner-angle" min="10" max="120" step="5" />
								<span class="trace-unit">°</span>
							</div>
						</div>
						<div class="trace-row">
							<span class="trace-label">Primitives</span>
							<div class="trace-checks-inline">
								<label class="trace-inline-check" title="Fit straight line segments">
									<input type="checkbox" id="trace-use-lines" />
									<span>Lines</span>
								</label>
								<label class="trace-inline-check" title="Fit circular arcs to curved segments">
									<input type="checkbox" id="trace-use-arcs" />
									<span>Arcs</span>
								</label>
								<label class="trace-inline-check" title="Detect full circles on closed loops">
									<input type="checkbox" id="trace-use-circles" />
									<span>Circles</span>
								</label>
							</div>
						</div>
					</div>

					<div class="trace-section">
						<div class="trace-section-title">Automatic Constraints</div>
						<div class="trace-constraints-grid">
							<label class="trace-check-row">
								<input type="checkbox" id="trace-c-tangent" />
								<span>Tangent (Line–Arc, Arc–Arc)</span>
							</label>
							<label class="trace-check-row">
								<input type="checkbox" id="trace-c-hv" />
								<span>Horizontal / Vertical</span>
							</label>
							<label class="trace-check-row">
								<input type="checkbox" id="trace-c-pp" />
								<span>Parallel / Perpendicular</span>
							</label>
							<label class="trace-check-row">
								<input type="checkbox" id="trace-c-equal" />
								<span>Equal Length / Radius</span>
							</label>
							<label class="trace-check-row">
								<input type="checkbox" id="trace-c-concentric" />
								<span>Concentric</span>
							</label>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-angle-tol">Angle Tolerance</label>
							<div class="trace-slider-group">
								<input type="range" id="trace-angle-tol-range" min="0.5" max="10" step="0.5" />
								<input type="number" class="trace-num-input" id="trace-angle-tol" min="0.5" max="15" step="0.5" />
								<span class="trace-unit">°</span>
							</div>
						</div>
					</div>

					<div class="trace-section">
						<div class="trace-section-title">Output</div>
						<div class="trace-row">
							<label class="trace-check-row">
								<input type="checkbox" id="trace-construction" />
								<span>Create as Construction Geometry</span>
							</label>
						</div>
						<div class="trace-row">
							<label class="trace-label" for="trace-after-convert">Source Image</label>
							<select class="trace-select" id="trace-after-convert">
								<option value="keep">Keep image</option>
								<option value="dim">Dim image (30%)</option>
								<option value="delete">Remove image</option>
							</select>
						</div>
					</div>
				</div>

				<div class="trace-warning-banner hidden" id="trace-warning-banner"></div>

				<div class="trace-modal-footer">
					<div class="trace-stats-summary" id="trace-stats-summary">Tracing…</div>
					<div class="trace-footer-actions">
						<button type="button" class="btn-param-action" id="btn-trace-reset" title="Reset to default settings">Reset</button>
						<button type="button" class="btn-param-action" id="btn-trace-cancel">Cancel</button>
						<button type="button" class="btn-param-action primary" id="btn-trace-apply">Convert</button>
					</div>
				</div>
			</div>
		`;
		this.dialogEl = this.container.querySelector('.trace-modal-dialog');
	}

	private syncControlsFromSettings(): void {
		if (!this.container) return;
		const s = this.settings;
		const image = this.currentImage;
		const nameEl = this.container.querySelector('#trace-modal-image-name');
		if (nameEl) nameEl.textContent = image ? image.fileName : '';

		this.container.querySelectorAll<HTMLButtonElement>('[data-trace-mode]').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.traceMode === s.mode);
		});
		this.container.querySelector('#trace-outline-algo-row')?.classList.toggle('hidden', s.mode !== 'outline');
		this.container.querySelector('#trace-centerline-algo-row')?.classList.toggle('hidden', s.mode !== 'centerline');

		this.setSelectValue('#trace-outline-algo', s.outlineAlgorithm);
		this.setSelectValue('#trace-centerline-algo', s.centerlineAlgorithm);
		this.setSelectValue('#trace-max-res', String(s.maxResolution));

		this.setCheckbox('#trace-auto-threshold', s.autoThreshold);
		const shownThreshold = this.latestResult && s.autoThreshold ? this.latestResult.threshold : s.threshold;
		this.setSliderAndNumber('#trace-threshold-range', '#trace-threshold', shownThreshold);

		this.setCheckbox('#trace-invert', s.invert);
		this.setSliderAndNumber('#trace-blur-range', '#trace-blur', s.blur);
		this.setSliderAndNumber('#trace-despeckle-range', '#trace-despeckle', s.despeckle);
		this.setSliderAndNumber('#trace-tolerance-range', '#trace-tolerance', s.tolerance);

		this.setCheckbox('#trace-auto-min-segment', s.autoMinSegment);
		const refW = this.latestResult?.width ?? image?.naturalWidth ?? 1000;
		const refH = this.latestResult?.height ?? image?.naturalHeight ?? 1000;
		const shownMinSeg = s.autoMinSegment ? Math.round(getAutoMinSegment(s, refW, refH)) : s.minSegment;
		this.setSliderAndNumber('#trace-min-segment-range', '#trace-min-segment', shownMinSeg);

		this.setSliderAndNumber('#trace-smoothing-range', '#trace-smoothing', s.smoothing);
		this.setSliderAndNumber('#trace-corner-angle-range', '#trace-corner-angle', s.cornerAngle);
		this.setCheckbox('#trace-use-lines', s.useLines);
		this.setCheckbox('#trace-use-arcs', s.useArcs);
		this.setCheckbox('#trace-use-circles', s.useCircles);

		this.setCheckbox('#trace-c-tangent', s.constraints.tangent);
		this.setCheckbox('#trace-c-hv', s.constraints.horizontalVertical);
		this.setCheckbox('#trace-c-pp', s.constraints.parallelPerpendicular);
		this.setCheckbox('#trace-c-equal', s.constraints.equal);
		this.setCheckbox('#trace-c-concentric', s.constraints.concentric);
		this.setSliderAndNumber('#trace-angle-tol-range', '#trace-angle-tol', s.angleTolerance);

		this.setCheckbox('#trace-construction', s.construction);
		this.setSelectValue('#trace-after-convert', s.afterConvert);
	}

	private setSelectValue(selector: string, value: string): void {
		const el = this.container?.querySelector<HTMLSelectElement>(selector);
		if (el) el.value = value;
	}

	private setCheckbox(selector: string, checked: boolean): void {
		const el = this.container?.querySelector<HTMLInputElement>(selector);
		if (el) el.checked = checked;
	}

	private setSliderAndNumber(rangeSelector: string, numSelector: string, value: number): void {
		const str = String(Number(value.toFixed(2)));
		const rangeEl = this.container?.querySelector<HTMLInputElement>(rangeSelector);
		const numEl = this.container?.querySelector<HTMLInputElement>(numSelector);
		if (rangeEl) rangeEl.value = str;
		if (numEl) numEl.value = str;
	}

	private bindEvents(): void {
		if (!this.container) return;
		const c = this.container;

		c.querySelector('#btn-close-trace-modal')?.addEventListener('click', () => this.close());
		c.querySelector('#btn-trace-cancel')?.addEventListener('click', () => this.close());
		c.querySelector('#btn-trace-reset')?.addEventListener('click', () => {
			this.settings = cloneTraceSettings(DEFAULT_TRACE_SETTINGS);
			this.syncControlsFromSettings();
			this.scheduleTrace(true);
		});
		c.querySelector('#btn-trace-apply')?.addEventListener('click', () => this.applyConversion());

		c.querySelectorAll<HTMLButtonElement>('[data-trace-mode]').forEach(btn => {
			btn.addEventListener('click', () => {
				const mode = btn.dataset.traceMode as TraceMode;
				if (!mode || this.settings.mode === mode) return;
				this.settings.mode = mode;
				this.syncControlsFromSettings();
				this.scheduleTrace();
			});
		});

		c.querySelector<HTMLSelectElement>('#trace-outline-algo')?.addEventListener('change', e => {
			this.settings.outlineAlgorithm = (e.target as HTMLSelectElement).value as OutlineAlgorithm;
			this.scheduleTrace();
		});

		c.querySelector<HTMLSelectElement>('#trace-centerline-algo')?.addEventListener('change', e => {
			this.settings.centerlineAlgorithm = (e.target as HTMLSelectElement).value as CenterlineAlgorithm;
			this.scheduleTrace();
		});

		c.querySelector<HTMLSelectElement>('#trace-max-res')?.addEventListener('change', e => {
			this.settings.maxResolution = Number((e.target as HTMLSelectElement).value) || 1000;
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-auto-threshold')?.addEventListener('change', e => {
			this.settings.autoThreshold = (e.target as HTMLInputElement).checked;
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-threshold-range', '#trace-threshold', 1, 255, val => {
			this.settings.autoThreshold = false;
			this.settings.threshold = Math.round(val);
			this.setCheckbox('#trace-auto-threshold', false);
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-invert')?.addEventListener('change', e => {
			this.settings.invert = (e.target as HTMLInputElement).checked;
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-blur-range', '#trace-blur', 0, 5, val => {
			this.settings.blur = val;
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-despeckle-range', '#trace-despeckle', 0, 500, val => {
			this.settings.despeckle = Math.round(val);
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-tolerance-range', '#trace-tolerance', 0.1, 25, val => {
			this.settings.tolerance = val;
			if (this.settings.autoMinSegment) {
				const refW = this.latestResult?.width ?? this.currentImage?.naturalWidth ?? 1000;
				const refH = this.latestResult?.height ?? this.currentImage?.naturalHeight ?? 1000;
				this.setSliderAndNumber(
					'#trace-min-segment-range',
					'#trace-min-segment',
					Math.round(getAutoMinSegment(this.settings, refW, refH))
				);
			}
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-auto-min-segment')?.addEventListener('change', e => {
			this.settings.autoMinSegment = (e.target as HTMLInputElement).checked;
			this.syncControlsFromSettings();
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-min-segment-range', '#trace-min-segment', 2, 300, val => {
			this.settings.autoMinSegment = false;
			this.settings.minSegment = Math.round(val);
			this.setCheckbox('#trace-auto-min-segment', false);
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-smoothing-range', '#trace-smoothing', 0, 10, val => {
			this.settings.smoothing = val;
			this.scheduleTrace();
		});

		this.bindLinkedSlider('#trace-corner-angle-range', '#trace-corner-angle', 10, 120, val => {
			this.settings.cornerAngle = Math.round(val);
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-use-lines')?.addEventListener('change', e => {
			this.settings.useLines = (e.target as HTMLInputElement).checked;
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-use-arcs')?.addEventListener('change', e => {
			this.settings.useArcs = (e.target as HTMLInputElement).checked;
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-use-circles')?.addEventListener('change', e => {
			this.settings.useCircles = (e.target as HTMLInputElement).checked;
			this.scheduleTrace();
		});

		c.querySelector<HTMLInputElement>('#trace-c-tangent')?.addEventListener('change', e => {
			this.settings.constraints.tangent = (e.target as HTMLInputElement).checked;
		});
		c.querySelector<HTMLInputElement>('#trace-c-hv')?.addEventListener('change', e => {
			this.settings.constraints.horizontalVertical = (e.target as HTMLInputElement).checked;
		});
		c.querySelector<HTMLInputElement>('#trace-c-pp')?.addEventListener('change', e => {
			this.settings.constraints.parallelPerpendicular = (e.target as HTMLInputElement).checked;
		});
		c.querySelector<HTMLInputElement>('#trace-c-equal')?.addEventListener('change', e => {
			this.settings.constraints.equal = (e.target as HTMLInputElement).checked;
		});
		c.querySelector<HTMLInputElement>('#trace-c-concentric')?.addEventListener('change', e => {
			this.settings.constraints.concentric = (e.target as HTMLInputElement).checked;
		});

		this.bindLinkedSlider('#trace-angle-tol-range', '#trace-angle-tol', 0.5, 15, val => {
			this.settings.angleTolerance = val;
		});

		c.querySelector<HTMLInputElement>('#trace-construction')?.addEventListener('change', e => {
			this.settings.construction = (e.target as HTMLInputElement).checked;
			this.notifyPreview();
		});

		c.querySelector<HTMLSelectElement>('#trace-after-convert')?.addEventListener('change', e => {
			this.settings.afterConvert = (e.target as HTMLSelectElement).value as ImageAfterConvert;
		});

		// Dragging by header so the user can move the dialog freely around the canvas
		const handle = c.querySelector<HTMLElement>('[data-trace-drag-handle]');
		handle?.addEventListener('mousedown', e => {
			if ((e.target as HTMLElement).closest('button')) return;
			if (!this.dialogEl) return;
			const rect = this.dialogEl.getBoundingClientRect();
			this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			this.dialogEl.style.left = `${rect.left}px`;
			this.dialogEl.style.top = `${rect.top}px`;
			this.dialogEl.style.right = 'auto';
			e.preventDefault();
		});

		window.addEventListener('mousemove', e => {
			if (!this.dragOffset || !this.dialogEl) return;
			const left = Math.max(8, Math.min(window.innerWidth - 120, e.clientX - this.dragOffset.x));
			const top = Math.max(8, Math.min(window.innerHeight - 80, e.clientY - this.dragOffset.y));
			this.dialogEl.style.left = `${left}px`;
			this.dialogEl.style.top = `${top}px`;
		});

		window.addEventListener('mouseup', () => {
			this.dragOffset = null;
		});

		window.addEventListener('keydown', e => {
			if (!this.isOpen) return;
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		});
	}

	private bindLinkedSlider(
		rangeSelector: string,
		numSelector: string,
		min: number,
		max: number,
		onChange: (val: number) => void
	): void {
		const rangeEl = this.container?.querySelector<HTMLInputElement>(rangeSelector);
		const numEl = this.container?.querySelector<HTMLInputElement>(numSelector);
		if (!rangeEl || !numEl) return;

		rangeEl.addEventListener('input', () => {
			const val = Number(rangeEl.value);
			if (!Number.isFinite(val)) return;
			numEl.value = String(val);
			onChange(val);
		});

		numEl.addEventListener('change', () => {
			let val = Number(numEl.value);
			if (!Number.isFinite(val)) return;
			val = Math.max(min, Math.min(max, val));
			numEl.value = String(val);
			rangeEl.value = String(val);
			onChange(val);
		});
	}

	private scheduleTrace(immediate = false): void {
		if (!this.isOpen) return;
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (immediate) {
			void this.runTrace();
		} else {
			this.debounceTimer = setTimeout(() => {
				this.debounceTimer = null;
				void this.runTrace();
			}, DEBOUNCE_MS);
		}
	}

	private async runTrace(): Promise<void> {
		const image = this.currentImage;
		if (!image || !image.objectUrl) {
			this.close();
			return;
		}
		const epoch = ++this.traceEpoch;
		this.isTracing = true;
		this.updateFooterUI();

		try {
			const settingsSnap = cloneTraceSettings(this.settings);
			const input = await decodeImageForTrace(image, settingsSnap.maxResolution);
			if (!this.isOpen || epoch !== this.traceEpoch) return;

			const result = await this.runner.trace(input, settingsSnap);
			if (!this.isOpen || epoch !== this.traceEpoch || !result) return;

			this.latestResult = result;
			this.isTracing = false;
			if (this.settings.autoThreshold) {
				this.setSliderAndNumber('#trace-threshold-range', '#trace-threshold', result.threshold);
			}
			if (this.settings.autoMinSegment) {
				this.setSliderAndNumber(
					'#trace-min-segment-range',
					'#trace-min-segment',
					Math.round(getAutoMinSegment(this.settings, result.width, result.height))
				);
			}
			this.updateFooterUI();
			this.notifyPreview();
		} catch (err) {
			if (!this.isOpen || epoch !== this.traceEpoch) return;
			this.isTracing = false;
			this.updateFooterUI(err instanceof Error ? err.message : 'Failed to trace image');
		}
	}

	private notifyPreview(): void {
		if (!this.isOpen || !this.currentImageId) return;
		this.callbacks.onPreviewChange({
			imageId: this.currentImageId,
			result: this.latestResult,
			settings: cloneTraceSettings(this.settings),
		});
	}

	private updateFooterUI(errorMsg?: string): void {
		if (!this.container) return;
		const summaryEl = this.container.querySelector<HTMLElement>('#trace-stats-summary');
		const warningEl = this.container.querySelector<HTMLElement>('#trace-warning-banner');
		const applyBtn = this.container.querySelector<HTMLButtonElement>('#btn-trace-apply');

		if (errorMsg) {
			if (summaryEl) summaryEl.textContent = errorMsg;
			warningEl?.classList.add('hidden');
			if (applyBtn) applyBtn.disabled = true;
			return;
		}

		const res = this.latestResult;
		if (!res) {
			if (summaryEl) summaryEl.textContent = 'Tracing…';
			warningEl?.classList.add('hidden');
			if (applyBtn) applyBtn.disabled = true;
			return;
		}

		const total = getTracePrimitiveCount(res.stats);
		const parts: string[] = [];
		if (res.stats.lines) parts.push(`${res.stats.lines} line${res.stats.lines === 1 ? '' : 's'}`);
		if (res.stats.arcs) parts.push(`${res.stats.arcs} arc${res.stats.arcs === 1 ? '' : 's'}`);
		if (res.stats.circles) parts.push(`${res.stats.circles} circle${res.stats.circles === 1 ? '' : 's'}`);
		if (res.stats.splines) parts.push(`${res.stats.splines} spline${res.stats.splines === 1 ? '' : 's'}`);

		const text = parts.length ? `${parts.join(' · ')} (${total} total)` : 'No primitives detected';
		if (summaryEl) {
			summaryEl.textContent = this.isTracing ? `${text} · updating…` : text;
		}
		if (applyBtn) {
			applyBtn.disabled = total === 0;
		}

		if (warningEl) {
			if (total > TRACE_PRIMITIVE_WARNING) {
				warningEl.textContent = `High primitive count (${total}) may slow down the geometric solver. Consider increasing Tolerance, Min Segment, or Despeckle.`;
				warningEl.classList.remove('hidden');
			} else {
				warningEl.classList.add('hidden');
			}
		}
	}

	private applyConversion(): void {
		const image = this.currentImage;
		const result = this.latestResult;
		if (!image || !result) return;
		const total = getTracePrimitiveCount(result.stats);
		if (total === 0) {
			showToast('No primitives detected with the current settings.');
			return;
		}

		const imageId = image.id;
		const settings = cloneTraceSettings(this.settings);
		const built = buildTraceGeometry(this.sketch, result, image, settings);
		this.close();
		this.sketch.selectEntities(built.entities, false);
		this.callbacks.onConverted(imageId);

		const constraintNote = built.constraints.added
			? ` with ${built.constraints.added} constraint${built.constraints.added === 1 ? '' : 's'}`
			: '';
		showToast(`Created ${built.entities.length} primitive${built.entities.length === 1 ? '' : 's'}${constraintNote}.`);
	}
}
