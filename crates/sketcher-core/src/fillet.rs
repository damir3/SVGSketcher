//! Fillet tangency and radius search. Keep the reference's branch order and tolerances.
use crate::{regions::Geometry, spline, Point2};
use std::f64::consts::{PI, TAU};

fn p(x: f64, y: f64) -> Point2 {
    Point2 { x, y }
}
fn sub(a: Point2, b: Point2) -> Point2 {
    p(a.x - b.x, a.y - b.y)
}
fn add_scaled(a: Point2, b: Point2, s: f64) -> Point2 {
    p(a.x + b.x * s, a.y + b.y * s)
}
fn scale(a: Point2, s: f64) -> Point2 {
    p(a.x * s, a.y * s)
}
fn dot(a: Point2, b: Point2) -> f64 {
    a.x * b.x + a.y * b.y
}
fn cross(a: Point2, b: Point2) -> f64 {
    a.x * b.y - a.y * b.x
}
fn distance(a: Point2, b: Point2) -> f64 {
    spline::length(sub(a, b))
}
fn unit(a: Point2) -> Point2 {
    let length = spline::length(a);
    if length < 1e-12 {
        p(1.0, 0.0)
    } else {
        scale(a, 1.0 / length)
    }
}
fn perp(a: Point2) -> Point2 {
    p(-a.y, a.x)
}
fn angle(c: Point2, a: Point2) -> f64 {
    (a.y - c.y).atan2(a.x - c.x)
}
fn positive(mut a: f64) -> f64 {
    a %= TAU;
    if a < 0.0 {
        a += TAU;
    }
    a
}

