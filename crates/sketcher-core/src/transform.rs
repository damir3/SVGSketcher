//! Similarity transforms over a complete batch of points, directions and scalar sizes.
use crate::Point2;

pub struct Input<'a> {
    pub center: Point2,
    pub translation: Point2,
    pub angle_degrees: f64,
    pub scale: f64,
    pub points: &'a [Point2],
    pub vectors: &'a [Point2],
    pub sizes: &'a [f64],
}
pub struct Output {
    pub points: Vec<Point2>,
    pub vectors: Vec<Point2>,
    pub sizes: Vec<f64>,
}
pub fn transform(input: Input<'_>) -> Result<Output, &'static str> {
    if ![input.center, input.translation]
        .into_iter()
        .chain(input.points.iter().copied())
        .chain(input.vectors.iter().copied())
        .all(|p| p.x.is_finite() && p.y.is_finite())
        || ![input.angle_degrees, input.scale]
            .into_iter()
            .chain(input.sizes.iter().copied())
            .all(f64::is_finite)
    {
        return Err("Non-finite transform input");
    }
    let angle = (input.angle_degrees % 360.0) * std::f64::consts::PI / 180.0;
    let rotate = |v: Point2| v.rotate_around(Point2::ZERO, angle);
    let origin = input.center + input.translation;
    Ok(Output {
        points: input
            .points
            .iter()
            .map(|&p| origin + rotate(p - input.center) * input.scale)
            .collect(),
        vectors: input.vectors.iter().map(|&v| rotate(v)).collect(),
        sizes: input.sizes.iter().map(|&s| s * input.scale).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transform_keeps_directions_independent_of_center_translation_and_scale() {
        let input = Input {
            center: Point2::new(2.0, 3.0),
            translation: Point2::new(7.0, -4.0),
            angle_degrees: 450.0,
            scale: 2.0,
            points: &[Point2::new(2.0, 3.0), Point2::new(3.0, 3.0)],
            vectors: &[Point2::UNIT_X],
            sizes: &[3.0],
        };
        let out = transform(input).unwrap();
        assert_eq!(out.points[0], Point2::new(9.0, -1.0));
        assert!((out.points[1] - Point2::new(9.0, 1.0)).length() < 1e-14);
        assert!((out.vectors[0] - Point2::UNIT_Y).length() < 1e-14);
        assert_eq!(out.sizes, vec![6.0]);
    }
    #[test]
    fn extreme_finite_inputs_keep_overflow_visible_for_editor_validation() {
        let out = transform(Input {
            center: Point2::ZERO,
            translation: Point2::ZERO,
            angle_degrees: 0.0,
            scale: 2.0,
            points: &[Point2::new(1e308, 0.0)],
            vectors: &[],
            sizes: &[1e308],
        })
        .unwrap();
        assert!(out.points[0].x.is_infinite());
        assert!(out.sizes[0].is_infinite());
    }
}
