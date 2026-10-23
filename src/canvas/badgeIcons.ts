import fixedRaw from '../assets/icons/fixed.svg?raw';
import collinearRaw from '../assets/icons/badge-collinear.svg?raw';
import symmetryRaw from '../assets/icons/badge-symmetry.svg?raw';
import circularPatternRaw from '../assets/icons/badge-circular-pattern.svg?raw';
import rectangularPatternRaw from '../assets/icons/badge-rectangular-pattern.svg?raw';
import badgeTangentRaw from '../assets/icons/badge-tangent.svg?raw';

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
	tangent: parseSvgIcon(badgeTangentRaw, 13, 13)
};

export function getBadgeIcon(name: string, x: number, y: number, color: string): SVGElement | null {
	const def = BADGE_ICONS[name];
	if (!def || !def.d) return null;

	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('x', (x - def.width * 0.5).toFixed(1));
	svg.setAttribute('y', (y - def.height * 0.5).toFixed(1));
	svg.setAttribute('width', def.width.toString());
	svg.setAttribute('height', def.height.toString());
	svg.setAttribute('viewBox', def.viewBox);

	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', def.d);
	path.setAttribute('fill', color);
	svg.appendChild(path);

	return svg;
}
