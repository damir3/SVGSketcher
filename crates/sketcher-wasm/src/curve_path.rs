use sketcher_core::{
    curve_path::{self, PathMetrics, Step},
    p,
    regions::Geometry,
};
use wasm_bindgen::prelude::*;

fn metrics(c: &Geometry, data: &[f64]) -> Result<PathMetrics, &'static str> {
    if data.len() < 4
        || !(data.len() - 4).is_multiple_of(3)
        || data.iter().any(|v| !v.is_finite())
        || data[0] < 0.0
        || data[1] < 0.0
        || ![-1.0, 1.0].contains(&data[3])
    {
        return Err("Invalid curve path metrics");
    }
    let n = (data.len() - 4) / 3;
    let valid = match c {
        Geometry::Spline(v, _) => n == if v.is_empty() { 0 } else { v.len() * 20 + 1 },
        Geometry::Ellipse(..) | Geometry::EllipticalArc(..) => n == 257 || n == 258,
        _ => n == 0,
    };
    if !valid {
        return Err("Invalid curve path table size");
    }
    let mut steps = Vec::with_capacity(n);
    let mut previous = 0.0;
    for (i, v) in data[4..].as_chunks::<3>().0.iter().enumerate() {
        if v[2] < previous || v[2] < 0.0 || (i == 0 && (v[0] != 0.0 || v[2] != 0.0)) {
            return Err("Invalid curve path lengths");
        }
        let valid = if let Geometry::Spline(curves, _) = c {
            let segment = if i == 0 { 0 } else { (i - 1) / 20 };
            let t = if i == 0 {
                0.0
            } else {
                ((i - 1) % 20 + 1) as f64 / 20.0
            };
            v[1] == segment as f64 && segment < curves.len() && v[0] == t
        } else {
            v[1] == 0.0
                && (0.0..=std::f64::consts::TAU).contains(&v[0])
                && (i == 0 || v[0] > data[4 + (i - 1) * 3])
        };
        if !valid {
            return Err("Invalid curve path step");
        }
        steps.push(Step {
            t: v[0],
            segment: v[1] as usize,
            length: v[2],
        });
        previous = v[2];
    }
    if n > 0 && (data[1] != previous || data[0] > data[1]) {
        return Err("Invalid curve path period");
    }
    if matches!(c, Geometry::Spline(..)) && data[0] != data[1] {
        return Err("Invalid spline path length");
    }
    if matches!(c, Geometry::Ellipse(..) | Geometry::EllipticalArc(..))
        && steps.last().is_none_or(|s| s.t != std::f64::consts::TAU)
    {
        return Err("Incomplete curve path table");
    }
    Ok(PathMetrics {
        length: data[0],
        period: data[1],
        begin: data[2],
        direction: data[3],
        steps,
    })
}
fn execute(
    data: &[f64],
    table: &[f64],
    values: &[f64],
    mode: u32,
) -> Result<Vec<f64>, &'static str> {
    if mode > 3 || values.iter().any(|v| !v.is_finite()) {
        return Err("Invalid curve path request");
    }
    let curves = crate::regions::decode(data)?;
    if curves.len() != 1 {
        return Err("Expected one curve path record");
    }
    let c = &curves[0].geometry;
    let result = match mode {
        0 => {
            if !table.is_empty() || !values.is_empty() {
                return Err("Unexpected curve path preparation data");
            }
            let path = curve_path::prepare(c);
            let mut out = vec![path.length, path.period, path.begin, path.direction];
            for step in path.steps {
                out.extend([step.t, step.segment as f64, step.length]);
            }
            out
        }
        1 => {
            let path = metrics(c, table)?;
            let mut out = Vec::with_capacity(values.len() * 6);
            for &distance in values {
                let f = curve_path::sample(c, &path, distance);
                out.extend([
                    f.point.x,
                    f.point.y,
                    f.tangent.x,
                    f.tangent.y,
                    f.normal.x,
                    f.normal.y,
                ]);
            }
            out
        }
        2 => {
            if !table.is_empty() {
                return Err("Unexpected curve parameter table");
            }
            values
                .iter()
                .flat_map(|&t| {
                    let p = curve_path::point_at(c, t);
                    [p.x, p.y]
                })
                .collect()
        }
        3 => {
            if !table.is_empty() || !values.len().is_multiple_of(2) {
                return Err("Invalid curve parameter points");
            }
            values
                .as_chunks::<2>()
                .0
                .iter()
                .map(|xy| curve_path::parameter_at(c, p(xy[0], xy[1])))
                .collect()
        }
        _ => unreachable!(),
    };
    if result.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite curve path result");
    }
    Ok(result)
}
#[wasm_bindgen]
pub fn curve_path(
    data: &[f64],
    table: &[f64],
    values: &[f64],
    mode: u32,
) -> Result<Vec<f64>, JsValue> {
    execute(data, table, values, mode).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    const LINE: [f64; 8] = [0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 10.0, 0.0];
    #[test]
    fn rejects_malformed_requests_and_prepared_tables() {
        assert!(execute(&LINE, &[], &[], 4).is_err());
        assert!(execute(&[], &[], &[], 0).is_err());
        assert!(execute(&LINE, &[], &[1.0], 3).is_err());
        for table in [
            vec![],
            vec![10.0, 0.0, 0.0, 0.0],
            vec![10.0, 0.0, f64::NAN, -1.0],
            vec![10.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0],
        ] {
            assert!(execute(&LINE, &table, &[1.0], 1).is_err());
        }
    }
    #[test]
    fn validates_spline_table_indices_before_sampling() {
        let curve = [5.0, 0.0, 0.0, 8.0, 0.0, 0.0, 3.0, 0.0, 6.0, 0.0, 9.0, 0.0];
        let table = execute(&curve, &[], &[], 0).unwrap();
        assert!(execute(&curve, &table, &[4.0], 1).is_ok());
        for index in [0, 1, 4, 5, 6, table.len() - 2] {
            let mut broken = table.clone();
            broken[index] = -1.0;
            assert!(execute(&curve, &broken, &[4.0], 1).is_err());
        }
    }

    #[test]
    fn returns_prepared_length_and_batched_frames() {
        let table = execute(&LINE, &[], &[], 0).unwrap();
        assert_eq!(table[0], 10.0);
        assert_eq!(
            execute(&LINE, &table, &[-1.0, 5.0, 12.0], 1).unwrap(),
            vec![
                0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 5.0, 0.0, 1.0, 0.0, 0.0, 1.0, 10.0, 0.0, 1.0, 0.0,
                0.0, 1.0
            ]
        );
    }
}
