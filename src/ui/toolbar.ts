import { ICONS } from './icons';
import type { SketchDocument } from '../model/sketch';
import type { CanvasInteraction, ToolType, ConstraintToolType } from '../canvas/interaction';
import type { PolygonMode } from '../canvas/tools/primitives/polygon';
import type { ArcMode } from '../canvas/tools/primitives/arc';
import type { CircleMode } from '../canvas/tools/primitives/circle';
import type { RectangleMode } from '../canvas/tools/primitives/rectangle';
import type { SlotMode } from '../canvas/tools/primitives/slot';
import type { SplineMode } from '../canvas/tools/primitives/spline';
import type { EllipseMode } from '../canvas/tools/primitives/ellipse';
import type { ChamferMode } from '../math/chamfer';
import type { OffsetDirection } from '../math/offset';
import type { ToolModeChangeDetail } from '../canvas/tools/modeChangeEvent';
import { showToast } from './toast';
export { showToast };

export class Toolbar {
	private container: HTMLElement;
	private interaction: CanvasInteraction;
	private tooltipEl: HTMLElement | null = null;

	constructor(container: HTMLElement, _sketch: SketchDocument, interaction: CanvasInteraction) {
		this.container = container;
		this.interaction = interaction;

		this.render();
		this.setupListeners();
		this.setupTooltip();
		this.setCircleMode('center_diameter');
		this.setConstructionActive(this.interaction.getEffectiveConstructionState());
	}

	render(): void {
		this.container.innerHTML = `

		<div class="toolbar-section">
			<div class="toolbar-title">Create</div>
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
				<button class="tool-btn" data-tool="polygon" title="Circumscribed Polygon (G)">
					${ICONS.polygon}
					<span class="btn-tooltip">Circumscribed Polygon (G)</span>
				</button>
				<button class="tool-btn" data-tool="arc" title="Centerpoint Arc (A)">
					${ICONS.arc_center}
					<span class="btn-tooltip">Center Arc (A)</span>
				</button>
				<button class="tool-btn" data-tool="slot" title="Center to Center Slot (S)">
					${ICONS.slot_center_to_center}
					<span class="btn-tooltip">Center to Center Slot (S)</span>
				</button>
				<button class="tool-btn" data-tool="spline" title="Fit Point Spline">
					${ICONS.spline_fit}
					<span class="btn-tooltip">Fit Spline</span>
				</button>
				<button class="tool-btn" data-tool="ellipse" title="Ellipse (E)">
					${ICONS.ellipse}
					<span class="btn-tooltip">Ellipse (E)</span>
				</button>
				<button class="tool-btn" data-tool="text" title="Text">
					${ICONS.text}
					<span class="btn-tooltip">Text</span>
				</button>
				<button class="tool-btn" data-tool="circular_pattern" id="tool-circular-pattern" title="Circular Pattern">
					${ICONS.circular_pattern}
					<span class="btn-tooltip">Circular Pattern</span>
				</button>
				<button class="tool-btn" data-tool="rectangular_pattern" id="tool-rectangular-pattern" title="Rectangular Pattern">
					${ICONS.rectangular_pattern}
					<span class="btn-tooltip">Rectangular Pattern</span>
				</button>
				<button class="tool-btn" data-tool="transform" id="tool-transform" title="Transform / Copy">
					${ICONS.transform}
					<span class="btn-tooltip">Transform / Copy</span>
				</button>
				<button class="tool-btn" data-tool="mirror" id="tool-mirror" title="Mirror Objects (M)">
					${ICONS.mirror}
					<span class="btn-tooltip">Mirror (M)</span>
				</button>
			</div>
		</div>

		<div class="toolbar-divider"></div>

		<div class="toolbar-section">
			<div class="toolbar-title">Tools</div>
			<div class="toolbar-grid">
				<button class="tool-btn active" data-tool="select" title="Select & Drag (V)">
					${ICONS.select}
					<span class="btn-tooltip">Select (V)</span>
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
				<button class="tool-btn" data-tool="extend" title="Extend">
					${ICONS.extend}
					<span class="btn-tooltip">Extend</span>
				</button>
				<button class="tool-btn" data-tool="offset" id="tool-offset" title="Offset (O)">
					${ICONS.offsetOneSide}
					<span class="btn-tooltip">Offset (O)</span>
				</button>
				<button class="tool-btn" data-tool="chamfer" id="tool-chamfer" title="Chamfer">
					${ICONS.chamferEqual}
					<span class="btn-tooltip">Chamfer</span>
				</button>
				<button class="tool-btn" data-tool="fillet" id="tool-fillet" title="Fillet">
					${ICONS.fillet}
					<span class="btn-tooltip">Fillet</span>
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
		</div>`;

		this.bindClicks();
	}

