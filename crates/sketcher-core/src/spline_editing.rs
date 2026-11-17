//! Complete spline cuts, including source provenance for the editor's shared Vec2 objects.
use crate::{spline::split_at, CubicBezier};

#[derive(Clone, Copy, Debug)]
pub struct Piece {
    pub curve: CubicBezier,
    pub source_index: usize,
    pub original_points: u8,
}
impl Piece {
    fn original(curve: CubicBezier, source_index: usize) -> Self {
        Self {
            curve,
            source_index,
            original_points: 15,
        }
    }
}

pub struct Interval {
    pub pieces: Vec<Piece>,
    pub reuse_source: bool,
}

/// Preserve the original trim thresholds and extrapolation of the single-cubic helper.
pub fn trim(curve: &CubicBezier, start: f64, end: f64) -> Piece {
    let mut piece = Piece::original(*curve, 0);
    if end < 1.0 - 1e-6 {
        piece.curve = split_at(&piece.curve, end)[0];
        piece.original_points = 1;
    }
    if start > 1e-6 {
        piece.curve = split_at(&piece.curve, (start / end.max(1e-6)).min(1.0))[1];
        piece.original_points &= 8;
    }
    piece
}

/// Even at an endpoint, retain both halves of the selected cubic, including its degenerate half.
pub fn split(segments: &[CubicBezier], param: f64) -> Option<(Vec<Piece>, Vec<Piece>)> {
    if segments.is_empty() {
        return None;
    }
    let value = param.clamp(0.0, 1.0) * segments.len() as f64;
    let index = (value.floor() as usize).min(segments.len() - 1);
    let [a, b] = split_at(&segments[index], value - index as f64);
    let mut left: Vec<_> = segments[..index]
        .iter()
        .enumerate()
        .map(|(i, b)| Piece::original(*b, i))
        .collect();
    left.push(Piece {
        curve: a,
        source_index: index,
        original_points: 1,
    });
    let mut right = vec![Piece {
        curve: b,
        source_index: index,
        original_points: 8,
    }];
    right.extend(
        segments
            .iter()
            .enumerate()
            .skip(index + 1)
            .map(|(i, b)| Piece::original(*b, i)),
    );
    Some((left, right))
}

fn forward(segments: &[CubicBezier], start: f64, end: f64) -> Interval {
    if (start - end).abs() < 1e-5 {
        return Interval {
            pieces: vec![],
            reuse_source: false,
        };
    }
    if start <= 1e-5 && end >= 1.0 - 1e-5 {
        return Interval {
            pieces: segments
                .iter()
                .enumerate()
                .map(|(i, b)| Piece::original(*b, i))
                .collect(),
            reuse_source: true,
        };
    }
    let count = segments.len() as f64;
    let mut pieces = vec![];
    for (i, curve) in segments.iter().enumerate() {
        let (a, b) = (i as f64 / count, (i + 1) as f64 / count);
        if b <= start + 1e-6 || a >= end - 1e-6 {
            continue;
        }
        let t0 = ((a.max(start) - a) * count).clamp(0.0, 1.0);
        let t1 = ((b.min(end) - a) * count).clamp(0.0, 1.0);
        if t1 - t0 < 1e-6 {
            continue;
        }
        pieces.push(Piece {
            source_index: i,
            ..trim(curve, t0, t1)
        });
    }
    Interval {
        pieces,
        reuse_source: false,
    }
}

/// Reversed intervals traverse the closed seam in tail-then-head order.
pub fn extract(segments: &[CubicBezier], start: f64, end: f64) -> Interval {
    if start > end && (start - end).abs() >= 1e-5 {
        let mut pieces = forward(segments, start, 1.0).pieces;
        pieces.extend(forward(segments, 0.0, end).pieces);
        Interval {
            pieces,
            reuse_source: false,
        }
    } else {
        forward(segments, start, end)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{p, spline::evaluate_bezier};

    fn curve() -> CubicBezier {
        [p(0.0, 1.0), p(4.0, 9.0), p(12.0, -3.0), p(17.0, 5.0)]
    }

    #[test]
    fn trimming_retains_the_exact_parameterized_cubic() {
        let b = curve();
        for (a, z) in [(0.0, 1.0), (0.2, 0.8), (0.0, 0.4), (0.3, 1.0)] {
            let result = trim(&b, a, z);
            for i in 0..=20 {
                let t = i as f64 / 20.0;
                assert!(
                    evaluate_bezier(&result.curve, t)
                        .distance(evaluate_bezier(&b, a + (z - a) * t))
                        < 1e-12
                );
            }
        }
        assert_eq!(trim(&b, 1e-6, 1.0 - 1e-6).original_points, 15);
        assert_eq!(trim(&b, 0.0, 0.4).original_points, 1);
        assert_eq!(trim(&b, 0.3, 1.0).original_points, 8);
        assert_eq!(trim(&b, 0.3, 0.7).original_points, 0);
    }

    #[test]
    fn splitting_keeps_boundary_halves_and_source_provenance() {
        let segments = [curve(), curve(), curve()];
        assert!(split(&[], 0.5).is_none());
        for t in [-1.0, 0.0, 1.0 / 3.0, 0.5, 1.0, 2.0] {
            let (left, right) = split(&segments, t).unwrap();
            assert_eq!(left.len() + right.len(), segments.len() + 1);
            let cut = left.last().unwrap();
            assert_eq!(cut.curve[3], right[0].curve[0]);
            assert_eq!(cut.source_index, right[0].source_index);
            assert_eq!(cut.original_points, 1);
            assert_eq!(right[0].original_points, 8);
            assert!(cut.curve[3].distance(crate::spline::point_at(&segments, t)) < 1e-12);
        }
    }

    #[test]
    fn intervals_preserve_wrap_order_empty_and_noop_thresholds() {
        let segments = [curve(), curve(), curve(), curve()];
        let full = extract(&segments, 1e-5, 1.0 - 1e-5);
        assert!(full.reuse_source);
        assert!(full.pieces.iter().all(|p| p.original_points == 15));
        assert!(extract(&segments, 0.5, 0.5 + 1e-6).pieces.is_empty());
        assert!(extract(&[], 0.2, 0.8).pieces.is_empty());
        assert!(extract(&[], 0.0, 1.0).reuse_source);
        let wrap = extract(&segments, 0.8, 0.2);
        assert!(!wrap.reuse_source);
        assert_eq!(
            wrap.pieces
                .iter()
                .map(|p| p.source_index)
                .collect::<Vec<_>>(),
            vec![3, 0]
        );
        assert!(wrap.pieces[0].curve[0].distance(crate::spline::point_at(&segments, 0.8)) < 1e-12);
        assert!(wrap.pieces[1].curve[3].distance(crate::spline::point_at(&segments, 0.2)) < 1e-12);
    }
}
