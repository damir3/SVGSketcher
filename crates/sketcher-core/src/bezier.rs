use super::{CubicBezier, Curve, Point2};

pub(crate) fn evaluate(b: &CubicBezier, t: f64) -> Point2 {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    let uuu = uu * u;
    let ttt = tt * t;
    Point2 {
        x: b[0].x * uuu + b[1].x * (3.0 * uu * t) + b[2].x * (3.0 * u * tt) + b[3].x * ttt,
        y: b[0].y * uuu + b[1].y * (3.0 * uu * t) + b[2].y * (3.0 * u * tt) + b[3].y * ttt,
    }
}

pub(crate) fn derivative(b: &CubicBezier, t: f64) -> Point2 {
    let u = 1.0 - t;
    let c0 = 3.0 * u * u;
    let c1 = 6.0 * u * t;
    let c2 = 3.0 * t * t;
    Point2 {
        x: 0.0 + (b[1].x - b[0].x) * c0 + (b[2].x - b[1].x) * c1 + (b[3].x - b[2].x) * c2,
        y: 0.0 + (b[1].y - b[0].y) * c0 + (b[2].y - b[1].y) * c1 + (b[3].y - b[2].y) * c2,
    }
}

fn lerp(a: Point2, b: Point2, t: f64) -> Point2 {
    super::offset(a, b.x - a.x, b.y - a.y, t)
}

fn split(b: &CubicBezier) -> (CubicBezier, CubicBezier) {
    let p01 = lerp(b[0], b[1], 0.5);
    let p12 = lerp(b[1], b[2], 0.5);
    let p23 = lerp(b[2], b[3], 0.5);
    let p012 = lerp(p01, p12, 0.5);
    let p123 = lerp(p12, p23, 0.5);
    let middle = lerp(p012, p123, 0.5);
    ([b[0], p01, p012, middle], [middle, p123, p23, b[3]])
}

fn implicit_roots(b: &CubicBezier, f: impl Fn(Point2) -> f64) -> Vec<Point2> {
    const N: usize = 16;
    let values: Vec<f64> = (0..=N)
        .map(|i| f(evaluate(b, i as f64 / N as f64)))
        .collect();
    let mut roots = Vec::new();
    for i in 0..N {
        let (ta, tb) = (i as f64 / N as f64, (i + 1) as f64 / N as f64);
        let (va, vb) = (values[i], values[i + 1]);
        if va * vb <= 0.0 {
            let (mut low, mut high, mut f_low) = (ta, tb, va);
            for _ in 0..28 {
                let mid = (low + high) * 0.5;
                let f_mid = f(evaluate(b, mid));
                if f_mid.abs() < 1e-12 || high - low < 1e-10 {
                    low = mid;
                    break;
                }
                if f_low * f_mid <= 0.0 {
                    high = mid;
                } else {
                    low = mid;
                    f_low = f_mid;
                }
            }
            roots.push((low + high) * 0.5);
        } else if va.abs() < 1e-4
            && (i == 0 || va.abs() <= values[i - 1].abs())
            && va.abs() <= vb.abs()
        {
            roots.push(ta);
        }
    }
    let (last, previous) = (values[N], values[N - 1]);
    if last * previous > 0.0 && last.abs() < 1e-4 && last.abs() <= previous.abs() {
        roots.push(1.0);
    }
    roots.into_iter().map(|t| evaluate(b, t)).collect()
}

