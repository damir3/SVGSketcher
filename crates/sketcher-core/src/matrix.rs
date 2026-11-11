//! Index-based loops preserve the reference implementation's accumulation and pivot order.
#![allow(clippy::needless_range_loop)]

pub(crate) type SparseRows = Vec<Vec<(usize, f64)>>;

fn merge_sub_row(
    target: &[(usize, f64)],
    pivot: &[(usize, f64)],
    factor: f64,
    scratch: &mut Vec<(usize, f64)>,
) {
    scratch.clear();
    let mut t_idx = 0;
    let mut p_idx = 0;
    while t_idx < target.len() && p_idx < pivot.len() {
        let (t_col, t_val) = target[t_idx];
        let (p_col, p_val) = pivot[p_idx];
        if t_col < p_col {
            scratch.push((t_col, t_val));
            t_idx += 1;
        } else if p_col < t_col {
            let val = -factor * p_val;
            if val != 0.0 {
                scratch.push((p_col, val));
            }
            p_idx += 1;
        } else {
            let val = t_val - factor * p_val;
            if val != 0.0 {
                scratch.push((t_col, val));
            }
            t_idx += 1;
            p_idx += 1;
        }
    }
    if t_idx < target.len() {
        scratch.extend_from_slice(&target[t_idx..]);
    }
    while p_idx < pivot.len() {
        let (p_col, p_val) = pivot[p_idx];
        let val = -factor * p_val;
        if val != 0.0 {
            scratch.push((p_col, val));
        }
        p_idx += 1;
    }
}

pub(super) fn normal_equations_from_rows(
    j_rows: &[Vec<(usize, f64)>],
    cols: usize,
    f: &[f64],
) -> (Vec<Vec<(usize, f64)>>, Vec<f64>) {
    let mut raw_rows: Vec<Vec<(usize, f64)>> = vec![Vec::new(); cols];
    let mut g = vec![0.0; cols];
    for (k, non_zeros) in j_rows.iter().enumerate() {
        let fk = f[k];
        for &(c, val) in non_zeros {
            g[c] += val * fk;
        }
        for &(r, value) in non_zeros {
            if value.abs() < 1e-15 {
                continue;
            }
            let r_vec = &mut raw_rows[r];
            for &(c, jc) in non_zeros {
                r_vec.push((c, value * jc));
            }
        }
    }
    let mut a_rows = Vec::with_capacity(cols);
    let mut row_acc = vec![0.0; cols];
    let mut seen = vec![false; cols];
    let mut touched = Vec::with_capacity(32);
    for r_vec in raw_rows {
        touched.clear();
        for (c, prod) in r_vec {
            if !seen[c] {
                seen[c] = true;
                touched.push(c);
            }
            row_acc[c] += prod;
        }
        touched.sort_unstable();
        let mut merged = Vec::with_capacity(touched.len());
        for &c in &touched {
            seen[c] = false;
            let val = row_acc[c];
            row_acc[c] = 0.0;
            merged.push((c, val));
        }
        a_rows.push(merged);
    }
    (a_rows, g)
}

pub(super) fn normal_equations_sparse(
    j: &[f64],
    rows: usize,
    cols: usize,
    f: &[f64],
) -> (Vec<Vec<(usize, f64)>>, Vec<f64>) {
    let j_rows: Vec<Vec<(usize, f64)>> = (0..rows)
        .map(|k| {
            j[k * cols..(k + 1) * cols]
                .iter()
                .enumerate()
                .filter_map(|(c, &val)| (val != 0.0).then_some((c, val)))
                .collect()
        })
        .collect();
    normal_equations_from_rows(&j_rows, cols, f)
}

#[cfg(test)]
pub(super) fn normal_equations(
    j: &[f64],
    rows: usize,
    cols: usize,
    f: &[f64],
) -> (Vec<f64>, Vec<f64>) {
    let (sparse, g) = normal_equations_sparse(j, rows, cols, f);
    let mut a = vec![0.0; cols * cols];
    for (r, row) in sparse.into_iter().enumerate() {
        for (c, val) in row {
            a[r * cols + c] = val;
        }
    }
    (a, g)
}

