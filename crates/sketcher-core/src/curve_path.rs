//! Curve-distance tables and batched frames. Preserve textPathReference sampling and continuation.
use crate::{regions::Geometry, spline, Point2};
use std::f64::consts::{PI, TAU};

fn positive(t: f64) -> f64 {
    if t < 0.0 {
        t + TAU
    } else {
        t
    }
}
fn direction(c: &Geometry) -> f64 {
    match c {
        Geometry::Arc(_, _, _, _, false) | Geometry::EllipticalArc(_, _, _, _, _, false) => 1.0,
        _ => -1.0,
    }
}
struct Ellipse {
    c: Point2,
    rx: f64,
    ry: f64,
    u: Point2,
    v: Point2,
}
impl Ellipse {
    fn new(c: Point2, a: Point2, b: Point2) -> Self {
        let u = Point2::from_polar(1.0, c.angle_to(a));
        Self {
            c,
            rx: c.scaled_distance(a),
            ry: c.scaled_distance(b),
            u,
            v: u.perp(),
        }
    }
    fn point(&self, t: f64) -> Point2 {
        self.c + self.u * (self.rx * t.cos()) + self.v * (self.ry * t.sin())
    }
    fn param(&self, p: Point2, floor: bool) -> f64 {
        let d = p - self.c;
        let (rx, ry) = if floor {
            (self.rx.max(1e-6), self.ry.max(1e-6))
        } else {
            (self.rx, self.ry)
        };
        (d.dot(self.v) / ry).atan2(d.dot(self.u) / rx)
    }
}
fn ellipse(c: &Geometry, svg: bool) -> Ellipse {
    let (c, a, b) = match *c {
        Geometry::Ellipse(c, a, b) | Geometry::EllipticalArc(c, a, b, ..) => (c, a, b),
        _ => unreachable!(),
    };
    if svg {
        Ellipse::new(c.flip_y(), a.flip_y(), b.flip_y())
    } else {
        Ellipse::new(c, a, b)
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub point: Point2,
    pub tangent: Point2,
    pub normal: Point2,
}
fn fallback() -> Frame {
    Frame {
        point: Point2::ZERO,
        tangent: Point2::UNIT_X,
        normal: Point2::UNIT_Y,
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub t: f64,
    pub segment: usize,
    pub length: f64,
}
#[derive(Debug)]
pub struct PathMetrics {
    pub length: f64,
    pub period: f64,
    pub begin: f64,
    pub direction: f64,
    pub steps: Vec<Step>,
}

pub fn prepare(c: &Geometry) -> PathMetrics {
    let mut path = PathMetrics {
        length: 0.0,
        period: 0.0,
        begin: 0.0,
        direction: direction(c),
        steps: vec![],
    };
    match c {
        Geometry::Segment(a, b) => {
            path.length = a.scaled_distance(*b);
        }
        Geometry::Circle(center, r) | Geometry::Arc(center, r, ..) => {
            let mut span = TAU;
            path.begin = PI;
            if let Geometry::Arc(_, _, a, b, _) = c {
                path.begin = center.angle_to(*a);
                span = (path.direction * (center.angle_to(*b) - path.begin)) % TAU;
                if span <= 0.0 {
                    span += TAU;
                }
            }
            path.length = r * span;
            path.period = TAU * r;
        }
        Geometry::Ellipse(..) | Geometry::EllipticalArc(..) => {
            let f = ellipse(c, false);
            path.begin = PI;
            let mut span = TAU;
            if f.rx == 0.0 || f.ry == 0.0 {
                span = 0.0;
            } else if let Geometry::EllipticalArc(_, _, _, a, b, _) = c {
                path.begin = f.param(*a, false);
                span = positive((path.direction * (f.param(*b, false) - path.begin)) % TAU);
            }
            let mut angles: Vec<f64> = (0..=256).map(|i| (i as f64 * TAU) / 256.0).collect();
            let end = angles.iter().position(|t| *t >= span).unwrap();
            if angles[end] != span {
                angles.insert(end, span);
            }
            let mut prev = f.point(path.begin);
            let mut length = 0.0;
            path.steps.push(Step {
                t: 0.0,
                segment: 0,
                length: 0.0,
            });
            for &t in &angles[1..] {
                let q = f.point(path.begin + path.direction * t);
                length += prev.scaled_distance(q);
                path.steps.push(Step {
                    t,
                    segment: 0,
                    length,
                });
                prev = q;
            }
            path.length = path.steps[end].length;
            path.period = length;
        }
        Geometry::Spline(curves, _) => {
            let mut length = 0.0;
            for (segment, curve) in curves.iter().enumerate() {
                let mut prev = spline::evaluate_bezier(curve, 0.0);
                if segment == 0 {
                    path.steps.push(Step {
                        t: 0.0,
                        segment: 0,
                        length: 0.0,
                    });
                }
                for i in 1..=20 {
                    let t = i as f64 / 20.0;
                    let q = spline::evaluate_bezier(curve, t);
                    length += prev.scaled_distance(q);
                    path.steps.push(Step { t, segment, length });
                    prev = q;
                }
            }
            path.length = length;
            path.period = length;
        }
    }
    path
}
fn interval(steps: &[Step], distance: f64) -> (Step, Step) {
    let (mut lo, mut hi) = (0, steps.len() - 1);
    while hi - lo > 1 {
        let mid = (lo + hi) >> 1;
        if steps[mid].length <= distance {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (steps[lo], steps[hi])
}
pub fn sample(c: &Geometry, path: &PathMetrics, s: f64) -> Frame {
    match c {
        Geometry::Segment(a, b) => {
            let tangent = if path.length > 1e-9 {
                (*b - *a) / path.length
            } else {
                Point2::UNIT_X
            };
            Frame {
                point: *a + tangent * s.clamp(0.0, path.length),
                tangent,
                normal: tangent.perp(),
            }
        }
        Geometry::Circle(center, r) | Geometry::Arc(center, r, ..) => {
            let offset = if *r > 0.0 { (s % path.period) / r } else { 0.0 };
            let normal = Point2::from_polar(1.0, path.begin + path.direction * offset);
            Frame {
                point: *center + normal * *r,
                tangent: normal.perp() * path.direction,
                normal,
            }
        }
        Geometry::Ellipse(..) | Geometry::EllipticalArc(..) => {
            let f = ellipse(c, false);
            let remainder = if path.period > 0.0 {
                s % path.period
            } else {
                0.0
            };
            let distance = if remainder < 0.0 {
                remainder + path.period
            } else {
                remainder
            };
            let (a, b) = interval(&path.steps, distance);
            let span = b.length - a.length;
            let fraction = if span > 0.0 {
                (distance - a.length) / span
            } else {
                0.0
            };
            let t = path.begin + path.direction * (a.t + fraction * (b.t - a.t));
            let v = f.u * (-f.rx * t.sin()) + f.v * (f.ry * t.cos());
            let length = v.scaled_length();
            let forward = if length < 1e-12 {
                Point2::UNIT_X
            } else {
                v / length
            };
            Frame {
                point: f.point(t),
                tangent: forward * path.direction,
                normal: -forward.perp(),
            }
        }
        Geometry::Spline(curves, _) => {
            if curves.is_empty() {
                return fallback();
            }
            let (a, b) = interval(&path.steps, s.clamp(0.0, path.length));
            let span = b.length - a.length;
            let fraction = if span > 1e-9 {
                (s.clamp(0.0, path.length) - a.length) / span
            } else {
                0.0
            };
            let start = if a.segment == b.segment { a.t } else { 0.0 };
            let t = start + fraction * (b.t - start);
            let point = spline::evaluate_bezier(&curves[b.segment], t);
            let v = spline::derivative_bezier(&curves[b.segment], t);
            let length = v.scaled_length();
            let tangent = if length <= 1e-9 {
                Point2::UNIT_X
            } else {
                v / length
            };
            Frame {
                point,
                tangent,
                normal: tangent.perp(),
            }
        }
    }
}

/// Legacy general curve parameters use SVG angles, rather than the text path's distance frame.
pub fn point_at(c: &Geometry, t: f64) -> Point2 {
    match c {
        Geometry::EllipticalArc(_, _, _, a, b, cw) => {
            let f = ellipse(c, true);
            let start = f.param(a.flip_y(), false);
            let end = f.param(b.flip_y(), false);
            let span = positive(if *cw {
                (end - start) % TAU
            } else {
                (start - end) % TAU
            });
            let u = t.clamp(0.0, 1.0) * span;
            f.point(if *cw { start + u } else { start - u }).flip_y()
        }
        Geometry::Ellipse(..) => ellipse(c, true).point(t).flip_y(),
        _ => c.point(t),
    }
}
pub fn parameter_at(c: &Geometry, point: Point2) -> f64 {
    match c {
        Geometry::Ellipse(..) => positive(ellipse(c, true).param(point.flip_y(), true)),
        Geometry::EllipticalArc(_, _, _, a, b, cw) => {
            let f = ellipse(c, true);
            let start = f.param(a.flip_y(), true);
            let end = f.param(b.flip_y(), true);
            let span = positive(if *cw {
                (end - start) % TAU
            } else {
                (start - end) % TAU
            });
            let t = f.param(point.flip_y(), true);
            let delta = positive(if *cw {
                (t - start) % TAU
            } else {
                (start - t) % TAU
            });
            if span < 1e-6 {
                0.0
            } else {
                (delta / span).clamp(0.0, 1.0)
            }
        }
        _ => c.param(point),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    fn near(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }
    #[test]
    fn segment_clamps_but_circle_and_arc_continue_at_signed_distances() {
        let line = Geometry::Segment(p(0.0, 0.0), p(10.0, 0.0));
        let path = prepare(&line);
        assert_eq!(path.length, 10.0);
        assert_eq!(sample(&line, &path, -2.0).point, Point2::ZERO);
        assert_eq!(sample(&line, &path, 12.0).point, p(10.0, 0.0));
        let arc = Geometry::Arc(Point2::ZERO, 10.0, p(10.0, 0.0), p(0.0, 10.0), false);
        let path = prepare(&arc);
        near(path.length, 5.0 * PI);
        near(sample(&arc, &path, path.length).point.y, 10.0);
        near(sample(&arc, &path, 2.0 * path.length).point.x, -10.0);
        near(sample(&arc, &path, -path.length).point.y, -10.0);
        let circle = Geometry::Circle(Point2::ZERO, 10.0);
        let path = prepare(&circle);
        near(path.length, 20.0 * PI);
        near(sample(&circle, &path, 0.0).point.x, -10.0);
        near(sample(&circle, &path, 5.0 * PI).point.y, 10.0);
    }
    #[test]
    fn spline_length_table_tracks_distance_across_unequal_segments() {
        let curve = Geometry::Spline(
            vec![
                [
                    p(0.0, 0.0),
                    p(10.0 / 3.0, 0.0),
                    p(20.0 / 3.0, 0.0),
                    p(10.0, 0.0),
                ],
                [p(10.0, 0.0), p(20.0, 0.0), p(30.0, 0.0), p(40.0, 0.0)],
            ],
            false,
        );
        let path = prepare(&curve);
        near(path.length, 40.0);
        for distance in [0.0, 5.0, 10.0, 10.00001, 15.0, 39.0, 40.0] {
            let frame = sample(&curve, &path, distance);
            near(frame.point.x, distance);
            assert_eq!(frame.tangent, Point2::UNIT_X);
            assert_eq!(frame.normal, Point2::UNIT_Y);
        }
        let empty = Geometry::Spline(vec![], false);
        assert_eq!(prepare(&empty).length, 0.0);
        assert_eq!(sample(&empty, &prepare(&empty), 100.0).point, Point2::ZERO);
    }
    #[test]
    fn ellipse_arc_length_and_frames_cover_the_full_continuation() {
        let curve = Geometry::EllipticalArc(
            Point2::ZERO,
            p(10.0, 0.0),
            p(0.0, 5.0),
            p(10.0, 0.0),
            p(0.0, 5.0),
            false,
        );
        let path = prepare(&curve);
        near(path.length, path.period / 4.0);
        near(sample(&curve, &path, 0.0).point.x, 10.0);
        let end = sample(&curve, &path, path.length);
        near(end.point.y, 5.0);
        near(end.normal.y, 1.0);
        near(end.tangent.x, -1.0);
        near(
            sample(&curve, &path, path.period + path.length).point.y,
            5.0,
        );
        near(sample(&curve, &path, -path.length).point.y, -5.0);
    }
}
