//! Spline construction and projection, preserving the TypeScript reference arithmetic and tolerances.
use crate::{bezier, CubicBezier, Point2};

pub fn evaluate_bezier(curve: &CubicBezier, t: f64) -> Point2 {
    bezier::evaluate(curve, t)
}
pub fn derivative_bezier(curve: &CubicBezier, t: f64) -> Point2 {
    bezier::derivative(curve, t)
}
pub fn split_at(b: &CubicBezier, t: f64) -> [CubicBezier; 2] {
    let p01 = b[0].lerp(b[1], t);
    let p12 = b[1].lerp(b[2], t);
    let p23 = b[2].lerp(b[3], t);
    let p012 = p01.lerp(p12, t);
    let p123 = p12.lerp(p23, t);
    let middle = p012.lerp(p123, t);
    [[b[0], p01, p012, middle], [middle, p123, p23, b[3]]]
}

pub fn natural_handles(points: &[Point2]) -> Vec<[Point2; 2]> {
    if points.len() < 2 {
        return vec![];
    }
    let n = points.len() - 1;
    let closed = n >= 2 && points[n].distance(points[0]) < 1e-4;
    (0..=n)
        .map(|i| {
            let h = if n == 1 || (!closed && i == 0) {
                (points[1] - points[0]) * (1.0 / 3.0)
            } else if !closed && i == n {
                (points[n] - points[n - 1]) * (1.0 / 3.0)
            } else {
                let (prev, next) = if closed && (i == 0 || i == n) {
                    (points[n - 1], points[1])
                } else {
                    (points[i - 1], points[i + 1])
                };
                let dir = next - prev;
                let dir_length = dir.length();
                let (incoming, outgoing) = (points[i] - prev, next - points[i]);
                let (d1, d2) = (incoming.length(), outgoing.length());
                let mut handle_length = (d1 + d2) / 6.0;
                if d1 > 1e-6 && d2 > 1e-6 {
                    let cos = (incoming.dot(outgoing) / (d1 * d2)).clamp(-0.999, 1.0);
                    let factor = 1.0 / (3.0 * (1.0 + ((1.0 + cos) * 0.5).max(0.0).sqrt()));
                    handle_length = (d1 + d2) * factor;
                }
                if dir_length > 1e-6 {
                    (dir / dir_length) * handle_length
                } else {
                    dir * (1.0 / 6.0)
                }
            };
            [points[i] - h, points[i] + h]
        })
        .collect()
}

pub fn fit_to_bezier(points: &[Point2], handles: &[Option<[Point2; 2]>]) -> Vec<CubicBezier> {
    if points.len() < 2 {
        return vec![];
    }
    let natural = natural_handles(points);
    (0..points.len() - 1)
        .map(|i| {
            let start = handles.get(i).copied().flatten().unwrap_or(natural[i]);
            let end = handles
                .get(i + 1)
                .copied()
                .flatten()
                .unwrap_or(natural[i + 1]);
            [points[i], start[1], end[0], points[i + 1]]
        })
        .collect()
}

pub fn valid_knots(points: usize, knots: &[f64]) -> bool {
    knots.len() == points + 4
        && knots.iter().all(|v| v.is_finite())
        && knots.windows(2).all(|v| v[0] <= v[1])
        && knots[..4].iter().all(|&v| v == knots[0])
        && knots[knots.len() - 4..]
            .iter()
            .all(|&v| v == knots[knots.len() - 1])
        && knots[0] < knots[knots.len() - 1]
        && knots[4..knots.len() - 4]
            .iter()
            .all(|&v| v > knots[0] && v < knots[knots.len() - 1])
}

/// Explicit knots are either empty or a valid clamped nondecreasing cubic knot vector.
pub fn control_to_bezier(points: &[Point2], explicit: &[f64]) -> Vec<CubicBezier> {
    match points.len() {
        0 | 1 => return vec![],
        2 => {
            let delta = points[1] - points[0];
            return vec![[
                points[0],
                points[0] + delta * (1.0 / 3.0),
                points[1] - delta * (1.0 / 3.0),
                points[1],
            ]];
        }
        3 => {
            return vec![[
                points[0],
                points[0].lerp(points[1], 2.0 / 3.0),
                points[2].lerp(points[1], 2.0 / 3.0),
                points[2],
            ]]
        }
        4 => return vec![[points[0], points[1], points[2], points[3]]],
        _ => {}
    }
    let spans = points.len() - 3;
    let mut knots = if explicit.len() == points.len() + 4 {
        explicit.to_vec()
    } else {
        [
            vec![0.0; 4],
            (1..spans).map(|v| v as f64).collect(),
            vec![spans as f64; 4],
        ]
        .concat()
    };
    let mut internals = knots[4..knots.len() - 4].to_vec();
    internals.sort_by(f64::total_cmp);
    internals.dedup();
    let mut current = points.to_vec();
    for u in internals {
        let mut multiplicity = knots.iter().filter(|&&v| (v - u).abs() < 1e-7).count();
        while multiplicity < 3 {
            let mut k = 0;
            while k < knots.len() - 1 && knots[k + 1] <= u {
                k += 1;
            }
            let mut next = current[..=k - 3].to_vec();
            for i in k - 2..=k {
                let denominator = knots[i + 3] - knots[i];
                let alpha = if denominator == 0.0 {
                    0.0
                } else {
                    (u - knots[i]) / denominator
                };
                next.push(current[i - 1] * (1.0 - alpha) + current[i] * alpha);
            }
            next.extend_from_slice(&current[k..]);
            knots.insert(k + 1, u);
            current = next;
            multiplicity += 1;
        }
    }
    (0..(current.len() - 1) / 3)
        .map(|i| {
            [
                current[i * 3],
                current[i * 3 + 1],
                current[i * 3 + 2],
                current[i * 3 + 3],
            ]
        })
        .collect()
}