pub(super) fn solve_sparse_linear_system(
    matrix_rows: &[Vec<(usize, f64)>],
    rhs: &[f64],
) -> Option<Vec<f64>> {
    let n = rhs.len();
    let mut order: Vec<usize> = (0..n).collect();
    let counts: Vec<usize> = (0..n)
        .map(|r| matrix_rows[r].iter().filter(|&&(_, v)| v != 0.0).count())
        .collect();
    order.sort_by_key(|&r| counts[r]);
    let mut inv_order = vec![0; n];
    for (new_idx, &orig_idx) in order.iter().enumerate() {
        inv_order[orig_idx] = new_idx;
    }
    let mut a_rows: Vec<Vec<(usize, f64)>> = Vec::with_capacity(n);
    let mut x = vec![0.0; n];
    for row in 0..n {
        let orig_row = order[row];
        x[row] = rhs[orig_row];
        let mut r_vec: Vec<(usize, f64)> = matrix_rows[orig_row]
            .iter()
            .filter_map(|&(orig_col, val)| (val != 0.0).then_some((inv_order[orig_col], val)))
            .collect();
        r_vec.sort_unstable_by_key(|&(col, _)| col);
        a_rows.push(r_vec);
    }
    let mut head = vec![0usize; n];
    let mut first_col: Vec<usize> = a_rows
        .iter()
        .map(|r| r.first().map_or(usize::MAX, |&(c, _)| c))
        .collect();
    let mut active_rows = Vec::with_capacity(32);
    let mut merge_buf = Vec::with_capacity(32);
    for i in 0..n {
        let mut max_value = 0.0;
        let mut max_row = i;
        let mut diag_value = 0.0;
        active_rows.clear();
        for k in i..n {
            if first_col[k] == i {
                active_rows.push(k);
                let abs = a_rows[k][head[k]].1.abs();
                if k == i {
                    diag_value = abs;
                }
                if abs > max_value {
                    max_value = abs;
                    max_row = k;
                }
            }
        }
        if max_value < 1e-13 {
            return None;
        }
        if diag_value >= 1e-6 * max_value {
            max_row = i;
        }
        if max_row != i {
            a_rows.swap(i, max_row);
            head.swap(i, max_row);
            first_col.swap(i, max_row);
            x.swap(i, max_row);
            for r in &mut active_rows {
                if *r == i {
                    *r = max_row;
                } else if *r == max_row {
                    *r = i;
                }
            }
        }
        let hi = head[i];
        let pivot = a_rows[i][hi].1;
        let xi = x[i];
        let (head_rows, tail_rows) = a_rows.split_at_mut(i + 1);
        let pivot_tail = &head_rows[i][hi + 1..];
        for &row in &active_rows {
            if row == i {
                continue;
            }
            let r_head = head[row];
            let row_vec = &mut tail_rows[row - (i + 1)];
            let a_row_i = row_vec[r_head].1;
            let next_head = r_head + 1;
            head[row] = next_head;
            let factor = a_row_i / pivot;
            if factor != 0.0 && !pivot_tail.is_empty() {
                let rem = &mut row_vec[next_head..];
                let mut updated_in_place = false;
                if rem.len() > pivot_tail.len() * 2 {
                    let mut all_found = true;
                    for &(p_col, p_val) in pivot_tail {
                        if let Ok(idx) = rem.binary_search_by_key(&p_col, |&(c, _)| c) {
                            if rem[idx].1 - factor * p_val == 0.0 {
                                all_found = false;
                                break;
                            }
                        } else {
                            all_found = false;
                            break;
                        }
                    }
                    if all_found {
                        for &(p_col, p_val) in pivot_tail {
                            let idx = rem.binary_search_by_key(&p_col, |&(c, _)| c).unwrap();
                            rem[idx].1 -= factor * p_val;
                        }
                        updated_in_place = true;
                    }
                }
                if !updated_in_place {
                    merge_sub_row(rem, pivot_tail, factor, &mut merge_buf);
                    std::mem::swap(row_vec, &mut merge_buf);
                    head[row] = 0;
                }
            }
            if factor != 0.0 {
                x[row] -= factor * xi;
            }
            first_col[row] = row_vec.get(head[row]).map_or(usize::MAX, |&(c, _)| c);
        }
    }
    for i in (0..n).rev() {
        let hi = head[i];
        let mut sum = x[i];
        for &(col, val) in &a_rows[i][hi + 1..] {
            sum -= val * x[col];
        }
        x[i] = sum / a_rows[i][hi].1;
    }
    let mut solution = vec![0.0; n];
    for i in 0..n {
        solution[order[i]] = x[i];
    }
    Some(solution)
}

