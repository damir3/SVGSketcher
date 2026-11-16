use sketcher_core::{
    offset_resize::{self, OffsetSpline, MAX_OFFSET_SPLINE_POINTS},
    p,
};
use wasm_bindgen::prelude::*;

fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if data.len() < 2
        || data.iter().any(|v| !v.is_finite())
        || ![0.0, 1.0].contains(&data[0])
        || data[1] < 2.0
        || data[1].fract() != 0.0
        || data[1] > (data.len() - 2) as f64 / 8.0
    {
        return Err("Invalid offset spline resize data");
    }
    let n = data[1] as usize;
    if data.len() != 2 + n * 8
        || settings.len() != 2
        || settings.iter().any(|v| !v.is_finite())
        || settings[0].fract() != 0.0
        || settings[0] < n as f64
        || settings[0] > MAX_OFFSET_SPLINE_POINTS as f64
    {
        return Err("Invalid offset spline resize settings");
    }
    let mut spline = OffsetSpline {
        points: Vec::with_capacity(n),
        normals: Vec::with_capacity(n),
        handles: Vec::with_capacity(n),
        closed: data[0] == 1.0,
    };
    for v in data[2..].as_chunks::<8>().0 {
        spline.points.push(p(v[0], v[1]));
        spline.normals.push(p(v[2], v[3]));
        spline.handles.push([p(v[4], v[5]), p(v[6], v[7])]);
    }
    let result = offset_resize::resize(spline, settings[0] as usize, settings[1])?;
    let g = result.geometry;
    let mut out = Vec::with_capacity(g.points.len() * 10);
    for i in 0..g.points.len() {
        for point in [
            g.points[i],
            g.normals[i],
            result.bases[i],
            g.handles[i][0],
            g.handles[i][1],
        ] {
            out.extend([point.x, point.y]);
        }
    }
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite offset spline resize result");
    }
    Ok(out)
}
#[wasm_bindgen]
pub fn resize_offset_spline(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    const LINE: [f64; 18] = [
        0.0, 2.0, 0.0, 0.0, 0.0, 1.0, -4.0, 0.0, 4.0, 0.0, 12.0, 0.0, 0.0, 1.0, 8.0, 0.0, 16.0, 0.0,
    ];
    #[test]
    fn rejects_invalid_counts_and_flags_before_allocation() {
        for settings in [
            vec![],
            vec![1.0, 0.0],
            vec![3.5, 0.0],
            vec![f64::INFINITY, 0.0],
            vec![MAX_OFFSET_SPLINE_POINTS as f64 + 1.0, 0.0],
        ] {
            assert!(query(&LINE, &settings).is_err());
        }
        for data in [vec![], vec![0.0, 2.0], vec![2.0, 2.0], vec![0.0, 1e20]] {
            assert!(query(&data, &[3.0, 1.0]).is_err());
        }
    }
    #[test]
    fn returns_ten_slots_per_requested_point() {
        let result = query(&LINE, &[3.0, 2.0]).unwrap();
        assert_eq!(result.len(), 30);
        assert_eq!(&result[10..16], &[6.0, 0.0, 0.0, 1.0, 6.0, -2.0]);
    }
}
