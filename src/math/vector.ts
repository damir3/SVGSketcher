export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function angle(a: Vec2, b: Vec2): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

export function projectPointOntoSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) {
    return { point: a, t: 0, dist: dist(p, a) };
  }
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / l2));
  const projection = add(a, scale(ab, t));
  return { point: projection, t, dist: dist(p, projection) };
}

export function projectPointOntoLine(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) {
    return { point: a, t: 0, dist: dist(p, a) };
  }
  const ap = sub(p, a);
  const t = dot(ap, ab) / l2;
  const projection = add(a, scale(ab, t));
  return { point: projection, t, dist: dist(p, projection) };
}

export function getCircumcircle(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2
): { center: Vec2; radius: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-6) return null;

  const p1Sq = p1.x * p1.x + p1.y * p1.y;
  const p2Sq = p2.x * p2.x + p2.y * p2.y;
  const p3Sq = p3.x * p3.x + p3.y * p3.y;

  const xc = (p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / d;
  const yc = (p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / d;

  const r = Math.hypot(p1.x - xc, p1.y - yc);
  if (!isFinite(r) || r < 1e-3 || r > 1e6) return null;

  return { center: vec(xc, yc), radius: r };
}

