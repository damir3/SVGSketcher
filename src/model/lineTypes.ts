export const DRAWING_LINE_TYPES = ['centerline', 'hidden', 'phantom', 'cutting_plane'] as const;

export type DrawingLineType = (typeof DRAWING_LINE_TYPES)[number];
export type AuxiliaryLineType = 'construction' | DrawingLineType;
export type EditableLineType = 'solid' | AuxiliaryLineType;
export type LineType = EditableLineType | 'spline_handle';
export type RoundCurveLineType = Exclude<EditableLineType, 'cutting_plane'>;

export function isDrawingLineType(type: LineType): type is DrawingLineType {
	return (DRAWING_LINE_TYPES as readonly LineType[]).includes(type);
}

export function isRoundCurveLineType(type: LineType): type is RoundCurveLineType {
	return type !== 'cutting_plane' && (type === 'solid' || type === 'construction' || isDrawingLineType(type));
}

export function getRoundCurveLineType(type: EditableLineType): RoundCurveLineType {
	return isRoundCurveLineType(type) ? type : 'solid';
}
