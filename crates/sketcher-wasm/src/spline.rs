use sketcher_core::{regions, spline, spline_editing, CubicBezier, Point2};
use wasm_bindgen::prelude::*;

/// Cut modes use [mode, start, end, 0]; each output piece is [source index, original-point mask, eight coordinates].
fn cut_query(
    segments: &[CubicBezier],
    handles: &[f64],
    knots: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, &'static str> {
    if !handles.is_empty() || !knots.is_empty() || settings[3] != 0.0 {
        return Err("Invalid spline cut settings");
    }
    let (mut result, pieces) = match settings[0] as u8 {
        11 if settings[2] == 0.0 => {
            let (mut left, right) = spline_editing::split(segments, settings[1])
                .ok_or("Cannot split an empty spline")?;
            let header = vec![left.len() as f64];
            left.extend(right);
            (header, left)
        }
        12 if segments.len() == 1 => (
            vec![],
            vec![spline_editing::trim(&segments[0], settings[1], settings[2])],
        ),
        13 => {
            if settings[1] > settings[2]
                && (settings[1] - settings[2]).abs() >= 1e-5
                && (settings[1] > 1.0 || settings[2] < 0.0)
            {
                return Err("Invalid spline wrapped interval");
            }
            let interval = spline_editing::extract(segments, settings[1], settings[2]);
            (
                vec![u8::from(interval.reuse_source) as f64],
                interval.pieces,
            )
        }
        _ => return Err("Invalid spline cut mode or segment count"),
    };
    for piece in pieces {
        result.extend([piece.source_index as f64, piece.original_points as f64]);
        result.extend(piece.curve.iter().flat_map(|p| [p.x, p.y]));
    }
    if result.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite spline cut result");
    }
    Ok(result)
}

/// Numeric spline boundary for editor operations and independent parity checks.
/// Settings: [mode, target x, target y, parameter]. Modes 0..3 retain the original queries;
/// 4/5 evaluate position/tangent, 6/7 evaluate one cubic/derivative, 8 splits one cubic,
/// 9 projects without computing the unused tangent and sample, 10 finds all spline self-intersections;
/// 11 splits a whole spline, 12 trims one cubic, 13 extracts a whole-spline interval.
#[wasm_bindgen]
pub fn spline_geometry(
    points: &[f64],
    handles: &[f64],
    knots: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    if settings.len() != 4
        || !(0.0..=13.0).contains(&settings[0])
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
        if settings[0] >= 11.0 {
            return cut_query(segments, handles, knots, settings).map_err(JsValue::from_str);
        }
        if settings[0] == 10.0 {
            if !handles.is_empty()
                || !knots.is_empty()
                || settings[1] != 0.0
                || settings[2] != 0.0
                || ![0.0, 1.0].contains(&settings[3])
            {
                return Err(JsValue::from_str(
                    "Invalid spline self-intersection settings",
                ));
            }
            let result: Vec<f64> = regions::spline_self_intersections(segments, settings[3] == 1.0)
                .into_iter()
                .flat_map(|(point, a, b)| [point.x, point.y, a, b])
                .collect();
            if result.iter().any(|v| !v.is_finite()) {
                return Err(JsValue::from_str(
                    "Non-finite spline self-intersection result",
                ));
            }
            return Ok(result);
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

#[cfg(test)]
mod tests {
    use super::*;
    use sketcher_core::p;

    #[test]
    fn cut_protocol_preserves_headers_provenance_and_counts() {
        let curve = [p(0.0, 1.0), p(4.0, 9.0), p(12.0, -3.0), p(17.0, 5.0)];
        let split = cut_query(&[curve; 3], &[], &[], &[11.0, 0.5, 0.0, 0.0]).unwrap();
        assert_eq!(split.len(), 1 + 4 * 10);
        assert_eq!(split[0], 2.0);
        assert_eq!(&split[11..13], &[1.0, 1.0]);
        assert_eq!(&split[21..23], &[1.0, 8.0]);
        let whole = cut_query(&[curve; 3], &[], &[], &[13.0, 0.0, 1.0, 0.0]).unwrap();
        assert_eq!(whole[0], 1.0);
        assert_eq!(whole.len(), 31);
        assert_eq!(
            cut_query(&[], &[], &[], &[13.0, 0.5, 0.5, 0.0]).unwrap(),
            vec![0.0]
        );
        assert_eq!(
            cut_query(&[curve], &[], &[], &[13.0, 1.0 + 1e-6, 1.0, 0.0]).unwrap(),
            vec![0.0]
        );
    }

    #[test]
    fn cut_protocol_rejects_unused_fields_invalid_arity_and_overflow() {
        let curve = [p(0.0, 1.0), p(4.0, 9.0), p(12.0, -3.0), p(17.0, 5.0)];
        for settings in [
            [11.0, 0.5, 1.0, 0.0],
            [12.0, 0.0, 1.0, 1.0],
            [13.0, 1.5, 0.5, 0.0],
            [13.0, 0.5, -0.5, 0.0],
        ] {
            assert!(cut_query(&[curve], &[], &[], &settings).is_err());
        }
        assert!(cut_query(&[], &[], &[], &[11.0, 0.5, 0.0, 0.0]).is_err());
        assert!(cut_query(&[curve; 2], &[], &[], &[12.0, 0.0, 1.0, 0.0]).is_err());
        assert!(cut_query(&[curve], &[0.0], &[], &[13.0, 0.0, 1.0, 0.0]).is_err());
        assert!(cut_query(&[curve], &[], &[0.0], &[13.0, 0.0, 1.0, 0.0]).is_err());
        assert!(cut_query(&[curve], &[], &[], &[12.0, 0.0, -f64::MAX, 0.0]).is_err());
    }
}