pub(super) fn intersect(b: CubicBezier, other: Curve) -> Vec<Point2> {
    match other {
        Curve::Bezier { points } => intersect_beziers(b, points),
        Curve::Segment { p1, p2 } => {
            let (a, coefficient_b) = (-(p2.y - p1.y), p2.x - p1.x);
            let c = -(a * p1.x + coefficient_b * p1.y);
            let length = a.hypot(coefficient_b);
            if length < 1e-12 {
                return vec![];
            }
            let (dx, dy) = (p2.x - p1.x, p2.y - p1.y);
            let length_sq = dx * dx + dy * dy;
            implicit_roots(&b, |p| (a * p.x + coefficient_b * p.y + c) / length)
                .into_iter()
                .filter(|p| {
                    let t = if length_sq < 1e-12 {
                        0.0
                    } else {
                        (((p.x - p1.x) * dx + (p.y - p1.y) * dy) / length_sq).clamp(0.0, 1.0)
                    };
                    let projected = super::offset(p1, dx, dy, t);
                    (projected.x - p.x).hypot(projected.y - p.y) < 1e-3
                        && (-1e-4..=1.0 + 1e-4).contains(&t)
                })
                .collect()
        }
        Curve::Circle { center, radius } => {
            implicit_roots(&b, |p| (p.x - center.x).hypot(p.y - center.y) - radius)
        }
        ellipse @ Curve::Ellipse { .. } => {
            let Some(frame) = super::ellipse::Frame::from_curve(ellipse) else {
                return vec![];
            };
            implicit_roots(&b, |p| frame.implicit_world(p))
        }
    }
}

fn bounds(b: &CubicBezier) -> (Point2, Point2) {
    let (mut min, mut max) = (b[0], b[0]);
    for p in &b[1..] {
        min.x = min.x.min(p.x);
        min.y = min.y.min(p.y);
        max.x = max.x.max(p.x);
        max.y = max.y.max(p.y);
    }
    (min, max)
}

fn cross(a: Point2, b: Point2) -> f64 {
    a.x * b.y - a.y * b.x
}