#[derive(Clone, Copy, Debug)]
pub struct Evaluation {
    pub point: Point2,
    pub tangent: Point2,
    pub normal: Point2,
}
pub fn evaluate(curve: &Geometry, t: f64) -> Evaluation {
    let (point, tangent) = match curve {
        Geometry::Segment(a, b) => (add_scaled(*a, sub(*b, *a), t), unit(sub(*b, *a))),
        Geometry::Arc(..) => {
            let point = curve.point(t);
            (point, unit(sub(curve.point(t + 1e-4), point)))
        }
        Geometry::Spline(segs, _) if !segs.is_empty() => {
            if (0.0..=1.0).contains(&t) {
                (
                    spline::point_at(segs, t),
                    unit(sub(
                        spline::point_at(segs, (t + 1e-4).min(1.0)),
                        spline::point_at(segs, (t - 1e-4).max(0.0)),
                    )),
                )
            } else if t < 0.0 {
                let d = unit(sub(segs[0][1], segs[0][0]));
                (add_scaled(segs[0][0], d, 100.0 * t), d)
            } else {
                let last = segs.last().unwrap();
                let d = unit(sub(last[3], last[2]));
                (add_scaled(last[3], d, 100.0 * (t - 1.0)), d)
            }
        }
        _ => (p(0.0, 0.0), p(1.0, 0.0)),
    };
    Evaluation {
        point,
        tangent,
        normal: perp(tangent),
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Projection {
    pub t: f64,
    pub point: Point2,
    pub dist: f64,
}
pub fn project(curve: &Geometry, target: Point2) -> Projection {
    match curve {
        Geometry::Segment(a, b) => {
            let delta = sub(*b, *a);
            let len_sq = dot(delta, delta);
            let t = if len_sq < 1e-12 {
                0.0
            } else {
                dot(sub(target, *a), delta) / len_sq
            };
            let point = if len_sq < 1e-12 {
                *a
            } else {
                add_scaled(*a, delta, t)
            };
            Projection {
                t,
                point,
                dist: distance(target, point),
            }
        }
        Geometry::Arc(c, r, a, b, cw) => {
            let sc = p(c.x, -c.y);
            let d = unit(sub(p(target.x, -target.y), sc));
            let sproj = add_scaled(sc, d, *r);
            let start = angle(sc, p(a.x, -a.y));
            let end = angle(sc, p(b.x, -b.y));
            let projected = angle(sc, sproj);
            let (sweep, cur) = if *cw {
                (positive(end - start), positive(projected - start))
            } else {
                (positive(start - end), positive(start - projected))
            };
            let point = p(sproj.x, -sproj.y);
            Projection {
                t: if sweep > 1e-6 { cur / sweep } else { 0.0 },
                point,
                dist: distance(target, point),
            }
        }
        Geometry::Spline(segs, _) => {
            let (t, dist, point) = spline::project(segs, target);
            if let (Some(first), Some(last)) = (segs.first(), segs.last()) {
                // Start extension deliberately wins when both outward rays are closer than the spline.
                for (origin, d, at_start) in [
                    (first[0], unit(sub(first[0], first[1])), true),
                    (last[3], unit(sub(last[3], last[2])), false),
                ] {
                    let along = dot(sub(target, origin), d);
                    if along > 0.0 {
                        let point = add_scaled(origin, d, along);
                        let ext_dist = distance(target, point);
                        if ext_dist < dist {
                            return Projection {
                                t: if at_start {
                                    -along / 100.0
                                } else {
                                    1.0 + along / 100.0
                                },
                                point,
                                dist: ext_dist,
                            };
                        }
                    }
                }
            }
            Projection { t, dist, point }
        }
        _ => Projection {
            t: 0.0,
            point: target,
            dist: 0.0,
        },
    }
}
fn intersect(a: Point2, d1: Point2, b: Point2, d2: Point2) -> Option<Point2> {
    let det = cross(d1, d2);
    if det.abs() < 1e-9 {
        None
    } else {
        Some(add_scaled(a, d1, cross(sub(b, a), d2) / det))
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub corner: Option<Point2>,
    pub click1: Point2,
    pub click2: Point2,
}
#[derive(Clone, Copy, Debug)]
pub struct Fillet {
    pub center: Point2,
    pub radius: f64,
    pub t1: Point2,
    pub t2: Point2,
    pub clockwise: bool,
    pub corner: Point2,
    pub mid_arc: Point2,
    pub bisector: Point2,
    pub param1: f64,
    pub param2: f64,
}
fn corner_direction(curve: &Geometry, v: Point2) -> Point2 {
    match curve {
        Geometry::Segment(a, b) => {
            if distance(v, *a) < distance(v, *b) {
                unit(sub(*b, *a))
            } else {
                unit(sub(*a, *b))
            }
        }
        Geometry::Arc(_, _, a, b, _) => unit(sub(
            evaluate(
                curve,
                if distance(v, *a) < distance(v, *b) {
                    0.01
                } else {
                    0.99
                },
            )
            .point,
            v,
        )),
        _ => {
            let start = evaluate(curve, 0.0);
            let end = evaluate(curve, 1.0);
            if distance(v, start.point) < distance(v, end.point) {
                start.tangent
            } else {
                scale(end.tangent, -1.0)
            }
        }
    }
}
fn corner(
    curve1: &Geometry,
    curve2: &Geometry,
    options: Options,
) -> Option<(Point2, Point2, Point2)> {
    if let Some(v) = options.corner {
        return Some((v, corner_direction(curve1, v), corner_direction(curve2, v)));
    }
    let c1 = options.click1;
    let c2 = options.click2;
    if let (Geometry::Segment(a, b), Geometry::Segment(c, d)) = (curve1, curve2) {
        let v = intersect(*a, unit(sub(*b, *a)), *c, unit(sub(*d, *c)))?;
        return Some((v, unit(sub(c1, v)), unit(sub(c2, v))));
    }
    let ev1 = [evaluate(curve1, 0.0), evaluate(curve1, 1.0)];
    let ev2 = [evaluate(curve2, 0.0), evaluate(curve2, 1.0)];
    let (mut min_dist, mut best1, mut best2) = (f64::INFINITY, 0, 0);
    for (i, a) in ev1.iter().enumerate() {
        for (j, b) in ev2.iter().enumerate() {
            let d = distance(a.point, b.point);
            if d < min_dist {
                min_dist = d;
                best1 = i;
                best2 = j;
            }
        }
    }
    let a = ev1[best1];
    let b = ev2[best2];
    let facing = intersect(a.point, a.tangent, b.point, b.tangent);
    let click1 = evaluate(curve1, project(curve1, c1).t);
    let click2 = evaluate(curve2, project(curve2, c2).t);
    let click = intersect(click1.point, click1.tangent, click2.point, click2.tangent);
    if let Some(v) = facing {
        Some((
            v,
            if best1 == 1 {
                scale(a.tangent, -1.0)
            } else {
                a.tangent
            },
            if best2 == 1 {
                scale(b.tangent, -1.0)
            } else {
                b.tangent
            },
        ))
    } else {
        let v = click.unwrap_or_else(|| {
            let a = project(curve1, c2).point;
            let b = project(curve2, c1).point;
            p((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
        });
        Some((v, unit(sub(c1, v)), unit(sub(c2, v))))
    }
}
fn side_normal(curve: &Geometry, corner: Point2, fallback_param: f64) -> Point2 {
    let start_distance = distance(evaluate(curve, 0.0).point, corner);
    let end_distance = distance(evaluate(curve, 1.0).point, corner);
    if start_distance.min(end_distance) < 1e-4 {
        // Anchor the offset side at the corner, before the span can turn across
        // the bisector. Sample arc ends just inside their clamped forward difference.
        let t = if start_distance < end_distance {
            0.0
        } else if matches!(curve, Geometry::Arc(..)) {
            1.0 - 1e-4
        } else {
            1.0
        };
        evaluate(curve, t).normal
    } else {
        evaluate(curve, fallback_param).normal
    }
}

struct Branch<'a> {
    curve1: &'a Geometry,
    curve2: &'a Geometry,
    v: Point2,
    dir1: Point2,
    dir2: Point2,
    bisector: Point2,
    half_angle: f64,
}
impl Branch<'_> {
    fn solve(&self, radius: f64) -> Option<(Point2, Point2, Point2)> {
        let Self {
            curve1,
            curve2,
            v,
            dir1,
            dir2,
            bisector,
            half_angle,
        } = *self;
        let r0 = radius.min(1.0);
        let mut t1 = project(curve1, add_scaled(v, dir1, r0 / half_angle.tan())).t;
        let endpoint = |curve: &Geometry| {
            let d0 = distance(evaluate(curve, 0.0).point, v);
            let d1 = distance(evaluate(curve, 1.0).point, v);
            (
                matches!(curve, Geometry::Spline(..)) && d0.min(d1) < 2.0,
                d0 < d1,
            )
        };
        let (endpoint1, start1) = endpoint(curve1);
        let (endpoint2, start2) = endpoint(curve2);
        let side = |normal: Point2, other: Point2| {
            let d = dot(normal, bisector);
            if (if d.abs() > 1e-4 {
                d
            } else {
                dot(normal, other)
            }) > 0.0
            {
                1.0
            } else {
                -1.0
            }
        };
        let ev = evaluate(curve1, t1);
        let n1 = perp(ev.tangent);
        let side1 = side(side_normal(curve1, v, t1), dir2);
        let center0 = add_scaled(ev.point, n1, r0 * side1);
        let side2 = side(side_normal(curve2, v, project(curve2, center0).t), dir1);
        let steps = if radius <= 5.0 {
            1.0
        } else {
            (radius / 5.0).ceil().max(2.0)
        };
        let (mut center, mut pt1, mut pt2) = (p(0.0, 0.0), p(0.0, 0.0), p(0.0, 0.0));
        let mut step = 1.0;
        while step <= steps {
            let r = radius * step / steps;
            let mut solved = false;
            for _ in 0..24 {
                let ev1 = evaluate(curve1, t1);
                pt1 = ev1.point;
                center = add_scaled(pt1, scale(perp(ev1.tangent), side1), r);
                let proj2 = project(curve2, center);
                pt2 = proj2.point;
                let n2 = scale(perp(evaluate(curve2, proj2.t).tangent), side2);
                let signed_dist = dot(sub(center, pt2), n2);
                let err = signed_dist - r;
                if dot(sub(center, v), bisector) <= 0.0
                    || dot(sub(pt1, v), dir1) < -1.0
                    || dot(sub(pt2, v), dir2) < -1.0
                {
                    break;
                }
                if endpoint1 && (if start1 { t1 > 0.6 } else { t1 < 0.4 }) {
                    break;
                }
                if endpoint2 && (if start2 { proj2.t > 0.6 } else { proj2.t < 0.4 }) {
                    break;
                }
                if err.abs() < 1e-3 {
                    solved = true;
                    break;
                }
                let next = evaluate(curve1, t1 + 1e-3);
                let center_next = add_scaled(next.point, scale(perp(next.tangent), side1), r);
                let proj_next = project(curve2, center_next);
                let n_next = scale(perp(evaluate(curve2, proj_next.t).tangent), side2);
                let deriv = (dot(sub(center_next, proj_next.point), n_next) - signed_dist) / 1e-3;
                if deriv.abs() < 1e-6 {
                    break;
                }
                t1 -= (err / deriv).clamp(-0.25, 0.25);
            }
            if !solved {
                return None;
            }
            step += 1.0;
        }
        Some((center, pt1, pt2))
    }
}
pub fn calculate(
    curve1: &Geometry,
    curve2: &Geometry,
    radius: f64,
    options: Options,
) -> Option<Fillet> {
    if radius <= 0.01 {
        return None;
    }
    let (v, u1, u2) = corner(curve1, curve2, options)?;
    let cos = dot(u1, u2);
    if !(-0.9999..=0.9999).contains(&cos) {
        return None;
    }
    let bisector = unit(p(u1.x + u2.x, u1.y + u2.y));
    let half_angle = cos.clamp(-1.0, 1.0).acos() * 0.5;
    if half_angle < 1e-3 || half_angle.sin() < 1e-4 {
        return None;
    }
    let (center, t1, t2) = if matches!(
        (curve1, curve2),
        (Geometry::Segment(..), Geometry::Segment(..))
    ) {
        let tangent = radius / half_angle.tan();
        (
            add_scaled(v, bisector, radius / half_angle.sin()),
            add_scaled(v, u1, tangent),
            add_scaled(v, u2, tangent),
        )
    } else {
        let branch = Branch {
            curve1,
            curve2,
            v,
            dir1: u1,
            dir2: u2,
            bisector,
            half_angle,
        };
        branch.solve(radius).or_else(|| {
            Branch {
                curve1: curve2,
                curve2: curve1,
                dir1: u2,
                dir2: u1,
                ..branch
            }
            .solve(radius)
            .map(|(c, a, b)| (c, b, a))
        })?
    };
    let clockwise = positive(-angle(center, t2) - (-angle(center, t1))) < PI;
    let d1 = sub(t1, center);
    let d2 = sub(t2, center);
    let mid_arc = add_scaled(center, unit(p(d1.x + d2.x, d1.y + d2.y)), radius);
    Some(Fillet {
        center,
        radius,
        t1,
        t2,
        clockwise,
        corner: v,
        mid_arc,
        bisector: unit(sub(mid_arc, center)),
        param1: project(curve1, t1).t,
        param2: project(curve2, t2).t,
    })
}
pub fn max_radius(
    curve1: &Geometry,
    curve2: &Geometry,
    options: Options,
    max: f64,
    min: f64,
) -> Option<f64> {
    calculate(curve1, curve2, min, options)?;
    if calculate(curve1, curve2, max, options).is_some() {
        return Some(max);
    }
    let (mut low, mut high) = (min, max);
    for _ in 0..10 {
        let mid = (low + high) * 0.5;
        if calculate(curve1, curve2, mid, options).is_some() {
            low = mid;
        } else {
            high = mid;
        }
    }
    let rounded = (low * 10.0).floor() / 10.0;
    Some(if rounded >= min { rounded } else { low })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(v: Point2) -> Options {
        Options {
            corner: Some(v),
            click1: p(0.0, 0.0),
            click2: p(0.0, 0.0),
        }
    }
    #[test]
    fn orthogonal_lines_produce_exact_tangent_circle_and_extend_parameters() {
        let a = Geometry::Segment(p(0.0, 0.0), p(10.0, 0.0));
        let b = Geometry::Segment(p(0.0, 0.0), p(0.0, 10.0));
        let r = calculate(&a, &b, 20.0, options(p(0.0, 0.0))).unwrap();
        assert!(distance(r.center, p(20.0, 20.0)) < 1e-12);
        assert!(distance(r.t1, p(20.0, 0.0)) < 1e-12);
        assert!(distance(r.t2, p(0.0, 20.0)) < 1e-12);
        assert!((r.param1 - 2.0).abs() < 1e-12 && (r.param2 - 2.0).abs() < 1e-12);
        assert_eq!(
            max_radius(&a, &b, options(p(0.0, 0.0)), 100.0, 0.1),
            Some(100.0)
        );
        assert!(calculate(&a, &a, 5.0, options(p(0.0, 0.0))).is_none());
    }
    #[test]
    fn curved_corner_stays_inside_and_rejects_radius_that_crosses_the_bowl() {
        let a = Geometry::Segment(p(-50.0, 0.0), p(50.0, 0.0));
        let b = Geometry::Spline(
            vec![[
                p(-50.0, 0.0),
                p(-50.0, -100.0),
                p(50.0, -100.0),
                p(50.0, 0.0),
            ]],
            false,
        );
        let opts = options(p(-50.0, 0.0));
        let r = calculate(&a, &b, 30.0, opts).unwrap();
        assert!(r.center.x > -50.0 && r.center.y < 0.0);
        assert!((distance(r.center, r.t1) - 30.0).abs() < 1e-3);
        assert!((distance(r.center, r.t2) - 30.0).abs() < 1e-3);
        assert!(calculate(&a, &b, 50.0, opts).is_none());
        let max = max_radius(&a, &b, opts, 100.0, 0.1).unwrap();
        assert!((36.5..=37.5).contains(&max));
    }
    #[test]
    fn arc_end_tangent_and_spline_extension_keep_reference_conventions() {
        let arc = Geometry::Arc(p(0.0, 0.0), 10.0, p(10.0, 0.0), p(0.0, 10.0), false);
        assert_eq!(evaluate(&arc, 1.0).tangent, p(1.0, 0.0));
        let spline = Geometry::Spline(
            vec![[p(0.0, 0.0), p(0.0, 10.0), p(10.0, 20.0), p(20.0, 20.0)]],
            false,
        );
        let r = evaluate(&spline, -0.25);
        assert_eq!(r.point, p(0.0, -25.0));
        let projected = project(&spline, p(3.0, -25.0));
        assert_eq!(projected.t, -0.25);
        assert_eq!(projected.point, r.point);
        assert_eq!(projected.dist, 3.0);
    }
}
