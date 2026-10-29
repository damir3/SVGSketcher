import { ICONS } from './icons';
import type { SketchDocument } from '../model/sketch';
import type { CanvasInteraction, ToolType, ConstraintToolType } from '../canvas/interaction';
import type { ArcMode } from '../canvas/tools/primitives/arc';
import type { RectangleMode } from '../canvas/tools/primitives/rectangle';
import type { SlotMode } from '../canvas/tools/primitives/slot';
import type { SplineMode } from '../canvas/tools/primitives/spline';
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
		this.setConstructionActive(this.interaction.getEffectiveConstructionState());
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
					<button class="tool-btn active" id="btn-snap" title="Toggle Snapping (S)">
						${ICONS.snap}
						<span class="btn-tooltip">Snap (S)</span>
					</button>
					<button class="tool-btn" id="btn-construction" title="Toggle Construction Mode (X)">
						${ICONS.construction}
						<span class="btn-tooltip">Construction (X)</span>
					</button>
					<button class="tool-btn" data-tool="delete" title="Delete">
						${ICONS.delete}
						<span class="btn-tooltip">Delete</span>
					</button>
					<button class="tool-btn" data-tool="break" title="Break (B)">
						${ICONS.break}
						<span class="btn-tooltip">Break (B)</span>
					</button>
					<button class="tool-btn" data-tool="trim" title="Trim (T)">
						${ICONS.trim}
						<span class="btn-tooltip">Trim (T)</span>
					</button>
					<button class="tool-btn" data-tool="fillet" id="tool-fillet" title="Fillet">
						${ICONS.fillet}
						<span class="btn-tooltip">Fillet</span>
					</button>
					<button class="tool-btn" data-tool="mirror" id="tool-mirror" title="Mirror Objects (M)">
						${ICONS.mirror}
						<span class="btn-tooltip">Mirror (M)</span>
					</button>
					<button class="tool-btn" data-tool="circular_pattern" id="tool-circular-pattern" title="Circular Pattern">
						${ICONS.circular_pattern}
						<span class="btn-tooltip">Circular Pattern</span>
					</button>
					<button class="tool-btn" data-tool="rectangular_pattern" id="tool-rectangular-pattern" title="Rectangular Pattern">
						${ICONS.rectangular_pattern}
						<span class="btn-tooltip">Rectangular Pattern</span>
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
					<button class="tool-btn" data-tool="rectangle" title="2-Point Rectangle (R)">
						${ICONS.rectangle}
						<span class="btn-tooltip">2-Point Rectangle (R)</span>
					</button>
					<button class="tool-btn" data-tool="circle" title="Circle (C)">
						${ICONS.circle}
						<span class="btn-tooltip">Circle (C)</span>
					</button>
					<button class="tool-btn" data-tool="polygon" title="Polygon (G)">
						${ICONS.polygon}
						<span class="btn-tooltip">Polygon (G)</span>
					</button>
					<button class="tool-btn" data-tool="arc" title="Centerpoint Arc (A)">
						${ICONS.arc_center}
						<span class="btn-tooltip">Center Arc (A)</span>
					</button>
					<button class="tool-btn" data-tool="slot" title="Center-to-Center Slot">
						${ICONS.slot_center_to_center}
						<span class="btn-tooltip">Center-to-Center Slot</span>
					</button>
					<button class="tool-btn" data-tool="spline" title="Fit Point Spline">
						${ICONS.spline_fit}
						<span class="btn-tooltip">Fit Spline</span>
					</button>
					<button class="tool-btn" data-tool="ellipse" title="Ellipse (E)">
						${ICONS.ellipse}
						<span class="btn-tooltip">Ellipse (E)</span>
					</button>
					<button class="tool-btn" data-tool="elliptical_arc" title="Elliptical Arc">
						${ICONS.elliptical_arc}
						<span class="btn-tooltip">Elliptical Arc</span>
					</button>
				</div>
			</div>

			<div class="toolbar-divider"></div>

			<div class="toolbar-section">
				<div class="toolbar-title">Constraints</div>
				<div class="toolbar-grid">
					<button class="tool-btn" data-constraint="coincident" title="Coincident / Point on Object (I)">
						${ICONS.coincident}
						<span class="btn-tooltip">Coincident (I)</span>
					</button>
					<button class="tool-btn" data-constraint="fixed" title="Fix Point (F)">
						${ICONS.fixed}
						<span class="btn-tooltip">Fix Point (F)</span>
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
					<button class="tool-btn" data-constraint="collinear" title="Collinear (2 lines)">
						${ICONS.collinear}
						<span class="btn-tooltip">Collinear</span>
					</button>
					<button class="tool-btn" data-constraint="perpendicular" title="Perpendicular (2 lines)">
						${ICONS.perpendicular}
						<span class="btn-tooltip">Perpendicular</span>
					</button>
					<button class="tool-btn" data-constraint="tangent" title="Tangent (1 line + 1 circle, or 2 circles)">
						${ICONS.tangent}
						<span class="btn-tooltip">Tangent</span>
					</button>
					<button class="tool-btn" data-constraint="concentric" title="Concentric (2 circles)">
						${ICONS.concentric}
						<span class="btn-tooltip">Concentric</span>
					</button>
					<button class="tool-btn" data-constraint="midpoint" title="Midpoint (1 point + 1 line)">
						${ICONS.midpoint}
						<span class="btn-tooltip">Midpoint</span>
					</button>
					<button class="tool-btn" data-constraint="symmetry" id="constraint-symmetry" title="Symmetry (2 points/circles + 1 line)">
						${ICONS.symmetry}
						<span class="btn-tooltip">Symmetry</span>
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

		// Snap toggle
		const snapBtn = this.container.querySelector('#btn-snap');
		snapBtn?.addEventListener('click', () => {
			this.interaction.toggleSnapping();
		});

		// Constraint buttons
		this.container.querySelectorAll<HTMLButtonElement>('[data-constraint]').forEach(btn => {
			btn.addEventListener('click', () => {
				const constraintType = btn.getAttribute('data-constraint') as ConstraintToolType;
				this.interaction.setTool(constraintType);
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

	setSnappingActive(active: boolean): void {
		const snapBtn = this.container.querySelector('#btn-snap');
		snapBtn?.classList.toggle('active', active);
	}

	setActiveToolButton(tool: ToolType): void {
		this.setActiveButton(tool);
	}

	setArcMode(mode: ArcMode): void {
		const arcBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="arc"]');
		if (!arcBtn) return;

		let icon = ICONS.arc_center;
		let title = 'Centerpoint Arc (A)';
		let tooltip = 'Center Arc (A)';

		if (mode === 'three_point') {
			icon = ICONS.arc;
			title = '3-Point Arc (A)';
			tooltip = '3-Point Arc (A)';
		} else if (mode === 'tangent') {
			icon = ICONS.arc_tangent;
			title = 'Tangent Arc (A)';
			tooltip = 'Tangent Arc (A)';
		}

		arcBtn.title = title;
		arcBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${tooltip}</span>
		`;
	}

	setRectangleMode(mode: RectangleMode): void {
		const rectBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="rectangle"]');
		if (!rectBtn) return;

		let icon = ICONS.rectangle;
		let title = '2-Point Rectangle (R)';

		if (mode === 'center') {
			icon = ICONS.rectangle_center;
			title = 'Center Rectangle (R)';
		} else if (mode === 'three_point') {
			icon = ICONS.rectangle_3point;
			title = '3-Point Rectangle (R)';
		} else if (mode === 'rounded') {
			icon = ICONS.rectangle_rounded;
			title = 'Rounded Rectangle (R)';
		}

		rectBtn.title = title;
		rectBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${title}</span>
		`;
	}

	setSlotMode(mode: SlotMode): void {
		const slotBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="slot"]');
		if (!slotBtn) return;

		let icon = ICONS.slot_center_to_center;
		let title = 'Center-to-Center Slot';

		if (mode === 'center_point') {
			icon = ICONS.slot_center_point;
			title = 'Center Point Slot';
		} else if (mode === 'overall') {
			icon = ICONS.slot_overall;
			title = 'Overall Slot';
		} else if (mode === 'three_point_arc') {
			icon = ICONS.slot_arc_3point;
			title = '3-Point Arc Slot';
		} else if (mode === 'center_point_arc') {
			icon = ICONS.slot_arc_center;
			title = 'Center Point Arc Slot';
		}

		slotBtn.title = title;
		slotBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${title}</span>
		`;
	}

	setSplineMode(mode: SplineMode): void {
		const splineBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="spline"]');
		if (!splineBtn) return;

		const icon = mode === 'control' ? ICONS.spline_control : ICONS.spline_fit;
		const title = mode === 'control' ? 'Control Point Spline' : 'Fit Point Spline';
		const tooltip = mode === 'control' ? 'Control Spline' : 'Fit Spline';

		splineBtn.title = title;
		splineBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${tooltip}</span>
		`;
	}
}
