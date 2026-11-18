import type { RegionKernelCurve } from './regionTypes';
import type { Point2 } from './types';

export type TextCommand =
	| { type: 'M' | 'L'; x: number; y: number }
	| { type: 'Q'; x1: number; y1: number; x: number; y: number }
	| { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	| { type: 'Z' };

export interface TextGlyph {
	line: number;
	advance: number;
	/** Outlines are extracted by the font library at the requested world-space text height. */
	commands: readonly TextCommand[];
}
export interface TextGeometryInput {
	mode: 'text' | 'text_on_path';
	height: number;
	unitsPerEm: number;
	ascender: number;
	descender: number;
	capHeight: number;
	characterSpacing: number;
	alignment: 'left' | 'center' | 'right';
	verticalAlignment: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	svg: boolean;
	lineCount: number;
	glyphs: readonly TextGlyph[];
	rectangle?: readonly [Point2, Point2, Point2, Point2];
	curve?: RegionKernelCurve;
}
export type TextGeometryKernel = (input: TextGeometryInput) => TextCommand[];
