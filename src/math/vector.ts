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
