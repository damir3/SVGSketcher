//! Read-only residual checks and reference measurements, without Jacobian assembly.
use crate::constraints::Program;
use crate::Point2;

/// Decode one point at the packed-buffer boundary.
fn point(data: &[f64], offset: usize) -> Point2 {
    Point2::new(data[offset], data[offset + 1])
}

pub const ARITIES: [usize; 6] = [1, 5, 2, 10, 11, 12];

pub fn angle_valid(p: &[f64], s1: f64, s2: f64, sign: f64, target: f64) -> bool {
    let a = (point(p, 2) - point(p, 0)) * s1;
    let b = (point(p, 6) - point(p, 4)) * s2;
    let (la, lb) = (a.scaled_length(), b.scaled_length());
    if !la.is_finite() || !lb.is_finite() || la == 0.0 || lb == 0.0 {
        return false;
    }
    let angle = sign * target * std::f64::consts::PI / 180.0;
    let rotated = (a * (1.0 / la)).rotate(angle);
    let actual = b * (1.0 / lb);
    rotated.cross(actual).atan2(rotated.dot(actual)).abs() <= 1e-3
}

pub fn measure(kind: usize, p: &[f64]) -> Result<f64, &'static str> {
    if ARITIES.get(kind) != Some(&p.len()) || p.iter().any(|v| !v.is_finite()) {
        return Err("Invalid reference measurement");
    }
    Ok(match kind {
        0 => p[0],
        1 => {
            if ![0.0, 1.0, 2.0].contains(&p[4]) {
                return Err("Invalid distance orientation");
            }
            let delta = point(p, 2) - point(p, 0);
            match p[4] {
                1.0 => delta.x.abs(),
                2.0 => delta.y.abs(),
                _ => delta.scaled_length(),
            }
        }
        2 => (p[1] - p[0]).abs(),
        3 => {
            if p[8] <= 0.0 || ![0.0, 1.0].contains(&p[9]) {
                return Err("Invalid line length floor");
            }
            let query = if p[9] == 1.0 {
                point(p, 0).lerp(point(p, 2), 0.5)
            } else {
                point(p, 0)
            };
            let origin = point(p, 4);
            let direction = point(p, 6) - origin;
            (query - origin).cross(direction).abs() / direction.scaled_length().max(p[8])
        }
        4 => {
            if ![-1.0, 0.0, 1.0].contains(&p[10]) {
                return Err("Invalid arc direction");
            }
            let a = (point(p, 2) - point(p, 0)) * p[8];
            let b = (point(p, 6) - point(p, 4)) * p[9];
            let angle = a.cross(b).atan2(a.dot(b));
            if p[10] == 0.0 {
                angle.abs() * 180.0 / std::f64::consts::PI
            } else {
                let two_pi = 2.0 * std::f64::consts::PI;
                (((angle * p[10]) % two_pi + two_pi) % two_pi) * 180.0 / std::f64::consts::PI
            }
        }
        5 => f64::from(angle_valid(p, p[8], p[9], p[10], p[11])),
        _ => unreachable!(),
    })
}

pub fn inspect(
    data: &[f64],
    groups: &[usize],
    measurements: &[(usize, &[f64])],
) -> Result<Vec<f64>, &'static str> {
    let rows = groups
        .iter()
        .try_fold(0usize, |sum, &n| sum.checked_add(n))
        .ok_or("Inspection row overflow")?;
    // Bound allocations by supplied records; even the smallest record has more slots than rows.
    if rows > data.len() {
        return Err("Invalid inspection row count");
    }
    let program = Program::decode(data, 0, rows, rows)?;
    let (error, satisfied) = program.inspect(groups)?;
    let mut result = vec![error, f64::from(satisfied)];
    for &(kind, p) in measurements {
        result.push(measure(kind, p)?);
    }
    Ok(result)
}

pub fn max_errors(
    data: &[f64],
    groups: &[usize],
    weights: &[f64],
) -> Result<Vec<f64>, &'static str> {
    if groups.len() != weights.len() || weights.iter().any(|v| !v.is_finite()) {
        return Err("Invalid inspection weights");
    }
    let rows = groups
        .iter()
        .try_fold(0usize, |sum, &n| sum.checked_add(n))
        .ok_or("Inspection row overflow")?;
    if rows > data.len() {
        return Err("Invalid inspection row count");
    }
    Program::decode(data, 0, rows, rows)?.max_errors(groups, weights)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measurements_preserve_axes_midpoints_and_degenerate_floors() {
        assert_eq!(measure(1, &[0.0, 0.0, 3.0, 4.0, 0.0]), Ok(5.0));
        assert_eq!(measure(1, &[0.0, 0.0, 3.0, 4.0, 1.0]), Ok(3.0));
        assert_eq!(measure(1, &[0.0, 0.0, 3.0, 4.0, 2.0]), Ok(4.0));
        assert_eq!(measure(2, &[12.0, 5.0]), Ok(7.0));
        let mut data = [0.0, 2.0, 4.0, 6.0, 0.0, 0.0, 1.0, 0.0, 1e-7, 1.0];
        assert_eq!(measure(3, &data), Ok(4.0));
        data[9] = 0.0;
        assert_eq!(measure(3, &data), Ok(2.0));
        data[6] = 1e-10;
        assert!((measure(3, &data).unwrap() - 0.002).abs() < 1e-16);
        data[6] = 0.0;
        assert_eq!(measure(3, &data), Ok(0.0));
    }

    #[test]
    fn angles_retain_reflex_sweeps_and_do_not_accept_tiny_wrong_directions() {
        let mut p = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0];
        assert_eq!(measure(4, &p), Ok(90.0));
        p[10] = -1.0;
        assert_eq!(measure(4, &p), Ok(270.0));
        for scale in [1e-12, 1.0, 1e12] {
            let p = [0.0, 0.0, scale, 0.0, 0.0, 0.0, scale, 0.0];
            assert!(!angle_valid(&p, 1.0, 1.0, 1.0, 90.0));
            assert!(angle_valid(&p, 1.0, 1.0, 1.0, 0.0));
        }
        assert!(!angle_valid(&[0.0; 8], 1.0, 1.0, 1.0, 0.0));
    }

    #[test]
    fn extreme_distances_scale_without_squaring_and_keep_overflow() {
        assert!((measure(1, &[0.0, 0.0, 3e200, 4e200, 0.0]).unwrap() / 5e200 - 1.0).abs() < 1e-15);
        assert!(
            (measure(1, &[0.0, 0.0, 3e-200, 4e-200, 0.0]).unwrap() / 5e-200 - 1.0).abs() < 1e-15
        );
        assert_eq!(
            measure(1, &[-1e308, 0.0, 1e308, 0.0, 0.0]),
            Ok(f64::INFINITY)
        );
    }

    #[test]
    fn inspection_rejects_holes_splits_and_unbounded_allocations() {
        let data = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, -1.0, 3.0, -1.0, 4.0];
        assert_eq!(inspect(&data, &[0, 2, 0], &[]), Ok(vec![12.5, 1.0]));
        assert!(inspect(&data, &[1, 1], &[]).is_err());
        assert!(inspect(&[], &[1], &[]).is_err());
        assert!(inspect(&[], &[usize::MAX, 1], &[]).is_err());
    }
}
