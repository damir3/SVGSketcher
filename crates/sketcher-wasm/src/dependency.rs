use sketcher_core::dependency::{self, Input, Rule};
use wasm_bindgen::prelude::*;
fn integer(v: f64) -> Result<usize, &'static str> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v >= usize::MAX as f64 {
        return Err("Invalid dependency index");
    }
    Ok(v as usize)
}
fn query(
    values: &[f64],
    constraints: &[f64],
    policies: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 4
        || ![0.0, 1.0].contains(&settings[2])
        || ![0.0, 1.0].contains(&settings[3])
    {
        return Err("Invalid dependency settings");
    }
    let boundary = integer(settings[0])?;
    let rows = integer(settings[1])?;
    let mut rules = Vec::new();
    let mut at = 0;
    let mut row = 0;
    while at < policies.len() {
        let header = policies
            .get(at..at + 3)
            .ok_or("Truncated dependency policy")?;
        let count = integer(header[0])?;
        let mode = integer(header[1])?;
        let len = integer(header[2])?;
        at += 3;
        if mode > 2 || len > policies.len() - at || count > rows.saturating_sub(row) {
            return Err("Invalid dependency policy size");
        }
        let columns = policies[at..at + len]
            .iter()
            .map(|&v| integer(v))
            .collect::<Result<_, _>>()?;
        rules.push(Rule {
            row,
            count,
            mode: mode as u8,
            columns,
        });
        row += count;
        at += len;
    }
    dependency::analyze(Input {
        values,
        constraints,
        rules: &rules,
        rows,
        hard_rows: boundary,
        candidate_has_free_parameters: settings[2] == 1.0,
        has_offsets: settings[3] == 1.0,
    })
    .map(|v| vec![f64::from(v)])
}
#[wasm_bindgen]
pub fn constraint_dependency(
    values: &[f64],
    constraints: &[f64],
    policies: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    query(values, constraints, policies, settings).map_err(JsValue::from_str)
}
