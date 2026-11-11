//! Levenberg–Marquardt loop independent of the browser and constraint implementations.
use crate::constraints::Program;
use crate::matrix::{
    analyze_nullspace, analyze_nullspace_sparse, normal_equations_from_rows,
    normal_equations_sparse, solve_sparse_linear_system, SparseRows,
};

#[derive(Clone, Copy, Debug)]
#[repr(u32)]
pub enum Evaluation {
    Residuals = 0,
    Linearization = 1,
    HardResiduals = 2,
    HardJacobian = 3,
    Commit = 4,
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub max_iterations: usize,
    pub tolerance: f64,
    pub grad_rel_tolerance: f64,
    pub initial_lambda: f64,
    pub lambda_factor: f64,
    pub min_lambda: f64,
    pub max_lambda: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            max_iterations: 40,
            tolerance: 1e-6,
            grad_rel_tolerance: 0.0,
            initial_lambda: 1e-3,
            lambda_factor: 4.0,
            min_lambda: 1e-9,
            max_lambda: 1e7,
        }
    }
}

pub struct Problem<'a> {
    pub values: &'a [f64],
    pub stiffness: &'a [f64],
    pub lower_bounds: &'a [f64],
    pub equations: usize,
    pub hard_equations: usize,
    pub skip_dof: bool,
    pub options: Options,
}

