use super::{integer, Constraint, Ref};
use crate::{spline, Point2};

pub(super) fn validate(kind: usize, a: f64, b: f64, refs: &[Ref]) -> Result<(), &'static str> {
    let invalid = "Invalid spline constraint representation";
    if kind == 29 {
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
        if self.kind == 29 {
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
        let base = self.a as usize * 2;
        let mut entries = Vec::new();
        for (i, h) in self.refs[base..].as_chunks::<5>().0.iter().enumerate() {
            for (j, r) in h[1..].iter().enumerate() {
                if let Some(column) = r.index {
                    entries.push((4 * i + j, column, 1.0));
                }
            }
        }
        // Match the original fit-point insertion order, not free-parameter order.
        let mut columns = Vec::new();
        for r in &self.refs[..base] {
            if let Some(column) = r.index {
                if !columns.contains(&column) {
                    columns.push(column);
                }
            }
        }
        let original = self.spline_residuals(p);
        let mut trial = p.to_vec();
        for column in columns {
            for (i, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[i] = p[i] + 1e-5;
                }
            }
            let shifted = self.spline_residuals(&trial);
            for (i, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[i] = p[i];
                }
            }
            for (row, (plus, initial)) in shifted.iter().zip(&original).enumerate() {
                let value = (plus - initial) / 1e-5;
                if value.abs() > 1e-11 {
                    entries.push((row, column, value));
                }
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
        assert!(validate(30, 2.0, 1.0, &refs).is_ok());
        let c = Constraint {
            kind: 30,
            row: 0,
            hard_row: Some(0),
            weight: 9.0,
            a: 2.0,
            b: 1.0,
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
