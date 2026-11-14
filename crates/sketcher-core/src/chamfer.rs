//! Chamfer corner preparation and the three distance/angle modes.
use crate::Point2;
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug)]
pub struct Corner {
    pub vertex: Point2,
    pub dir1: Point2,
    pub dir2: Point2,
    pub len1: f64,
    pub len2: f64,
    pub angle: f64,
}
pub fn corner(vertex: Point2, other1: Point2, other2: Point2) -> Option<Corner> {
    let v1 = other1 - vertex;
    let v2 = other2 - vertex;
    let len1 = v1.length();
    let len2 = v2.length();
    if len1 < 1e-4 || len2 < 1e-4 {
        return None;
    }
    let dir1 = v1 / len1;
    let dir2 = v2 / len2;
    let cos = dir1.dot(dir2).clamp(-1.0, 1.0);
    if cos.abs() > 0.9999 {
        return None;
    }
    Some(Corner {
        vertex,
        dir1,
        dir2,
        len1,
        len2,
        angle: cos.acos(),
    })
}
#[derive(Clone, Copy, Debug)]
pub enum Mode {
    EqualDistance,
    TwoDistance,
    DistanceAngle,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Error {
    None,
    ZeroAngle,
    LargeAngle,
    LargeDistance,
}
#[derive(Clone, Copy, Debug)]
pub struct Chamfer {
    pub t1: Point2,
    pub t2: Point2,
    pub dist1: f64,
    pub dist2: f64,
    pub angle: f64,
    pub length: f64,
    pub midpoint: Point2,
    pub bisector: Point2,
    pub max1: f64,
    pub max2: f64,
    pub error: Error,
}
pub fn calculate(
    c: Corner,
    mode: Mode,
    d1_input: f64,
    d2_input: f64,
    angle_input: f64,
    flip: bool,
) -> Chamfer {
    let max1 = (c.len1 - 0.1).max(0.1);
    let max2 = (c.len2 - 0.1).max(0.1);
    let mut error = Error::None;
    let (dist1, dist2, angle) = match mode {
        Mode::EqualDistance => {
            let d = d1_input.max(0.1);
            (d, d, ((PI - c.angle) / 2.0) * (180.0 / PI))
        }
        Mode::TwoDistance => {
            let d1 = d1_input.max(0.1);
            let d2 = d2_input.max(0.1);
            let (a, b) = if flip { (d2, d1) } else { (d1, d2) };
            let ab = (c.vertex + c.dir2 * b) - (c.vertex + c.dir1 * a);
            let norm = ab.length();
            let cos = (ab.dot(-c.dir1) / if norm == 0.0 { 1.0 } else { norm }).clamp(-1.0, 1.0);
            (a, b, cos.acos() * (180.0 / PI))
        }
        Mode::DistanceAngle => {
            let d = d1_input.max(0.1);
            let degrees = angle_input.clamp(0.0, 179.9);
            let alpha = (degrees * PI) / 180.0;
            if alpha <= 1e-4 {
                error = Error::ZeroAngle;
                (d, 0.0, degrees)
            } else if alpha + c.angle >= PI - 1e-4 {
                error = Error::LargeAngle;
                (d, d, degrees)
            } else {
                let sin_beta = (PI - c.angle - alpha).sin();
                let other = d * (alpha.sin() / sin_beta.max(1e-5));
                if flip {
                    (other, d, degrees)
                } else {
                    (d, other, degrees)
                }
            }
        }
    };
    if (dist1 > max1 || dist2 > max2) && error == Error::None {
        error = Error::LargeDistance;
    }
    let t1 = c.vertex + c.dir1 * dist1;
    let t2 = c.vertex + c.dir2 * dist2;
    let bisector = (c.dir1 + c.dir2).unit();
    Chamfer {
        t1,
        t2,
        dist1,
        dist2,
        angle,
        length: t1.distance(t2),
        midpoint: t1.middle(t2),
        bisector,
        max1,
        max2,
        error,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    #[test]
    fn orthogonal_chamfer_obeys_triangle_distances_and_flip() {
        let c = corner(p(0.0, 0.0), p(100.0, 0.0), p(0.0, 80.0)).unwrap();
        let equal = calculate(c, Mode::EqualDistance, 10.0, 0.0, 0.0, false);
        assert_eq!(equal.t1, p(10.0, 0.0));
        assert_eq!(equal.t2, p(0.0, 10.0));
        assert_eq!(equal.angle, 45.0);
        let angled = calculate(c, Mode::DistanceAngle, 10.0, 0.0, 30.0, false);
        assert!((angled.dist2 - 10.0 / 3.0_f64.sqrt()).abs() < 1e-12);
        let flipped = calculate(c, Mode::DistanceAngle, 10.0, 0.0, 30.0, true);
        assert_eq!(flipped.dist1, angled.dist2);
        assert_eq!(flipped.dist2, angled.dist1);
    }
    #[test]
    fn degenerate_corners_and_invalid_input_ranges_retain_error_priority() {
        assert!(corner(p(0.0, 0.0), p(0.0, 0.0), p(0.0, 10.0)).is_none());
        assert!(corner(p(0.0, 0.0), p(10.0, 0.0), p(-10.0, 0.0)).is_none());
        let c = corner(p(0.0, 0.0), p(10.0, 0.0), p(0.0, 10.0)).unwrap();
        assert_eq!(
            calculate(c, Mode::DistanceAngle, 100.0, 0.0, 0.0, true).error,
            Error::ZeroAngle
        );
        assert_eq!(
            calculate(c, Mode::DistanceAngle, 100.0, 0.0, 90.0, true).error,
            Error::LargeAngle
        );
        assert_eq!(
            calculate(c, Mode::TwoDistance, 10.0, 1.0, 0.0, false).error,
            Error::LargeDistance
        );
    }
}
