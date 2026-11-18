use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn construct_geometry(mode: u32, data: &[f64]) -> Result<Vec<f64>, JsValue> {
    sketcher_core::construction::query(mode, data)
        .map(|out| match out {
            None => vec![0.0],
            Some(values) => {
                let mut out = vec![1.0];
                out.extend(values);
                out
            }
        })
        .map_err(JsValue::from_str)
}
