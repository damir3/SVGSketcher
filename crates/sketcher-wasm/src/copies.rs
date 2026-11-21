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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_packets_tags_and_flags() {
        for (points, ops) in [
            (&[0.0][..], &[][..]),
            (&[], &[0.0, 0.0]),
            (&[], &[99.0]),
            (&[], &[-1.0]),
            (&[], &[1.5]),
            (&[], &[f64::NAN]),
            (&[f64::NAN, 0.0], &[4.0, 0.0, 0.0]),
            (&[], &[1.0, 0.0, 0.0, 4.0, 3.0, 90.0, 1.0]),
            (
                &[],
                &[5.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ),
        ] {
            assert!(query(points, ops).is_err());
        }
    }
    #[test]
    fn decodes_packed_multi_operation_batches_with_expected_stride() {
        let points = [10.0, 5.0, 0.0, 0.0];
        let ops = [
            0.0, 0.0, 0.0, 10.0, 0.0, // mirror across X axis
            4.0, 3.0, -2.0, // translate by (3, -2)
            5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // default directions
        ];
        let out = query(&points, &ops).unwrap();
        let stride = 6 + 3 * 2;
        assert_eq!(out.len(), 3 * stride);
        // Mirror across X axis: (10, 5) -> (10, -5), near=0; (0, 0) -> (0, 0), near=1
        assert_eq!(out[0], 1.0);
        assert_eq!(&out[6..12], &[10.0, -5.0, 0.0, 0.0, 0.0, 1.0]);
        // Translate by (3, -2)
        assert_eq!(
            &out[stride + 6..stride + 12],
            &[13.0, 3.0, 0.0, 3.0, -2.0, 0.0]
        );
        // Default directions: u1=(1,0), u2=(0,1)
        assert_eq!(&out[2 * stride + 2..2 * stride + 6], &[1.0, 0.0, 0.0, 1.0]);
    }
}
