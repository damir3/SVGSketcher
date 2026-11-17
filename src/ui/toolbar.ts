import { ICONS } from './icons';
import type { SketchDocument } from '../model/sketch';
import type { CanvasInteraction, ToolType, ConstraintToolType } from '../canvas/interaction';
import type { ToolModeChangeDetail } from '../canvas/tools/modeChangeEvent';
import { showToast } from './toast';
export { showToast };

interface ToolbarButtonDef {
	key: string;
	icon: string;
	title: string;
	tooltip?: string;
	id?: string;
	active?: boolean;
}

interface ToolModeButtonMeta {
	icon: string;
	title: string;
	tooltip?: string;
}

const TOOLBAR_SECTIONS: ReadonlyArray<{
	title: string;
	attr: 'data-tool' | 'data-constraint';
	items: ToolbarButtonDef[];
}> = [
	{
		title: 'Create',
		attr: 'data-tool',
		items: [
			{ key: 'point', icon: ICONS.point, title: 'Point (P)' },
			{ key: 'line', icon: ICONS.line, title: 'Line (L)' },
			{ key: 'rectangle', icon: ICONS.rectangle, title: '2-Point Rectangle (R)' },
			{ key: 'circle', icon: ICONS.circle, title: 'Circle (C)' },
			{ key: 'polygon', icon: ICONS.polygon, title: 'Circumscribed Polygon (G)' },
			{ key: 'arc', icon: ICONS.arc_center, title: 'Centerpoint Arc (A)', tooltip: 'Center Arc (A)' },
			{ key: 'slot', icon: ICONS.slot_center_to_center, title: 'Center to Center Slot (S)' },
			{ key: 'spline', icon: ICONS.spline_fit, title: 'Fit Point Spline', tooltip: 'Fit Spline' },
			{ key: 'ellipse', icon: ICONS.ellipse, title: 'Ellipse (E)' },
			{ key: 'text', icon: ICONS.text, title: 'Text' },
			{ key: 'circular_pattern', id: 'tool-circular-pattern', icon: ICONS.circular_pattern, title: 'Circular Pattern' },
			{
				key: 'rectangular_pattern',
				id: 'tool-rectangular-pattern',
				icon: ICONS.rectangular_pattern,
				title: 'Rectangular Pattern',
			},
			{ key: 'transform', id: 'tool-transform', icon: ICONS.transform, title: 'Transform / Copy' },
			{ key: 'mirror', id: 'tool-mirror', icon: ICONS.mirror, title: 'Mirror Objects (M)', tooltip: 'Mirror (M)' },
		],
	},
	{
		title: 'Tools',
		attr: 'data-tool',
		items: [
			{ key: 'select', active: true, icon: ICONS.select, title: 'Select & Drag (V)', tooltip: 'Select (V)' },
			{ key: 'delete', icon: ICONS.delete, title: 'Delete' },
			{ key: 'break', icon: ICONS.break, title: 'Break (B)' },
			{ key: 'trim', icon: ICONS.trim, title: 'Trim (T)' },
			{ key: 'extend', icon: ICONS.extend, title: 'Extend' },
			{ key: 'offset', id: 'tool-offset', icon: ICONS.offsetOneSide, title: 'Offset (O)' },
			{ key: 'chamfer', id: 'tool-chamfer', icon: ICONS.chamferEqual, title: 'Chamfer' },
			{ key: 'fillet', id: 'tool-fillet', icon: ICONS.fillet, title: 'Fillet' },
		],
	},
	{
		title: 'Constraints',
		attr: 'data-constraint',
		items: [
			{
				key: 'coincident',
				icon: ICONS.coincident,
				title: 'Coincident / Point on Object (I)',
				tooltip: 'Coincident (I)',
			},
			{ key: 'fixed', icon: ICONS.fixed, title: 'Fix Point (F)' },
			{
				key: 'horizontal_vertical',
				icon: ICONS.horizontalVertical,
				title: 'Horizontal / Vertical (H)',
				tooltip: 'Horiz / Vert (H)',
			},
			{ key: 'dimension', icon: ICONS.dimension, title: 'Dimension (D)' },
			{ key: 'equal', icon: ICONS.equal, title: 'Equal Length or Radius', tooltip: 'Equal' },
			{ key: 'parallel', icon: ICONS.parallel, title: 'Parallel (2 lines)', tooltip: 'Parallel' },
			{ key: 'collinear', icon: ICONS.collinear, title: 'Collinear (2 lines)', tooltip: 'Collinear' },
			{ key: 'perpendicular', icon: ICONS.perpendicular, title: 'Perpendicular (2 lines)', tooltip: 'Perpendicular' },
			{
				key: 'tangent',
				icon: ICONS.tangent,
				title: 'Tangent (1 line + 1 circle, or 2 circles)',
				tooltip: 'Tangent',
			},
			{ key: 'concentric', icon: ICONS.concentric, title: 'Concentric (2 circles)', tooltip: 'Concentric' },
			{ key: 'midpoint', icon: ICONS.midpoint, title: 'Midpoint (1 point + 1 line)', tooltip: 'Midpoint' },
			{
				key: 'symmetry',
				id: 'constraint-symmetry',
				icon: ICONS.symmetry,
				title: 'Symmetry (2 points/circles + 1 line)',
				tooltip: 'Symmetry',
			},
		],
	},
];

