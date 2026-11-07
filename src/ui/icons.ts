import select from '../assets/icons/select.svg?raw';
import pan from '../assets/icons/pan.svg?raw';
import point from '../assets/icons/point.svg?raw';
import line from '../assets/icons/line.svg?raw';
import circle from '../assets/icons/circle.svg?raw';
import circleCenter from '../assets/icons/circle-center.svg?raw';
import circle2Point from '../assets/icons/circle-2point.svg?raw';
import circle3Point from '../assets/icons/circle-3point.svg?raw';
import circle2Tangent from '../assets/icons/circle-2tangent.svg?raw';
import circle3Tangent from '../assets/icons/circle-3tangent.svg?raw';
import arc from '../assets/icons/arc.svg?raw';
import arcCenter from '../assets/icons/arc-center.svg?raw';
import arcTangent from '../assets/icons/arc-tangent.svg?raw';
import rectangle from '../assets/icons/rectangle.svg?raw';
import rectangleCenter from '../assets/icons/rectangle-center.svg?raw';
import rectangle3Point from '../assets/icons/rectangle-3point.svg?raw';
import rectangleRounded from '../assets/icons/rectangle-rounded.svg?raw';
import slotCenterToCenter from '../assets/icons/slot-center-to-center.svg?raw';
import slotCenterPoint from '../assets/icons/slot-center-point.svg?raw';
import slotOverall from '../assets/icons/slot-overall.svg?raw';
import slotArc3Point from '../assets/icons/slot-arc-3point.svg?raw';
import slotArcCenter from '../assets/icons/slot-arc-center.svg?raw';
import polygon from '../assets/icons/polygon.svg?raw';
import regions from '../assets/icons/regions.svg?raw';
import constraintBadges from '../assets/icons/constraint-badges.svg?raw';
import dimensionsToggle from '../assets/icons/dimensions-toggle.svg?raw';
import ellipse from '../assets/icons/ellipse.svg?raw';
import ellipticalArc from '../assets/icons/elliptical-arc.svg?raw';
import splineFit from '../assets/icons/spline-fit.svg?raw';
import splineControl from '../assets/icons/spline-control.svg?raw';
import construction from '../assets/icons/construction.svg?raw';
import snap from '../assets/icons/snap.svg?raw';
import trim from '../assets/icons/trim.svg?raw';
import fillet from '../assets/icons/fillet.svg?raw';
import chamferEqual from '../assets/icons/chamfer-equal.svg?raw';
import chamferTwoDistance from '../assets/icons/chamfer-two-distance.svg?raw';
import chamferDistanceAngle from '../assets/icons/chamfer-distance-angle.svg?raw';
import offsetOneSide from '../assets/icons/offset-one-side.svg?raw';
import offsetTwoSides from '../assets/icons/offset-two-sides.svg?raw';
import offsetSymmetric from '../assets/icons/offset-symmetric.svg?raw';
import extend from '../assets/icons/extend.svg?raw';
import breakIcon from '../assets/icons/break.svg?raw';
import mirror from '../assets/icons/mirror.svg?raw';
import circularPattern from '../assets/icons/circular-pattern.svg?raw';
import rectangularPattern from '../assets/icons/rectangular-pattern.svg?raw';
import textIcon from '../assets/icons/text.svg?raw';
import textRectIcon from '../assets/icons/text-rect.svg?raw';
import textOnPathIcon from '../assets/icons/text-on-path.svg?raw';

import bold from '../assets/icons/bold.svg?raw';
import italic from '../assets/icons/italic.svg?raw';
import alignLeft from '../assets/icons/align-left.svg?raw';
import alignCenter from '../assets/icons/align-center.svg?raw';
import alignRight from '../assets/icons/align-right.svg?raw';
import alignTop from '../assets/icons/align-top.svg?raw';
import alignMiddle from '../assets/icons/align-middle.svg?raw';
import alignBottom from '../assets/icons/align-bottom.svg?raw';
import placementAbove from '../assets/icons/placement-above.svg?raw';
import placementBelow from '../assets/icons/placement-below.svg?raw';
import flipHorizontal from '../assets/icons/flip-horizontal.svg?raw';
import flipVertical from '../assets/icons/flip-vertical.svg?raw';

