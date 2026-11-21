//! Constraint dependency analysis. Reuse the native constraint program and sparse rank implementation.
use crate::{
    constraints::Program,
    matrix::{sparse_rank, SparseRows},
    solver::Evaluation,
};

pub struct Rule {
    pub row: usize,
    pub count: usize,
    pub mode: u8,
    pub columns: Vec<usize>,
}
pub struct Input<'a> {
    pub values: &'a [f64],
    pub constraints: &'a [f64],
    pub rules: &'a [Rule],
    pub rows: usize,
    pub hard_rows: usize,
    pub candidate_has_free_parameters: bool,
    pub has_offsets: bool,
}
fn find_root(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

fn dependent(mut rows: SparseRows, cols: usize, boundary: usize, relevant: bool) -> bool {
    // Stable sorting preserves duplicate-entry accumulation order from the original Jacobians.
    for row in &mut rows {
        row.sort_by_key(|&(c, _)| c);
        let mut write = 0;
        for read in 0..row.len() {
            let (col, value) = row[read];
            if write > 0 && row[write - 1].0 == col {
                row[write - 1].1 += value;
            } else {
                row[write] = (col, value);
                write += 1;
            }
        }
        row.truncate(write);
        row.retain(|&(_, v)| v != 0.0);
    }
    let candidate_empty = rows[boundary..].iter().all(|r| r.is_empty());
    if relevant && candidate_empty {
        return false;
    }
    for row in &mut rows {
        if row.iter().any(|&(_, v)| !v.is_finite()) {
            return false;
        }
        let scale = row.iter().map(|&(_, v)| v.abs()).fold(0.0, f64::max);
        if scale != 0.0 {
            for (_, v) in row {
                *v /= scale;
            }
        }
    }
    if rows.len() == boundary {
        return false;
    }
    if candidate_empty {
        return true;
    }
    // Restrict rank comparison to the connected component(s) touching the candidate rows.
    let mut parent: Vec<usize> = (0..cols).collect();
    for row in &rows {
        let Some(&(first, _)) = row.first() else {
            continue;
        };
        if first >= cols {
            continue;
        }
        for &(c, _) in &row[1..] {
            if c < cols {
                let ra = find_root(&mut parent, first);
                let rb = find_root(&mut parent, c);
                if ra != rb {
                    parent[rb] = ra;
                }
            }
        }
    }
    let mut active_root = vec![false; cols];
    for row in &rows[boundary..] {
        for &(c, _) in row {
            if c < cols {
                let root = find_root(&mut parent, c);
                active_root[root] = true;
            }
        }
    }
    let mut col_to_local = vec![usize::MAX; cols];
    let mut local_cols = 0;
    for c in 0..cols {
        if active_root[find_root(&mut parent, c)] {
            col_to_local[c] = local_cols;
            local_cols += 1;
        }
    }
    if local_cols == 0 {
        return true;
    }
    if local_cols == cols {
        let rank = sparse_rank(rows[..boundary].to_vec(), cols, 1e-7);
        let augmented = sparse_rank(rows, cols, 1e-7);
        return rank == augmented;
    }
    let mut active_rows = Vec::new();
    for row in rows[..boundary].iter() {
        let Some(&(first, _)) = row.first() else {
            continue;
        };
        if first < cols && col_to_local[first] != usize::MAX {
            active_rows.push(
                row.iter()
                    .filter_map(|&(c, v)| {
                        (c < cols && col_to_local[c] != usize::MAX).then_some((col_to_local[c], v))
                    })
                    .collect(),
            );
        }
    }
    let active_boundary = active_rows.len();
    for row in rows[boundary..].iter() {
        if !row.is_empty() {
            active_rows.push(
                row.iter()
                    .filter_map(|&(c, v)| {
                        (c < cols && col_to_local[c] != usize::MAX).then_some((col_to_local[c], v))
                    })
                    .collect(),
            );
        }
    }
    let rank = sparse_rank(active_rows[..active_boundary].to_vec(), local_cols, 1e-7);
    let augmented = sparse_rank(active_rows, local_cols, 1e-7);
    rank == augmented
}
pub fn analyze(input: Input<'_>) -> Result<bool, &'static str> {
    let n = input.values.len();
    let m = input.rows;
    if input.hard_rows > m
        || m > input.constraints.len()
        || input.values.iter().any(|v| !v.is_finite())
    {
        return Err("Invalid dependency dimensions or state");
    }
    let mut row = 0;
    let mut offsets = false;
    for r in input.rules {
        if r.row != row
            || r.count == 0
            || r.count > m - row
            || r.mode > 2
            || r.columns.iter().any(|&c| c >= n)
            || r.columns.windows(2).any(|p| p[0] >= p[1])
        {
            return Err("Invalid dependency differentiation policy");
        }
        row += r.count;
        offsets |= r.mode == 2 && r.row < input.hard_rows;
        if r.row < input.hard_rows && row > input.hard_rows {
            return Err("Dependency boundary splits a constraint");
        }
    }
    if row != m || (offsets && !input.has_offsets) {
        return Err("Incomplete dependency policies");
    }
    let program = Program::decode(input.constraints, n, m, m)?;
    if program.needs_callback(Evaluation::Linearization) {
        return Err("Dependency program has unsupported rows");
    }
    if input.has_offsets && !program.candidate_touches_offset_child(input.hard_rows) {
        return Ok(dependent(
            program.dependency_rows(input.values, input.rules, true)?,
            n,
            input.hard_rows,
            input.candidate_has_free_parameters,
        ));
    }
    let first = program.dependency_rows(input.values, input.rules, false)?;
    if dependent(
        first,
        n,
        input.hard_rows,
        input.candidate_has_free_parameters,
    ) {
        return Ok(true);
    }
    if input.has_offsets {
        return Ok(dependent(
            program.dependency_rows(input.values, input.rules, true)?,
            n,
            input.hard_rows,
            input.candidate_has_free_parameters,
        ));
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(kind: usize, row: usize, a: f64, b: f64, refs: &[(f64, f64)]) -> Vec<f64> {
        let mut out = vec![
            kind as f64,
            row as f64,
            row as f64,
            1.0,
            a,
            b,
            refs.len() as f64,
        ];
        for &(i, v) in refs {
            out.extend([i, v]);
        }
        out
    }
    #[test]
    fn distinguishes_duplicate_and_independent_measurements_and_normalizes_rows() {
        // Free endpoint (x,y), fixed origin.
        let refs = [(-1.0, 0.0), (-1.0, 0.0), (0.0, 10.0), (1.0, 0.0)];
        let mut data = record(6, 0, 10.0, 0.0, &refs);
        data.extend(record(6, 1, 10.0, 0.0, &refs));
        let rules = [
            Rule {
                row: 0,
                count: 1,
                mode: 0,
                columns: vec![],
            },
            Rule {
                row: 1,
                count: 1,
                mode: 0,
                columns: vec![],
            },
        ];
        for weight in [1e-10, 1.0, 1e10] {
            data[3] = weight;
            assert!(analyze(Input {
                values: &[10.0, 0.0],
                constraints: &data,
                rules: &rules,
                rows: 2,
                hard_rows: 1,
                candidate_has_free_parameters: true,
                has_offsets: false
            })
            .unwrap());
        }
        data = record(2, 0, 0.0, 0.0, &refs);
        data.extend(record(6, 1, 10.0, 0.0, &refs));
        assert!(!analyze(Input {
            values: &[10.0, 0.0],
            constraints: &data,
            rules: &rules,
            rows: 2,
            hard_rows: 1,
            candidate_has_free_parameters: true,
            has_offsets: false
        })
        .unwrap());
    }
    #[test]
    fn zero_derivative_is_not_proof_of_a_constant_measurement_at_a_singularity() {
        let data = record(
            6,
            0,
            0.0,
            0.0,
            &[(-1.0, 0.0), (-1.0, 0.0), (0.0, 0.0), (1.0, 0.0)],
        );
        let rules = [Rule {
            row: 0,
            count: 1,
            mode: 0,
            columns: vec![],
        }];
        for relevant in [false, true] {
            assert_eq!(
                analyze(Input {
                    values: &[0.0, 0.0],
                    constraints: &data,
                    rules: &rules,
                    rows: 1,
                    hard_rows: 0,
                    candidate_has_free_parameters: relevant,
                    has_offsets: false
                })
                .unwrap(),
                !relevant
            );
        }
    }
    #[test]
    fn central_differences_perturb_aliases_together_and_respect_entity_masks() {
        // A point aliased to the first line endpoint lies on the line for all changes.
        let data = record(
            10,
            0,
            0.0,
            0.0,
            &[
                (0.0, 2.0),
                (1.0, 3.0),
                (0.0, 2.0),
                (1.0, 3.0),
                (-1.0, 10.0),
                (-1.0, 0.0),
            ],
        );
        let program = Program::decode(&data, 2, 1, 1).unwrap();
        let rules = [Rule {
            row: 0,
            count: 1,
            mode: 1,
            columns: vec![0, 1],
        }];
        assert!(program.dependency_rows(&[2.0, 3.0], &rules, false).unwrap()[0].is_empty());
        let data = record(
            10,
            0,
            0.0,
            0.0,
            &[
                (-1.0, 5.0),
                (0.0, 2.0),
                (-1.0, 0.0),
                (1.0, 0.0),
                (-1.0, 10.0),
                (-1.0, 0.0),
            ],
        );
        let program = Program::decode(&data, 2, 1, 1).unwrap();
        let rules = [Rule {
            row: 0,
            count: 1,
            mode: 1,
            columns: vec![0],
        }];
        let rows = program.dependency_rows(&[2.0, 0.0], &rules, false).unwrap();
        assert_eq!(rows[0].len(), 1);
        assert_eq!(rows[0][0].0, 0);
        assert!((rows[0][0].1 + 1.0).abs() < 1e-9);
    }
    #[test]
    fn full_offset_relation_finds_a_constant_gap_while_the_source_can_move() {
        // Parent y is column 0, child y is column 1; both source endpoints share parent y.
        let refs = [
            (-1.0, 0.0),
            (1.0, 2.0),
            (-1.0, 0.0),
            (0.0, 0.0),
            (-1.0, 10.0),
            (0.0, 0.0),
        ];
        let mut data = record(24, 0, 2.0, 1.0, &refs);
        data.extend(record(20, 1, 2.0, -1.0, &refs));
        let rules = [
            Rule {
                row: 0,
                count: 1,
                mode: 2,
                columns: vec![0, 1],
            },
            Rule {
                row: 1,
                count: 1,
                mode: 1,
                columns: vec![0, 1],
            },
        ];
        let values = [0.0, 2.0];
        let program = Program::decode(&data, 2, 2, 2).unwrap();
        assert!(!dependent(
            program.dependency_rows(&values, &rules, false).unwrap(),
            2,
            1,
            true
        ));
        assert!(dependent(
            program.dependency_rows(&values, &rules, true).unwrap(),
            2,
            1,
            true
        ));
        assert!(analyze(Input {
            values: &values,
            constraints: &data,
            rules: &rules,
            rows: 2,
            hard_rows: 1,
            candidate_has_free_parameters: true,
            has_offsets: true
        })
        .unwrap());
    }
    #[test]
    fn a_candidate_offset_does_not_enable_the_geometric_pass_by_itself() {
        let data = record(
            24,
            0,
            2.0,
            1.0,
            &[
                (-1.0, 0.0),
                (1.0, 2.0),
                (-1.0, 0.0),
                (0.0, 0.0),
                (-1.0, 10.0),
                (0.0, 0.0),
            ],
        );
        let rules = [Rule {
            row: 0,
            count: 1,
            mode: 2,
            columns: vec![0, 1],
        }];
        assert!(!analyze(Input {
            values: &[0.0, 2.0],
            constraints: &data,
            rules: &rules,
            rows: 1,
            hard_rows: 0,
            candidate_has_free_parameters: true,
            has_offsets: false
        })
        .unwrap());
    }
    #[test]
    fn duplicate_sparse_entries_cancel_before_the_singular_guard() {
        assert!(!dependent(
            vec![vec![], vec![(0, 1.0), (0, -1.0)]],
            1,
            1,
            true
        ));
        assert!(dependent(
            vec![vec![(0, 1.0)], vec![(0, 2.0), (0, -1.0)]],
            1,
            1,
            true
        ));
    }
    #[test]
    fn redundant_coincident_with_offset_child_does_not_pin_parent_dimension() {
        // Params: 0:off.x, 1:off.y, 2:orig.x, 3:orig.y, 4:off.r, 5:orig.r
        let values = [10.0, 20.0, 10.0, 20.0, 25.0, 15.0];
        let mut base = record(
            25,
            0,
            10.0,
            1.0,
            &[
                (0.0, 0.0),
                (1.0, 0.0),
                (2.0, 0.0),
                (3.0, 0.0),
                (4.0, 0.0),
                (5.0, 0.0),
            ],
        );
        // Redundant coincident between orig center (2,3) and off center (0,1).
        base.extend(record(
            1,
            3,
            0.0,
            0.0,
            &[(2.0, 0.0), (3.0, 0.0), (0.0, 0.0), (1.0, 0.0)],
        ));
        // Candidate on parent center distance to origin: should be independent (false).
        let mut parent_data = base.clone();
        parent_data.extend(record(
            6,
            5,
            10.0_f64.hypot(20.0),
            0.0,
            &[(-1.0, 0.0), (-1.0, 0.0), (2.0, 0.0), (3.0, 0.0)],
        ));
        let rules = [
            Rule {
                row: 0,
                count: 3,
                mode: 2,
                columns: vec![0, 1, 2, 3, 4, 5],
            },
            Rule {
                row: 3,
                count: 2,
                mode: 0,
                columns: vec![],
            },
            Rule {
                row: 5,
                count: 1,
                mode: 0,
                columns: vec![],
            },
        ];
        assert!(!analyze(Input {
            values: &values,
            constraints: &parent_data,
            rules: &rules,
            rows: 6,
            hard_rows: 5,
            candidate_has_free_parameters: true,
            has_offsets: true
        })
        .unwrap());
        // Candidate on offset child radius: must still be dependent (true).
        let mut child_data = base;
        child_data.extend(record(4, 5, 25.0, 0.0, &[(4.0, 0.0)]));
        assert!(analyze(Input {
            values: &values,
            constraints: &child_data,
            rules: &rules,
            rows: 6,
            hard_rows: 5,
            candidate_has_free_parameters: true,
            has_offsets: true
        })
        .unwrap());
    }
}
