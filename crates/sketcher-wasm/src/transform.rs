use sketcher_core::{
    transform::{self, Input},
    Point2,
};
use wasm_bindgen::prelude::*;

fn count(v: f64) -> Result<usize, &'static str> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v >= usize::MAX as f64 {
        return Err("Invalid transform count");
    }
    Ok(v as usize)
}
fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 9 || settings.iter().chain(data).any(|v| !v.is_finite()) {
        return Err("Invalid transform data");
    }
    let (np, nv, ns) = (
        count(settings[6])?,
        count(settings[7])?,
        count(settings[8])?,
    );
    let pairs = np.checked_add(nv).ok_or("Transform count overflow")?;
    if pairs.checked_mul(2).and_then(|n| n.checked_add(ns)) != Some(data.len()) {
        return Err("Invalid transform size");
    }
    let points: Vec<_> = data[..pairs * 2]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| Point2::new(p[0], p[1]))
        .collect();
    let out = transform::transform(Input {
        center: Point2::new(settings[0], settings[1]),
        translation: Point2::new(settings[2], settings[3]),
        angle_degrees: settings[4],
        scale: settings[5],
        points: &points[..np],
        vectors: &points[np..],
        sizes: &data[pairs * 2..],
    })?;
    let mut result = Vec::with_capacity(data.len());
    for p in out.points.iter().chain(&out.vectors) {
        result.extend([p.x, p.y]);
    }
    result.extend(out.sizes);
    Ok(result)
}
#[wasm_bindgen]
pub fn transform_geometry(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}