#[cfg(test)]
pub(super) fn solve_linear_system(matrix: &[f64], rhs: &[f64]) -> Option<Vec<f64>> {
    let n = rhs.len();
    let rows: Vec<Vec<(usize, f64)>> = (0..n)
        .map(|r| {
            matrix[r * n..(r + 1) * n]
                .iter()
                .enumerate()
                .filter_map(|(c, &v)| (v != 0.0).then_some((c, v)))
                .collect()
        })
        .collect();
    solve_sparse_linear_system(&rows, rhs)
}

pub(super) fn analyze_nullspace_sparse(
    mut a_rows: Vec<Vec<(usize, f64)>>,
    cols: usize,
    tolerance: f64,
) -> (usize, Vec<usize>) {
    let rows = a_rows.len();
    let mut pivots = Vec::new();
    let mut is_pivot = vec![false; cols];
    let mut first_pos = vec![0usize; rows];
    let mut first_col: Vec<usize> = a_rows
        .iter()
        .map(|r| r.first().map_or(usize::MAX, |&(c, _)| c))
        .collect();
    let mut active_rows = Vec::with_capacity(32);
    let mut merge_buf = Vec::with_capacity(32);
    let mut row = 0;
    for col in 0..cols {
        if row >= rows {
            break;
        }
        let mut max_row = row;
        let mut max_value = 0.0;
        active_rows.clear();
        for r in row..rows {
            if first_col[r] < col {
                let r_vec = &a_rows[r];
                let mut p = first_pos[r] + 1;
                while p < r_vec.len() && r_vec[p].0 < col {
                    p += 1;
                }
                first_pos[r] = p;
                first_col[r] = r_vec.get(p).map_or(usize::MAX, |&(c, _)| c);
            }
            if first_col[r] == col {
                active_rows.push(r);
                let abs = a_rows[r][first_pos[r]].1.abs();
                if abs > max_value {
                    max_value = abs;
                    max_row = r;
                }
            }
        }
        if max_value < tolerance {
            continue;
        }
        if max_row != row {
            a_rows.swap(row, max_row);
            first_pos.swap(row, max_row);
            first_col.swap(row, max_row);
            for r in &mut active_rows {
                if *r == row {
                    *r = max_row;
                } else if *r == max_row {
                    *r = row;
                }
            }
        }
        let pivot_pos = first_pos[row];
        let pivot = a_rows[row][pivot_pos].1;
        let (head, tail) = a_rows.split_at_mut(row + 1);
        let pivot_tail = &head[row][pivot_pos + 1..];
        for &r in &active_rows {
            if r == row {
                continue;
            }
            let pos = first_pos[r];
            let row_vec = &mut tail[r - (row + 1)];
            let a_r_col = row_vec[pos].1;
            let factor = a_r_col / pivot;
            if factor == 0.0 {
                if pos == 0 {
                    first_pos[r] = 1;
                } else {
                    row_vec.remove(pos);
                }
            } else {
                merge_sub_row(&row_vec[pos + 1..], pivot_tail, factor, &mut merge_buf);
                if pos == 0 {
                    std::mem::swap(row_vec, &mut merge_buf);
                } else {
                    row_vec.truncate(pos);
                    row_vec.append(&mut merge_buf);
                }
            }
            first_col[r] = row_vec.get(first_pos[r]).map_or(usize::MAX, |&(c, _)| c);
        }
        pivots.push(col);
        is_pivot[col] = true;
        row += 1;
    }
    let rank = pivots.len();
    if rank == cols {
        return (rank, pivots);
    }
    let mut col_entries: Vec<Vec<(usize, f64)>> = vec![Vec::new(); cols];
    for r in 0..rank {
        let p_col = pivots[r];
        for &(c, val) in &a_rows[r] {
            if c != p_col && val != 0.0 {
                col_entries[c].push((r, val));
            }
        }
    }
    let mut movable = vec![false; cols];
    let mut free_col = vec![0.0; rank];
    for free in 0..cols {
        if is_pivot[free] {
            continue;
        }
        free_col.fill(0.0);
        for &(r, val) in &col_entries[free] {
            free_col[r] = val;
        }
        for r in (0..rank).rev() {
            let col = pivots[r];
            if col > free {
                continue;
            }
            let a_r_free = free_col[r];
            if a_r_free == 0.0 {
                continue;
            }
            let pivot_val = a_rows[r][first_pos[r]].1;
            let coefficient = a_r_free / pivot_val;
            if coefficient.abs() > tolerance {
                movable[col] = true;
            }
            if coefficient == 0.0 {
                continue;
            }
            for &(i, val) in &col_entries[col] {
                if i < r {
                    free_col[i] -= val * coefficient;
                }
            }
        }
    }
    (
        rank,
        pivots.into_iter().filter(|&col| !movable[col]).collect(),
    )
}