import coincident from '../assets/icons/coincident.svg?raw';
import fixed from '../assets/icons/fixed.svg?raw';
import unfixed from '../assets/icons/unfixed.svg?raw';
import horizontal from '../assets/icons/horizontal.svg?raw';
import vertical from '../assets/icons/vertical.svg?raw';
import horizontalVertical from '../assets/icons/horizontal-vertical.svg?raw';
import distance from '../assets/icons/distance.svg?raw';
import dimension from '../assets/icons/dimension.svg?raw';
import angle from '../assets/icons/angle.svg?raw';
import equal from '../assets/icons/equal.svg?raw';
import parallel from '../assets/icons/parallel.svg?raw';
import collinear from '../assets/icons/collinear.svg?raw';
import perpendicular from '../assets/icons/perpendicular.svg?raw';
import tangent from '../assets/icons/tangent.svg?raw';
import concentric from '../assets/icons/concentric.svg?raw';
import pointOnLine from '../assets/icons/point-on-line.svg?raw';
import midpoint from '../assets/icons/midpoint.svg?raw';
import symmetry from '../assets/icons/symmetry.svg?raw';

import undo from '../assets/icons/undo.svg?raw';
import redo from '../assets/icons/redo.svg?raw';
import deleteIcon from '../assets/icons/delete.svg?raw';
import clear from '../assets/icons/clear.svg?raw';
import fitView from '../assets/icons/fit-view.svg?raw';
import exportIcon from '../assets/icons/export.svg?raw';
import openIcon from '../assets/icons/open.svg?raw';
import parameters from '../assets/icons/parameters.svg?raw';
import github from '../assets/icons/github.svg?raw';

export const ICONS = {
	github,
	select,
	pan,
	point,
	line,
	circle,
	circle_center: circleCenter,
	circle_2point: circle2Point,
	circle_3point: circle3Point,
	circle_2tangent: circle2Tangent,
	circle_3tangent: circle3Tangent,
	arc,
	arc_center: arcCenter,
	arc_tangent: arcTangent,
	rectangle,
	rectangle_center: rectangleCenter,
	rectangle_3point: rectangle3Point,
	rectangle_rounded: rectangleRounded,
	slot: slotCenterToCenter,
	slot_center_to_center: slotCenterToCenter,
	slot_center_point: slotCenterPoint,
	slot_overall: slotOverall,
	slot_arc_3point: slotArc3Point,
	slot_arc_center: slotArcCenter,
	lock: fixed,
	unlock: unfixed,
	polygon,
	regions,
	constraintBadges,
	dimensionsToggle,
	ellipse,
	elliptical_arc: ellipticalArc,
	spline_fit: splineFit,
	spline_control: splineControl,
	text: textIcon,
	text_rect: textRectIcon,
	text_on_path: textOnPathIcon,
	bold,
	italic,
	alignLeft,
	alignCenter,
	alignRight,
	alignTop,
	alignMiddle,
	alignBottom,
	align_left: alignLeft,
	align_center: alignCenter,
	align_right: alignRight,
	align_top: alignTop,
	align_middle: alignMiddle,
	align_bottom: alignBottom,
	placementAbove,
	placementBelow,
	placement_above: placementAbove,
	placement_below: placementBelow,
	flipHorizontal,
	flipVertical,
	flip_horizontal: flipHorizontal,
	flip_vertical: flipVertical,
	construction,
	snap,
	trim,
	extend,
	fillet,
	chamferEqual,
	chamferTwoDistance,
	chamferDistanceAngle,
	offsetOneSide,
	offsetTwoSides,
	offsetSymmetric,
	break: breakIcon,
	mirror,
	circular_pattern: circularPattern,
	rectangular_pattern: rectangularPattern,

	// Constraints
	coincident,
	fixed,
	horizontal,
	vertical,
	horizontalVertical,
	distance,
	dimension,
	angle,
	equal,
	parallel,
	collinear,
	perpendicular,
	tangent,
	concentric,
	pointOnLine,
	midpoint,
	symmetry,

	// General tools
	undo,
	redo,
	delete: deleteIcon,
	clear,
	fitView,
	export: exportIcon,
	open: openIcon,
	parameters,
};
