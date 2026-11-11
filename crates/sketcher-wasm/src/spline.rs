use sketcher_core::{spline, CubicBezier, Point2};
use wasm_bindgen::prelude::*;

/// Numeric spline boundary for editor operations and independent parity checks.
/// Settings: [mode, target x, target y, parameter]. Modes 0..3 retain the original queries;
/// 4/5 evaluate position/tangent, 6/7 evaluate one cubic/derivative, 8 splits one cubic,
/// and 9 projects without computing the unused tangent and sample.
#[wasm_bindgen]
pub fn spline_geometry(
    points: &[f64],
    handles: &[f64],
    knots: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    if settings.len() != 4
        || !(0.0..=9.0).contains(&settings[0])
        || settings[0].fract() != 0.0
        || !points.len().is_multiple_of(2)
        || points
            .iter()
            .chain(handles)
            .chain(knots)
            .chain(settings)
            .any(|v| !v.is_finite())
    {
        return Err(JsValue::from_str("Invalid spline geometry buffers"));
    }
    let pts: Vec<Point2> = points
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| Point2 { x: p[0], y: p[1] })
        .collect();
    if settings[0] >= 3.0 {
        let (segments, remainder) = pts.as_chunks::<4>();
        if !remainder.is_empty() {
            return Err(JsValue::from_str("Invalid spline segment buffer"));
        }
        if settings[0] == 4.0 || settings[0] == 5.0 {
            let point = if settings[0] == 4.0 {
                spline::point_at(segments, settings[3])
            } else {
                spline::tangent_at(segments, settings[3])
            };
            return Ok(vec![point.x, point.y]);
        }
        if (6.0..=8.0).contains(&settings[0]) {
            if segments.len() != 1 {
                return Err(JsValue::from_str("Expected one spline segment"));
            }
            if settings[0] == 8.0 {
                return Ok(spline::split_at(&segments[0], settings[3])
                    .iter()
                    .flat_map(|s| s.iter().flat_map(|p| [p.x, p.y]))
                    .collect());
            }
            let point = if settings[0] == 6.0 {
                spline::evaluate_bezier(&segments[0], settings[3])
            } else {
                spline::derivative_bezier(&segments[0], settings[3])
            };
            return Ok(vec![point.x, point.y]);
        }
        let target = Point2 {
            x: settings[1],
            y: settings[2],
        };
        let (param, distance, point) = spline::project(segments, target);
        if settings[0] == 9.0 {
            return Ok(vec![param, distance, point.x, point.y]);
        }
        let tangent = spline::tangent_at(segments, param);
        let sample = spline::point_at(segments, settings[3]);
        return Ok(vec![
            param, distance, point.x, point.y, tangent.x, tangent.y, sample.x, sample.y,
        ]);
    }
    if settings[0] == 0.0 {
        return Ok(spline::natural_handles(&pts)
            .iter()
            .flat_map(|h| [h[0].x, h[0].y, h[1].x, h[1].y])
            .collect());
    }
    let segments: Vec<CubicBezier> = if settings[0] == 1.0 {
        if (!handles.is_empty() && handles.len() != pts.len() * 5)
            || handles
                .as_chunks::<5>()
                .0
                .iter()
                .any(|h| ![0.0, 1.0].contains(&h[0]))
        {
            return Err(JsValue::from_str("Invalid spline handles"));
        }
        let hs: Vec<_> = handles
            .as_chunks::<5>()
            .0
            .iter()
            .map(|h| {
                if h[0] == 0.0 {
                    None
                } else {
                    Some([Point2 { x: h[1], y: h[2] }, Point2 { x: h[3], y: h[4] }])
                }
            })
            .collect();
        spline::fit_to_bezier(&pts, &hs)
    } else {
        if pts.len() >= 5 && knots.len() == pts.len() + 4 && !spline::valid_knots(pts.len(), knots)
        {
            return Err(JsValue::from_str("Unsupported spline knot vector"));
        }
        spline::control_to_bezier(&pts, knots)
    };
    Ok(segments
        .iter()
        .flat_map(|s| s.iter().flat_map(|p| [p.x, p.y]))
        .collect())
}