	private setupListeners(): void {
		document.addEventListener('tool-mode-change', event => {
			const { tool, mode } = (event as CustomEvent<ToolModeChangeDetail>).detail;
			switch (tool) {
				case 'arc':
					this.setArcMode(mode as ArcMode);
					break;
				case 'polygon':
					this.setPolygonMode(mode as PolygonMode);
					break;
				case 'circle':
					this.setCircleMode(mode as CircleMode);
					break;
				case 'rectangle':
					this.setRectangleMode(mode as RectangleMode);
					break;
				case 'slot':
					this.setSlotMode(mode as SlotMode);
					break;
				case 'spline':
					this.setSplineMode(mode as SplineMode);
					break;
				case 'ellipse':
					this.setEllipseMode(mode as EllipseMode);
					break;
				case 'chamfer':
					this.setChamferMode(mode as ChamferMode);
					break;
				case 'offset':
					this.setOffsetDirection(mode as OffsetDirection);
					break;
			}
		});
		this.interaction.onToolChange = tool => {
			this.setActiveButton(tool);
		};
		this.interaction.onConstructionChange = isConst => {
			this.setConstructionActive(isConst);
		};
	}

	private bindClicks(): void {
		// Tool buttons (select, point, line, circle, rectangle, etc.)
		this.container.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => {
			btn.addEventListener('click', () => {
				const tool = btn.getAttribute('data-tool') as ToolType;
				this.interaction.setTool(tool);
			});
		});

		// Construction toggle (if present in container)
		const constrBtn = this.container.querySelector('#btn-construction');
		constrBtn?.addEventListener('click', () => {
			this.interaction.toggleConstructionMode();
		});

		// Snap toggle (if present in container)
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

	private setupTooltip(): void {
		if (typeof document === 'undefined') return;

		this.tooltipEl = document.createElement('div');
		this.tooltipEl.className = 'cad-floating-tooltip';
		document.body.appendChild(this.tooltipEl);

		const hideTooltip = () => {
			if (!this.tooltipEl) return;
			this.tooltipEl.classList.remove('visible');
		};

		this.container.addEventListener('mouseover', (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.tool-btn');
			if (!target || !this.tooltipEl) return;

			const span = target.querySelector('.btn-tooltip');
			const text = span?.textContent?.trim() || target.getAttribute('title') || '';
			if (!text) return;

			this.tooltipEl.textContent = text;
			const rect = target.getBoundingClientRect();
			this.tooltipEl.style.top = `${rect.top + rect.height / 2}px`;
			this.tooltipEl.style.left = `${rect.right + 8}px`;
			this.tooltipEl.classList.add('visible');
		});

		this.container.addEventListener('mouseout', (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.tool-btn');
			const related = (e.relatedTarget as HTMLElement | null)?.closest<HTMLButtonElement>('.tool-btn');
			if (target && target === related) return;
			hideTooltip();
		});

		this.container.addEventListener('scroll', hideTooltip, { passive: true });
		this.container.addEventListener('click', hideTooltip);
	}

	destroy(): void {
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
			this.tooltipEl = null;
		}
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

