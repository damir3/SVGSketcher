use sketcher_core::inspection::{self, ARITIES};
use wasm_bindgen::prelude::*;

fn integer(v: f64) -> Result<usize, &'static str> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v >= usize::MAX as f64 {
        return Err("Invalid inspection index");
    }
    Ok(v as usize)
}
fn query(data: &[f64], groups: &[f64], packed: &[f64]) -> Result<Vec<f64>, &'static str> {
    let groups = groups
        .iter()
        .map(|&v| integer(v))
        .collect::<Result<Vec<_>, _>>()?;
    let mut measurements = Vec::new();
    let mut at = 0;
    while at < packed.len() {
        let kind = integer(packed[at])?;
        let count = *ARITIES.get(kind).ok_or("Unknown measurement kind")?;
        at += 1;
        let p = packed
            .get(at..at + count)
            .ok_or("Truncated reference measurement")?;
        measurements.push((kind, p));
        at += count;
    }
    inspection::inspect(data, &groups, &measurements)
}
#[wasm_bindgen]
pub fn inspect_constraints(
    data: &[f64],
    groups: &[f64],
    measurements: &[f64],
) -> Result<Vec<f64>, JsValue> {
    query(data, groups, measurements).map_err(JsValue::from_str)
}

#[wasm_bindgen]
pub fn constraint_max_errors(
    data: &[f64],
    groups: &[f64],
    weights: &[f64],
) -> Result<Vec<f64>, JsValue> {
    let groups = groups
        .iter()
        .map(|&v| integer(v))
        .collect::<Result<Vec<_>, _>>()
        .map_err(JsValue::from_str)?;
    inspection::max_errors(data, &groups, weights).map_err(JsValue::from_str)
}
