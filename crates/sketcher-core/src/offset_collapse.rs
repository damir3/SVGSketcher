//! Empty inward offsets, tested as clearance in the source interior.
use super::*;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Clone, Copy)]
struct Cell {
    x: f64,
    y: f64,
    hx: f64,
    hy: f64,
    upper: f64,
}
impl PartialEq for Cell {
    fn eq(&self, other: &Self) -> bool {
        self.upper == other.upper
    }
}
impl Eq for Cell {}
impl PartialOrd for Cell {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Cell {
    fn cmp(&self, other: &Self) -> Ordering {
        self.upper.total_cmp(&other.upper)
    }
}

fn clearance(pt: Point2, polygon: &[Point2]) -> f64 {
    let mut odd = false;
    let mut closest = f64::INFINITY;
    let mut j = polygon.len() - 1;
    for (i, &b) in polygon.iter().enumerate() {
        let a = polygon[j];
        let delta = sub(b, a);
        let len = dot(delta, delta);
        let t = if len > 1e-20 {
            (dot(sub(pt, a), delta) / len).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let q = sub(sub(pt, a), scale(delta, t));
        closest = closest.min(dot(q, q));
        if (a.y > pt.y) != (b.y > pt.y) && pt.x < delta.x * (pt.y - a.y) / delta.y + a.x {
            odd = !odd;
        }
        j = i;
    }
    closest.sqrt() * if odd { 1.0 } else { -1.0 }
}

fn band_covers(a: &Geometry, b: &Geometry, cell: Cell, radius: f64, tolerance: f64) -> bool {
    match (a, b) {
        (Geometry::Segment(a0, a1), Geometry::Segment(b0, b1)) => {
            let av = *a1 - *a0;
            let bv = *b1 - *b0;
            let al = av.length();
            let bl = bv.length();
            if al < 1e-9 || bl < 1e-9 {
                return false;
            }
            let u = av * (1.0 / al);
            let v = bv * (1.0 / bl);
            let n = u.perp();
            if u.cross(v).abs() > 1e-10 || u.dot(v) > -1.0 + 1e-10 {
                return false;
            }
            let offset = (*b0 - *a0).dot(n);
            let lo = offset.min(0.0);
            let hi = offset.max(0.0);
            if (hi - lo) / 2.0 > radius + tolerance {
                return false;
            }
            let s = dot(sub(p(cell.x, cell.y), *a0), n);
            let extent = n.x.abs() * cell.hx + n.y.abs() * cell.hy;
            if s - extent < lo - 1e-9 || s + extent > hi + 1e-9 {
                return false;
            }
            let covers = |q: Point2, dir: Point2, len: f64| {
                let t = dot(sub(p(cell.x, cell.y), q), dir);
                let spread = dir.x.abs() * cell.hx + dir.y.abs() * cell.hy;
                t - spread >= -1e-9 && t + spread <= len + 1e-9
            };
            covers(*a0, u, al) && covers(*b0, v, bl)
        }
        (Geometry::Arc(c, r, a0, a1, cw), Geometry::Arc(q, s, b0, b1, bw))
            if cw != bw && dist(*c, *q) < 1e-9 =>
        {
            let low = r.min(*s);
            let high = r.max(*s);
            if (high - low) / 2.0 > radius + tolerance {
                return false;
            }
            let dx = cell.x - c.x;
            let dy = cell.y - c.y;
            let center_distance = dx.hypot(dy);
            let diagonal = cell.hx.hypot(cell.hy);
            if center_distance <= diagonal
                || (dx.abs() - cell.hx)
                    .max(0.0)
                    .hypot((dy.abs() - cell.hy).max(0.0))
                    < low - 1e-9
                || (dx.abs() + cell.hx).hypot(dy.abs() + cell.hy) > high + 1e-9
            {
                return false;
            }
            let angle_at_center = dy.atan2(dx);
            let margin = (diagonal / center_distance).min(1.0).asin();
            [(*a0, *a1, *cw), (*b0, *b1, *bw)]
                .iter()
                .all(|&(start, end, clockwise)| {
                    let begin = angle(*c, start);
                    let span = sweep(begin, angle(*c, end), clockwise);
                    let t = sweep(begin, angle_at_center, clockwise);
                    t >= margin - 1e-9 && t + margin <= span + 1e-9
                })
        }
        _ => false,
    }
}
pub(super) fn collapsed(items: &[Item], radius: f64) -> bool {
    if items.is_empty() || radius <= 0.0 || items.iter().any(|i| i.geometry.is_none()) {
        return false;
    }
    if items.len() == 1 {
        match items[0].geometry.as_ref().unwrap() {
            Geometry::Circle(_, r) => return radius >= *r,
            Geometry::Ellipse(c, a, b) => return radius >= dist(*c, *a).min(dist(*c, *b)),
            _ => {}
        }
    }
    let parts: Option<Vec<_>> = items
        .iter()
        .map(|item| {
            let count = match &item.geometry {
                Some(Geometry::Spline(s, _)) => (s.len() * 256).clamp(512, 8192),
                Some(Geometry::Ellipse(..) | Geometry::EllipticalArc(..)) => 1024,
                _ => 512,
            };
            let mut points = sample(item, count);
            if points.len() < 2 || points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
                return None;
            }
            points.pop();
            Some(points)
        })
        .collect();
    let Some(parts) = parts else {
        return false;
    };
    let polygon: Vec<_> = parts.into_iter().flatten().collect();
    if polygon.len() < 3 {
        return false;
    }
    let (min_x, max_x, min_y, max_y) = polygon.iter().fold(
        (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ),
        |b, p| (b.0.min(p.x), b.1.max(p.x), b.2.min(p.y), b.3.max(p.y)),
    );
    let (width, height) = (max_x - min_x, max_y - min_y);
    let tolerance = 1e-5_f64.max(width.max(height) * 1e-7);
    if radius >= width.min(height) / 2.0 - tolerance {
        return true;
    }
    let mut heap = BinaryHeap::new();
    let add = |x, y, hx: f64, hy: f64, heap: &mut BinaryHeap<Cell>| {
        let cell = Cell {
            x,
            y,
            hx,
            hy,
            upper: 0.0,
        };
        for i in 0..items.len() {
            for j in i + 1..items.len() {
                if band_covers(
                    items[i].geometry.as_ref().unwrap(),
                    items[j].geometry.as_ref().unwrap(),
                    cell,
                    radius,
                    tolerance,
                ) {
                    return false;
                }
            }
        }
        let distance = clearance(p(x, y), &polygon);
        if distance > radius + tolerance {
            return true;
        }
        let upper = distance + hx.hypot(hy);
        if upper > radius + tolerance {
            heap.push(Cell {
                x,
                y,
                hx,
                hy,
                upper,
            });
        }
        false
    };
    if add(
        (min_x + max_x) / 2.0,
        (min_y + max_y) / 2.0,
        width / 2.0,
        height / 2.0,
        &mut heap,
    ) {
        return false;
    }
    while let Some(c) = heap.pop() {
        if c.hx >= c.hy {
            let h = c.hx / 2.0;
            if add(c.x - h, c.y, h, c.hy, &mut heap) || add(c.x + h, c.y, h, c.hy, &mut heap) {
                return false;
            }
        } else {
            let h = c.hy / 2.0;
            if add(c.x, c.y - h, c.hx, h, &mut heap) || add(c.x, c.y + h, c.hx, h, &mut heap) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(g: Geometry) -> Item {
        Item {
            geometry: Some(g),
            kind: 0,
            reversed: false,
            endpoint_reversed: false,
            gizmo_clockwise: false,
        }
    }
    #[test]
    fn clearances_handle_convex_and_concave_polygons_at_the_extinction_threshold() {
        let triangle = [p(0.0, 0.0), p(10.0, 0.0), p(5.0, 5.0 * 3.0_f64.sqrt())];
        let items: Vec<_> = (0..3)
            .map(|i| item(Geometry::Segment(triangle[i], triangle[(i + 1) % 3])))
            .collect();
        let r = 5.0 * 3.0_f64.sqrt() / 3.0;
        assert!(!collapsed(&items, r - 0.01));
        assert!(collapsed(&items, r));
        assert!(collapsed(&items, r + 1.0));
        let vertices = [
            p(0.0, 0.0),
            p(100.0, 0.0),
            p(100.0, 2.0),
            p(2.0, 2.0),
            p(2.0, 100.0),
            p(0.0, 100.0),
        ];
        let items: Vec<_> = (0..vertices.len())
            .map(|i| {
                item(Geometry::Segment(
                    vertices[i],
                    vertices[(i + 1) % vertices.len()],
                ))
            })
            .collect();
        assert!(!collapsed(&items, 1.0));
        assert!(collapsed(&items, 1.2));
    }
    #[test]
    fn concentric_arc_bands_collapse_without_refining_the_whole_medial_ridge() {
        let c = p(0.0, 0.0);
        let items = [
            item(Geometry::Arc(c, 12.0, p(12.0, 0.0), p(-12.0, 0.0), false)),
            item(Geometry::Segment(p(-12.0, 0.0), p(-10.0, 0.0))),
            item(Geometry::Arc(c, 10.0, p(-10.0, 0.0), p(10.0, 0.0), true)),
            item(Geometry::Segment(p(10.0, 0.0), p(12.0, 0.0))),
        ];
        assert!(!collapsed(&items, 0.8));
        assert!(collapsed(&items, 1.0));
        assert!(collapsed(&items, 2.0));
    }
}