	setPolygonMode(mode: PolygonMode): void {
		const button = this.container.querySelector<HTMLButtonElement>('[data-tool="polygon"]');
		if (!button) return;

		const modes: Record<PolygonMode, { icon: string; title: string }> = {
			circumscribed: { icon: ICONS.polygon, title: 'Circumscribed Polygon (G)' },
			inscribed: { icon: ICONS.polygon_inscribed, title: 'Inscribed Polygon (G)' },
			edge: { icon: ICONS.polygon_edge, title: 'Edge Polygon (G)' },
		};
		const { icon, title } = modes[mode];
		button.title = title;
		button.innerHTML = `
			${icon}
			<span class="btn-tooltip">${title}</span>
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

	setCircleMode(mode: CircleMode): void {
		const circleBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="circle"]');
		if (!circleBtn) return;

		const circleModes: Record<CircleMode, { icon: string; title: string }> = {
			center_diameter: { icon: ICONS.circle_center, title: 'Center Diameter Circle (C)' },
			two_point: { icon: ICONS.circle_2point, title: '2-Point Circle (C)' },
			three_point: { icon: ICONS.circle_3point, title: '3-Point Circle (C)' },
			two_tangent: { icon: ICONS.circle_2tangent, title: '2-Tangent Circle (C)' },
			three_tangent: { icon: ICONS.circle_3tangent, title: '3-Tangent Circle (C)' },
		};
		const { icon, title } = circleModes[mode];

		circleBtn.title = title;
		circleBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${title}</span>
		`;
	}

	setSlotMode(mode: SlotMode): void {
		const slotBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="slot"]');
		if (!slotBtn) return;

		let icon = ICONS.slot_center_to_center;
		let title = 'Center to Center Slot (S)';

		if (mode === 'center_point') {
			icon = ICONS.slot_center_point;
			title = 'Center Point Slot (S)';
		} else if (mode === 'overall') {
			icon = ICONS.slot_overall;
			title = 'Overall Slot (S)';
		} else if (mode === 'three_point_arc') {
			icon = ICONS.slot_arc_3point;
			title = '3-Point Arc Slot (S)';
		} else if (mode === 'center_point_arc') {
			icon = ICONS.slot_arc_center;
			title = 'Center Point Arc Slot (S)';
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

	setEllipseMode(mode: EllipseMode): void {
		const ellipseBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="ellipse"]');
		if (!ellipseBtn) return;

		const icon = mode === 'elliptical_arc' ? ICONS.elliptical_arc : ICONS.ellipse;
		const title = mode === 'elliptical_arc' ? 'Elliptical Arc (E)' : 'Ellipse (E)';
		const tooltip = mode === 'elliptical_arc' ? 'Elliptical Arc (E)' : 'Ellipse (E)';

		ellipseBtn.title = title;
		ellipseBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${tooltip}</span>
		`;
	}

	setChamferMode(mode: ChamferMode): void {
		const chamferBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="chamfer"]');
		if (!chamferBtn) return;

		let icon = ICONS.chamferEqual;
		let title = 'Equal Distance Chamfer';
		let tooltip = 'Equal Chamfer';

		if (mode === 'two_distance') {
			icon = ICONS.chamferTwoDistance;
			title = 'Two Distance Chamfer';
			tooltip = 'Two Dist Chamfer';
		} else if (mode === 'distance_angle') {
			icon = ICONS.chamferDistanceAngle;
			title = 'Distance and Angle Chamfer';
			tooltip = 'Dist & Angle Chamfer';
		}

		chamferBtn.title = title;
		chamferBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${tooltip}</span>
		`;
	}

	setOffsetDirection(direction: OffsetDirection): void {
		const offsetBtn = this.container.querySelector<HTMLButtonElement>('[data-tool="offset"]');
		if (!offsetBtn) return;

		let icon = ICONS.offsetOneSide;
		let title = 'One Side Offset';
		let tooltip = 'One Side';

		if (direction === 'two_sides') {
			icon = ICONS.offsetTwoSides;
			title = 'Two Sides Offset';
			tooltip = 'Two Sides';
		} else if (direction === 'symmetric') {
			icon = ICONS.offsetSymmetric;
			title = 'Symmetric Offset';
			tooltip = 'Symmetric';
		}

		offsetBtn.title = title;
		offsetBtn.innerHTML = `
			${icon}
			<span class="btn-tooltip">${tooltip}</span>
		`;
	}
}