#[derive(Debug)]
pub enum SolveError<E> {
    InvalidInput(&'static str),
    Evaluation(E),
}

#[derive(Debug, PartialEq)]
#[repr(u32)]
pub enum Status {
    Converged = 0,
    UnderConstrained = 1,
    OverConstrained = 2,
}

#[derive(Debug)]
pub struct SolveResult {
    pub values: Vec<f64>,
    pub status: Status,
    pub iterations: usize,
    pub initial_error: f64,
    pub final_error: f64,
    pub degrees_of_freedom: usize,
    pub constrained_indices: Vec<usize>,
}

fn error(residuals: &[f64]) -> f64 {
    let mut sum = 0.0;
    for &r in residuals {
        sum += r * r;
    }
    sum * 0.5
}

fn evaluate<E>(
    state: &[f64],
    mode: Evaluation,
    expected: usize,
    callback: &mut impl FnMut(&[f64], Evaluation) -> Result<Vec<f64>, E>,
) -> Result<Vec<f64>, SolveError<E>> {
    let data = callback(state, mode).map_err(SolveError::Evaluation)?;
    if data.len() != expected {
        return Err(SolveError::InvalidInput(
            "Invalid solver evaluation buffer length",
        ));
    }
    Ok(data)
}

fn damp_sparse_rows(
    base_rows: &[Vec<(usize, f64)>],
    lambda: f64,
    stiffness: &[f64],
) -> Vec<Vec<(usize, f64)>> {
    let mut rows = base_rows.to_vec();
    for (i, row) in rows.iter_mut().enumerate() {
        match row.binary_search_by_key(&i, |&(c, _)| c) {
            Ok(idx) => {
                let diagonal = row[idx].1.abs().max(1.0);
                row[idx].1 += lambda * diagonal * stiffness[i];
            }
            Err(idx) => {
                let val = lambda * stiffness[i];
                if val != 0.0 {
                    row.insert(idx, (i, val));
                }
            }
        }
    }
    rows
}

fn constraint_state<E>(
    problem: &Problem<'_>,
    program: Option<&Program>,
    state: &[f64],
    callback: &mut impl FnMut(&[f64], Evaluation) -> Result<Vec<f64>, E>,
) -> Result<(usize, Vec<usize>), SolveError<E>> {
    if problem.skip_dof {
        return Ok((0, Vec::new()));
    }
    let n = state.len();
    if n == 0 || problem.hard_equations == 0 {
        return Ok((n, Vec::new()));
    }
    if let Some(prog) = program.filter(|p| !p.needs_callback(Evaluation::HardJacobian)) {
        let (_, j_rows) = prog
            .evaluate_sparse(state, true)
            .map_err(SolveError::InvalidInput)?;
        let (rank, fixed) = analyze_nullspace_sparse(j_rows, n, 1e-7);
        return Ok((n - rank, fixed));
    }
    let j = evaluate(
        state,
        Evaluation::HardJacobian,
        problem.hard_equations * n,
        callback,
    )?;
    let (rank, fixed) = analyze_nullspace(&j, problem.hard_equations, n, 1e-7);
    Ok((n - rank, fixed))
}

pub fn solve<E>(
    problem: &Problem<'_>,
    callback: impl FnMut(&[f64], Evaluation) -> Result<Vec<f64>, E>,
) -> Result<SolveResult, SolveError<E>> {
    solve_inner(problem, None, callback)
}

pub fn solve_with_program<E>(
    problem: &Problem<'_>,
    program: &Program,
    callback: impl FnMut(&[f64], Evaluation) -> Result<Vec<f64>, E>,
) -> Result<SolveResult, SolveError<E>> {
    solve_inner(problem, Some(program), callback)
}

fn solve_inner<E>(
    problem: &Problem<'_>,
    program: Option<&Program>,
    mut callback: impl FnMut(&[f64], Evaluation) -> Result<Vec<f64>, E>,
) -> Result<SolveResult, SolveError<E>> {
    let n = problem.values.len();
    let m = problem.equations;
    if problem.stiffness.len() != n || problem.lower_bounds.len() != n || problem.hard_equations > m
    {
        return Err(SolveError::InvalidInput("Invalid solver dimensions"));
    }
    if n.checked_mul(n).is_none()
        || m.checked_mul(n)
            .and_then(|size| size.checked_add(m))
            .is_none()
    {
        return Err(SolveError::InvalidInput("Solver dimensions overflow"));
    }
    if problem
        .values
        .iter()
        .chain(problem.stiffness)
        .any(|v| !v.is_finite())
        || problem.lower_bounds.iter().any(|v| v.is_nan())
    {
        return Err(SolveError::InvalidInput("Invalid solver parameter values"));
    }
    let options = problem.options;
    let mut x = problem.values.to_vec();
    if n == 0 || m == 0 {
        return Ok(SolveResult {
            values: x,
            status: if n == 0 {
                Status::Converged
            } else {
                Status::UnderConstrained
            },
            iterations: 0,
            initial_error: 0.0,
            final_error: 0.0,
            degrees_of_freedom: n,
            constrained_indices: Vec::new(),
        });
    }
    let mut current_error = error(&evaluate(&x, Evaluation::Residuals, m, &mut callback)?);
    let initial_error = current_error;
    if current_error < options.tolerance * options.tolerance {
        let (dof, fixed) = constraint_state(problem, program, &x, &mut callback)?;
        return Ok(SolveResult {
            values: x,
            status: if dof == 0 {
                Status::Converged
            } else {
                Status::UnderConstrained
            },
            iterations: 0,
            initial_error,
            final_error: current_error,
            degrees_of_freedom: dof,
            constrained_indices: fixed,
        });
    }
    let mut lambda = options.initial_lambda;
    let mut iteration = 0;
    let mut cached_linearization: Option<(SparseRows, Vec<f64>, bool)> = None;
    while iteration < options.max_iterations {
        if cached_linearization.is_none() {
            let (h_rows, g) = if let Some(prog) =
                program.filter(|p| !p.needs_callback(Evaluation::Linearization))
            {
                let (residuals, j_rows) = prog
                    .evaluate_sparse(&x, false)
                    .map_err(SolveError::InvalidInput)?;
                normal_equations_from_rows(&j_rows, n, &residuals)
            } else {
                let data = evaluate(&x, Evaluation::Linearization, m + m * n, &mut callback)?;
                let (residuals, j) = data.split_at(m);
                normal_equations_sparse(j, m, n, residuals)
            };
            let mut gradient_norm = 0.0;
            for &v in &g {
                gradient_norm += v * v;
            }
            let grad_norm = gradient_norm.sqrt();
            if grad_norm == 0.0
                || (options.grad_rel_tolerance <= 0.0 && grad_norm < options.tolerance)
            {
                break;
            }
            let small_grad = grad_norm < options.tolerance;
            let neg_g: Vec<f64> = g.into_iter().map(|v| -v).collect();
            cached_linearization = Some((h_rows, neg_g, small_grad));
        }
        let (base_h_rows, neg_g, small_grad) = cached_linearization.as_ref().unwrap();
        let small_grad = *small_grad;
        let damped_h = damp_sparse_rows(base_h_rows, lambda, problem.stiffness);
        let Some(delta) = solve_sparse_linear_system(&damped_h, neg_g) else {
            lambda = (lambda * options.lambda_factor * 2.0).min(options.max_lambda);
            iteration += 1;
            continue;
        };
        let mut candidate = vec![0.0; n];
        let mut step_norm = 0.0;
        for i in 0..n {
            candidate[i] = problem.lower_bounds[i].max(x[i] + delta[i]);
            let d = candidate[i] - x[i];
            step_norm += d * d;
        }
        let candidate_error = error(&evaluate(
            &candidate,
            Evaluation::Residuals,
            m,
            &mut callback,
        )?);
        if candidate_error < current_error {
            let rel_decrease = (current_error - candidate_error) / current_error;
            let damped_small =
                small_grad && (lambda < options.initial_lambda || lambda <= options.min_lambda);
            x = candidate;
            current_error = candidate_error;
            cached_linearization = None;
            evaluate(&x, Evaluation::Commit, 0, &mut callback)?;
            lambda = (lambda / options.lambda_factor).max(options.min_lambda);
            if step_norm.sqrt() < options.tolerance
                || current_error < options.tolerance * options.tolerance
                || (damped_small && rel_decrease < options.grad_rel_tolerance)
            {
                iteration += 1;
                break;
            }
        } else {
            if small_grad && (step_norm.sqrt() < options.tolerance || lambda >= 1.0) {
                break;
            }
            lambda = (lambda * options.lambda_factor).min(options.max_lambda);
        }
        iteration += 1;
    }
    let hard_error = error(&evaluate(
        &x,
        Evaluation::HardResiduals,
        problem.hard_equations,
        &mut callback,
    )?);
    let (dof, fixed) = constraint_state(problem, program, &x, &mut callback)?;
    let status = if hard_error > 1e-2 {
        Status::OverConstrained
    } else if dof > 0 {
        Status::UnderConstrained
    } else {
        Status::Converged
    };
    Ok(SolveResult {
        values: x,
        status,
        iterations: iteration,
        initial_error,
        final_error: current_error,
        degrees_of_freedom: dof,
        constrained_indices: fixed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn linear(state: &[f64], mode: Evaluation) -> Result<Vec<f64>, &'static str> {
        Ok(match mode {
            Evaluation::Residuals | Evaluation::HardResiduals => {
                vec![state[0] - 10.0, state[1] - 20.0]
            }
            Evaluation::Linearization => vec![state[0] - 10.0, state[1] - 20.0, 1.0, 0.0, 0.0, 1.0],
            Evaluation::HardJacobian => vec![1.0, 0.0, 0.0, 1.0],
            Evaluation::Commit => vec![],
        })
    }
    #[test]
    fn converges_and_commits_only_accepted_states() {
        let problem = Problem {
            values: &[2.0, 3.0],
            stiffness: &[1.0, 1.0],
            lower_bounds: &[f64::NEG_INFINITY; 2],
            equations: 2,
            hard_equations: 2,
            skip_dof: false,
            options: Options::default(),
        };
        let mut accepted = Vec::new();
        let result = solve(&problem, |x, mode| {
            if matches!(mode, Evaluation::Commit) {
                accepted.push(x.to_vec());
            }
            linear(x, mode)
        })
        .unwrap();
        assert_eq!(result.status, Status::Converged);
        assert_eq!(result.iterations, 3);
        assert_eq!(result.degrees_of_freedom, 0);
        assert_eq!(result.constrained_indices, vec![0, 1]);
        assert!(result.final_error < 1e-12);
        assert_eq!(accepted.len(), 3);
        assert_eq!(accepted.last(), Some(&result.values));
    }
    #[test]
    fn malformed_dimensions_and_evaluation_errors_are_reported() {
        let mut problem = Problem {
            values: &[1.0],
            stiffness: &[],
            lower_bounds: &[0.0],
            equations: 1,
            hard_equations: 1,
            skip_dof: false,
            options: Options::default(),
        };
        assert!(matches!(
            solve(&problem, linear),
            Err(SolveError::InvalidInput(_))
        ));
        problem.stiffness = &[1.0];
        assert!(matches!(
            solve(&problem, |_, _| Ok::<_, ()>(vec![])),
            Err(SolveError::InvalidInput(_))
        ));
        assert!(matches!(
            solve(&problem, |_, _| Err::<Vec<f64>, _>("evaluation failure")),
            Err(SolveError::Evaluation("evaluation failure"))
        ));
    }
}
