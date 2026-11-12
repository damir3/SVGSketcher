use sketcher_core::{
    chamfer::{self, Corner, Mode},
    Point2,
};
use wasm_bindgen::prelude::*;
fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 6
        || settings.iter().any(|v| !v.is_finite())
        || ![0.0, 1.0].contains(&settings[0])
        || ![0.0, 1.0, 2.0].contains(&settings[1])
        || ![0.0, 1.0].contains(&settings[5])
    {
        return Err("Invalid chamfer settings");
    }
    let required = if settings[0] == 0.0 { 6 } else { 9 };
    if data.len() != required || data.iter().any(|v| !v.is_finite()) {
        return Err("Invalid chamfer geometry");
    }
    let point = |i| Point2 {
        x: data[i],
        y: data[i + 1],
    };
    let out = if settings[0] == 0.0 {
        match chamfer::corner(point(0), point(2), point(4)) {
            None => vec![0.0],
            Some(c) => vec![
                1.0, c.dir1.x, c.dir1.y, c.dir2.x, c.dir2.y, c.len1, c.len2, c.angle,
            ],
        }
    } else {
        if data[6] < 0.0 || data[7] < 0.0 || !(0.0..=std::f64::consts::PI).contains(&data[8]) {
            return Err("Invalid chamfer corner bounds");
        }
        let c = Corner {
            vertex: point(0),
            dir1: point(2),
            dir2: point(4),
            len1: data[6],
            len2: data[7],
            angle: data[8],
        };
        let mode = match settings[1] {
            0.0 => Mode::EqualDistance,
            1.0 => Mode::TwoDistance,
            _ => Mode::DistanceAngle,
        };
        let r = chamfer::calculate(
            c,
            mode,
            settings[2],
            settings[3],
            settings[4],
            settings[5] == 1.0,
        );
        let error = match r.error {
            chamfer::Error::None => 0.0,
            chamfer::Error::ZeroAngle => 1.0,
            chamfer::Error::LargeAngle => 2.0,
            chamfer::Error::LargeDistance => 3.0,
        };
        vec![
            r.t1.x,
            r.t1.y,
            r.t2.x,
            r.t2.y,
            r.dist1,
            r.dist2,
            r.angle,
            r.length,
            r.midpoint.x,
            r.midpoint.y,
            r.bisector.x,
            r.bisector.y,
            r.max1,
            r.max2,
            error,
        ]
    };
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite chamfer result");
    }
    Ok(out)
}
/// Settings: [operation, mode, distance1, distance2, angle_degrees, flip].
/// Operation 0 prepares a corner from three points; operation 1 calculates the chamfer.
#[wasm_bindgen]
pub fn chamfer_geometry(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_buffers_modes_flags_and_non_finite_values() {
        let data = [0.0, 0.0, 100.0, 0.0, 0.0, 80.0];
        let valid = [0.0; 6];
        assert!(query(&data, &valid).is_ok());
        assert!(query(&[], &valid).is_err());
        assert!(query(&data, &[]).is_err());
        for (index, value) in [
            (0, 2.0),
            (1, 3.0),
            (1, 0.5),
            (5, 0.5),
            (2, f64::NAN),
            (4, f64::INFINITY),
        ] {
            let mut s = valid;
            s[index] = value;
            assert!(query(&data, &s).is_err());
        }
        let mut d = data;
        d[3] = f64::INFINITY;
        assert!(query(&d, &valid).is_err());
        assert!(query(
            &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, -1.0, 10.0, 1.0],
            &[1.0, 0.0, 1.0, 1.0, 45.0, 0.0]
        )
        .is_err());
    }
    #[test]
    fn encodes_invalid_angles_and_corner_rejection_without_js_errors() {
        assert_eq!(query(&[0.0; 6], &[0.0; 6]).unwrap(), vec![0.0]);
        let c = [
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            1.0,
            100.0,
            80.0,
            std::f64::consts::FRAC_PI_2,
        ];
        let result = query(&c, &[1.0, 2.0, 10.0, 0.0, 0.0, 1.0]).unwrap();
        assert_eq!(result.len(), 15);
        assert_eq!(result[14], 1.0);
        assert_eq!(result[4], 10.0);
        assert_eq!(result[5], 0.0);
    }
}
