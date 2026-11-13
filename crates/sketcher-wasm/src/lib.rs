use sketcher_core::{intersect, Curve, Point2};
use wasm_bindgen::prelude::*;

mod chamfer;
mod editing;
mod fillet;
mod offset;
mod regions;
mod solver;
mod spline;

const CURVE_STRIDE: usize = 9;
const PAIR_STRIDE: usize = CURVE_STRIDE * 2;

#[wasm_bindgen]
pub fn api_version() -> u32 {
    19
}

fn decode_curve(data: &[f64]) -> Result<Curve, &'static str> {
    if data.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite curve data");
    }
    match data[0] {
        0.0 => Ok(Curve::Segment {
            p1: Point2 {
                x: data[1],
                y: data[2],
            },
            p2: Point2 {
                x: data[3],
                y: data[4],
            },
        }),
        1.0 if data[3] >= 0.0 => Ok(Curve::Circle {
            center: Point2 {
                x: data[1],
                y: data[2],
            },
            radius: data[3],
        }),
        2.0 => Ok(Curve::Ellipse {
            center: Point2 {
                x: data[1],
                y: data[2],
            },
            major_axis_point: Point2 {
                x: data[3],
                y: data[4],
            },
            minor_axis_point: Point2 {
                x: data[5],
                y: data[6],
            },
        }),
        3.0 => Ok(Curve::Bezier {
            points: std::array::from_fn(|i| Point2 {
                x: data[1 + i * 2],
                y: data[2 + i * 2],
            }),
        }),
        _ => Err("Unknown curve tag or negative radius"),
    }
}

fn intersect_packed(data: &[f64]) -> Result<Vec<f64>, &'static str> {
    let (pairs, remainder) = data.as_chunks::<PAIR_STRIDE>();
    if !remainder.is_empty() {
        return Err("Invalid intersection pair buffer length");
    }
    let mut result = Vec::new();
    for pair in pairs {
        let points = intersect(
            decode_curve(&pair[..CURVE_STRIDE])?,
            decode_curve(&pair[CURVE_STRIDE..])?,
        );
        result.push(points.len() as f64);
        for point in points {
            result.extend([point.x, point.y]);
        }
    }
    Ok(result)
}

/// Input: nine slots per curve. Cubic: [3, x0, y0, x1, y1, x2, y2, x3, y3].
/// Segment, circle and ellipse retain their previous slots followed by zero padding.
/// Output: [point_count, x, y, ...] for every input pair, including empty results.
#[wasm_bindgen]
pub fn intersect_pairs(data: &[f64]) -> Result<Vec<f64>, JsValue> {
    intersect_packed(data).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_preserves_empty_results_and_order() {
        let data = [
            0.0, -2.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 5.0, 0.0, 1.0, 0.0, 0.0, 0.0,
            0.0, 0.0,
        ];
        assert_eq!(
            intersect_packed(&data).unwrap(),
            vec![2.0, -1.0, 0.0, 1.0, 0.0, 0.0]
        );
        assert!(intersect_packed(&[]).unwrap().is_empty());
    }

    #[test]
    fn decodes_ellipse_axes_and_returns_four_intersections() {
        let data = [
            2.0, 0.0, 0.0, 5.0, 0.0, 0.0, 3.0, 0.0, 0.0, 1.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 0.0,
            0.0,
        ];
        let result = intersect_packed(&data).unwrap();
        assert_eq!(result[0], 4.0);
        assert_eq!(result.len(), 9);
        assert!(result.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn decodes_all_four_cubic_control_points() {
        let data = [
            3.0, -3.0, 0.0, -1.0, 0.0, 1.0, 0.0, 3.0, 0.0, 3.0, 0.0, -3.0, 0.0, -1.0, 0.0, 1.0,
            0.0, 3.0,
        ];
        let hits = intersect_packed(&data).unwrap();
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0], 1.0);
        assert!(hits[1].hypot(hits[2]) < 1e-8);
        let mut invalid = data;
        invalid[8] = f64::INFINITY;
        assert!(intersect_packed(&invalid).is_err());
    }

    #[test]
    fn rejects_malformed_buffers() {
        assert!(intersect_packed(&[0.0]).is_err());
        let mut data = [0.0; PAIR_STRIDE];
        data[0] = 4.0;
        assert!(intersect_packed(&data).is_err());
        data[0] = f64::NAN;
        assert!(intersect_packed(&data).is_err());
        data[0] = 1.0;
        data[3] = -1.0;
        assert!(intersect_packed(&data).is_err());
    }
}
