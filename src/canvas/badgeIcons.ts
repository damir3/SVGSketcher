import fixedRaw from '../assets/icons/fixed.svg?raw';
import collinearRaw from '../assets/icons/badge-collinear.svg?raw';
import symmetryRaw from '../assets/icons/badge-symmetry.svg?raw';
import circularPatternRaw from '../assets/icons/badge-circular-pattern.svg?raw';
import rectangularPatternRaw from '../assets/icons/badge-rectangular-pattern.svg?raw';
import badgeTangentRaw from '../assets/icons/badge-tangent.svg?raw';
import { Vec2 } from '../math/vector';
import type { SketchDocument } from '../model/sketch';
import type { Viewport } from './viewport';
import { createSvgElement, createSvgRect, createSvgText, getArcSweep } from './svg';
import { COLORS, STROKE_WIDTH } from './styles';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface BadgeIconDef {
	viewBox: string;
	d: string;
	width: number;
	height: number;
}

function parseSvgIcon(raw: string, width = 12, height = 12): BadgeIconDef {
	const vbMatch = raw.match(/viewBox="([^"]+)"/);
	const dMatch = raw.match(/d="([^"]+)"/);
	return {
		viewBox: vbMatch ? vbMatch[1] : '0 0 24 24',
		d: dMatch ? dMatch[1] : '',
		width,
		height,
	};
}

const BADGE_ICONS: Record<string, BadgeIconDef> = {
	fixed: parseSvgIcon(fixedRaw, 12, 12),
	collinear: parseSvgIcon(collinearRaw, 13, 13),
	symmetry: parseSvgIcon(symmetryRaw, 13, 13),
	circular_pattern: parseSvgIcon(circularPatternRaw, 13, 13),
	rectangular_pattern: parseSvgIcon(rectangularPatternRaw, 13, 13),
	tangent: parseSvgIcon(badgeTangentRaw, 13, 13),
};

export function getBadgeIcon(name: string, position: Vec2, color: string): SVGElement | null {
	const def = BADGE_ICONS[name];
	if (!def || !def.d) return null;

	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('x', (position.x - def.width * 0.5).toFixed(1));
	svg.setAttribute('y', (position.y - def.height * 0.5).toFixed(1));
	svg.setAttribute('width', def.width.toString());
	svg.setAttribute('height', def.height.toString());
	svg.setAttribute('viewBox', def.viewBox);

	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', def.d);
	path.setAttribute('fill', color);
	svg.appendChild(path);

	return svg;
}

export function renderConstraintBadge(
	targetGroup: SVGElement,
	id: string,
	position: Vec2,
	label: string,
	isSelected: boolean,
	visible = true,
	customColor?: string
): void {
	const g = createSvgElement(
		'g',
		{
			class: 'constraint-badge',
			'data-id': id,
			'data-type': 'constraint',
		},
		targetGroup
	);
	g.style.display = visible ? '' : 'none';

	const color = isSelected ? COLORS.primary : (customColor ?? COLORS.badgeText);
	const icon = getBadgeIcon(label, position, color);
	const width = icon ? 18 : Math.max(18, label.length * 8 + 8);

	createSvgRect(
		new Vec2(position.x - width * 0.5, position.y - 9),
		new Vec2(width, 18),
		{
			rx: 3,
			fill: isSelected ? COLORS.selectedBg : COLORS.white,
			stroke: isSelected ? COLORS.primary : COLORS.badgeBorder,
			'stroke-width': STROKE_WIDTH.thin,
		},
		g
	);

	if (icon) {
		g.appendChild(icon);
	} else {
		createSvgText(
			new Vec2(position.x, position.y + 4),
			label,
			{
				'text-anchor': 'middle',
				fill: color,
				'font-size': 10,
				'font-weight': 700,
				'font-family': 'sans-serif',
			},
			g
		);
	}
}

export function renderBadgeOnSegment(
	targetGroup: SVGElement,
	constraintId: string,
	p1Id: string,
	p2Id: string,
	sketch: SketchDocument,
	viewport: Viewport,
	label: string,
	isSelected: boolean,
	visible = true,
	lineBadgeCounts?: Map<string, number>
): void {
	const p1 = sketch.points.get(p1Id);
	const p2 = sketch.points.get(p2Id);
	if (!p1 || !p2) return;

	const s1 = viewport.worldToScreen(p1);
	const s2 = viewport.worldToScreen(p2);

	const dir = new Vec2().subVectors(s2, s1);
	const len = Math.max(dir.length(), 1);
	const u = dir.clone().multiplyScalar(1 / len);

	const normal = u.clone().perpendicular();
	if (normal.y > 0 || (Math.abs(normal.y) < 1e-4 && normal.x < 0)) {
		normal.negate();
	}

	let badgeIndex = 0;
	if (lineBadgeCounts) {
		const lineKey = p1Id < p2Id ? `${p1Id}_${p2Id}` : `${p2Id}_${p1Id}`;
		badgeIndex = lineBadgeCounts.get(lineKey) ?? 0;
		lineBadgeCounts.set(lineKey, badgeIndex + 1);
	}

	const offsetAlong =
		badgeIndex === 0 ? 0 : (badgeIndex % 2 === 1 ? Math.floor((badgeIndex + 1) / 2) : -Math.floor(badgeIndex / 2)) * 22;

	const midpoint = new Vec2().midpoint(s1, s2).addScaledVector(normal, 14).addScaledVector(u, offsetAlong);

	renderConstraintBadge(targetGroup, constraintId, midpoint, label, isSelected, visible);
}

export function renderBadgeOnCircle(
	targetGroup: SVGElement,
	constraintId: string,
	circleId: string,
	sketch: SketchDocument,
	viewport: Viewport,
	label: string,
	isSelected: boolean,
	visible = true
): void {
	const circle = sketch.circles.get(circleId);
	const arc = sketch.arcs.get(circleId);
	const entity = circle ?? arc;
	if (!entity) return;
	const center = sketch.points.get(entity.centerId);
	if (!center) return;

	const sc = viewport.worldToScreen(center);
	const rScreen = entity.radius * viewport.zoom;
	let bx = sc.x + rScreen * 0.7071;
	let by = sc.y - rScreen * 0.7071;

	if (arc) {
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (start && end) {
			const ss = viewport.worldToScreen(start);
			const se = viewport.worldToScreen(end);
			const as = sc.angleToPoint(ss);
			const clockwise = !!arc.clockwise;
			const sweepAngle = getArcSweep(as, sc.angleToPoint(se), clockwise);
			const midAngle = as + (clockwise ? 0.5 : -0.5) * sweepAngle;
			bx = sc.x + Math.cos(midAngle) * rScreen;
			by = sc.y + Math.sin(midAngle) * rScreen;
		}
	}

	renderConstraintBadge(targetGroup, constraintId, new Vec2(bx, by), label, isSelected, visible);
}
