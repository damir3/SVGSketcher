//! Geometry placement and ordered inference for converting a traced image into a sketch.
use crate::Point2;
use std::collections::HashSet;

pub struct Placement<'a> {
    pub image: [f64; 3],
    pub position: Point2,
    pub size: Point2,
    pub angle: f64,
    pub points: &'a [Point2],
    pub radii: &'a [f64],
    pub arcs: &'a [[usize; 3]],
}
pub fn place(input: Placement<'_>) -> Result<Vec<f64>, &'static str> {
    if input.image.iter().any(|&v| !v.is_finite() || v <= 0.0)
        || ![
            input.position.x,
            input.position.y,
            input.size.x,
            input.size.y,
            input.angle,
        ]
        .into_iter()
        .chain(input.radii.iter().copied())
        .all(f64::is_finite)
        || input
            .points
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
        || input
            .arcs
            .iter()
            .flatten()
            .any(|&i| i >= input.points.len())
    {
        return Err("Invalid trace placement");
    }
    let [width, height, y_scale] = input.image;
    let scale = input.size.x / width;
    let angle = input.angle * std::f64::consts::PI / 180.0;
    let points: Vec<_> = input
        .points
        .iter()
        .map(|p| {
            Point2::new(
                (p.x / width - 0.5) * input.size.x,
                (0.5 - p.y / y_scale / height) * input.size.y,
            )
            .rotate_around(Point2::ZERO, angle)
                + input.position
        })
        .collect();
    let mut result =
        Vec::with_capacity(1 + 2 * points.len() + input.radii.len() + input.arcs.len());
    result.push(scale);
    for p in &points {
        result.extend([p.x, p.y]);
    }
    result.extend(input.radii.iter().map(|&r| r * scale));
    for &[a, m, b] in input.arcs {
        result.push(f64::from(
            (points[m] - points[a]).cross(points[b] - points[m]) < 0.0,
        ));
    }
    Ok(result)
}

pub struct Radial {
    pub center: Option<Point2>,
    pub radius: f64,
}
pub struct Relations<'a> {
    pub lines: &'a [Option<[Point2; 2]>],
    pub radial: &'a [Radial],
    pub angle_tolerance: f64,
    pub tolerance: f64,
    pub scale: f64,
    pub flags: u8,
    pub rejected_perpendicular: &'a [(usize, usize)],
    pub rejected_concentric: &'a [(usize, usize)],
}
fn difference(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % 180.0;
    d.min(180.0 - d)
}
fn clusters(values: &[f64], indices: &[usize], tolerance: f64, relative: bool) -> Vec<Vec<usize>> {
    let mut sorted = indices.to_vec();
    sorted.sort_by(|&a, &b| {
        values[a]
            .partial_cmp(&values[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for i in sorted {
        if let Some(last) = groups.last_mut() {
            let first = values[last[0]];
            let tol = if relative {
                tolerance.max(first * 0.01)
            } else {
                tolerance
            };
            if values[i] - first <= tol {
                last.push(i);
                continue;
            }
        }
        groups.push(vec![i]);
    }
    groups.into_iter().filter(|v| v.len() > 1).collect()
}
fn stars(groups: Vec<Vec<usize>>) -> Vec<(usize, usize)> {
    groups
        .into_iter()
        .flat_map(|g| {
            let first = g[0];
            g.into_iter().skip(1).map(move |i| (first, i))
        })
        .collect()
}
pub fn relations(input: Relations<'_>) -> Result<Vec<f64>, &'static str> {
    let n = input.lines.len();
    let r = input.radial.len();
    let finite = |p: Point2| p.x.is_finite() && p.y.is_finite();
    if input.flags > 15
        || ![input.angle_tolerance, input.tolerance, input.scale]
            .into_iter()
            .all(f64::is_finite)
        || input.lines.iter().flatten().flatten().any(|&p| !finite(p))
        || input
            .radial
            .iter()
            .any(|v| !v.radius.is_finite() || v.center.is_some_and(|p| !finite(p)))
        || input
            .rejected_perpendicular
            .iter()
            .any(|&(a, b)| a >= n || b >= n || a == b)
        || input
            .rejected_concentric
            .iter()
            .any(|&(a, b)| a >= r || b >= r || a >= b)
    {
        return Err("Invalid trace relation input");
    }
    let angles: Vec<_> = input
        .lines
        .iter()
        .map(|line| {
            line.map_or(0.0, |[a, b]| {
                let angle = (b - a).y.atan2((b - a).x) * 180.0 / std::f64::consts::PI;
                ((angle % 180.0) + 180.0) % 180.0
            })
        })
        .collect();
    let mut axes = Vec::new();
    let mut axis = vec![false; n];
    if input.flags & 1 != 0 {
        for i in 0..n {
            if input.lines[i].is_none() {
                continue;
            }
            let vertical = if difference(angles[i], 0.0) <= input.angle_tolerance {
                Some(false)
            } else if difference(angles[i], 90.0) <= input.angle_tolerance {
                Some(true)
            } else {
                None
            };
            if let Some(v) = vertical {
                axes.push((i, usize::from(v)));
                axis[i] = true;
            }
        }
    }
    let mut parallel = Vec::new();
    let mut perpendicular = Vec::new();
    if input.flags & 2 != 0 {
        let free: Vec<_> = (0..n).filter(|&i| !axis[i]).collect();
        let mut groups = clusters(&angles, &free, input.angle_tolerance, false);
        if groups.len() > 1 {
            let first = groups[0][0];
            let last = *groups.last().unwrap().last().unwrap();
            if angles[first] + 180.0 - angles[last] <= input.angle_tolerance {
                let tail = groups.pop().unwrap();
                groups[0].extend(tail);
            }
        }
        parallel = stars(groups.clone());
        let mut in_cluster = vec![false; n];
        for g in &groups {
            for &i in g {
                in_cluster[i] = true;
            }
        }
        let mut representatives: Vec<_> = groups.iter().map(|g| g[0]).collect();
        representatives.extend(free.into_iter().filter(|&i| !in_cluster[i]));
        let rejected: HashSet<_> = input.rejected_perpendicular.iter().copied().collect();
        let mut linked = vec![false; n];
        for i in 0..representatives.len() {
            for j in i + 1..representatives.len() {
                let (a, b) = (representatives[i], representatives[j]);
                if difference(angles[a], angles[b] + 90.0) > input.angle_tolerance
                    || linked[a]
                    || linked[b]
                    || rejected.contains(&(a, b))
                {
                    continue;
                }
                perpendicular.push((a, b));
                linked[a] = true;
                linked[b] = true;
            }
        }
    }
    let tolerance = (input.tolerance * input.scale).max(1e-6);
    let mut equal_length = Vec::new();
    let mut equal_radius = Vec::new();
    if input.flags & 4 != 0 {
        let lengths: Vec<_> = input
            .lines
            .iter()
            .map(|line| line.map_or(0.0, |[a, b]| a.scaled_distance(b)))
            .collect();
        equal_length = stars(clusters(
            &lengths,
            &(0..n).collect::<Vec<_>>(),
            tolerance,
            true,
        ));
        let radii: Vec<_> = input.radial.iter().map(|v| v.radius).collect();
        equal_radius = stars(clusters(
            &radii,
            &(0..r).collect::<Vec<_>>(),
            tolerance,
            true,
        ));
    }
    let mut concentric = Vec::new();
    if input.flags & 8 != 0 {
        let rejected: HashSet<_> = input.rejected_concentric.iter().copied().collect();
        let mut used = vec![false; r];
        for i in 0..r {
            if used[i] {
                continue;
            }
            let Some(center) = input.radial[i].center else {
                continue;
            };
            for (j, item) in input.radial.iter().enumerate().skip(i + 1) {
                if used[j] || rejected.contains(&(i, j)) {
                    continue;
                }
                if let Some(other) = item.center {
                    if center.scaled_distance(other) <= tolerance * 2.0 {
                        concentric.push((i, j));
                        used[j] = true;
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for pairs in [
        axes,
        parallel,
        perpendicular,
        equal_length,
        equal_radius,
        concentric,
    ] {
        out.push(pairs.len() as f64);
        for (a, b) in pairs {
            out.extend([a as f64, b as f64]);
        }
    }
    Ok(out)
}
pub fn moved(
    original: &[Point2],
    current: &[Point2],
    threshold: f64,
) -> Result<Vec<f64>, &'static str> {
    if original.len() != current.len()
        || !threshold.is_finite()
        || original
            .iter()
            .chain(current)
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return Err("Invalid trace displacement input");
    }
    Ok(original
        .iter()
        .zip(current)
        .enumerate()
        .filter_map(|(i, (&a, &b))| (a.scaled_distance(b) > threshold).then_some(i as f64))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn placement_uses_image_y_scale_then_rotates_and_translates() {
        let points = [
            Point2::new(20.0, 20.0),
            Point2::new(40.0, 40.0),
            Point2::ZERO,
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 10.0),
        ];
        let out = place(Placement {
            image: [40.0, 20.0, 2.0],
            position: Point2::new(3.0, 4.0),
            size: Point2::new(80.0, 60.0),
            angle: 90.0,
            points: &points,
            radii: &[3.0],
            arcs: &[[2, 3, 4]],
        })
        .unwrap();
        assert_eq!(out[0], 2.0);
        assert_eq!(&out[1..3], &[3.0, 4.0]);
        assert!((out[3] - 33.0).abs() < 1e-12);
        assert!((out[4] - 44.0).abs() < 1e-12);
        assert_eq!(out[out.len() - 2], 6.0);
        assert_eq!(out[out.len() - 1], 1.0);
    }
    #[test]
    fn rejecting_a_perpendicular_candidate_keeps_the_next_link_available() {
        let lines: Vec<_> = [10.0_f64, 99.6, 100.4]
            .into_iter()
            .map(|a| Some([Point2::ZERO, Point2::from_polar(10.0, a.to_radians())]))
            .collect();
        let run = |rejected: &[(usize, usize)]| {
            relations(Relations {
                lines: &lines,
                radial: &[],
                angle_tolerance: 0.5,
                tolerance: 0.1,
                scale: 1.0,
                flags: 2,
                rejected_perpendicular: rejected,
                rejected_concentric: &[],
            })
            .unwrap()
        };
        assert_eq!(run(&[]), vec![0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0]);
        assert_eq!(run(&[(0, 1)]), vec![0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 0.0]);
    }
    #[test]
    fn displacement_uses_a_strict_threshold_and_scaled_lengths() {
        assert!(moved(&[Point2::ZERO], &[Point2::new(0.6, 0.8)], 1.0)
            .unwrap()
            .is_empty());
        assert_eq!(
            moved(&[Point2::ZERO], &[Point2::new(0.6, 0.80001)], 1.0).unwrap(),
            vec![0.0]
        );
        assert!(moved(&[Point2::ZERO], &[], 1.0).is_err());
        assert!(moved(&[], &[], f64::NAN).is_err());
    }
}
