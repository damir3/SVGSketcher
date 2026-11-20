use sketcher_core::{
    copies::{self, ARITIES},
    Point2,
};
use wasm_bindgen::prelude::*;
fn query(points: &[f64], data: &[f64]) -> Result<Vec<f64>, &'static str> {
    if !points.len().is_multiple_of(2) {
        return Err("Invalid copy point arity");
    }
    let points: Vec<_> = points
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| Point2::new(p[0], p[1]))
        .collect();
    let mut operations = Vec::new();
    let mut at = 0;
    while at < data.len() {
        let tag = data[at];
        if !tag.is_finite() || tag < 0.0 || tag.fract() != 0.0 || tag >= ARITIES.len() as f64 {
            return Err("Invalid copy tag");
        }
        let kind = tag as usize;
        at += 1;
        let count = ARITIES[kind];
        let p = data.get(at..at + count).ok_or("Truncated copy operation")?;
        operations.push((kind, p));
        at += count;
    }
    copies::query(&points, &operations)
}
#[wasm_bindgen]
pub fn copy_geometry(points: &[f64], operations: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(points, operations).map_err(JsValue::from_str)
}
