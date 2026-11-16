//! Batched editor geometry queries. Coordinate transforms and visibility stay in JS.
use crate::{p, regions::Geometry, spline, Curve, Point2};
use std::f64::consts::{PI, TAU};

#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub min: Point2,
    pub max: Point2,
}
impl Bounds {
    fn new(p: Point2) -> Self {
        Self { min: p, max: p }
    }
    fn add(&mut self, p: Point2) {
        self.min = self.min.min(p);
        self.max = self.max.max(p);
    }
    pub fn contains(self, p: Point2) -> bool {
        p.x >= self.min.x && p.x <= self.max.x && p.y >= self.min.y && p.y <= self.max.y
    }
}
fn norm(p: Point2) -> f64 {
    p.scaled_length()
}
fn distance(a: Point2, b: Point2) -> f64 {
    a.scaled_distance(b)
}
fn positive(t: f64) -> f64 {
    let s = t % TAU;
    if s < 0.0 {
        s + TAU
    } else {
        s
    }
}
struct Ellipse {
    c: Point2,
    a: f64,
    b: f64,
    u: Point2,
    v: Point2,
}
impl Ellipse {
    fn new(c: Point2, major: Point2, minor: Point2) -> Self {
        let u = Point2::from_polar(1.0, c.angle_to(major));
        Self {
            c,
            a: distance(c, major),
            b: distance(c, minor),
            u,
            v: u.perp(),
        }
    }
    fn param(&self, p: Point2) -> f64 {
        let d = p - self.c;
        (d.dot(self.v) / self.b).atan2(d.dot(self.u) / self.a)
    }
    fn point(&self, t: f64) -> Point2 {
        self.c + self.u * (self.a * t.cos()) + self.v * (self.b * t.sin())
    }
}
pub fn bounds(g: &Geometry) -> Option<Bounds> {
    if let Geometry::Segment(a, b) = g {
        let mut v = Bounds::new(*a);
        v.add(*b);
        return Some(v);
    }
    if let Geometry::Spline(curves, _) = g {
        let first = curves.first()?;
        let mut out = Bounds::new(first[0]);
        for curve in curves {
            out.add(curve[0]);
            out.add(curve[3]);
            for axis in 0..2 {
                let value = |p: Point2| if axis == 0 { p.x } else { p.y };
                let (d0, d1, d2) = (
                    value(curve[1] - curve[0]),
                    value(curve[2] - curve[1]),
                    value(curve[3] - curve[2]),
                );
                let a = d0 - 2.0 * d1 + d2;
                let b = 2.0 * (d1 - d0);
                let disc = b * b - 4.0 * a * d0;
                let roots = if a == 0.0 {
                    if b == 0.0 {
                        vec![]
                    } else {
                        vec![-d0 / b]
                    }
                } else if disc >= 0.0 {
                    vec![
                        (-b - disc.sqrt()) / (2.0 * a),
                        (-b + disc.sqrt()) / (2.0 * a),
                    ]
                } else {
                    vec![]
                };
                for t in roots {
                    if t > 0.0 && t < 1.0 {
                        out.add(spline::evaluate_bezier(curve, t));
                    }
                }
            }
        }
        return Some(out);
    }
    let (frame, arc) = match g {
        Geometry::Circle(c, r) => (
            Ellipse {
                c: *c,
                a: *r,
                b: *r,
                u: Point2::UNIT_X,
                v: Point2::UNIT_Y,
            },
            None,
        ),
        Geometry::Arc(c, r, a, b, cw) => (
            Ellipse {
                c: *c,
                a: *r,
                b: *r,
                u: Point2::UNIT_X,
                v: Point2::UNIT_Y,
            },
            Some((*a, *b, *cw)),
        ),
        Geometry::Ellipse(c, a, b) => (Ellipse::new(*c, *a, *b), None),
        Geometry::EllipticalArc(c, a, b, s, e, cw) => {
            (Ellipse::new(*c, *a, *b), Some((*s, *e, *cw)))
        }
        _ => unreachable!(),
    };
    let (x, y) = (
        norm(p(frame.a * frame.u.x, frame.b * frame.v.x)),
        norm(p(frame.a * frame.u.y, frame.b * frame.v.y)),
    );
    let Some((a, b, cw)) = arc else {
        return Some(Bounds {
            min: frame.c - p(x, y),
            max: frame.c + p(x, y),
        });
    };
    let mut out = Bounds::new(a);
    out.add(b);
    let parameter = |pt| {
        if matches!(g, Geometry::Arc(..)) {
            frame.c.angle_to(pt)
        } else {
            frame.param(pt)
        }
    };
    let begin = parameter(a);
    let direction = if cw { -1.0 } else { 1.0 };
    let delta = |t| positive((t - begin) * direction);
    let span = delta(parameter(b));
    let tx = (frame.b * frame.v.x).atan2(frame.a * frame.u.x);
    let ty = (frame.b * frame.v.y).atan2(frame.a * frame.u.y);
    if delta(tx) <= span {
        out.max.x = out.max.x.max(frame.c.x + x);
    }
    if delta(tx + PI) <= span {
        out.min.x = out.min.x.min(frame.c.x - x);
    }
    if delta(ty) <= span {
        out.max.y = out.max.y.max(frame.c.y + y);
    }
    if delta(ty + PI) <= span {
        out.min.y = out.min.y.min(frame.c.y - y);
    }
    Some(out)
}
fn project_segment(pt: Point2, a: Point2, b: Point2) -> (Point2, f64, f64) {
    let delta = b - a;
    let len = delta.length_squared();
    let t = if len < 1e-12 {
        0.0
    } else {
        ((pt - a).dot(delta) / len).clamp(0.0, 1.0)
    };
    let point = a + delta * t;
    (point, t, distance(point, pt))
}
fn in_span(angle: f64, a: f64, b: f64, cw: bool, tol: f64) -> bool {
    let direction = if cw { 1.0 } else { -1.0 };
    let span = positive((b - a) * direction);
    let t = positive((angle - a) * direction);
    t <= span + tol || t >= TAU - tol
}
pub fn hit_distance(g: &Geometry, pt: Point2, threshold: f64) -> Option<f64> {
    match g {
        Geometry::Segment(a, b) => Some(project_segment(pt, *a, *b).2),
        Geometry::Circle(c, r) => Some((distance(pt, *c) - r).abs()),
        Geometry::Arc(c, r, a, b, cw) => {
            let d = (distance(pt, *c) - r).abs();
            (d <= threshold
                && in_span(
                    c.angle_to(pt),
                    c.angle_to(*a),
                    c.angle_to(*b),
                    *cw,
                    threshold / r.max(1.0),
                ))
            .then_some(d)
        }
        Geometry::Spline(curves, _) => {
            if curves.is_empty() {
                None
            } else {
                Some(spline::project(curves, pt).1)
            }
        }
        Geometry::Ellipse(c, a, b) | Geometry::EllipticalArc(c, a, b, ..) => {
            let f = Ellipse::new(*c, *a, *b);
            if f.a < 0.1 || f.b < 0.1 {
                return None;
            }
            let t = f.param(pt);
            // Match the reference's center-relative arithmetic (no add/sub round trip).
            let q = f.u * (f.a * t.cos()) + f.v * (f.b * t.sin());
            let d = distance(q, pt - *c);
            if let Geometry::EllipticalArc(_, _, _, s, e, cw) = g {
                if d > threshold
                    || !in_span(
                        t,
                        f.param(*s),
                        f.param(*e),
                        *cw,
                        threshold / f.a.min(f.b).max(1.0),
                    )
                {
                    return None;
                }
            }
            Some(d)
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Projection {
    pub point: Point2,
    pub distance: f64,
    pub param: f64,
}
pub fn snap(g: &Geometry, pt: Point2, max: f64, tolerance: f64) -> Option<Projection> {
    match g {
        Geometry::Segment(a, b) => {
            let (point, param, distance) = project_segment(pt, *a, *b);
            (distance < max).then_some(Projection {
                point,
                param,
                distance,
            })
        }
        Geometry::Spline(curves, _) => {
            if curves.is_empty() {
                return None;
            }
            let (_, d, point) = spline::project(curves, pt);
            (d < max).then_some(Projection {
                point,
                distance: d,
                param: 0.0,
            })
        }
        Geometry::Circle(c, r) | Geometry::Arc(c, r, ..) => {
            let delta = pt - *c;
            let len = norm(delta);
            let d = (len - r).abs();
            if d >= max {
                return None;
            }
            let point = if let Geometry::Arc(_, _, a, b, cw) = g {
                let begin = c.angle_to(*a);
                let direction = if *cw { 1.0 } else { -1.0 };
                let angle = positive((c.angle_to(pt) - begin) * direction);
                let span = positive((c.angle_to(*b) - begin) * direction);
                if !in_span(
                    c.angle_to(pt),
                    begin,
                    c.angle_to(*b),
                    *cw,
                    tolerance / r.max(1.0),
                ) {
                    return None;
                }
                *c + Point2::from_polar(*r, begin + direction * angle.clamp(0.0, span))
            } else {
                *c + delta * (r / len.max(1e-6))
            };
            Some(Projection {
                point,
                distance: d,
                param: 0.0,
            })
        }
        Geometry::Ellipse(c, a, b) | Geometry::EllipticalArc(c, a, b, ..) => {
            let mut f = Ellipse::new(*c, *a, *b);
            if f.a < 1.0 || f.b < 1.0 {
                return None;
            }
            if matches!(g, Geometry::Ellipse(..)) {
                f.u = (*a - *c) * (1.0 / f.a);
                f.v = (*b - *c) * (1.0 / f.b);
            }
            let mut t = f.param(pt);
            if let Geometry::EllipticalArc(_, _, _, s, e, cw) = g {
                let begin = f.param(*s);
                let direction = if *cw { 1.0 } else { -1.0 };
                let span = positive((f.param(*e) - begin) * direction);
                let angle = positive((t - begin) * direction);
                let tol = tolerance / f.a.min(f.b).max(1.0);
                if !in_span(t, begin, f.param(*e), *cw, tol) {
                    return None;
                }
                t = begin
                    + direction
                        * if angle >= TAU - tol {
                            0.0
                        } else {
                            angle.clamp(0.0, span)
                        };
            }
            let point = f.point(t);
            let d = distance(pt, point);
            (d < max).then_some(Projection {
                point,
                distance: d,
                param: 0.0,
            })
        }
    }
}
pub fn closest(
    curves: &[Geometry],
    point: Point2,
    threshold: f64,
    snapping: bool,
    tolerance: f64,
) -> Option<(usize, Projection)> {
    let mut best = None;
    let mut max = threshold;
    for (i, c) in curves.iter().enumerate() {
        let candidate = if snapping {
            snap(c, point, max, tolerance)
        } else {
            hit_distance(c, point, max).map(|distance| Projection {
                point: p(0.0, 0.0),
                distance,
                param: 0.0,
            })
        };
        if let Some(q) = candidate {
            if q.distance < max {
                max = q.distance;
                best = Some((i, q));
            }
        }
    }
    best
}
pub fn segment_box(a: Point2, b: Point2, rect: Bounds) -> bool {
    if rect.contains(a) || rect.contains(b) {
        return true;
    }
    if a.x.max(b.x) < rect.min.x
        || a.x.min(b.x) > rect.max.x
        || a.y.max(b.y) < rect.min.y
        || a.y.min(b.y) > rect.max.y
    {
        return false;
    }
    let delta = b - a;
    let mut lo = 0.0_f64;
    let mut hi = 1.0_f64;
    for (p, q) in [-delta.x, delta.x, -delta.y, delta.y].iter().zip([
        a.x - rect.min.x,
        rect.max.x - a.x,
        a.y - rect.min.y,
        rect.max.y - a.y,
    ]) {
        if *p == 0.0 {
            if q < 0.0 {
                return false;
            }
        } else {
            let t = q / p;
            if *p < 0.0 {
                if t > hi {
                    return false;
                }
                lo = lo.max(t);
            } else {
                if t < lo {
                    return false;
                }
                hi = hi.min(t);
            }
        }
    }
    lo <= hi
}
pub fn intersects_box(g: &Geometry, rect: Bounds) -> bool {
    match g {
        Geometry::Segment(a, b) => segment_box(*a, *b, rect),
        Geometry::Circle(c, r) => {
            if rect.contains(*c) {
                return true;
            }
            let near = p(
                c.x.clamp(rect.min.x, rect.max.x),
                c.y.clamp(rect.min.y, rect.max.y),
            );
            if c.distance_squared(near) > r * r {
                return false;
            }
            let far = p(
                (c.x - rect.min.x).abs().max((c.x - rect.max.x).abs()),
                (c.y - rect.min.y).abs().max((c.y - rect.max.y).abs()),
            );
            far.length_squared() >= r * r
        }
        Geometry::Arc(c, r, a, b, cw) => {
            if rect.contains(*a) || rect.contains(*b) || rect.contains(*c) {
                return true;
            }
            let begin = c.angle_to(*a);
            let direction = if *cw { 1.0 } else { -1.0 };
            let span = positive((c.angle_to(*b) - begin) * direction);
            let mut prev = *a;
            for i in 1..=32 {
                let q = *c + Point2::from_polar(*r, begin + direction * (i as f64 / 32.0) * span);
                if rect.contains(q) || segment_box(prev, q, rect) {
                    return true;
                }
                prev = q;
            }
            false
        }
        Geometry::Ellipse(c, a, b) | Geometry::EllipticalArc(c, a, b, ..) => {
            if rect.contains(*c) {
                return true;
            }
            let f = Ellipse::new(*c, *a, *b);
            let (begin, span, direction, mut prev) =
                if let Geometry::EllipticalArc(_, _, _, s, e, cw) = g {
                    if rect.contains(*s) || rect.contains(*e) {
                        return true;
                    }
                    let begin = f.param(*s);
                    let direction = if *cw { 1.0 } else { -1.0 };
                    (
                        begin,
                        positive((f.param(*e) - begin) * direction),
                        direction,
                        *s,
                    )
                } else {
                    if rect.contains(*a) || rect.contains(*b) {
                        return true;
                    }
                    (0.0, TAU, 1.0, p(c.x + f.a * f.u.x, c.y + f.a * f.u.y))
                };
            if f.a < 0.01 || f.b < 0.01 {
                return false;
            }
            for i in 1..=36 {
                let t = if matches!(g, Geometry::Ellipse(..)) {
                    (i as f64 / 36.0) * TAU
                } else {
                    begin + direction * (i as f64 / 36.0) * span
                };
                let q = f.point(t);
                if rect.contains(q) || segment_box(prev, q, rect) {
                    return true;
                }
                prev = q;
            }
            false
        }
        Geometry::Spline(curves, _) => {
            if curves
                .iter()
                .any(|c| rect.contains(c[0]) || rect.contains(c[3]))
            {
                return true;
            }
            let corners = [
                rect.min,
                p(rect.max.x, rect.min.y),
                rect.max,
                p(rect.min.x, rect.max.y),
            ];
            corners.iter().enumerate().any(|(i, &a)| {
                curves.iter().any(|c| {
                    !crate::intersect(
                        Curve::Bezier { points: *c },
                        Curve::Segment {
                            p1: a,
                            p2: corners[(i + 1) % 4],
                        },
                    )
                    .is_empty()
                })
            })
        }
    }
}
pub fn contained(g: &Geometry, rect: Bounds) -> bool {
    bounds(g).is_none_or(|b| rect.contains(b.min) && rect.contains(b.max))
}
pub fn in_ring(pt: Point2, ring: &[Point2]) -> bool {
    let mut inside = false;
    if ring.is_empty() {
        return false;
    }
    let mut j = ring.len() - 1;
    for (i, a) in ring.iter().enumerate() {
        let b = ring[j];
        if (a.y > pt.y) != (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_use_cubic_extrema_and_world_arc_sweep() {
        let curve = Geometry::Spline(
            vec![[p(0.0, 0.0), p(0.0, 100.0), p(10.0, 100.0), p(10.0, 0.0)]],
            false,
        );
        let b = bounds(&curve).unwrap();
        assert_eq!(b.min, p(0.0, 0.0));
        assert_eq!(b.max, p(10.0, 75.0));
        let short = Geometry::Arc(p(0.0, 0.0), 10.0, p(10.0, 0.0), p(0.0, 10.0), false);
        assert_eq!(bounds(&short).unwrap().min, p(0.0, 0.0));
        let long = Geometry::Arc(p(0.0, 0.0), 10.0, p(10.0, 0.0), p(0.0, 10.0), true);
        assert_eq!(bounds(&long).unwrap().min, p(-10.0, -10.0));
        assert!(bounds(&Geometry::Spline(vec![], false)).is_none());
    }

    #[test]
    fn closest_shrinks_hit_threshold_but_keeps_snap_tolerance() {
        let point = Point2::from_polar(20.0, -0.1);
        let line = Geometry::Segment(point + p(-5.0, 1.0), point + p(5.0, 1.0));
        let arc = Geometry::Arc(p(0.0, 0.0), 20.0, p(20.0, 0.0), p(0.0, 20.0), true);
        let curves = vec![line.clone(), arc];
        assert_eq!(closest(&curves, point, 18.0, false, 18.0).unwrap().0, 0);
        assert_eq!(closest(&curves, point, 18.0, true, 18.0).unwrap().0, 1);
        assert_eq!(
            closest(&[line.clone(), line], point, 18.0, false, 18.0)
                .unwrap()
                .0,
            0
        );
        assert!(closest(&[], point, 18.0, false, 18.0).is_none());
    }

    #[test]
    fn box_queries_retain_perimeter_and_endpoint_rules() {
        let rect = Bounds {
            min: p(10.0, 10.0),
            max: p(20.0, 20.0),
        };
        assert!(intersects_box(
            &Geometry::Segment(p(0.0, 15.0), p(30.0, 15.0)),
            rect
        ));
        assert!(!intersects_box(&Geometry::Circle(p(0.0, 0.0), 100.0), rect));
        assert!(intersects_box(
            &Geometry::Circle(p(15.0, 15.0), 100.0),
            rect
        ));
        // An interior control point alone never selects an otherwise disjoint spline.
        let spline = Geometry::Spline(
            vec![[p(0.0, 0.0), p(15.0, 15.0), p(0.0, 0.0), p(0.0, 0.0)]],
            false,
        );
        assert!(!intersects_box(&spline, rect));
        assert!(!contained(
            &Geometry::Segment(p(0.0, 15.0), p(30.0, 15.0)),
            rect
        ));
    }

    #[test]
    fn ellipse_hit_and_snap_keep_separate_pixel_floors() {
        let e = Geometry::Ellipse(p(0.0, 0.0), p(0.5, 0.0), p(0.0, 0.3));
        assert_eq!(hit_distance(&e, p(0.5, 0.0), 18.0), Some(0.0));
        assert!(snap(&e, p(0.5, 0.0), 18.0, 18.0).is_none());
        let ring = [p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)];
        assert!(in_ring(p(0.0, 0.0), &ring));
        assert!(!in_ring(p(10.0, 10.0), &ring));
        assert!(!in_ring(p(0.0, 0.0), &[]));
    }
}
