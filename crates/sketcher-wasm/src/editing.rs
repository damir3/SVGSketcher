use sketcher_core::{editing, regions::Geometry, Point2};
use wasm_bindgen::prelude::*;

fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 4
        || settings.iter().any(|v| !v.is_finite())
        || ![0.0, 1.0, 2.0].contains(&settings[0])
        || ![0.0, 1.0].contains(&settings[3])
    {
        return Err("Invalid curve editing settings");
    }
    let curves = crate::regions::decode(data)?;
    let (target, others) = curves.split_first().ok_or("Missing editing target")?;
    if settings[3] == 1.0 && !matches!(target.geometry, Geometry::Spline(..)) {
        return Err("Invalid editing spline kind");
    }
    let cursor = Point2 {
        x: settings[1],
        y: settings[2],
    };
    let index = |v: Option<usize>| v.map_or(-1.0, |i| i as f64);
    let out = match settings[0] {
        0.0 => {
            let hits = editing::curve_intersections(target, others);
            let mut out = vec![hits.len() as f64];
            for h in hits {
                out.extend([h.point.x, h.point.y, h.param, h.source as f64]);
            }
            out
        }
        1.0 => {
            let r = editing::trim(target, others, cursor, settings[3] == 1.0);
            vec![
                r.interval[0],
                r.interval[1],
                r.start.x,
                r.start.y,
                r.end.x,
                r.end.y,
                index(r.start_source),
                index(r.end_source),
                if r.whole { 1.0 } else { 0.0 },
            ]
        }
        _ => match editing::extend(target, others, cursor, settings[3] == 1.0) {
            None => vec![0.0],
            Some(r) => vec![
                1.0,
                if r.end { 1.0 } else { 0.0 },
                r.from.x,
                r.from.y,
                r.to.x,
                r.to.y,
                index(r.source),
                if r.full { 1.0 } else { 0.0 },
            ],
        },
    };
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite curve editing result");
    }
    Ok(out)
}
#[wasm_bindgen]
pub fn curve_editing(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_settings_target_and_control_kind() {
        for s in [
            vec![],
            vec![3.0, 0.0, 0.0, 0.0],
            vec![0.0, f64::NAN, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.5],
        ] {
            assert!(query(&[], &s).is_err())
        }
        assert!(query(&[], &[1.0, 0.0, 0.0, 0.0]).is_err());
        assert!(query(&[1.0, 0.0, 0.0, 3.0, 0.0, 0.0, 1.0], &[1.0, 0.0, 0.0, 1.0]).is_err());
    }
    #[test]
    fn fixed_result_layouts() {
        let l = [0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 10.0, 0.0];
        assert_eq!(query(&l, &[0.0, 0.0, 0.0, 0.0]).unwrap(), vec![0.0]);
        assert_eq!(
            query(&l, &[1.0, 5.0, 0.0, 0.0]).unwrap(),
            vec![0.0, 1.0, 0.0, 0.0, 10.0, 0.0, -1.0, -1.0, 1.0]
        );
        assert_eq!(
            query(&l, &[2.0, 10.0, 0.0, 0.0]).unwrap(),
            vec![1.0, 1.0, 10.0, 0.0, 60.0, 0.0, -1.0, 0.0]
        );
    }
}
