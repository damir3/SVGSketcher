use super::{integer, Constraint, ConstraintKind, Ref};
use crate::{spline, Point2};

pub(super) fn validate(
    kind: ConstraintKind,
    a: f64,
    b: f64,
    refs: &[Ref],
) -> Result<(), &'static str> {
    let invalid = "Invalid spline constraint representation";
    if kind == ConstraintKind::PointOnSpline {
        let count = integer(b)?;
        let base = count
            .checked_mul(2)
            .and_then(|n| n.checked_add(2))
            .ok_or(invalid)?;
        if a == 0.0 {
            if count.checked_mul(7).and_then(|n| n.checked_add(2)) != Some(refs.len()) {
                return Err(invalid);
            }
            for h in refs[base..].as_chunks::<5>().0 {
                if h[0].index.is_some() || ![0.0, 1.0].contains(&h[0].constant) {
                    return Err(invalid);
                }
            }
        } else if a == 1.0 {
            if refs.len() != base
                && (count < 5
                    || base.checked_add(count).and_then(|n| n.checked_add(4)) != Some(refs.len()))
            {
                return Err(invalid);
            }
            let knots = refs.get(base..).ok_or(invalid)?;
            if knots.iter().any(|r| r.index.is_some())
                || (!knots.is_empty()
                    && !spline::valid_knots(
                        count,
                        &knots.iter().map(|r| r.constant).collect::<Vec<_>>(),
                    ))
            {
                return Err(invalid);
            }
        } else {
            return Err(invalid);
        }
    } else {
        let count = integer(a)?;
        let handles = integer(b)?;
        let base = count.checked_mul(2).ok_or(invalid)?;
        if handles.checked_mul(5).and_then(|n| n.checked_add(base)) != Some(refs.len())
            || (handles > 0 && count < 2)
        {
            return Err(invalid);
        }
        for h in refs[base..].as_chunks::<5>().0 {
            if h[0].index.is_some() || integer(h[0].constant)? >= count {
                return Err(invalid);
            }
        }
    }
    Ok(())
}

fn points(p: &[f64]) -> Vec<Point2> {
    p.as_chunks::<2>()
        .0
        .iter()
        .map(|v| Point2::new(v[0], v[1]))
        .collect()
}

impl Constraint {
    pub(super) fn spline_residuals(&self, p: &[f64]) -> Vec<f64> {
        if self.kind == ConstraintKind::PointOnSpline {
            let n = self.b as usize;
            if n < 2 {
                return vec![0.0];
            }
            let base = 2 + n * 2;
            let pts = points(&p[2..base]);
            let segments = if self.a == 1.0 {
                spline::control_to_bezier(&pts, &p[base..])
            } else {
                let handles: Vec<_> = p[base..]
                    .as_chunks::<5>()
                    .0
                    .iter()
                    .map(|h| {
                        if h[0] == 0.0 {
                            None
                        } else {
                            Some([Point2::new(h[1], h[2]), Point2::new(h[3], h[4])])
                        }
                    })
                    .collect();
                spline::fit_to_bezier(&pts, &handles)
            };
            vec![spline::signed_distance(&segments, Point2::new(p[0], p[1])) * self.weight]
        } else {
            let base = self.a as usize * 2;
            let natural = spline::natural_handles(&points(&p[..base]));
            let mut values = Vec::with_capacity(self.b as usize * 4);
            for h in p[base..].as_chunks::<5>().0 {
                let [h1, h2] = natural[h[0] as usize];
                let d1 = Point2::new(h[1], h[2]) - h1;
                let d2 = Point2::new(h[3], h[4]) - h2;
                values.extend([d1.x, d1.y, d2.x, d2.y]);
            }
            values
        }
    }

