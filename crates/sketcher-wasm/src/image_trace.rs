use sketcher_core::{
    image_trace::{self, SegmentKind, Settings, Spline},
    Point2,
};
use wasm_bindgen::prelude::*;
fn point(out: &mut Vec<f64>, p: Point2) {
    out.extend([p.x, p.y]);
}
fn spline(out: &mut Vec<f64>, s: Spline) {
    out.extend([s.points.len() as f64, s.handles.len() as f64]);
    for p in s.points {
        point(out, p);
    }
    for [a, b] in s.handles {
        point(out, a);
        point(out, b);
    }
}
fn query(gray: &[f32], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    let s = Settings::decode(settings, gray.len())?;
    let t = image_trace::trace(gray, &s)?;
    let mut out = vec![t.threshold, t.vertices.len() as f64];
    for p in t.vertices {
        point(&mut out, p);
    }
    out.push(t.paths.len() as f64);
    for path in t.paths {
        out.extend([f64::from(path.closed), path.segments.len() as f64]);
        for (seg, tangent) in path.segments.into_iter().zip(path.tangent) {
            let tag = match &seg.kind {
                SegmentKind::Line => 0.0,
                SegmentKind::Arc { .. } => 1.0,
                SegmentKind::Spline(_) => 2.0,
            };
            out.extend([tag, seg.a as f64, seg.b as f64, f64::from(tangent)]);
            match seg.kind {
                SegmentKind::Line => {}
                SegmentKind::Arc { circle, mid } => {
                    point(&mut out, circle.center);
                    out.push(circle.radius);
                    point(&mut out, mid);
                }
                SegmentKind::Spline(s) => spline(&mut out, s),
            }
        }
    }
    out.push(t.circles.len() as f64);
    for c in t.circles {
        point(&mut out, c.center);
        out.push(c.radius);
    }
    out.push(t.closed_splines.len() as f64);
    for s in t.closed_splines {
        spline(&mut out, s);
    }
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite image trace result");
    }
    Ok(out)
}
#[wasm_bindgen]
pub fn trace_image(gray: &[f32], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(gray, settings).map_err(JsValue::from_str)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> [f64; 22] {
        [
            4., 4., 1., 1., 0., 0., 0., 1., 128., 0., 0., 0., 1., 1.5, 1., 12., 40., 1., 1., 1.,
            1., 0.,
        ]
    }
    #[test]
    fn rejects_bad_rasters_and_settings() {
        let s = settings();
        assert!(query(&[255.; 15], &s).is_err());
        assert!(query(&[f32::NAN; 16], &s).is_err());
        for (i, value) in [
            (0, 1e20),
            (1, -1.),
            (2, 0.),
            (4, 2.),
            (10, -1.),
            (12, 1e20),
            (13, f64::NAN),
        ] {
            let mut bad = s;
            bad[i] = value;
            assert!(query(&[255.; 16], &bad).is_err());
        }
    }
    #[test]
    fn empty_raster_has_no_geometry() {
        assert_eq!(
            query(&[255.; 16], &settings()).unwrap(),
            vec![129., 0., 0., 0., 0.]
        );
    }
}