pub(super) fn analyze_nullspace(
    matrix: &[f64],
    rows: usize,
    cols: usize,
    tolerance: f64,
) -> (usize, Vec<usize>) {
    let a_rows: Vec<Vec<(usize, f64)>> = (0..rows)
        .map(|r| {
            matrix[r * cols..(r + 1) * cols]
                .iter()
                .enumerate()
                .filter_map(|(c, &v)| (v != 0.0).then_some((c, v)))
                .collect()
        })
        .collect();
    analyze_nullspace_sparse(a_rows, cols, tolerance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_original_variable_order_after_sparse_ordering_and_pivoting() {
        assert_eq!(
            solve_linear_system(
                &[1.0, 2.0, 3.0, 0.0, 0.0, 4.0, 0.0, 5.0, 0.0],
                &[14.0, 12.0, 10.0]
            ),
            Some(vec![1.0, 2.0, 3.0])
        );
        assert_eq!(
            solve_linear_system(&[1.0, 2.0, 2.0, 4.0], &[1.0, 2.0]),
            None
        );
    }

    #[test]
    fn distinguishes_fixed_coordinates_from_movable_pivots() {
        let a = [1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        assert_eq!(analyze_nullspace(&a, 3, 4, 1e-7), (3, vec![0, 3]));
        assert_eq!(analyze_nullspace(&[0.0; 6], 2, 3, 1e-7), (0, vec![]));
    }

    #[test]
    fn normal_equations_preserve_small_coefficient_rules() {
        let (a, g) = normal_equations(&[1.0, 2.0, 3.0, 4.0], 2, 2, &[5.0, 6.0]);
        assert_eq!(a, vec![10.0, 14.0, 14.0, 20.0]);
        assert_eq!(g, vec![23.0, 34.0]);
        let (a, g) = normal_equations(&[1e-16], 1, 1, &[1.0]);
        assert_eq!(a, vec![0.0]);
        assert_eq!(g, vec![1e-16]);
    }
}
