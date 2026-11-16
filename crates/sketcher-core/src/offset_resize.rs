//! Exact subdivision to preserve existing offset fit-point IDs without altering the curve.
use crate::{spline, Point2};
pub const MAX_OFFSET_SPLINE_POINTS: usize = 1_000_000;

pub struct OffsetSpline {
    pub points: Vec<Point2>,
    pub normals: Vec<Point2>,
    pub handles: Vec<[Point2; 2]>,
    pub closed: bool,
}
pub struct ResizedOffsetSpline {
    pub geometry: OffsetSpline,
    pub bases: Vec<Point2>,
}

pub fn resize(
    mut geometry: OffsetSpline,
    count: usize,
    distance: f64,
) -> Result<ResizedOffsetSpline, &'static str> {
    let n = geometry.points.len();
    let finite = |p: &Point2| p.x.is_finite() && p.y.is_finite();
    if n < 2
        || geometry.normals.len() != n
        || geometry.handles.len() != n
        || count < n
        || count > MAX_OFFSET_SPLINE_POINTS
        || !distance.is_finite()
        || !geometry.points.iter().all(finite)
        || !geometry.normals.iter().all(finite)
        || !geometry.handles.iter().flatten().all(finite)
    {
        return Err("Invalid offset spline resize input");
    }
    while geometry.points.len() < count {
        let mut index = 0;
        let mut best = -1.0;
        for i in 0..geometry.points.len() - 1 {
            let length = geometry.points[i].scaled_distance(geometry.handles[i][1])
                + geometry.handles[i][1].scaled_distance(geometry.handles[i + 1][0])
                + geometry.handles[i + 1][0].scaled_distance(geometry.points[i + 1]);
            if length > best {
                best = length;
                index = i;
            }
        }
        let [left, right] = spline::split_at(
            &[
                geometry.points[index],
                geometry.handles[index][1],
                geometry.handles[index + 1][0],
                geometry.points[index + 1],
            ],
            0.5,
        );
        geometry.handles[index][1] = left[1];
        geometry.handles[index + 1][0] = right[2];
        geometry.points.insert(index + 1, left[3]);
        let normal = geometry.normals[index].lerp(geometry.normals[index + 1], 0.5);
        let length = normal.scaled_length();
        geometry.normals.insert(
            index + 1,
            if length < 1e-12 {
                Point2::UNIT_X
            } else {
                normal * (1.0 / length)
            },
        );
        geometry.handles.insert(index + 1, [left[2], right[1]]);
    }
    if geometry.closed {
        let last = geometry.handles.len() - 1;
        let seam = [geometry.handles[last][0], geometry.handles[0][1]];
        geometry.handles[0] = seam;
        geometry.handles[last] = seam;
    }
    let bases = geometry
        .points
        .iter()
        .zip(&geometry.normals)
        .map(|(&p, &n)| p + n * (-distance))
        .collect();
    Ok(ResizedOffsetSpline { geometry, bases })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    fn line() -> OffsetSpline {
        OffsetSpline {
            points: vec![p(0.0, 0.0), p(12.0, 0.0)],
            normals: vec![Point2::UNIT_Y; 2],
            handles: vec![[p(-4.0, 0.0), p(4.0, 0.0)], [p(8.0, 0.0), p(16.0, 0.0)]],
            closed: false,
        }
    }
    #[test]
    fn splits_longest_span_and_keeps_first_tie() {
        let result = resize(line(), 4, 2.0).unwrap();
        assert_eq!(
            result.geometry.points,
            vec![p(0.0, 0.0), p(3.0, 0.0), p(6.0, 0.0), p(12.0, 0.0)]
        );
        assert_eq!(
            result.bases,
            vec![p(0.0, -2.0), p(3.0, -2.0), p(6.0, -2.0), p(12.0, -2.0)]
        );
    }
    #[test]
    fn opposite_normals_use_unit_x_and_closed_handles_share_the_seam() {
        let mut geometry = line();
        geometry.normals[1] = -Point2::UNIT_Y;
        geometry.closed = true;
        let result = resize(geometry, 3, -2.0).unwrap();
        assert_eq!(result.geometry.normals[1], Point2::UNIT_X);
        assert_eq!(result.bases[1], p(8.0, 0.0));
        assert_eq!(result.geometry.handles[0], result.geometry.handles[2]);
    }
    #[test]
    fn rejects_inconsistent_metadata_and_unbounded_counts() {
        assert!(resize(line(), 1, 1.0).is_err());
        assert!(resize(line(), MAX_OFFSET_SPLINE_POINTS + 1, 1.0).is_err());
        let mut bad = line();
        bad.normals.pop();
        assert!(resize(bad, 3, 1.0).is_err());
    }
}