const TOOL_MODE_BUTTONS: Readonly<Record<string, Readonly<Record<string, ToolModeButtonMeta>>>> = {
	arc: {
		center: { icon: ICONS.arc_center, title: 'Centerpoint Arc (A)', tooltip: 'Center Arc (A)' },
		three_point: { icon: ICONS.arc, title: '3-Point Arc (A)' },
		tangent: { icon: ICONS.arc_tangent, title: 'Tangent Arc (A)' },
	},
	polygon: {
		circumscribed: { icon: ICONS.polygon, title: 'Circumscribed Polygon (G)' },
		inscribed: { icon: ICONS.polygon_inscribed, title: 'Inscribed Polygon (G)' },
		edge: { icon: ICONS.polygon_edge, title: 'Edge Polygon (G)' },
	},
	rectangle: {
		two_point: { icon: ICONS.rectangle, title: '2-Point Rectangle (R)' },
		center: { icon: ICONS.rectangle_center, title: 'Center Rectangle (R)' },
		three_point: { icon: ICONS.rectangle_3point, title: '3-Point Rectangle (R)' },
		rounded: { icon: ICONS.rectangle_rounded, title: 'Rounded Rectangle (R)' },
	},
	circle: {
		center_diameter: { icon: ICONS.circle_center, title: 'Center Diameter Circle (C)' },
		two_point: { icon: ICONS.circle_2point, title: '2-Point Circle (C)' },
		three_point: { icon: ICONS.circle_3point, title: '3-Point Circle (C)' },
		two_tangent: { icon: ICONS.circle_2tangent, title: '2-Tangent Circle (C)' },
		three_tangent: { icon: ICONS.circle_3tangent, title: '3-Tangent Circle (C)' },
	},
	slot: {
		center_to_center: { icon: ICONS.slot_center_to_center, title: 'Center to Center Slot (S)' },
		center_point: { icon: ICONS.slot_center_point, title: 'Center Point Slot (S)' },
		overall: { icon: ICONS.slot_overall, title: 'Overall Slot (S)' },
		three_point_arc: { icon: ICONS.slot_arc_3point, title: '3-Point Arc Slot (S)' },
		center_point_arc: { icon: ICONS.slot_arc_center, title: 'Center Point Arc Slot (S)' },
	},
	spline: {
		fit: { icon: ICONS.spline_fit, title: 'Fit Point Spline', tooltip: 'Fit Spline' },
		control: { icon: ICONS.spline_control, title: 'Control Point Spline', tooltip: 'Control Spline' },
	},
	ellipse: {
		ellipse: { icon: ICONS.ellipse, title: 'Ellipse (E)' },
		elliptical_arc: { icon: ICONS.elliptical_arc, title: 'Elliptical Arc (E)' },
	},
	chamfer: {
		equal_distance: { icon: ICONS.chamferEqual, title: 'Equal Distance Chamfer', tooltip: 'Equal Chamfer' },
		two_distance: { icon: ICONS.chamferTwoDistance, title: 'Two Distance Chamfer', tooltip: 'Two Dist Chamfer' },
		distance_angle: {
			icon: ICONS.chamferDistanceAngle,
			title: 'Distance and Angle Chamfer',
			tooltip: 'Dist & Angle Chamfer',
		},
	},
	offset: {
		one_side: { icon: ICONS.offsetOneSide, title: 'One Side Offset', tooltip: 'One Side' },
		two_sides: { icon: ICONS.offsetTwoSides, title: 'Two Sides Offset', tooltip: 'Two Sides' },
		symmetric: { icon: ICONS.offsetSymmetric, title: 'Symmetric Offset', tooltip: 'Symmetric' },
	},
};

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
		this.setToolMode('circle', 'center_diameter');
		this.setConstructionActive(this.interaction.getEffectiveConstructionState());
	}

	render(): void {
		this.container.innerHTML = TOOLBAR_SECTIONS.map(
			section => `
		<div class="toolbar-section">
			<div class="toolbar-title">${section.title}</div>
			<div class="toolbar-grid">
				${section.items
					.map(
						item => `
				<button class="tool-btn${item.active ? ' active' : ''}" ${section.attr}="${item.key}"${item.id ? ` id="${item.id}"` : ''} title="${item.title}">
					${item.icon}
					<span class="btn-tooltip">${item.tooltip ?? item.title}</span>
				</button>`
					)
					.join('')}
			</div>
		</div>`
		).join('\n\n\t\t<div class="toolbar-divider"></div>\n');

		this.bindClicks();
	}

	private setupListeners(): void {
		document.addEventListener('tool-mode-change', event => {
			const { tool, mode } = (event as CustomEvent<ToolModeChangeDetail>).detail;
			this.setToolMode(tool, mode);
		});
		this.interaction.onToolChange = tool => {
			this.setActiveButton(tool);
		};
		this.interaction.onConstructionChange = isConst => {
			this.setConstructionActive(isConst);
		};
	}

	private bindClicks(): void {
		this.container.querySelectorAll<HTMLButtonElement>('[data-tool], [data-constraint]').forEach(btn => {
			btn.addEventListener('click', () => {
				const tool = (btn.getAttribute('data-tool') ?? btn.getAttribute('data-constraint')) as
					| ToolType
					| ConstraintToolType;
				this.interaction.setTool(tool);
			});
		});

		this.container.querySelector('#btn-construction')?.addEventListener('click', () => {
			this.interaction.toggleConstructionMode();
		});

		this.container.querySelector('#btn-snap')?.addEventListener('click', () => {
			this.interaction.toggleSnapping();
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
		this.container.querySelectorAll('[data-tool], [data-constraint]').forEach(b => {
			const key = b.getAttribute('data-tool') ?? b.getAttribute('data-constraint');
			b.classList.toggle('active', key === tool);
		});
	}

	setConstructionActive(active: boolean): void {
		this.container.querySelector('#btn-construction')?.classList.toggle('active', active);
	}

	setSnappingActive(active: boolean): void {
		this.container.querySelector('#btn-snap')?.classList.toggle('active', active);
	}

	setActiveToolButton(tool: ToolType): void {
		this.setActiveButton(tool);
	}

	setToolMode(tool: string, mode: string): void {
		const meta = TOOL_MODE_BUTTONS[tool]?.[mode];
		const btn = meta && this.container.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
		if (!btn) return;
		btn.title = meta.title;
		btn.innerHTML = `${meta.icon}<span class="btn-tooltip">${meta.tooltip ?? meta.title}</span>`;
	}
}