fn intersect_beziers(b1: CubicBezier, b2: CubicBezier) -> Vec<Point2> {
    struct Task {
        seg1: CubicBezier,
        t0: f64,
        t1: f64,
        seg2: CubicBezier,
        u0: f64,
        u1: f64,
        depth: usize,
    }
    let mut stack = vec![Task {
        seg1: b1,
        t0: 0.0,
        t1: 1.0,
        seg2: b2,
        u0: 0.0,
        u1: 1.0,
        depth: 0,
    }];
    let mut points = Vec::new();
    while !stack.is_empty() && points.len() < 16 {
        let Task {
            seg1,
            t0,
            t1,
            seg2,
            u0,
            u1,
            depth,
        } = stack.pop().unwrap();
        let (min1, max1) = bounds(&seg1);
        let (min2, max2) = bounds(&seg2);
        if max1.x < min2.x - 1e-4
            || min1.x > max2.x + 1e-4
            || max1.y < min2.y - 1e-4
            || min1.y > max2.y + 1e-4
        {
            continue;
        }
        let span1 = (max1.x - min1.x).max(max1.y - min1.y);
        let span2 = (max2.x - min2.x).max(max2.y - min2.y);
        if (span1 < 1e-4 && span2 < 1e-4) || depth >= 15 {
            let (mut t, mut u) = ((t0 + t1) * 0.5, (u0 + u1) * 0.5);
            for _ in 0..4 {
                let (p1, p2) = (evaluate(&b1, t), evaluate(&b2, u));
                let f = Point2 {
                    x: p1.x - p2.x,
                    y: p1.y - p2.y,
                };
                if f.x.hypot(f.y) < 1e-11 {
                    break;
                }
                let (d1, d2) = (derivative(&b1, t), derivative(&b2, u));
                let det = cross(d2, d1);
                if det.abs() < 1e-12 {
                    break;
                }
                let (dt, du) = (cross(d2, f) / det, cross(d1, f) / det);
                t = (t - dt).clamp(0.0, 1.0);
                u = (u - du).clamp(0.0, 1.0);
            }
            let (p1, p2) = (evaluate(&b1, t), evaluate(&b2, u));
            if (p1.x - p2.x).hypot(p1.y - p2.y) < 1e-3 {
                points.push(Point2 {
                    x: (p1.x + p2.x) * 0.5,
                    y: (p1.y + p2.y) * 0.5,
                });
            }
            continue;
        }
        let (split1, split2) = (span1 >= 1e-4, span2 >= 1e-4);
        if split1 && split2 {
            let (left1, right1) = split(&seg1);
            let (left2, right2) = split(&seg2);
            let (tm, um) = ((t0 + t1) * 0.5, (u0 + u1) * 0.5);
            stack.push(Task {
                seg1: left1,
                t0,
                t1: tm,
                seg2: left2,
                u0,
                u1: um,
                depth: depth + 1,
            });
            stack.push(Task {
                seg1: left1,
                t0,
                t1: tm,
                seg2: right2,
                u0: um,
                u1,
                depth: depth + 1,
            });
            stack.push(Task {
                seg1: right1,
                t0: tm,
                t1,
                seg2: left2,
                u0,
                u1: um,
                depth: depth + 1,
            });
            stack.push(Task {
                seg1: right1,
                t0: tm,
                t1,
                seg2: right2,
                u0: um,
                u1,
                depth: depth + 1,
            });
        } else if split1 {
            let (left, right) = split(&seg1);
            let tm = (t0 + t1) * 0.5;
            stack.push(Task {
                seg1: left,
                t0,
                t1: tm,
                seg2,
                u0,
                u1,
                depth: depth + 1,
            });
            stack.push(Task {
                seg1: right,
                t0: tm,
                t1,
                seg2,
                u0,
                u1,
                depth: depth + 1,
            });
        } else {
            let (left, right) = split(&seg2);
            let um = (u0 + u1) * 0.5;
            stack.push(Task {
                seg1,
                t0,
                t1,
                seg2: left,
                u0,
                u1: um,
                depth: depth + 1,
            });
            stack.push(Task {
                seg1,
                t0,
                t1,
                seg2: right,
                u0: um,
                u1,
                depth: depth + 1,
            });
        }
    }
    let mut unique: Vec<Point2> = Vec::new();
    for p in points {
        if !unique.iter().any(|u| (u.x - p.x).hypot(u.y - p.y) < 1e-3) {
            unique.push(p);
        }
    }
    unique
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> Point2 {
        Point2 { x, y }
    }
    fn line(a: Point2, b: Point2) -> CubicBezier {
        [a, lerp(a, b, 1.0 / 3.0), lerp(a, b, 2.0 / 3.0), b]
    }

    #[test]
    fn evaluation_and_subdivision_agree_at_the_shared_endpoint() {
        let b = [p(-2.0, 0.0), p(-1.0, 4.0), p(1.0, -4.0), p(2.0, 0.0)];
        let (left, right) = split(&b);
        assert_eq!(left[3], evaluate(&b, 0.5));
        assert_eq!(right[0], left[3]);
        assert_eq!(evaluate(&b, 0.0), b[0]);
        assert_eq!(evaluate(&b, 1.0), b[3]);
    }

    #[test]
    fn line_circle_and_finite_segment_intersections() {
        let b = line(p(-5.0, 0.0), p(5.0, 0.0));
        let hits = intersect(
            b,
            Curve::Circle {
                center: p(0.0, 0.0),
                radius: 2.0,
            },
        );
        assert_eq!(hits.len(), 2);
        for hit in hits {
            assert!((hit.x.abs() - 2.0).abs() < 1e-8);
            assert!(hit.y.abs() < 1e-8);
        }
        assert!(intersect(
            b,
            Curve::Segment {
                p1: p(0.0, 10.0),
                p2: p(0.0, 20.0)
            }
        )
        .is_empty());
    }

    #[test]
    fn final_near_root_sample_is_not_lost() {
        let b = line(p(-1.0, 1.0), p(1.0, 5e-5));
        let hits = intersect(
            b,
            Curve::Segment {
                p1: p(-2.0, 0.0),
                p2: p(2.0, 0.0),
            },
        );
        assert_eq!(hits, vec![b[3]]);
    }

    #[test]
    fn two_cubics_cross_and_disjoint_cubics_do_not() {
        let a = line(p(-5.0, 0.0), p(5.0, 0.0));
        let hits = intersect_beziers(a, line(p(0.0, -5.0), p(0.0, 5.0)));
        assert_eq!(hits.len(), 1);
        assert!(hits[0].x.hypot(hits[0].y) < 1e-8);
        assert!(intersect_beziers(a, line(p(-5.0, 2.0), p(5.0, 2.0))).is_empty());
    }
}
