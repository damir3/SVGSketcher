export type ModeAwareToolId = 'arc' | 'circle' | 'rectangle' | 'slot' | 'spline' | 'ellipse' | 'chamfer' | 'offset';

export interface ToolModeChangeDetail {
	tool: ModeAwareToolId;
	mode: string;
}

export function dispatchToolModeChange(tool: ModeAwareToolId, mode: string): void {
	if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
	if (typeof CustomEvent === 'undefined') return;

	document.dispatchEvent(
		new CustomEvent<ToolModeChangeDetail>('tool-mode-change', {
			detail: { tool, mode },
		})
	);
}
