//! Index-based loops preserve the reference implementation's accumulation and pivot order.
#![allow(clippy::needless_range_loop)]

use std::collections::BinaryHeap;

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

/// Builds only the upper triangle (`col >= row`) of `H = J^T * J` together with `g = J^T * f`.
/// Each row of `j_rows` must be sorted ascending by column index.
pub(super) fn normal_equations_upper_from_rows(
    j_rows: &[Vec<(usize, f64)>],
    cols: usize,
    f: &[f64],
) -> (SparseRows, Vec<f64>) {
    let mut raw_rows: Vec<Vec<(usize, f64)>> = vec![Vec::new(); cols];
    let mut g = vec![0.0; cols];
    for (k, non_zeros) in j_rows.iter().enumerate() {
        let fk = f[k];
        for &(c, val) in non_zeros {
            g[c] += val * fk;
        }
        for (idx_r, &(r, value)) in non_zeros.iter().enumerate() {
            if value.abs() < 1e-15 {
                continue;
            }
            let r_vec = &mut raw_rows[r];
            for &(c, jc) in &non_zeros[idx_r..] {
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

pub(super) fn normal_equations_upper_sparse(
    j: &[f64],
    rows: usize,
    cols: usize,
    f: &[f64],
) -> (SparseRows, Vec<f64>) {
    let j_rows: Vec<Vec<(usize, f64)>> = (0..rows)
        .map(|k| {
            j[k * cols..(k + 1) * cols]
                .iter()
                .enumerate()
                .filter_map(|(c, &val)| (val != 0.0).then_some((c, val)))
                .collect()
        })
        .collect();
    normal_equations_upper_from_rows(&j_rows, cols, f)
}

#[cfg(test)]
pub(super) fn expand_upper_to_full(upper: &[Vec<(usize, f64)>]) -> SparseRows {
    let n = upper.len();
    let mut full: SparseRows = vec![Vec::new(); n];
    for (r, row) in upper.iter().enumerate() {
        for &(c, val) in row {
            if val == 0.0 {
                continue;
            }
            full[r].push((c, val));
            if c != r {
                full[c].push((r, val));
            }
        }
    }
    for row in &mut full {
        row.sort_unstable_by_key(|&(c, _)| c);
    }
    full
}

#[cfg(test)]
pub(super) fn normal_equations_sparse(
    j: &[f64],
    rows: usize,
    cols: usize,
    f: &[f64],
) -> (SparseRows, Vec<f64>) {
    let (upper, g) = normal_equations_upper_sparse(j, rows, cols, f);
    (expand_upper_to_full(&upper), g)
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

/// Reusable flat scratch buffers for accumulating `H = J^T * J` and `g = J^T * f`
/// row-by-row without per-row heap allocations.
pub(crate) struct NormalEquationsWorkspace {
    n: usize,
    g: Vec<f64>,
    triplets: Vec<(usize, usize, f64)>,
    counts: Vec<usize>,
    offsets: Vec<usize>,
    bucket_cols: Vec<usize>,
    bucket_vals: Vec<f64>,
    row_acc: Vec<f64>,
    seen: Vec<bool>,
    touched: Vec<usize>,
    upper_offsets: Vec<usize>,
    upper_cols: Vec<usize>,
    upper_vals: Vec<f64>,
}

impl NormalEquationsWorkspace {
    pub(crate) fn new(n: usize) -> Self {
        Self {
            n,
            g: vec![0.0; n],
            triplets: Vec::with_capacity(n.saturating_mul(16)),
            counts: vec![0; n],
            offsets: vec![0; n + 1],
            bucket_cols: Vec::new(),
            bucket_vals: Vec::new(),
            row_acc: vec![0.0; n],
            seen: vec![false; n],
            touched: Vec::with_capacity(64),
            upper_offsets: Vec::with_capacity(n + 1),
            upper_cols: Vec::with_capacity(n.saturating_mul(8)),
            upper_vals: Vec::with_capacity(n.saturating_mul(8)),
        }
    }

    pub(crate) fn reset(&mut self) {
        self.g.fill(0.0);
        self.counts.fill(0);
        self.triplets.clear();
    }

    #[inline]
    pub(crate) fn add_row(&mut self, non_zeros: &[(usize, f64)], fk: f64) {
        for &(c, val) in non_zeros {
            self.g[c] += val * fk;
        }
        for (idx_r, &(r, value)) in non_zeros.iter().enumerate() {
            if value.abs() < 1e-15 {
                continue;
            }
            let tail = &non_zeros[idx_r..];
            self.counts[r] += tail.len();
            for &(c, jc) in tail {
                self.triplets.push((r, c, value * jc));
            }
        }
    }

    pub(crate) fn gradient_norm(&self) -> f64 {
        let mut sum = 0.0;
        for &v in &self.g {
            sum += v * v;
        }
        sum.sqrt()
    }

    pub(crate) fn finish(&mut self, stiffness: &[f64]) -> PreparedNormalEquations {
        let n = self.n;
        self.offsets.clear();
        self.offsets.push(0);
        let mut total = 0;
        for &cnt in &self.counts {
            total += cnt;
            self.offsets.push(total);
        }
        self.bucket_cols.resize(total, 0);
        self.bucket_vals.resize(total, 0.0);
        self.counts.copy_from_slice(&self.offsets[..n]);
        for &(r, c, prod) in &self.triplets {
            let pos = self.counts[r];
            self.bucket_cols[pos] = c;
            self.bucket_vals[pos] = prod;
            self.counts[r] = pos + 1;
        }
        self.upper_offsets.clear();
        self.upper_offsets.push(0);
        self.upper_cols.clear();
        self.upper_vals.clear();
        for r in 0..n {
            self.touched.clear();
            let start = self.offsets[r];
            let end = self.offsets[r + 1];
            for idx in start..end {
                let c = self.bucket_cols[idx];
                if !self.seen[c] {
                    self.seen[c] = true;
                    self.touched.push(c);
                }
                self.row_acc[c] += self.bucket_vals[idx];
            }
            for &c in &self.touched {
                self.seen[c] = false;
                let val = self.row_acc[c];
                self.row_acc[c] = 0.0;
                if val != 0.0 {
                    self.upper_cols.push(c);
                    self.upper_vals.push(val);
                }
            }
            self.upper_offsets.push(self.upper_cols.len());
        }
        let neg_g: Vec<f64> = self.g.iter().map(|&v| -v).collect();
        PreparedNormalEquations::from_upper_csr(
            &self.upper_offsets,
            &self.upper_cols,
            &self.upper_vals,
            neg_g,
            stiffness,
        )
    }
}

/// Pre-permuted and symbolically factored normal equations `H = J^T * J` cached across rejected LM steps.
pub(super) struct PreparedNormalEquations {
    order: Vec<usize>,
    /// Diagonal entries in permuted coordinates.
    perm_diag: Vec<f64>,
    /// Strictly lower-triangular entries (`j < k`) in flat CSR by row `k`.
    lower_offsets: Vec<usize>,
    lower_cols: Vec<usize>,
    lower_vals: Vec<f64>,
    /// Elimination tree and column-oriented CSR offsets for `L` in `L * D * L^T`.
    parent: Vec<usize>,
    l_col_offsets: Vec<usize>,
    perm_stiffness: Vec<f64>,
    perm_neg_g: Vec<f64>,
    neg_g: Vec<f64>,
    all_positive_stiffness: bool,
}

impl PreparedNormalEquations {
    pub(super) fn new(h_upper: SparseRows, neg_g: Vec<f64>, stiffness: &[f64]) -> Self {
        let n = neg_g.len();
        let total: usize = h_upper.iter().map(Vec::len).sum();
        let mut upper_offsets = Vec::with_capacity(n + 1);
        let mut upper_cols = Vec::with_capacity(total);
        let mut upper_vals = Vec::with_capacity(total);
        upper_offsets.push(0);
        for row in &h_upper {
            for &(c, val) in row {
                if val != 0.0 {
                    upper_cols.push(c);
                    upper_vals.push(val);
                }
            }
            upper_offsets.push(upper_cols.len());
        }
        Self::from_upper_csr(&upper_offsets, &upper_cols, &upper_vals, neg_g, stiffness)
    }

    pub(super) fn from_upper_csr(
        upper_offsets: &[usize],
        upper_cols: &[usize],
        upper_vals: &[f64],
        neg_g: Vec<f64>,
        stiffness: &[f64],
    ) -> Self {
        let n = neg_g.len();
        let mut counts = vec![0usize; n];
        for r in 0..n {
            for idx in upper_offsets[r]..upper_offsets[r + 1] {
                let c = upper_cols[idx];
                counts[r] += 1;
                if c != r {
                    counts[c] += 1;
                }
            }
        }
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by_key(|&r| counts[r]);
        let mut inv_order = vec![0usize; n];
        for (new_idx, &orig_idx) in order.iter().enumerate() {
            inv_order[orig_idx] = new_idx;
        }
        let mut perm_diag = vec![0.0; n];
        let mut lower_counts = vec![0usize; n];
        for r in 0..n {
            let pr = inv_order[r];
            for idx in upper_offsets[r]..upper_offsets[r + 1] {
                let pc = inv_order[upper_cols[idx]];
                if pr == pc {
                    perm_diag[pr] = upper_vals[idx];
                } else {
                    lower_counts[pr.max(pc)] += 1;
                }
            }
        }
        let mut lower_offsets = Vec::with_capacity(n + 1);
        lower_offsets.push(0);
        let mut total_lower = 0;
        for &cnt in &lower_counts {
            total_lower += cnt;
            lower_offsets.push(total_lower);
        }
        let mut cursor = lower_offsets[..n].to_vec();
        let mut lower_cols = vec![0usize; total_lower];
        let mut lower_vals = vec![0.0; total_lower];
        for r in 0..n {
            let pr = inv_order[r];
            for idx in upper_offsets[r]..upper_offsets[r + 1] {
                let pc = inv_order[upper_cols[idx]];
                if pr != pc {
                    let (lo, hi) = if pr < pc { (pr, pc) } else { (pc, pr) };
                    let pos = cursor[hi];
                    lower_cols[pos] = lo;
                    lower_vals[pos] = upper_vals[idx];
                    cursor[hi] = pos + 1;
                }
            }
        }
        let all_positive_stiffness = stiffness.iter().all(|&s| s > 0.0);
        let (parent, l_col_offsets) = if all_positive_stiffness {
            // Up-looking symbolic LDL^T: compute elimination tree and exact column nnz of L.
            let mut parent = vec![usize::MAX; n];
            let mut col_nnz = vec![0usize; n];
            let mut flag = vec![usize::MAX; n];
            for k in 0..n {
                flag[k] = k;
                for &orig_j in &lower_cols[lower_offsets[k]..lower_offsets[k + 1]] {
                    let mut j = orig_j;
                    while flag[j] != k {
                        flag[j] = k;
                        col_nnz[j] += 1;
                        if parent[j] == usize::MAX {
                            parent[j] = k;
                        }
                        j = parent[j];
                    }
                }
            }
            let mut l_col_offsets = Vec::with_capacity(n + 1);
            l_col_offsets.push(0);
            let mut total_l = 0;
            for &cnt in &col_nnz {
                total_l += cnt;
                l_col_offsets.push(total_l);
            }
            (parent, l_col_offsets)
        } else {
            (Vec::new(), Vec::new())
        };
        let perm_stiffness: Vec<f64> = order.iter().map(|&orig| stiffness[orig]).collect();
        let perm_neg_g: Vec<f64> = order.iter().map(|&orig| neg_g[orig]).collect();
        Self {
            order,
            perm_diag,
            lower_offsets,
            lower_cols,
            lower_vals,
            parent,
            l_col_offsets,
            perm_stiffness,
            perm_neg_g,
            neg_g,
            all_positive_stiffness,
        }
    }

    /// Solves `(H + lambda * diag(max(|H_ii|, 1) * stiffness)) * delta = -g`.
    /// Uses flat up-looking sparse LDL^T when strictly SPD, and falls back to pivoted sparse LU otherwise.
    pub(super) fn solve(&self, lambda: f64, stiffness: &[f64]) -> Option<Vec<f64>> {
        if self.all_positive_stiffness && lambda > 0.0 {
            if let Some(solution) = self.solve_spd(lambda) {
                return Some(solution);
            }
        }
        let n = self.order.len();
        let mut full: SparseRows = vec![Vec::new(); n];
        for pr in 0..n {
            let orig_r = self.order[pr];
            let d = self.perm_diag[pr];
            let diagonal = d.abs().max(1.0);
            let val = d + lambda * diagonal * stiffness[orig_r];
            if val != 0.0 {
                full[orig_r].push((orig_r, val));
            }
            for idx in self.lower_offsets[pr]..self.lower_offsets[pr + 1] {
                let orig_c = self.order[self.lower_cols[idx]];
                let v = self.lower_vals[idx];
                if v != 0.0 {
                    full[orig_r].push((orig_c, v));
                    full[orig_c].push((orig_r, v));
                }
            }
        }
        for row in &mut full {
            row.sort_unstable_by_key(|&(c, _)| c);
        }
        solve_sparse_linear_system(&full, &self.neg_g)
    }

    fn solve_spd(&self, lambda: f64) -> Option<Vec<f64>> {
        let n = self.order.len();
        let total_l = self.l_col_offsets[n];
        let mut d = vec![0.0; n];
        let mut y = vec![0.0; n];
        let mut flag = vec![usize::MAX; n];
        let mut col_cursor = self.l_col_offsets[..n].to_vec();
        let mut l_row_idx = vec![0usize; total_l];
        let mut l_vals = vec![0.0; total_l];
        let mut pattern = Vec::with_capacity(32);

        for k in 0..n {
            let base_d = self.perm_diag[k];
            let mut dk = base_d + lambda * base_d.abs().max(1.0) * self.perm_stiffness[k];
            flag[k] = k;
            pattern.clear();
            let row_start = self.lower_offsets[k];
            let row_end = self.lower_offsets[k + 1];
            for idx in row_start..row_end {
                let mut cur = self.lower_cols[idx];
                y[cur] = self.lower_vals[idx];
                while flag[cur] != k {
                    flag[cur] = k;
                    pattern.push(cur);
                    cur = self.parent[cur];
                }
            }
            if pattern.len() > 1 {
                pattern.sort_unstable();
            }
            for &i in &pattern {
                let yi = y[i];
                y[i] = 0.0;
                let l_ki = yi / d[i];
                dk -= l_ki * yi;
                let col_start = self.l_col_offsets[i];
                let col_end = col_cursor[i];
                for idx in col_start..col_end {
                    y[l_row_idx[idx]] -= l_vals[idx] * yi;
                }
                l_row_idx[col_end] = k;
                l_vals[col_end] = l_ki;
                col_cursor[i] = col_end + 1;
            }
            if !dk.is_finite() || dk <= 1e-13 {
                return None;
            }
            d[k] = dk;
        }

        let mut x = self.perm_neg_g.clone();
        // Forward substitution: L * z = -g
        for i in 0..n {
            let xi = x[i];
            if xi != 0.0 {
                for idx in self.l_col_offsets[i]..self.l_col_offsets[i + 1] {
                    x[l_row_idx[idx]] -= l_vals[idx] * xi;
                }
            }
        }
        // Diagonal scaling: D * w = z
        for i in 0..n {
            x[i] /= d[i];
        }
        // Backward substitution: L^T * y = w
        for i in (0..n).rev() {
            let mut xi = x[i];
            for idx in self.l_col_offsets[i]..self.l_col_offsets[i + 1] {
                xi -= l_vals[idx] * x[l_row_idx[idx]];
            }
            x[i] = xi;
        }

        let mut solution = vec![0.0; n];
        for i in 0..n {
            solution[self.order[i]] = x[i];
        }
        Some(solution)
    }
}

pub(super) fn solve_sparse_linear_system(
    matrix_rows: &[Vec<(usize, f64)>],
    rhs: &[f64],
) -> Option<Vec<f64>> {
    let n = rhs.len();
    if n == 0 {
        return Some(Vec::new());
    }
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
    let mut col_head = vec![usize::MAX; n];
    let mut next_in_col = vec![usize::MAX; n];
    for r in 0..n {
        if let Some(&(c, _)) = a_rows[r].first() {
            if c < n {
                next_in_col[r] = col_head[c];
                col_head[c] = r;
            }
        }
    }
    let mut slot_to_row: Vec<usize> = (0..n).collect();
    let mut row_to_slot: Vec<usize> = (0..n).collect();
    let mut pivot_rows = vec![0usize; n];
    let mut active_rows = Vec::with_capacity(32);
    let mut merge_buf = Vec::with_capacity(32);
    for i in 0..n {
        active_rows.clear();
        let mut cur = col_head[i];
        col_head[i] = usize::MAX;
        while cur != usize::MAX {
            let next = next_in_col[cur];
            next_in_col[cur] = usize::MAX;
            active_rows.push(cur);
            cur = next;
        }
        let diag_row = slot_to_row[i];
        let mut max_value = 0.0;
        let mut max_row = diag_row;
        let mut max_slot = usize::MAX;
        let mut diag_value = 0.0;
        for &r in &active_rows {
            let abs = a_rows[r][head[r]].1.abs();
            if r == diag_row {
                diag_value = abs;
            }
            let s = row_to_slot[r];
            if abs > max_value || (abs == max_value && s < max_slot) {
                max_value = abs;
                max_row = r;
                max_slot = s;
            }
        }
        if max_value < 1e-13 {
            return None;
        }
        let pivot_row = if diag_value >= 1e-6 * max_value {
            diag_row
        } else {
            max_row
        };
        if pivot_row != diag_row {
            let p_slot = row_to_slot[pivot_row];
            slot_to_row[i] = pivot_row;
            slot_to_row[p_slot] = diag_row;
            row_to_slot[pivot_row] = i;
            row_to_slot[diag_row] = p_slot;
        }
        pivot_rows[i] = pivot_row;
        let hi = head[pivot_row];
        let pivot = a_rows[pivot_row][hi].1;
        let xi = x[pivot_row];
        for &row in &active_rows {
            if row == pivot_row {
                continue;
            }
            let (p_vec, row_vec) = if pivot_row < row {
                let (left, right) = a_rows.split_at_mut(row);
                (&left[pivot_row], &mut right[0])
            } else {
                let (left, right) = a_rows.split_at_mut(pivot_row);
                (&right[0], &mut left[row])
            };
            let pivot_tail = &p_vec[hi + 1..];
            let r_head = head[row];
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
            if let Some(&(next_col, _)) = row_vec.get(head[row]) {
                if next_col < n {
                    next_in_col[row] = col_head[next_col];
                    col_head[next_col] = row;
                }
            }
        }
    }
    let mut y = vec![0.0; n];
    for i in (0..n).rev() {
        let pr = pivot_rows[i];
        let hi = head[pr];
        let mut sum = x[pr];
        for &(col, val) in &a_rows[pr][hi + 1..] {
            sum -= val * y[col];
        }
        y[i] = sum / a_rows[pr][hi].1;
    }
    let mut solution = vec![0.0; n];
    for i in 0..n {
        solution[order[i]] = y[i];
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
    a_rows: Vec<Vec<(usize, f64)>>,
    cols: usize,
    tolerance: f64,
) -> (usize, Vec<usize>) {
    analyze_sparse(a_rows, cols, tolerance, true)
}

/// Dependency analysis needs only the rank, without solving for fixed columns of the nullspace.
pub(crate) fn sparse_rank(a_rows: SparseRows, cols: usize, tolerance: f64) -> usize {
    analyze_sparse(a_rows, cols, tolerance, false).0
}

fn analyze_sparse(
    mut a_rows: SparseRows,
    cols: usize,
    tolerance: f64,
    fixed_columns: bool,
) -> (usize, Vec<usize>) {
    let rows = a_rows.len();
    if rows == 0 || cols == 0 {
        return (0, Vec::new());
    }
    // Order sparse columns by ascending non-zero count to push hub columns (like pattern centers)
    // to the end of elimination, preventing massive early fill-in. Rank and fixed columns are
    // invariant under column permutations.
    let col_order = if cols >= 32 {
        let mut col_counts = vec![0usize; cols];
        for r in &a_rows {
            for &(c, v) in r {
                if c < cols && v != 0.0 {
                    col_counts[c] += 1;
                }
            }
        }
        let mut order: Vec<usize> = (0..cols).collect();
        order.sort_by_key(|&c| col_counts[c]);
        let mut inv_col = vec![0usize; cols];
        for (new_c, &orig_c) in order.iter().enumerate() {
            inv_col[orig_c] = new_c;
        }
        for r in &mut a_rows {
            for entry in r.iter_mut() {
                if entry.0 < cols {
                    entry.0 = inv_col[entry.0];
                }
            }
            if r.len() > 1 {
                r.sort_unstable_by_key(|&(c, _)| c);
            }
        }
        Some(order)
    } else {
        None
    };
    let mut pivots = Vec::new();
    let mut pivot_rows = Vec::new();
    let mut is_pivot = vec![false; cols];
    let mut first_pos = vec![0usize; rows];
    let mut col_head = vec![usize::MAX; cols];
    let mut next_in_col = vec![usize::MAX; rows];
    for r in 0..rows {
        if let Some(&(c, _)) = a_rows[r].first() {
            if c < cols {
                next_in_col[r] = col_head[c];
                col_head[c] = r;
            }
        }
    }
    let mut slot_to_row: Vec<usize> = (0..rows).collect();
    let mut row_to_slot: Vec<usize> = (0..rows).collect();
    let mut active_rows = Vec::with_capacity(32);
    let mut merge_buf = Vec::with_capacity(32);
    let mut row = 0;
    for col in 0..cols {
        if row >= rows {
            break;
        }
        active_rows.clear();
        let mut cur = col_head[col];
        col_head[col] = usize::MAX;
        while cur != usize::MAX {
            let next = next_in_col[cur];
            next_in_col[cur] = usize::MAX;
            active_rows.push(cur);
            cur = next;
        }
        if active_rows.is_empty() {
            continue;
        }
        let mut max_row = active_rows[0];
        let mut max_slot = usize::MAX;
        let mut max_value = 0.0;
        for &r in &active_rows {
            let abs = a_rows[r][first_pos[r]].1.abs();
            let s = row_to_slot[r];
            if abs > max_value || (abs == max_value && s < max_slot) {
                max_value = abs;
                max_row = r;
                max_slot = s;
            }
        }
        if max_value < tolerance {
            // Column has no valid pivot; advance every row that touched `col` to its next column.
            for &r in &active_rows {
                let mut p = first_pos[r] + 1;
                let r_vec = &a_rows[r];
                while p < r_vec.len() && r_vec[p].0 <= col {
                    p += 1;
                }
                first_pos[r] = p;
                if let Some(&(next_c, _)) = r_vec.get(p) {
                    if next_c < cols {
                        next_in_col[r] = col_head[next_c];
                        col_head[next_c] = r;
                    }
                }
            }
            continue;
        }
        let slot_row = slot_to_row[row];
        if max_row != slot_row {
            let m_slot = row_to_slot[max_row];
            slot_to_row[row] = max_row;
            slot_to_row[m_slot] = slot_row;
            row_to_slot[max_row] = row;
            row_to_slot[slot_row] = m_slot;
        }
        let pivot_row = max_row;
        let pivot_pos = first_pos[pivot_row];
        let pivot = a_rows[pivot_row][pivot_pos].1;
        for &r in &active_rows {
            if r == pivot_row {
                continue;
            }
            let (p_vec, row_vec) = if pivot_row < r {
                let (left, right) = a_rows.split_at_mut(r);
                (&left[pivot_row], &mut right[0])
            } else {
                let (left, right) = a_rows.split_at_mut(pivot_row);
                (&right[0], &mut left[r])
            };
            let pivot_tail = &p_vec[pivot_pos + 1..];
            let pos = first_pos[r];
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
            if let Some(&(next_c, _)) = row_vec.get(first_pos[r]) {
                if next_c < cols {
                    next_in_col[r] = col_head[next_c];
                    col_head[next_c] = r;
                }
            }
        }
        pivots.push(col);
        pivot_rows.push(pivot_row);
        is_pivot[col] = true;
        row += 1;
    }
    let rank = pivots.len();
    if !fixed_columns {
        return (rank, Vec::new());
    }
    if rank == cols {
        return (rank, (0..cols).collect());
    }
    let mut col_entries: Vec<Vec<(usize, f64)>> = vec![Vec::new(); cols];
    for r in 0..rank {
        let pr = pivot_rows[r];
        let p_col = pivots[r];
        for &(c, val) in &a_rows[pr] {
            if c != p_col && val != 0.0 {
                col_entries[c].push((r, val));
            }
        }
    }
    let mut movable = vec![false; cols];
    let mut free_col = vec![0.0; rank];
    let mut in_heap = vec![false; rank];
    let mut heap = BinaryHeap::new();
    for free in 0..cols {
        if is_pivot[free] {
            continue;
        }
        for &(r, val) in &col_entries[free] {
            if pivots[r] < free {
                free_col[r] = val;
                if !in_heap[r] {
                    in_heap[r] = true;
                    heap.push(r);
                }
            }
        }
        while let Some(r) = heap.pop() {
            in_heap[r] = false;
            let a_r_free = free_col[r];
            free_col[r] = 0.0;
            if a_r_free == 0.0 {
                continue;
            }
            let col = pivots[r];
            let pr = pivot_rows[r];
            let pivot_val = a_rows[pr][first_pos[pr]].1;
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
                    if !in_heap[i] {
                        in_heap[i] = true;
                        heap.push(i);
                    }
                }
            }
        }
    }
    let mut fixed: Vec<usize> = pivots
        .into_iter()
        .filter(|&col| !movable[col])
        .map(|col| col_order.as_ref().map_or(col, |order| order[col]))
        .collect();
    if col_order.is_some() {
        fixed.sort_unstable();
    }
    (rank, fixed)
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
    fn spd_normal_equations_match_general_sparse_lu() {
        let j = [
            1.0, 2.0, 0.0, -1.0, //
            0.0, 3.0, 4.0, 0.5, //
            -2.0, 0.0, 1.0, 2.0,
        ];
        let f = [5.0, -3.0, 2.0];
        let stiffness = [1.0, 2.0, 0.5, 4.0];
        let lambda = 1e-2;
        let (upper, g) = normal_equations_upper_sparse(&j, 3, 4, &f);
        let neg_g: Vec<f64> = g.iter().map(|&v| -v).collect();
        let prepared = PreparedNormalEquations::new(upper.clone(), neg_g.clone(), &stiffness);
        let spd = prepared.solve(lambda, &stiffness).unwrap();
        let mut full = expand_upper_to_full(&upper);
        for (i, row) in full.iter_mut().enumerate() {
            let idx = row.binary_search_by_key(&i, |&(c, _)| c).unwrap();
            let diag = row[idx].1.abs().max(1.0);
            row[idx].1 += lambda * diag * stiffness[i];
        }
        let lu = solve_sparse_linear_system(&full, &neg_g).unwrap();
        for (a, b) in spd.iter().zip(&lu) {
            assert!((a - b).abs() < 1e-12, "{a} != {b}");
        }
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
