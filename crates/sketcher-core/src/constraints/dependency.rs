use super::Program;
use crate::{dependency::Rule, matrix::SparseRows};

impl Program {
    /// Preserve the solver Jacobian unless the dependency test requests central differences.
    pub(crate) fn dependency_rows(
        &self,
        state: &[f64],
        rules: &[Rule],
        geometric: bool,
    ) -> Result<SparseRows, &'static str> {
        let mut rows = vec![Vec::new(); self.covered.len()];
        for c in &self.constraints {
            if c.equations() == 0 {
                continue;
            }
            let rule_index = rules
                .partition_point(|r| r.row <= c.row)
                .checked_sub(1)
                .ok_or("Missing dependency policy")?;
            let rule = &rules[rule_index];
            if c.row + c.equations() > rule.row + rule.count
                || ((24..=26).contains(&c.kind) != (rule.mode == 2))
            {
                return Err("Dependency policy does not match constraint rows");
            }
            let p: Vec<f64> = c
                .refs
                .iter()
                .map(|r| r.index.map_or(r.constant, |i| state[i]))
                .collect();
            if rule.mode == 1 || (rule.mode == 2 && geometric) {
                let mut trial = p.clone();
                for &column in &rule.columns {
                    if !c.refs.iter().any(|r| r.index == Some(column)) {
                        continue;
                    }
                    // Perturb aliases together, exactly as a single parameter-map entry is perturbed in TS.
                    for (i, r) in c.refs.iter().enumerate() {
                        if r.index == Some(column) {
                            trial[i] = p[i] + 1e-5;
                        }
                    }
                    let plus = c.residuals(&trial);
                    for (i, r) in c.refs.iter().enumerate() {
                        if r.index == Some(column) {
                            trial[i] = p[i] - 1e-5;
                        }
                    }
                    let minus = c.residuals(&trial);
                    for (i, r) in c.refs.iter().enumerate() {
                        if r.index == Some(column) {
                            trial[i] = p[i];
                        }
                    }
                    for equation in 0..c.equations() {
                        let value = (plus[equation] - minus[equation]) / (2.0 * 1e-5);
                        if value.abs() > 1e-11 {
                            rows[c.row + equation].push((column, value));
                        }
                    }
                }
            } else {
                for (equation, column, value) in c.jacobian(&p) {
                    rows[c.row + equation].push((column, value));
                }
            }
        }
        Ok(rows)
    }
}
