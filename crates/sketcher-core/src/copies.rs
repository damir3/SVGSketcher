//! Ordered batches for mirror and pattern construction; document identity remains outside the kernel.
use crate::{
    constraints::{axis_offset, pattern_degrees},
    Point2,
};
pub const ARITIES: [usize; 6] = [4, 6, 10, 3, 2, 10];
pub const MAX_OUTPUT: usize = 16_000_000;
fn point(p: &[f64], at: usize) -> Point2 {
    Point2::new(p[at], p[at + 1])
}
fn flag(v: f64) -> bool {
    v == 0.0 || v == 1.0
}
pub fn query(points: &[Point2], operations: &[(usize, &[f64])]) -> Result<Vec<f64>, &'static str> {
    let stride = points
        .len()
        .checked_mul(3)
        .and_then(|n| n.checked_add(6))
        .ok_or("Copy result overflow")?;
    let count = stride
        .checked_mul(operations.len())
        .ok_or("Copy result overflow")?;
    if count > MAX_OUTPUT {
        return Err("Copy geometry batch too large");
    }
    if points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return Err("Non-finite copy point");
    }
    let mut out = Vec::with_capacity(count);
    for &(kind, p) in operations {
        if ARITIES.get(kind) != Some(&p.len()) || p.iter().any(|v| !v.is_finite()) {
            return Err("Invalid copy operation");
        }
        let mut valid = true;
        let mut angle = 0.0;
        let mut offset = Point2::ZERO;
        let mut normal = Point2::ZERO;
        match kind {
            0 => {
                let direction = point(p, 2) - point(p, 0);
                let length = direction.scaled_length();
                valid = length >= 1e-6;
                if valid {
                    normal = direction.perp() * (1.0 / length);
                }
            }
            1 => {
                if ![0.0, 1.0, 2.0].contains(&p[3]) {
                    return Err("Invalid circular distribution");
                }
                angle = pattern_degrees(p[5], p[2], p[3], p[4]);
            }
            2 => {
                if !flag(p[6]) || !flag(p[7]) {
                    return Err("Invalid pattern direction");
                }
                offset = point(p, 0) * axis_offset(p[8], p[4], p[6])
                    + point(p, 2) * axis_offset(p[9], p[5], p[7]);
            }
            3 => angle = p[2],
            4 => offset = point(p, 0),
            5 => {
                if !flag(p[0]) || !flag(p[5]) {
                    return Err("Invalid direction presence");
                }
                let unit = |present: f64, a: Point2, b: Point2, fallback: Point2| {
                    let dir = b - a;
                    let len = dir.scaled_length();
                    if present == 1.0 && len > 1e-6 {
                        dir * (1.0 / len)
                    } else {
                        fallback
                    }
                };
                offset = unit(p[0], point(p, 1), point(p, 3), Point2::UNIT_X);
                normal = unit(p[5], point(p, 6), point(p, 8), offset.perp());
            }
            _ => unreachable!(),
        }
        out.extend([
            f64::from(valid),
            angle,
            offset.x,
            offset.y,
            normal.x,
            normal.y,
        ]);
        let radians = angle * std::f64::consts::PI / 180.0;
        for &v in points {
            let (mapped, near) = match kind {
                0 if valid => {
                    let distance = (v - point(p, 0)).dot(normal);
                    (v + normal * (-2.0 * distance), distance.abs() < 1e-3)
                }
                1 => (
                    v.rotate_around(point(p, 0), radians),
                    point(p, 0).scaled_distance(v) < 1e-3,
                ),
                3 => (v.rotate_around(point(p, 0), radians), false),
                2 | 4 => (v + offset, false),
                _ => (v, false),
            };
            out.extend([mapped.x, mapped.y, f64::from(near)]);
        }
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mirror_preserves_tangent_coordinates_and_strict_tolerance() {
        let points = [
            Point2::new(3.0, 4.0),
            Point2::new(1e-3, 2.0),
            Point2::new(0.999e-3, 2.0),
        ];
        let out = query(&points, &[(0, &[0.0, 0.0, 0.0, 10.0])]).unwrap();
        assert_eq!(&out[6..9], &[-3.0, 4.0, 0.0]);
        assert_eq!(out[11], 0.0);
        assert_eq!(out[14], 1.0);
    }
    #[test]
    fn rectangular_basis_and_symmetric_offsets_keep_order() {
        let out = query(
            &[Point2::new(2.0, 3.0)],
            &[(2, &[0.6, 0.8, -0.8, 0.6, 5.0, 7.0, 1.0, 1.0, 3.0, 2.0])],
        )
        .unwrap();
        assert!((out[6] - 13.6).abs() < 1e-12);
        assert!((out[7] - 6.8).abs() < 1e-12);
    }
    #[test]
    fn invalid_operations_and_extreme_counts_are_rejected() {
        assert!(query(&[], &[(1, &[0.0; 5])]).is_err());
        assert!(query(&[], &[(5, &[2.0; 10])]).is_err());
    }
}
