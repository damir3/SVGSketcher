//! Browser-independent geometry. Preserve existing editor tolerances during migration.

mod bezier;
pub mod chamfer;
pub mod constraints;
pub mod editing;
mod ellipse;
pub mod fillet;
mod matrix;
pub mod offset;
pub mod point;
pub mod regions;
pub mod solver;
pub mod spline;

pub use point::{
    add, add_scaled, angle, cross, distance, dot, middle, p, perp, polar, scale, step, sub, unit,
    Point2,
};

pub type CubicBezier = [Point2; 4];

#[derive(Clone, Copy, Debug)]
pub enum Curve {
    Segment {
        p1: Point2,
        p2: Point2,
    },
    Circle {
        center: Point2,
        radius: f64,
    },
    Ellipse {
        center: Point2,
        major_axis_point: Point2,
        minor_axis_point: Point2,
    },
    Bezier {
        points: CubicBezier,
    },
}

pub fn intersect(a: Curve, b: Curve) -> Vec<Point2> {
    match (a, b) {
        (Curve::Bezier { points }, other) | (other, Curve::Bezier { points }) => {
            bezier::intersect(points, other)
        }
        (Curve::Segment { p1: a1, p2: a2 }, Curve::Segment { p1: b1, p2: b2 }) => {
            segment_segment(a1, a2, b1, b2)
        }
        (Curve::Segment { p1, p2 }, Curve::Circle { center, radius })
        | (Curve::Circle { center, radius }, Curve::Segment { p1, p2 }) => {
            segment_circle(p1, p2, center, radius)
        }
        (
            Curve::Circle {
                center: a,
                radius: ar,
            },
            Curve::Circle {
                center: b,
                radius: br,
            },
        ) => circle_circle(a, ar, b, br),
        (Curve::Segment { p1, p2 }, e @ Curve::Ellipse { .. })
        | (e @ Curve::Ellipse { .. }, Curve::Segment { p1, p2 }) => {
            ellipse::segment_ellipse(p1, p2, e)
        }
        (a, b) => ellipse::conic_conic(a, b),
    }
}

fn segment_segment(a1: Point2, a2: Point2, b1: Point2, b2: Point2) -> Vec<Point2> {
    let d = a2 - a1;
    let e = b2 - b1;
    let det = d.cross(e);
    if det.abs() < 1e-10 {
        return vec![];
    }
    let w = b1 - a1;
    let t = w.cross(e) / det;
    let u = w.cross(d) / det;
    if !(-1e-5..=1.0 + 1e-5).contains(&t) || !(-1e-5..=1.0 + 1e-5).contains(&u) {
        return vec![];
    }
    vec![a1 + d * t.clamp(0.0, 1.0)]
}

fn segment_circle(p1: Point2, p2: Point2, center: Point2, radius: f64) -> Vec<Point2> {
    let d = p2 - p1;
    let w = p1 - center;
    let length_sq = d.length_squared();
    if length_sq < 1e-12 {
        return vec![];
    }
    let closest_t = -w.dot(d) / length_sq;
    let closest = p1 + d * closest_t;
    let distance = closest.distance(center);
    let tangent = (distance - radius).abs() <= 1e-5;
    if !tangent && distance > radius {
        return vec![];
    }
    let delta = if tangent {
        0.0
    } else {
        ((radius - distance) * (radius + distance) / length_sq).sqrt()
    };
    let candidates = [closest_t - delta, closest_t + delta];
    let mut points: Vec<Point2> = vec![];
    for t in &candidates[..if tangent { 1 } else { 2 }] {
        if (-1e-5..=1.0 + 1e-5).contains(t) {
            points.push(p1 + d * t.clamp(0.0, 1.0));
        }
    }
    points
}

fn circle_circle(a: Point2, ar: f64, b: Point2, br: f64) -> Vec<Point2> {
    let delta = b - a;
    let distance = delta.length();
    if distance < 1e-9 || distance > ar + br + 1e-5 || distance < (ar - br).abs() - 1e-5 {
        return vec![];
    }
    let along = (ar * ar - br * br + distance * distance) / (2.0 * distance);
    let height = (ar * ar - along * along).max(0.0).sqrt();
    let base = a + delta * (along / distance);
    if height < 1e-7 {
        return vec![base];
    }
    // Keep both candidates until the caller has applied arc-span filtering.
    let n = delta.perp() * (1.0 / distance);
    vec![base + n * height, base - n * height]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossing_and_disjoint_segments() {
        assert_eq!(
            segment_segment(p(0.0, 0.0), p(2.0, 2.0), p(0.0, 2.0), p(2.0, 0.0)),
            vec![p(1.0, 1.0)]
        );
        assert!(segment_segment(p(0.0, 0.0), p(1.0, 0.0), p(0.0, 1.0), p(1.0, 1.0)).is_empty());
        assert!(segment_segment(p(0.0, 0.0), p(0.0, 0.0), p(-1.0, 0.0), p(1.0, 0.0)).is_empty());
    }

    #[test]
    fn tangency_absorbs_solver_roundoff_at_all_segment_lengths() {
        for half_length in [1.0, 100.0, 10000.0] {
            for error in [-5e-6, -1e-6, 0.0, 1e-6, 5e-6] {
                let y = 25.0 + error;
                assert_eq!(
                    segment_circle(p(-half_length, y), p(half_length, y), p(0.0, 0.0), 25.0),
                    vec![p(0.0, y)]
                );
            }
        }
    }

    #[test]
    fn segment_circle_preserves_crossings_and_gaps() {
        assert_eq!(
            segment_circle(p(-2.0, 0.0), p(2.0, 0.0), p(0.0, 0.0), 1.0),
            vec![p(-1.0, 0.0), p(1.0, 0.0)]
        );
        assert!(segment_circle(p(-2.0, 1.001), p(2.0, 1.001), p(0.0, 0.0), 1.0).is_empty());
        assert!(segment_circle(p(0.0, 0.0), p(0.0, 0.0), p(0.0, 0.0), 1.0).is_empty());
    }

    #[test]
    fn circles_cover_tangent_nested_and_concentric_cases() {
        assert_eq!(
            circle_circle(p(0.0, 0.0), 1.0, p(2.0, 0.0), 1.0),
            vec![p(1.0, 0.0)]
        );
        assert!(circle_circle(p(0.0, 0.0), 3.0, p(1.0, 0.0), 1.0).is_empty());
        assert!(circle_circle(p(0.0, 0.0), 1.0, p(0.0, 0.0), 1.0).is_empty());
        let points = circle_circle(p(0.0, 0.0), 5.0, p(6.0, 0.0), 5.0);
        assert_eq!(points, vec![p(3.0, 4.0), p(3.0, -4.0)]);
    }
}
