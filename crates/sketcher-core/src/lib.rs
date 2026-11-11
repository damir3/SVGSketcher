//! Browser-independent geometry. Preserve existing editor tolerances during migration.

mod bezier;
pub mod constraints;
mod ellipse;
mod matrix;
pub mod solver;
pub mod spline;

pub type CubicBezier = [Point2; 4];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

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

fn offset(p: Point2, dx: f64, dy: f64, scale: f64) -> Point2 {
    Point2 {
        x: p.x + dx * scale,
        y: p.y + dy * scale,
    }
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
    let (dx, dy) = (a2.x - a1.x, a2.y - a1.y);
    let (ex, ey) = (b2.x - b1.x, b2.y - b1.y);
    let det = dx * ey - dy * ex;
    if det.abs() < 1e-10 {
        return vec![];
    }
    let (wx, wy) = (b1.x - a1.x, b1.y - a1.y);
    let t = (wx * ey - wy * ex) / det;
    let u = (wx * dy - wy * dx) / det;
    if !(-1e-5..=1.0 + 1e-5).contains(&t) || !(-1e-5..=1.0 + 1e-5).contains(&u) {
        return vec![];
    }
    vec![offset(a1, dx, dy, t.clamp(0.0, 1.0))]
}

fn segment_circle(p1: Point2, p2: Point2, center: Point2, radius: f64) -> Vec<Point2> {
    let (dx, dy) = (p2.x - p1.x, p2.y - p1.y);
    let (wx, wy) = (p1.x - center.x, p1.y - center.y);
    let length_sq = dx * dx + dy * dy;
    if length_sq < 1e-12 {
        return vec![];
    }
    let closest_t = -(wx * dx + wy * dy) / length_sq;
    let closest = offset(p1, dx, dy, closest_t);
    let distance = (closest.x - center.x).hypot(closest.y - center.y);
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
            let point = offset(p1, dx, dy, t.clamp(0.0, 1.0));
            points.push(point);
        }
    }
    points
}

fn circle_circle(a: Point2, ar: f64, b: Point2, br: f64) -> Vec<Point2> {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let distance = dx.hypot(dy);
    if distance < 1e-9 || distance > ar + br + 1e-5 || distance < (ar - br).abs() - 1e-5 {
        return vec![];
    }
    let along = (ar * ar - br * br + distance * distance) / (2.0 * distance);
    let height = (ar * ar - along * along).max(0.0).sqrt();
    let base = offset(a, dx, dy, along / distance);
    if height < 1e-7 {
        return vec![base];
    }
    // Keep both candidates until the caller has applied arc-span filtering.
    vec![
        offset(base, -dy * (1.0 / distance), dx * (1.0 / distance), height),
        offset(base, -dy * (1.0 / distance), dx * (1.0 / distance), -height),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point2 {
        Point2 { x, y }
    }

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