    pub(super) fn automatic_jacobian(&self, p: &[f64]) -> Vec<(usize, usize, f64)> {
        let count = self.a as usize;
        let base = count * 2;
        let handle_count = self.b as usize;
        let mut entries = Vec::with_capacity(handle_count * 12);
        let handle_ref_chunks = self.refs[base..].as_chunks::<5>().0;
        for (i, h) in handle_ref_chunks.iter().enumerate() {
            for (j, r) in h[1..].iter().enumerate() {
                if let Some(column) = r.index {
                    entries.push((4 * i + j, column, 1.0));
                }
            }
        }
        if handle_count == 0 || count < 2 {
            return entries;
        }
        // Match the original fit-point insertion order, not free-parameter order.
        let mut columns = Vec::with_capacity(base);
        for r in &self.refs[..base] {
            if let Some(column) = r.index {
                if !columns.contains(&column) {
                    columns.push(column);
                }
            }
        }
        if columns.is_empty() {
            return entries;
        }
        let mut pts = points(&p[..base]);
        let orig_closed = spline::is_closed_fit_points(&pts);
        let n = count - 1;
        let handle_p_chunks = p[base..].as_chunks::<5>().0;
        let mut orig_handles = Vec::with_capacity(handle_count);
        let mut orig_res = Vec::with_capacity(handle_count);
        for h in handle_p_chunks {
            let idx = h[0] as usize;
            let [h1, h2] = spline::natural_handle_at(&pts, orig_closed, idx);
            orig_handles.push([h1, h2]);
            orig_res.push([h[1] - h1.x, h[2] - h1.y, h[3] - h2.x, h[4] - h2.y]);
        }
        let mut perturbed_pts = vec![false; count];
        let mut touched_pts = Vec::with_capacity(4);
        for column in columns {
            touched_pts.clear();
            for (i, r) in self.refs[..base].iter().enumerate() {
                if r.index == Some(column) {
                    let pt_idx = i / 2;
                    if i % 2 == 0 {
                        pts[pt_idx].x = p[i] + 1e-5;
                    } else {
                        pts[pt_idx].y = p[i] + 1e-5;
                    }
                    if !perturbed_pts[pt_idx] {
                        perturbed_pts[pt_idx] = true;
                        touched_pts.push(pt_idx);
                    }
                }
            }
            let new_closed = spline::is_closed_fit_points(&pts);
            let closed_changed = new_closed != orig_closed;
            for (i, (hp, hr)) in handle_p_chunks.iter().zip(handle_ref_chunks).enumerate() {
                let idx = hp[0] as usize;
                let neighbor_touched = closed_changed
                    || perturbed_pts[idx]
                    || if n == 1 || (!new_closed && idx == 0) {
                        perturbed_pts[0] || perturbed_pts[1]
                    } else if !new_closed && idx == n {
                        perturbed_pts[n - 1] || perturbed_pts[n]
                    } else if new_closed && (idx == 0 || idx == n) {
                        perturbed_pts[n - 1] || perturbed_pts[1]
                    } else {
                        perturbed_pts[idx - 1] || perturbed_pts[idx + 1]
                    };
                let alias_mask = [
                    hr[1].index == Some(column),
                    hr[2].index == Some(column),
                    hr[3].index == Some(column),
                    hr[4].index == Some(column),
                ];
                let any_alias = alias_mask[0] || alias_mask[1] || alias_mask[2] || alias_mask[3];
                if !neighbor_touched && !any_alias {
                    continue;
                }
                let [nh1, nh2] = if neighbor_touched {
                    spline::natural_handle_at(&pts, new_closed, idx)
                } else {
                    orig_handles[i]
                };
                let shifted = [
                    (hp[1] + if alias_mask[0] { 1e-5 } else { 0.0 }) - nh1.x,
                    (hp[2] + if alias_mask[1] { 1e-5 } else { 0.0 }) - nh1.y,
                    (hp[3] + if alias_mask[2] { 1e-5 } else { 0.0 }) - nh2.x,
                    (hp[4] + if alias_mask[3] { 1e-5 } else { 0.0 }) - nh2.y,
                ];
                let orig = orig_res[i];
                for j in 0..4 {
                    let value = (shifted[j] - orig[j]) / 1e-5;
                    if value.abs() > 1e-11 {
                        entries.push((4 * i + j, column, value));
                    }
                }
            }
            for &pt_idx in &touched_pts {
                pts[pt_idx].x = p[pt_idx * 2];
                pts[pt_idx].y = p[pt_idx * 2 + 1];
                perturbed_pts[pt_idx] = false;
            }
        }
        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_handles_preserve_fit_child_alias_accumulation_and_ignore_weight() {
        let refs = [
            Some(0),
            Some(1),
            Some(2),
            Some(3),
            None,
            Some(0),
            Some(1),
            Some(4),
            Some(5),
        ]
        .iter()
        .map(|&index| Ref {
            index,
            constant: 0.0,
        })
        .collect::<Vec<_>>();
        assert!(validate(ConstraintKind::AutomaticSplineHandles, 2.0, 1.0, &refs).is_ok());
        let c = Constraint {
            kind: ConstraintKind::AutomaticSplineHandles,
            row: 0,
            hard_row: Some(0),
            weight: 9.0,
            a: 2.0,
            b: 1.0,
            sin_cos: None,
            refs,
        };
        let p = [0.0, 0.0, 9.0, 3.0, 0.0, 0.0, 0.0, 6.0, 7.0];
        assert_eq!(c.spline_residuals(&p), vec![3.0, 1.0, 3.0, 6.0]);
        let jacobian = c.automatic_jacobian(&p);
        let alias: f64 = jacobian
            .iter()
            .filter(|e| e.0 == 0 && e.1 == 0)
            .map(|e| e.2)
            .sum();
        assert!((alias - 2.0 / 3.0).abs() < 1e-9);
    }
}
