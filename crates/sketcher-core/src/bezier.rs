use super::{cross, CubicBezier, Curve, Point2};

pub(crate) fn evaluate(b: &CubicBezier, t: f64) -> Point2 {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    let uuu = uu * u;
    let ttt = tt * t;
    b[0] * uuu + b[1] * (3.0 * uu * t) + b[2] * (3.0 * u * tt) + b[3] * ttt
}

pub(crate) fn derivative(b: &CubicBezier, t: f64) -> Point2 {
    let u = 1.0 - t;
    let c0 = 3.0 * u * u;
    let c1 = 6.0 * u * t;
    let c2 = 3.0 * t * t;
    (b[1] - b[0]) * c0 + (b[2] - b[1]) * c1 + (b[3] - b[2]) * c2
}

fn lerp(a: Point2, b: Point2, t: f64) -> Point2 {
    a.lerp(b, t)
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

const NEAR_ROOT_TOLERANCE: f64 = 1e-4;
const SEGMENT_PROJECTION_TOLERANCE: f64 = 1e-2;
const MAX_IMPLICIT_SUBDIV_DEPTH: usize = 24;
const MAX_IMPLICIT_SUBDIV_ITERS: usize = 4096;
const MAX_IMPLICIT_CANDIDATES: usize = 17;

struct ImplicitTask {
    coeffs: [f64; 7],
    t0: f64,
    t1: f64,
    depth: usize,
}

fn bernstein_degree3(b: &CubicBezier, f: &impl Fn(Point2) -> f64) -> [f64; 7] {
    [f(b[0]), f(b[1]), f(b[2]), f(b[3]), 0.0, 0.0, 0.0]
}

fn bernstein_degree6(d: [Point2; 4], offset: f64) -> [f64; 7] {
    let m = |i: usize, j: usize| d[i].dot(d[j]);
    [
        m(0, 0) - offset,
        m(0, 1) - offset,
        (2.0 * m(0, 2) + 3.0 * m(1, 1)) / 5.0 - offset,
        (m(0, 3) + 9.0 * m(1, 2)) / 10.0 - offset,
        (2.0 * m(1, 3) + 3.0 * m(2, 2)) / 5.0 - offset,
        m(2, 3) - offset,
        m(3, 3) - offset,
    ]
}

fn split_bernstein(c: &[f64; 7], degree: usize) -> ([f64; 7], [f64; 7]) {
    let mut left = [0.0; 7];
    let mut right = [0.0; 7];
    let mut work = *c;
    left[0] = work[0];
    right[degree] = work[degree];
    for r in 1..=degree {
        for i in 0..=(degree - r) {
            work[i] = 0.5 * (work[i] + work[i + 1]);
        }
        left[r] = work[0];
        right[degree - r] = work[degree - r];
    }
    (left, right)
}

fn sign_changes(c: &[f64]) -> usize {
    let mut changes = 0;
    let mut prev = 0i8;
    for &v in c {
        if v == 0.0 {
            continue;
        }
        let s = if v > 0.0 { 1 } else { -1 };
        if prev != 0 && s != prev {
            changes += 1;
        }
        prev = s;
    }
    changes
}

fn bisect_implicit_root(
    b: &CubicBezier,
    f: &impl Fn(Point2) -> f64,
    t_a: f64,
    t_b: f64,
    v_a: f64,
) -> f64 {
    let (mut low, mut high, mut f_low) = (t_a, t_b, v_a);
    for _ in 0..52 {
        let mid = 0.5 * (low + high);
        let f_mid = f(evaluate(b, mid));
        if f_mid == 0.0 || high - low < 1e-13 {
            return mid;
        }
        if f_low * f_mid <= 0.0 {
            high = mid;
        } else {
            low = mid;
            f_low = f_mid;
        }
    }
    0.5 * (low + high)
}

fn minimize_abs_implicit(
    b: &CubicBezier,
    f: &impl Fn(Point2) -> f64,
    t0: f64,
    t1: f64,
) -> (f64, f64) {
    let v0 = f(evaluate(b, t0));
    let v1 = f(evaluate(b, t1));
    if v0 == 0.0 && v1 != 0.0 {
        return (t0, 0.0);
    }
    if v1 == 0.0 && v0 != 0.0 {
        return (t1, 0.0);
    }
    let tm0 = 0.5 * (t0 + t1);
    if f(evaluate(b, tm0)) == 0.0 && v0 != 0.0 && v1 != 0.0 {
        return (tm0, 0.0);
    }

    const PHI: f64 = 0.618_033_988_749_894_9;
    let (mut a, mut hi) = (t0, t1);
    let mut x1 = hi - PHI * (hi - a);
    let mut x2 = a + PHI * (hi - a);
    let mut f1 = f(evaluate(b, x1)).abs();
    let mut f2 = f(evaluate(b, x2)).abs();
    for _ in 0..28 {
        if f1 < f2 {
            hi = x2;
            x2 = x1;
            f2 = f1;
            x1 = hi - PHI * (hi - a);
            f1 = f(evaluate(b, x1)).abs();
        } else {
            a = x1;
            x1 = x2;
            f1 = f2;
            x2 = a + PHI * (hi - a);
            f2 = f(evaluate(b, x2)).abs();
        }
    }
    let mut best_t = 0.5 * (a + hi);
    let mut best_v = f(evaluate(b, best_t));
    if v0.abs() < best_v.abs() {
        best_t = t0;
        best_v = v0;
    }
    if v1.abs() < best_v.abs() {
        best_t = t1;
        best_v = v1;
    }
    (best_t, best_v)
}

fn is_local_extremum_near_root(b: &CubicBezier, f: &impl Fn(Point2) -> f64, t: f64) -> bool {
    let v = f(evaluate(b, t));
    if v.abs() >= NEAR_ROOT_TOLERANCE {
        return false;
    }
    let h = 1e-7;
    let vl = if t > 0.0 {
        f(evaluate(b, (t - h).max(0.0)))
    } else {
        v
    };
    let vr = if t < 1.0 {
        f(evaluate(b, (t + h).min(1.0)))
    } else {
        v
    };
    vl * v >= 0.0 && vr * v >= 0.0 && vl.abs() >= v.abs() && vr.abs() >= v.abs()
}

fn implicit_roots(
    b: &CubicBezier,
    coeffs: [f64; 7],
    degree: usize,
    g_low: f64,
    g_high: f64,
    f: impl Fn(Point2) -> f64,
) -> Vec<Point2> {
    let flat_eps = 1e-12 * (g_high / NEAR_ROOT_TOLERANCE).max(1.0);
    let mut roots = Vec::new();
    let mut stack = Vec::with_capacity(64);
    stack.push(ImplicitTask {
        coeffs,
        t0: 0.0,
        t1: 1.0,
        depth: 0,
    });
    let mut iters = 0;

    while let Some(task) = stack.pop() {
        if iters >= MAX_IMPLICIT_SUBDIV_ITERS {
            break;
        }
        iters += 1;

        let slice = &task.coeffs[..=degree];
        let mut min_c = slice[0];
        let mut max_c = slice[0];
        for &v in &slice[1..] {
            if v < min_c {
                min_c = v;
            }
            if v > max_c {
                max_c = v;
            }
        }
        if min_c > g_high || max_c < g_low {
            continue;
        }

        // Skip interior flood when the whole cubic coincides with the target; endpoints are checked separately.
        if task.depth == 0 && max_c <= flat_eps && min_c >= -flat_eps {
            continue;
        }

        let c0 = slice[0];
        let c_last = slice[degree];
        if sign_changes(slice) == 1 && c0 * c_last < 0.0 {
            let v0 = f(evaluate(b, task.t0));
            roots.push(bisect_implicit_root(b, &f, task.t0, task.t1, v0));
            continue;
        }

        let mut non_inc = true;
        let mut non_dec = true;
        for i in 0..degree {
            if slice[i + 1] > slice[i] {
                non_inc = false;
            }
            if slice[i + 1] < slice[i] {
                non_dec = false;
            }
        }
        if non_inc || non_dec {
            if (c0 > 0.0 && c_last > 0.0) || (c0 < 0.0 && c_last < 0.0) {
                if task.t0 > 0.0 && is_local_extremum_near_root(b, &f, task.t0) {
                    roots.push(task.t0);
                }
                if task.t1 < 1.0 && is_local_extremum_near_root(b, &f, task.t1) {
                    roots.push(task.t1);
                }
                continue;
            }
            if c0 == 0.0 && c_last != 0.0 {
                roots.push(task.t0);
                continue;
            }
            if c_last == 0.0 && c0 != 0.0 {
                roots.push(task.t1);
                continue;
            }
        }

        if task.depth >= MAX_IMPLICIT_SUBDIV_DEPTH || task.t1 - task.t0 < 1e-7 {
            let (t, v) = minimize_abs_implicit(b, &f, task.t0, task.t1);
            if v.abs() < NEAR_ROOT_TOLERANCE {
                roots.push(t);
            }
            continue;
        }

        let (left, right) = split_bernstein(&task.coeffs, degree);
        let tm = 0.5 * (task.t0 + task.t1);
        // Push right first so left is popped first, keeping roots in ascending parameter order.
        stack.push(ImplicitTask {
            coeffs: right,
            t0: tm,
            t1: task.t1,
            depth: task.depth + 1,
        });
        stack.push(ImplicitTask {
            coeffs: left,
            t0: task.t0,
            t1: tm,
            depth: task.depth + 1,
        });
    }

    let root_points: Vec<Point2> = roots.into_iter().map(|t| evaluate(b, t)).collect();
    let has_close_root = |p: Point2| {
        root_points
            .iter()
            .any(|rp| rp.distance(p) < NEAR_ROOT_TOLERANCE)
    };

    let include_start = f(b[0]).abs() < NEAR_ROOT_TOLERANCE && !has_close_root(b[0]);
    let include_end = f(b[3]).abs() < NEAR_ROOT_TOLERANCE && !has_close_root(b[3]);

    let mut candidates = Vec::new();
    if include_start {
        candidates.push(b[0]);
    }
    candidates.extend(root_points);
    if include_end {
        candidates.push(b[3]);
    }

    let mut unique: Vec<Point2> = Vec::new();
    for p in candidates {
        if unique.len() >= MAX_IMPLICIT_CANDIDATES {
            break;
        }
        if !unique.iter().any(|u| u.distance(p) < NEAR_ROOT_TOLERANCE) {
            unique.push(p);
        }
    }
    unique
}

pub(super) fn intersect(b: CubicBezier, other: Curve) -> Vec<Point2> {
    match other {
        Curve::Bezier { points } => intersect_beziers(b, points),
        Curve::Segment { p1, p2 } => {
            let d = p2 - p1;
            let n = d.perp();
            let length = n.length();
            if length < 1e-12 {
                return vec![];
            }
            let length_sq = d.length_squared();
            let f = |p: Point2| (p - p1).dot(n) / length;
            let coeffs = bernstein_degree3(&b, &f);
            implicit_roots(&b, coeffs, 3, -NEAR_ROOT_TOLERANCE, NEAR_ROOT_TOLERANCE, f)
                .into_iter()
                .filter(|p| {
                    let t = if length_sq < 1e-12 {
                        0.0
                    } else {
                        ((*p - p1).dot(d) / length_sq).clamp(0.0, 1.0)
                    };
                    let projected = p1 + d * t;
                    projected.distance(*p) < SEGMENT_PROJECTION_TOLERANCE
                        && (-1e-4..=1.0 + 1e-4).contains(&t)
                })
                .collect()
        }
        Curve::Circle { center, radius } => {
            if radius < 0.0 {
                return vec![];
            }
            let r_sq = radius * radius;
            let d = [b[0] - center, b[1] - center, b[2] - center, b[3] - center];
            let r_min = (radius - NEAR_ROOT_TOLERANCE).max(0.0);
            let r_max = radius + NEAR_ROOT_TOLERANCE;
            let g_low = r_min * r_min - r_sq;
            let g_high = r_max * r_max - r_sq;
            let coeffs = bernstein_degree6(d, r_sq);
            implicit_roots(&b, coeffs, 6, g_low, g_high, |p| {
                p.distance(center) - radius
            })
        }
        ellipse @ Curve::Ellipse { .. } => {
            let Some(frame) = super::ellipse::Frame::from_curve(ellipse) else {
                return vec![];
            };
            let normalized = [
                frame.normalized_world(b[0]),
                frame.normalized_world(b[1]),
                frame.normalized_world(b[2]),
                frame.normalized_world(b[3]),
            ];
            let coeffs = bernstein_degree6(normalized, 1.0);
            implicit_roots(
                &b,
                coeffs,
                6,
                -NEAR_ROOT_TOLERANCE,
                NEAR_ROOT_TOLERANCE,
                |p| frame.implicit_world(p),
            )
        }
    }
}

fn bounds(b: &CubicBezier) -> (Point2, Point2) {
    let (mut min, mut max) = (b[0], b[0]);
    for &p in &b[1..] {
        min = min.min(p);
        max = max.max(p);
    }
    (min, max)
}

pub(crate) fn intersect_beziers(b1: CubicBezier, b2: CubicBezier) -> Vec<Point2> {
    struct Task {
        seg1: CubicBezier,
        t0: f64,
        t1: f64,
        seg2: CubicBezier,
        u0: f64,
        u1: f64,
        depth: usize,
    }
    let mut hits: Vec<(Point2, f64)> = Vec::new();
    let record_hit = |hits: &mut Vec<(Point2, f64)>, point: Point2, residual: f64| {
        for hit in hits.iter_mut() {
            if hit.0.distance(point) < 1e-3 {
                if hit.1 > 1e-9 && residual < hit.1 {
                    *hit = (point, residual);
                }
                return;
            }
        }
        hits.push((point, residual));
    };
    for p1 in [b1[0], b1[3]] {
        for p2 in [b2[0], b2[3]] {
            let dist = p1.distance(p2);
            if dist < 1e-9 {
                record_hit(&mut hits, p1.middle(p2), dist);
            }
        }
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
    let mut pops = 0;
    while !stack.is_empty() && hits.len() < 16 && pops < 4096 {
        pops += 1;
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
                let f = p1 - p2;
                if f.length() < 1e-11 {
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
            let dist = p1.distance(p2);
            if dist < 1e-3 {
                record_hit(&mut hits, p1.middle(p2), dist);
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
    hits.into_iter().map(|(point, _)| point).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
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

    #[test]
    fn subdivision_finds_small_circle_and_triple_roots_inside_single_sixteenth() {
        let long_cubic = [p(0.0, 0.0), p(333.0, 0.02), p(666.0, -0.02), p(1000.0, 0.0)];
        let small_hits = intersect(
            long_cubic,
            Curve::Circle {
                center: p(317.123, 0.0),
                radius: 0.005,
            },
        );
        assert_eq!(small_hits.len(), 2);
        for hit in small_hits {
            assert!(((hit.x - 317.123).hypot(hit.y) - 0.005).abs() < 1e-10);
        }

        // y(t) = 1e4 * (t - 0.01)(t - 0.03)(t - 0.05) has all 3 roots inside [0, 1/16].
        let y0 = -0.000015 * 1e4;
        let y1 = (-0.000015 + 0.0023 / 3.0) * 1e4;
        let y2 = (-0.000015 + (2.0 * 0.0023) / 3.0 - 0.09 / 3.0) * 1e4;
        let y3 = (1.0 - 0.09 + 0.0023 - 0.000015) * 1e4;
        let triple_cubic = [p(0.0, y0), p(1.0 / 3.0, y1), p(2.0 / 3.0, y2), p(1.0, y3)];
        let triple_hits = intersect(
            triple_cubic,
            Curve::Segment {
                p1: p(-1.0, 0.0),
                p2: p(2.0, 0.0),
            },
        );
        assert_eq!(triple_hits.len(), 3);
        let expected_x = [0.01, 0.03, 0.05];
        for (hit, target_x) in triple_hits.iter().zip(expected_x) {
            assert!((hit.x - target_x).abs() < 1e-9);
            assert!(hit.y.abs() < 1e-8);
        }
    }

    #[test]
    fn nearly_tangent_shared_endpoint_returns_exact_endpoint() {
        let shared = p(49.61295834866398, -25.76020358468419);
        let b1 = [
            shared,
            p(42.44238510289348, -2.9859618798756253),
            p(9.583250450170045, 17.444397623456208),
            p(4.443064009924984e-19, 40.00009685405597),
        ];
        let b2 = [
            p(40.999982253826545, -56.49998319368469),
            p(51.06022153273804, -45.59769745530476),
            p(52.66908742069694, -35.46668336925695),
            shared,
        ];
        let hits = intersect_beziers(b1, b2);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].distance(shared) < 1e-9);
    }
}
