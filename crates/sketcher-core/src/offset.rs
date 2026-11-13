//! Numeric offset chains, retaining the editor's sampling, join order and tolerances.
use crate::{regions::Geometry, spline, Point2};
use std::f64::consts::TAU;
#[path = "offset_spline.rs"]
mod refined_spline;
fn p(x: f64, y: f64) -> Point2 {
    Point2 { x, y }
}
fn sub(a: Point2, b: Point2) -> Point2 {
    p(a.x - b.x, a.y - b.y)
}
fn scale(a: Point2, s: f64) -> Point2 {
    p(a.x * s, a.y * s)
}
fn add(a: Point2, b: Point2) -> Point2 {
    p(a.x + b.x, a.y + b.y)
}
fn step(a: Point2, b: Point2, s: f64) -> Point2 {
    p(a.x + b.x * s, a.y + b.y * s)
}
fn dot(a: Point2, b: Point2) -> f64 {
    a.x * b.x + a.y * b.y
}
fn cross(a: Point2, b: Point2) -> f64 {
    a.x * b.y - a.y * b.x
}
fn dist(a: Point2, b: Point2) -> f64 {
    spline::length(sub(a, b))
}
fn squared(a: Point2, b: Point2) -> f64 {
    let d = sub(a, b);
    dot(d, d)
}
fn unit(a: Point2) -> Point2 {
    let n = spline::length(a);
    if n < 1e-12 {
        p(1.0, 0.0)
    } else {
        scale(a, 1.0 / n)
    }
}
fn perp(a: Point2) -> Point2 {
    p(-a.y, a.x)
}
fn middle(a: Point2, b: Point2) -> Point2 {
    p((a.x + b.x) / 2.0, (a.y + b.y) / 2.0)
}
fn angle(c: Point2, a: Point2) -> f64 {
    (a.y - c.y).atan2(a.x - c.x)
}
fn polar(r: f64, a: f64) -> Point2 {
    p(r * a.cos(), r * a.sin())
}
fn sweep(a: f64, b: f64, cw: bool) -> f64 {
    let mut s = if cw { a - b } else { b - a };
    while s < 0.0 {
        s += TAU;
    }
    s
}
#[derive(Clone, Debug)]
pub struct Item {
    pub geometry: Option<Geometry>,
    pub kind: u8,
    pub reversed: bool,
    pub endpoint_reversed: bool,
    pub gizmo_clockwise: bool,
}
#[derive(Clone, Debug)]
pub struct SplineOffset {
    pub points: Vec<Point2>,
    pub basis: Option<(Vec<Point2>, Vec<Point2>)>,
    pub tangents: Option<[Point2; 2]>,
    pub handles: Option<Vec<[Point2; 2]>>,
    pub closed: bool,
}
#[derive(Clone, Debug)]
pub enum Shape {
    Line([Point2; 2], Point2),
    Arc(Point2, f64, [Point2; 2], bool),
    Circle(Point2, f64),
    Spline(SplineOffset),
}
impl Shape {
    fn start(&self) -> Point2 {
        match self {
            Self::Line(v, _) | Self::Arc(_, _, v, _) => v[0],
            Self::Spline(s) => s.points[0],
            Self::Circle(..) => unreachable!(),
        }
    }
    fn end(&self) -> Point2 {
        match self {
            Self::Line(v, _) | Self::Arc(_, _, v, _) => v[1],
            Self::Spline(s) => *s.points.last().unwrap(),
            Self::Circle(..) => unreachable!(),
        }
    }
    fn set_start(&mut self, p: Point2) {
        match self {
            Self::Line(v, _) | Self::Arc(_, _, v, _) => v[0] = p,
            Self::Spline(s) => s.points[0] = p,
            Self::Circle(..) => unreachable!(),
        }
    }
    fn set_end(&mut self, p: Point2) {
        match self {
            Self::Line(v, _) | Self::Arc(_, _, v, _) => v[1] = p,
            Self::Spline(s) => *s.points.last_mut().unwrap() = p,
            Self::Circle(..) => unreachable!(),
        }
    }
}
#[derive(Clone, Debug)]
pub struct Primitive {
    pub source: usize,
    pub shape: Shape,
}
#[derive(Clone, Debug)]
pub struct Side {
    pub primitives: Vec<Primitive>,
    pub side: f64,
    pub distance: f64,
    pub error: u8,
}
#[derive(Clone, Debug)]
pub struct Offset {
    pub sides: Vec<Side>,
    pub anchor: Point2,
    pub normal: Point2,
    pub error: u8,
}
fn ellipse(c: Point2, major: Point2, minor: Point2) -> (f64, f64, Point2, Point2) {
    let a = dist(c, major);
    let b = dist(c, minor);
    let u = polar(1.0, angle(c, major));
    (a, b, u, perp(u))
}
fn ellipse_point(c: Point2, a: f64, b: f64, u: Point2, v: Point2, t: f64) -> Point2 {
    step(step(c, u, a * t.cos()), v, b * t.sin())
}
fn sample(item: &Item, count: usize) -> Vec<Point2> {
    let Some(g) = &item.geometry else {
        return vec![];
    };
    match g {
        Geometry::Segment(a, b) => vec![*a, *b],
        Geometry::Circle(c, r) => {
            let mut out: Vec<_> = (0..count)
                .map(|i| {
                    add(
                        polar(*r, (i as f64 / count as f64) * std::f64::consts::PI * 2.0),
                        *c,
                    )
                })
                .collect();
            out.push(out[0]);
            out
        }
        Geometry::Ellipse(c, major, minor) => {
            let (a, b, u, v) = ellipse(*c, *major, *minor);
            let mut out: Vec<_> = (0..count)
                .map(|i| {
                    ellipse_point(
                        *c,
                        a,
                        b,
                        u,
                        v,
                        (i as f64 / count as f64) * std::f64::consts::PI * 2.0,
                    )
                })
                .collect();
            out.push(out[0]);
            out
        }
        Geometry::Arc(c, r, a, b, cw) => {
            let start = angle(*c, *a);
            let s = sweep(start, angle(*c, *b), *cw);
            (0..=count)
                .map(|i| {
                    let t = i as f64 / count as f64;
                    add(
                        polar(*r, if *cw { start - t * s } else { start + t * s }),
                        *c,
                    )
                })
                .collect()
        }
        Geometry::Spline(segments, _) => {
            if segments.is_empty() {
                return vec![];
            }
            let mut out: Vec<_> = (0..=count)
                .map(|i| spline::point_at(segments, i as f64 / count as f64))
                .collect();
            if item.reversed {
                out.reverse();
            }
            out
        }
        Geometry::EllipticalArc(c, major, minor, start, end, cw) => {
            let (a, b, u, v) = ellipse(*c, *major, *minor);
            let parameter = |pt: Point2| {
                let d = sub(pt, *c);
                (dot(d, v) / b).atan2(dot(d, u) / a)
            };
            let begin = parameter(*start);
            let s = sweep(begin, parameter(*end), *cw);
            (0..=count)
                .map(|i| {
                    let t = i as f64 / count as f64;
                    ellipse_point(
                        *c,
                        a,
                        b,
                        u,
                        v,
                        if *cw { begin - t * s } else { begin + t * s },
                    )
                })
                .collect()
        }
    }
}
fn polygon(items: &[Item], samples: usize) -> Vec<Point2> {
    let mut out = vec![];
    for it in items {
        let pts = sample(it, samples);
        out.extend(pts.iter().take(pts.len().saturating_sub(1)).copied());
    }
    out
}
fn inside(pt: Point2, poly: &[Point2]) -> bool {
    let mut result = false;
    if poly.is_empty() {
        return false;
    }
    let mut j = poly.len() - 1;
    for (i, a) in poly.iter().enumerate() {
        let b = poly[j];
        if (a.y > pt.y) != (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x {
            result = !result;
        }
        j = i;
    }
    result
}
fn normal(tangent: Point2, closed: bool, ccw: bool) -> Point2 {
    let n = perp(tangent);
    if closed && ccw {
        scale(n, -1.0)
    } else {
        n
    }
}
pub fn intersect_lines(a: Point2, d1: Point2, b: Point2, d2: Point2) -> Option<Point2> {
    let det = cross(d1, d2);
    if det.abs() < 1e-7 {
        None
    } else {
        Some(step(a, d1, cross(sub(b, a), d2) / det))
    }
}
fn line_circle(origin: Point2, dir: Point2, c: Point2, r: f64, near: Point2) -> Option<Point2> {
    let t = dot(sub(c, origin), dir);
    let x = origin.x + t * dir.x - c.x;
    let y = origin.y + t * dir.y - c.y;
    let d = x * x + y * y;
    if d > r * r {
        return None;
    }
    let dt = (r * r - d).max(0.0).sqrt();
    let a = step(origin, dir, t - dt);
    let b = step(origin, dir, t + dt);
    Some(if dist(a, near) < dist(b, near) { a } else { b })
}
fn join(cur: &Shape, next: &Shape, d: f64) -> Option<Point2> {
    match (cur, next) {
        (Shape::Line(a, da), Shape::Line(b, db)) => intersect_lines(a[0], *da, b[0], *db),
        (Shape::Line(a, dir), Shape::Arc(c, r, ..)) => line_circle(a[0], *dir, *c, *r, a[1]),
        (Shape::Arc(c, r, a, _), Shape::Line(b, dir)) => line_circle(b[0], *dir, *c, *r, a[1]),
        (Shape::Line(a, dir), Shape::Spline(s)) => {
            intersect_lines(a[0], *dir, s.points[0], s.tangents.unwrap()[0])
                .filter(|p| dist(*p, a[1]) <= 4.0 * d.abs())
                .or_else(|| Some(middle(a[1], s.points[0])))
        }
        (Shape::Spline(s), Shape::Line(b, dir)) => intersect_lines(
            b[0],
            *dir,
            *s.points.last().unwrap(),
            s.tangents.unwrap()[1],
        )
        .filter(|p| dist(*p, b[0]) <= 4.0 * d.abs())
        .or_else(|| Some(middle(*s.points.last().unwrap(), b[0]))),
        (Shape::Arc(c, r, a, _), Shape::Spline(s)) => {
            line_circle(s.points[0], s.tangents.unwrap()[0], *c, *r, a[1])
                .or_else(|| Some(middle(a[1], s.points[0])))
        }
        (Shape::Spline(s), Shape::Arc(c, r, b, _)) => line_circle(
            *s.points.last().unwrap(),
            s.tangents.unwrap()[1],
            *c,
            *r,
            b[0],
        )
        .or_else(|| Some(middle(*s.points.last().unwrap(), b[0]))),
        _ => Some(middle(cur.end(), next.start())),
    }
}
fn side(items: &[Item], closed: bool, d: f64) -> Side {
    let invalid = |error| Side {
        primitives: vec![],
        side: 1.0,
        distance: d,
        error,
    };
    if items.is_empty() {
        return invalid(1);
    }
    if items.len() == 1 && items[0].kind == 3 {
        let Some(Geometry::Circle(c, r)) = &items[0].geometry else {
            return invalid(1);
        };
        let radius = r + d;
        if radius <= 0.1 {
            return invalid(2);
        }
        return Side {
            primitives: vec![Primitive {
                source: 0,
                shape: Shape::Circle(*c, radius),
            }],
            side: if d < 0.0 { -1.0 } else { 1.0 },
            distance: d.abs(),
            error: 0,
        };
    }
    if items.len() == 1 && items[0].kind == 4 {
        let Some(Geometry::Ellipse(c, major, minor)) = &items[0].geometry else {
            return invalid(1);
        };
        let (a, b, u, v) = ellipse(*c, *major, *minor);
        let mut points = vec![];
        for i in 0..24 {
            let t = (i as f64 / 24.0) * std::f64::consts::PI * 2.0;
            let pt = ellipse_point(*c, a, b, u, v, t);
            let tangent = step(scale(u, -a * t.sin()), v, b * t.cos());
            let mut n = scale(perp(unit(tangent)), -1.0);
            if squared(add(pt, n), *c) < squared(pt, *c) {
                n = scale(n, -1.0);
            }
            points.push(step(pt, n, d));
        }
        points.push(points[0]);
        return Side {
            primitives: vec![Primitive {
                source: 0,
                shape: Shape::Spline(refined_spline::simplify_closed(&points)),
            }],
            side: if d < 0.0 { -1.0 } else { 1.0 },
            distance: d.abs(),
            error: 0,
        };
    }
    let ccw = if closed {
        let pts = polygon(items, 4);
        let mut area = 0.0;
        for i in 0..pts.len() {
            area += cross(pts[i], pts[(i + 1) % pts.len()]);
        }
        area > 0.0
    } else {
        true
    };
    let mut primitives = vec![];
    for (source, item) in items.iter().enumerate() {
        let Some(g) = &item.geometry else {
            return invalid(1);
        };
        let shape = match g {
            Geometry::Segment(a, b) => {
                let dir = unit(sub(*b, *a));
                let n = normal(dir, closed, ccw);
                Shape::Line([step(*a, n, d), step(*b, n, d)], dir)
            }
            Geometry::Arc(c, r, a, b, cw) => {
                let samples = sample(item, 4);
                let mid = samples.get(2).copied().unwrap_or(*a);
                let radial = unit(sub(mid, *c));
                let n = normal(unit(sub(*b, *a)), closed, ccw);
                let radius = r + if dot(n, radial) >= 0.0 { d } else { -d };
                if radius <= 0.1 {
                    return invalid(3);
                }
                Shape::Arc(
                    *c,
                    radius,
                    [
                        step(*c, unit(sub(*a, *c)), radius),
                        step(*c, unit(sub(*b, *c)), radius),
                    ],
                    *cw,
                )
            }
            _ => {
                let samples = sample(item, 16);
                if samples.len() < 2 {
                    return invalid(1);
                }
                let mut normals = vec![];
                let mut points = vec![];
                for k in 0..samples.len() {
                    let prev = samples[k.saturating_sub(1)];
                    let next = samples[(k + 1).min(samples.len() - 1)];
                    let n = normal(unit(sub(next, prev)), closed, ccw);
                    normals.push(n);
                    points.push(step(samples[k], n, d));
                }
                let mut start = unit(sub(points[1], points[0]));
                let mut end = unit(sub(*points.last().unwrap(), points[points.len() - 2]));
                if let Geometry::Spline(segments, _) = g {
                    if let (Some(first), Some(last)) = (segments.first(), segments.last()) {
                        if item.endpoint_reversed {
                            start = unit(sub(last[2], last[3]));
                            end = unit(sub(first[0], first[1]));
                        } else {
                            start = unit(sub(first[1], first[0]));
                            end = unit(sub(last[3], last[2]));
                        }
                    }
                }
                normals[0] = normal(start, closed, ccw);
                let last = normals.len() - 1;
                normals[last] = normal(end, closed, ccw);
                points[0] = step(samples[0], normals[0], d);
                points[last] = step(samples[last], normals[last], d);
                Shape::Spline(SplineOffset {
                    points,
                    basis: Some((samples, normals)),
                    tangents: Some([start, end]),
                    handles: None,
                    closed: false,
                })
            }
        };
        primitives.push(Primitive { source, shape });
    }
    let count = if closed { items.len() } else { items.len() - 1 };
    for i in 0..count {
        let next = (i + 1) % items.len();
        if let Some(pt) = join(&primitives[i].shape, &primitives[next].shape, d) {
            primitives[i].shape.set_end(pt);
            primitives[next].shape.set_start(pt);
        }
    }
    for prim in &mut primitives {
        if let Shape::Spline(s) = &mut prim.shape {
            let mut handles = spline::natural_handles(&s.points);
            if let Some([start, end]) = s.tangents {
                let last = s.points.len() - 1;
                let a = dist(s.points[0], s.points[1]) / 3.0;
                let b = dist(s.points[last - 1], s.points[last]) / 3.0;
                handles[0] = [step(s.points[0], start, -a), step(s.points[0], start, a)];
                handles[last] = [step(s.points[last], end, -b), step(s.points[last], end, b)];
            }
            s.handles = Some(handles);
        }
    }
    refined_spline::refine(items, &mut primitives, closed, d);
    Side {
        primitives,
        side: if d < 0.0 { -1.0 } else { 1.0 },
        distance: d.abs(),
        error: 0,
    }
}
pub fn calculate(
    items: &[Item],
    closed: bool,
    reference: usize,
    mode: u8,
    d1: f64,
    d2: f64,
    flip: bool,
) -> Offset {
    if items.is_empty() {
        return Offset {
            sides: vec![],
            anchor: p(0.0, 0.0),
            normal: p(1.0, 0.0),
            error: 4,
        };
    }
    let item = &items[reference];
    let mut anchor = p(0.0, 0.0);
    let mut n = p(0.0, 1.0);
    let poly = if closed { polygon(items, 16) } else { vec![] };
    if let Some(g) = &item.geometry {
        match g {
            Geometry::Segment(a, b) => {
                anchor = middle(*a, *b);
                n = perp(unit(sub(*b, *a)));
                if closed && poly.len() >= 3 && inside(step(anchor, n, 0.5), &poly) {
                    n = scale(n, -1.0);
                }
            }
            Geometry::Arc(c, r, a, b, _) => {
                let begin = angle(*c, *a);
                let mut s = sweep(begin, angle(*c, *b), item.gizmo_clockwise);
                while s >= TAU {
                    s -= TAU;
                }
                let mid = if item.gizmo_clockwise {
                    begin - s / 2.0
                } else {
                    begin + s / 2.0
                };
                anchor = add(polar(*r, mid), *c);
                n = polar(1.0, mid);
                if closed && poly.len() >= 3 && inside(step(anchor, n, 0.5), &poly) {
                    n = scale(n, -1.0);
                }
            }
            Geometry::Circle(c, r) => {
                anchor = p(c.x + r, c.y);
                n = p(1.0, 0.0);
            }
            Geometry::Ellipse(c, major, _) => {
                anchor = *major;
                n = unit(sub(*major, *c));
            }
            Geometry::Spline(..) => {
                let pts = sample(item, 64);
                if pts.len() >= 2 {
                    let i = pts.len() / 2;
                    anchor = pts[i];
                    let prev = pts[i.saturating_sub(1)];
                    let next = pts[(i + 1).min(pts.len() - 1)];
                    n = perp(unit(sub(next, prev)));
                    if closed && poly.len() >= 3 && inside(step(anchor, n, 0.5), &poly) {
                        n = scale(n, -1.0);
                    }
                }
            }
            Geometry::EllipticalArc(..) => {}
        }
    }
    let sign = if flip { -1.0 } else { 1.0 };
    let sides = match mode {
        0 => vec![side(items, closed, sign * d1)],
        1 => vec![
            side(items, closed, sign * d1),
            side(items, closed, -sign * d2),
        ],
        _ => vec![side(items, closed, d1), side(items, closed, -d1)],
    };
    let error = sides.iter().find(|s| s.error != 0).map_or(0, |s| s.error);
    Offset {
        sides,
        anchor,
        normal: n,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(a: Point2, b: Point2) -> Item {
        Item {
            geometry: Some(Geometry::Segment(a, b)),
            kind: 0,
            reversed: false,
            endpoint_reversed: false,
            gizmo_clockwise: false,
        }
    }
    #[test]
    fn open_lines_meet_at_the_left_offset_miter() {
        let items = [
            line(p(0.0, 0.0), p(10.0, 0.0)),
            line(p(10.0, 0.0), p(10.0, 10.0)),
        ];
        let r = calculate(&items, false, 0, 0, 2.0, 0.0, false);
        assert_eq!(r.error, 0);
        assert_eq!(r.anchor, p(5.0, 0.0));
        assert_eq!(r.normal, p(-0.0, 1.0));
        assert_eq!(r.sides[0].primitives[0].shape.end(), p(8.0, 2.0));
        assert_eq!(r.sides[0].primitives[1].shape.start(), p(8.0, 2.0));
    }
    #[test]
    fn closed_rectangle_offsets_outward_and_joins_its_last_corner() {
        let vertices = [p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)];
        let items: Vec<_> = (0..4)
            .map(|i| line(vertices[i], vertices[(i + 1) % 4]))
            .collect();
        let r = calculate(&items, true, 0, 2, 2.0, 0.0, false);
        assert_eq!(r.error, 0);
        assert_eq!(r.sides.len(), 2);
        assert_eq!(r.sides[0].primitives[0].shape.start(), p(-2.0, -2.0));
        assert_eq!(r.sides[0].primitives[0].shape.end(), p(12.0, -2.0));
        assert_eq!(r.sides[0].primitives[3].shape.end(), p(-2.0, -2.0));
        assert_eq!(r.sides[1].primitives[0].shape.start(), p(2.0, 2.0));
    }
    #[test]
    fn circle_radius_collapse_keeps_the_valid_other_side_and_error_metadata() {
        let circle = Item {
            geometry: Some(Geometry::Circle(p(0.0, 0.0), 5.0)),
            kind: 3,
            reversed: false,
            endpoint_reversed: false,
            gizmo_clockwise: false,
        };
        let r = calculate(&[circle], true, 0, 1, 2.0, 5.0, false);
        assert_eq!(r.error, 2);
        assert_eq!(r.sides[0].error, 0);
        assert_eq!(r.sides[1].error, 2);
        assert_eq!(r.sides[1].distance, -5.0);
        assert!(r.sides[1].primitives.is_empty());
    }
    #[test]
    fn inward_closed_spline_preserves_both_components_after_the_neck_collapses() {
        let points = [
            p(-75.0, 0.0),
            p(-35.75, 78.25),
            p(0.0, 8.5),
            p(38.5, 75.25),
            p(75.0, 0.0),
            p(41.0, -71.75),
            p(0.0, -7.0),
            p(-41.75, -71.5),
            p(-75.0, 0.0),
        ];
        let handles = spline::natural_handles(&points);
        let curves: Vec<_> = (0..points.len() - 1)
            .map(|i| [points[i], handles[i][1], handles[i + 1][0], points[i + 1]])
            .collect();
        for reversed in [false, true] {
            let item = Item {
                geometry: Some(Geometry::Spline(curves.clone(), true)),
                kind: 2,
                reversed,
                endpoint_reversed: reversed,
                gizmo_clockwise: false,
            };
            for distance in [-15.0, -10.0, -5.0, 0.0, 10.0] {
                let result = calculate(
                    std::slice::from_ref(&item),
                    true,
                    0,
                    0,
                    distance,
                    0.0,
                    false,
                );
                assert_eq!(result.error, 0);
                let primitives = &result.sides[0].primitives;
                assert_eq!(primitives.len(), if distance <= -10.0 { 2 } else { 1 });
                for (i, prim) in primitives.iter().enumerate() {
                    let Shape::Spline(s) = &prim.shape else {
                        panic!("expected a closed spline")
                    };
                    assert_eq!(prim.source, 0);
                    assert!(s.closed);
                    assert!(dist(s.points[0], *s.points.last().unwrap()) < 1e-8);
                    if primitives.len() == 2 {
                        assert!(s.points.iter().all(|p| if i == 0 {
                            p.x < -10.0
                        } else {
                            p.x > 10.0
                        }));
                    }
                }
            }
        }
    }
}
