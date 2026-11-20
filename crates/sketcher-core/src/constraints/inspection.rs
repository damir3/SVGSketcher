use super::Program;
use crate::inspection::angle_valid;

impl Program {
    pub(crate) fn inspect(&self, groups: &[usize]) -> Result<(f64, bool), &'static str> {
        if self.covered.iter().any(|&v| !v) {
            return Err("Incomplete inspection program");
        }
        let mut residuals = vec![0.0; self.covered.len()];
        let mut satisfied = true;
        let mut p = Vec::new();
        let boundaries: Vec<_> = groups
            .iter()
            .scan(0, |row, &n| {
                *row += n;
                Some(*row)
            })
            .collect();
        for c in &self.constraints {
            let count = c.equations();
            if count == 0 {
                continue;
            }
            let group = boundaries.partition_point(|&end| end <= c.row);
            if group >= boundaries.len() || c.row + count > boundaries[group] {
                return Err("Constraint splits inspection group");
            }
            p.clear();
            p.extend(c.refs.iter().map(|r| r.constant));
            residuals[c.row..c.row + count].copy_from_slice(&c.residuals(&p));
            if c.kind == 14 {
                satisfied &= angle_valid(&p, p[8], p[9], p[10], c.a);
            }
        }
        let mut error = 0.0;
        let mut row = 0;
        for &count in groups {
            let mut group_error = 0.0;
            for &r in &residuals[row..row + count] {
                group_error += r * r / 2.0;
            }
            error += group_error;
            row += count;
        }
        Ok((error, satisfied))
    }
}