pub fn point_at(segments: &[CubicBezier], param: f64) -> Point2 {
    if segments.is_empty() {
        return Point2::ZERO;
    }
    let value = param.clamp(0.0, 1.0) * segments.len() as f64;
    let index = (value.floor() as usize).min(segments.len() - 1);
    bezier::evaluate(&segments[index], value - index as f64)
}
pub fn tangent_at(segments: &[CubicBezier], param: f64) -> Point2 {
    if segments.is_empty() {
        return Point2::UNIT_X;
    }
    let value = param.clamp(0.0, 1.0) * segments.len() as f64;
    let index = (value.floor() as usize).min(segments.len() - 1);
    bezier::derivative(&segments[index], value - index as f64)
}

pub fn project(segments: &[CubicBezier], target: Point2) -> (f64, f64, Point2) {
    let (mut best_param, mut best_distance, mut best_point) = (0.0, f64::INFINITY, target);
    for (s, segment) in segments.iter().enumerate() {
        let (mut local_t, mut local_distance) = (0.0_f64, f64::INFINITY);
        for i in 0..=12 {
            let t = i as f64 / 12.0;
            let d = bezier::evaluate(segment, t).distance(target);
            if d < local_distance {
                local_distance = d;
                local_t = t;
            }
        }
        let (mut a, mut b) = (
            (local_t - 1.0 / 12.0).max(0.0),
            (local_t + 1.0 / 12.0).min(1.0),
        );
        for _ in 0..10 {
            let t1 = a + (b - a) * 0.382;
            let t2 = a + (b - a) * 0.618;
            let d1 = bezier::evaluate(segment, t1).distance(target);
            let d2 = bezier::evaluate(segment, t2).distance(target);
            if d1 < d2 {
                b = t2;
            } else {
                a = t1;
            }
        }
        let t = (a + b) * 0.5;
        let point = bezier::evaluate(segment, t);
        let d = point.distance(target);
        if d < best_distance {
            best_distance = d;
            best_param = (s as f64 + t) / segments.len() as f64;
            best_point = point;
        }
    }
    (best_param, best_distance, best_point)
}

pub fn signed_distance(segments: &[CubicBezier], target: Point2) -> f64 {
    if segments.is_empty() {
        return 0.0;
    }
    let (param, _, point) = project(segments, target);
    let tangent = tangent_at(segments, param);
    let normal = tangent.perp() / tangent.length().max(1e-7);
    (target - point).dot(normal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    #[test]
    fn splitting_at_arbitrary_parameters_preserves_the_curve() {
        let b = [p(0.0, 1.0), p(4.0, 9.0), p(12.0, -3.0), p(17.0, 5.0)];
        for t in [-0.25, 0.0, 0.37, 1.0, 1.25] {
            let [left, right] = split_at(&b, t);
            let middle = evaluate_bezier(&b, t);
            assert_eq!(left[0], b[0]);
            assert_eq!(right[3], b[3]);
            assert_eq!(left[3], right[0]);
            assert!(left[3].distance(middle) < 1e-12);
        }
    }
    #[test]
    fn natural_handles_preserve_endpoints_and_closed_seam() {
        assert_eq!(
            natural_handles(&[p(0.0, 0.0), p(9.0, 3.0)]),
            vec![[p(-3.0, -1.0), p(3.0, 1.0)], [p(6.0, 2.0), p(12.0, 4.0)]]
        );
        let closed = [p(0.0, 0.0), p(5.0, 10.0), p(11.0, 0.0), p(0.0, 0.0)];
        let handles = natural_handles(&closed);
        assert_eq!(handles[0], handles[3]);
        for (point, handles) in closed.iter().zip(handles) {
            assert!(handles[0].middle(handles[1]).distance(*point) < 1e-12);
        }
    }
    #[test]
    fn nonuniform_control_knots_produce_connected_cubics() {
        let points = [
            p(0.0, 0.0),
            p(3.0, 9.0),
            p(9.0, 15.0),
            p(19.0, 1.0),
            p(24.0, 8.0),
            p(32.0, -4.0),
        ];
        let knots = [0.0, 0.0, 0.0, 0.0, 0.2, 0.8, 1.0, 1.0, 1.0, 1.0];
        assert!(valid_knots(points.len(), &knots));
        let segments = control_to_bezier(&points, &knots);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0][0], points[0]);
        assert_eq!(segments[2][3], points[5]);
        assert_eq!(segments[0][3], segments[1][0]);
        assert_eq!(segments[1][3], segments[2][0]);
    }
    #[test]
    fn projection_and_signed_normal_keep_reference_endpoint_behavior() {
        let segments = control_to_bezier(&[p(0.0, 0.0), p(10.0, 0.0)], &[]);
        let (_, distance, point) = project(&segments, p(4.0, 3.0));
        assert!((point.x - 4.0).abs() < 0.01);
        assert!((distance - 3.0).abs() < 1e-5);
        assert_eq!(signed_distance(&segments, p(4.0, 3.0)), 3.0);
        assert_eq!(signed_distance(&segments, p(12.0, -3.0)), -3.0);
        let (param, distance, point) = project(&[], p(4.0, 3.0));
        assert_eq!((param, distance, point), (0.0, f64::INFINITY, p(4.0, 3.0)));
    }
}
