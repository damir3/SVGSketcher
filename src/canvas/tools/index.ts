export * from './types';
export * from './base';
export * from './primitives';
export * from './modify';
export * from './constraints';
export * from './selection';

import { CONSTRAINT_TOOLS, type ITool, type ToolType } from './types';
import {
	PointTool,
	LineTool,
	CircleTool,
	RectangleTool,
	SlotTool,
	ArcTool,
	PolygonTool,
	EllipseTool,
	SplineTool,
	TextTool,
} from './primitives';
import {
	TrimTool,
	ExtendTool,
	BreakTool,
	DeleteTool,
	FilletTool,
	ChamferTool,
	OffsetTool,
	TransformTool,
	ImageTool,
	MirrorTool,
	CircularPatternTool,
	RectangularPatternTool,
} from './modify';
import { DimensionTool, ConstraintTool } from './constraints';
import { SelectTool, PanTool } from './selection';

export function createToolMap(onReplaceImage?: (id: string) => void): Map<ToolType, ITool> {
	const tools = new Map<ToolType, ITool>([
		// Primitives
		['point', new PointTool()],
		['line', new LineTool()],
		['circle', new CircleTool()],
		['rectangle', new RectangleTool()],
		['slot', new SlotTool('center_to_center')],
		['arc', new ArcTool('center')],
		['polygon', new PolygonTool()],
		['ellipse', new EllipseTool('ellipse')],
		['spline', new SplineTool('fit')],
		['text', new TextTool()],

		// Modify
		['trim', new TrimTool()],
		['extend', new ExtendTool()],
		['break', new BreakTool()],
		['delete', new DeleteTool()],
		['fillet', new FilletTool()],
		['chamfer', new ChamferTool()],
		['offset', new OffsetTool()],
		['transform', new TransformTool()],
		['image', new ImageTool(id => onReplaceImage?.(id))],
		['mirror', new MirrorTool()],
		['circular_pattern', new CircularPatternTool()],
		['rectangular_pattern', new RectangularPatternTool()],

		// Constraints
		['dimension', new DimensionTool()],

		// Selection & Pan
		['select', new SelectTool()],
		['pan', new PanTool()],
	]);

	for (const cTool of CONSTRAINT_TOOLS) {
		if (cTool !== 'dimension') {
			tools.set(cTool, new ConstraintTool(cTool));
		}
	}

	return tools;
}
