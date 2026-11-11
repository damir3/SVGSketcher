use js_sys::{Float64Array, Function};
use sketcher_core::constraints::Program;
use sketcher_core::solver::{self, Evaluation, Options, Problem, SolveError};
use wasm_bindgen::{prelude::*, JsCast};

fn integer(value: f64) -> Result<usize, JsValue> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value >= usize::MAX as f64 {
        return Err(JsValue::from_str("Invalid solver integer setting"));
    }
    Ok(value as usize)
}

/// One callback for a complete residual/Jacobian request, or an accepted-state commit.
/// State arrays are copies, so callback re-entry and WASM memory growth cannot invalidate them.
#[wasm_bindgen]
pub fn solve_system(
    values: &[f64],
    stiffness: &[f64],
    lower_bounds: &[f64],
    settings: &[f64],
    native_constraints: &[f64],
    evaluate: &Function,
) -> Result<Vec<f64>, JsValue> {
    if settings.len() != 9
        || settings.iter().any(|v| !v.is_finite())
        || (settings[2] != 0.0 && settings[2] != 1.0)
    {
        return Err(JsValue::from_str("Invalid solver settings"));
    }
    let problem = Problem {
        values,
        stiffness,
        lower_bounds,
        equations: integer(settings[0])?,
        hard_equations: integer(settings[1])?,
        skip_dof: settings[2] == 1.0,
        options: Options {
            max_iterations: integer(settings[3])?,
            tolerance: settings[4],
            initial_lambda: settings[5],
            lambda_factor: settings[6],
            min_lambda: settings[7],
            max_lambda: settings[8],
        },
    };
    let program = Program::decode(
        native_constraints,
        values.len(),
        problem.equations,
        problem.hard_equations,
    )
    .map_err(JsValue::from_str)?;
    let result = solver::solve_with_program(&problem, &program, |state, mode| {
        let expected = program.output_len(mode).map_err(JsValue::from_str)?;
        let mut output = if program.needs_callback(mode) {
            let state = Float64Array::from(state);
            let output = evaluate.call2(&JsValue::NULL, &state, &JsValue::from(mode as u32))?;
            output
                .dyn_into::<Float64Array>()
                .map(|array| array.to_vec())
                .map_err(|_| JsValue::from_str("Solver evaluator must return Float64Array"))?
        } else {
            vec![0.0; expected]
        };
        if output.len() != expected {
            return Err(JsValue::from_str("Invalid solver evaluation buffer length"));
        }
        program
            .fill(state, mode, &mut output)
            .map_err(JsValue::from_str)?;
        Ok(output)
    })
    .map_err(|error| match error {
        SolveError::InvalidInput(message) => JsValue::from_str(message),
        SolveError::Evaluation(error) => error,
    })?;
    let mut output = vec![
        result.status as u32 as f64,
        result.iterations as f64,
        result.initial_error,
        result.final_error,
        result.degrees_of_freedom as f64,
        result.constrained_indices.len() as f64,
    ];
    output.extend(result.values);
    output.extend(result.constrained_indices.into_iter().map(|i| i as f64));
    Ok(output)
}

/// Evaluate just the native rows, useful for formula parity checks and batch queries.
/// Settings are [all equations, hard equations, evaluation mode].
#[wasm_bindgen]
pub fn evaluate_constraints(
    values: &[f64],
    native_constraints: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    if settings.len() != 3 || values.iter().any(|v| !v.is_finite()) {
        return Err(JsValue::from_str(
            "Invalid native constraint evaluation settings",
        ));
    }
    let mode = match integer(settings[2])? {
        0 => Evaluation::Residuals,
        1 => Evaluation::Linearization,
        2 => Evaluation::HardResiduals,
        3 => Evaluation::HardJacobian,
        4 => Evaluation::Commit,
        _ => return Err(JsValue::from_str("Unknown constraint evaluation mode")),
    };
    let program = Program::decode(
        native_constraints,
        values.len(),
        integer(settings[0])?,
        integer(settings[1])?,
    )
    .map_err(JsValue::from_str)?;
    let mut output = vec![0.0; program.output_len(mode).map_err(JsValue::from_str)?];
    program
        .fill(values, mode, &mut output)
        .map_err(JsValue::from_str)?;
    Ok(output)
}
