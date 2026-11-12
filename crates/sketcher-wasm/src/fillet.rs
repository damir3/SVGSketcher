use sketcher_core::{
    fillet::{self, Options},
    regions::Geometry,
    Point2,
};
use wasm_bindgen::prelude::*;

fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 10
        || settings.iter().any(|v| !v.is_finite())
        || ![0.0, 1.0, 2.0, 3.0].contains(&settings[0])
        || ![0.0, 1.0].contains(&settings[3])
    {
        return Err("Invalid fillet settings");
    }
    let curves = crate::regions::decode(data)?;
    let mode = settings[0];
    if curves.len() != if mode < 2.0 { 1 } else { 2 } {
        return Err("Invalid fillet curve count");
    }
    if curves.iter().any(|c| {
        !matches!(
            c.geometry,
            Geometry::Segment(..) | Geometry::Arc(..) | Geometry::Spline(..)
        )
    }) {
        return Err("Unsupported fillet curve");
    }
    let point = |i| Point2 {
        x: settings[i],
        y: settings[i + 1],
    };
    let options = Options {
        corner: if settings[3] == 1.0 {
            Some(point(4))
        } else {
            None
        },
        click1: point(6),
        click2: point(8),
    };
    let a = &curves[0].geometry;
    let out = match mode {
        0.0 => {
            let r = fillet::evaluate(a, settings[1]);
            vec![
                r.point.x,
                r.point.y,
                r.tangent.x,
                r.tangent.y,
                r.normal.x,
                r.normal.y,
            ]
        }
        1.0 => {
            let r = fillet::project(a, point(1));
            vec![r.t, r.point.x, r.point.y, r.dist]
        }
        2.0 => match fillet::calculate(a, &curves[1].geometry, settings[1], options) {
            None => vec![0.0],
            Some(r) => vec![
                1.0,
                r.center.x,
                r.center.y,
                r.radius,
                r.t1.x,
                r.t1.y,
                r.t2.x,
                r.t2.y,
                if r.clockwise { 1.0 } else { 0.0 },
                r.corner.x,
                r.corner.y,
                r.mid_arc.x,
                r.mid_arc.y,
                r.bisector.x,
                r.bisector.y,
                r.param1,
                r.param2,
            ],
        },
        _ => match fillet::max_radius(a, &curves[1].geometry, options, settings[1], settings[2]) {
            None => vec![0.0],
            Some(r) => vec![1.0, r],
        },
    };
    let empty_projection = mode == 1.0 && matches!(a,Geometry::Spline(s,_) if s.is_empty());
    if out
        .iter()
        .enumerate()
        .any(|(i, v)| !v.is_finite() && !(empty_projection && i == 3 && *v == f64::INFINITY))
    {
        return Err("Non-finite fillet result");
    }
    Ok(out)
}
/// Reuses the region curve records. Settings: [mode, a, b, has_corner, vx, vy, click1x, click1y, click2x, click2y].
/// Modes: evaluate(a=t), project(a=x,b=y), calculate(a=radius), maximum(a=max,b=min).
#[wasm_bindgen]
pub fn fillet_geometry(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_settings_and_curve_count() {
        let line = [0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 100.0, 0.0];
        let valid = [0.0; 10];
        assert!(query(&line, &valid).is_ok());
        assert!(query(&line, &[]).is_err());
        for (i, v) in [
            (0, 4.0),
            (0, 0.5),
            (3, 0.5),
            (1, f64::INFINITY),
            (9, f64::NAN),
        ] {
            let mut s = valid;
            s[i] = v;
            assert!(query(&line, &s).is_err());
        }
        assert!(query(&[], &valid).is_err());
        let mut s = valid;
        s[0] = 2.0;
        assert!(query(&line, &s).is_err());
        assert!(query(&[1.0, 0.0, 0.0, 3.0, 0.0, 0.0, 10.0], &valid).is_err());
    }
    #[test]
    fn result_layouts_and_empty_spline_sentinel() {
        let line = [0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 100.0, 0.0];
        assert_eq!(
            query(&line, &[0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]).unwrap(),
            vec![50.0, 0.0, 1.0, 0.0, -0.0, 1.0]
        );
        assert_eq!(
            query(
                &line,
                &[1.0, 150.0, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
            )
            .unwrap(),
            vec![1.5, 150.0, 0.0, 20.0]
        );
        let empty = [5.0, 0.0, 0.0, 0.0];
        assert_eq!(
            query(&empty, &[1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]).unwrap(),
            vec![0.0, 2.0, 3.0, f64::INFINITY]
        );
    }
}
