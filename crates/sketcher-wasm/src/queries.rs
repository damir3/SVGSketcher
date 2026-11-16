use sketcher_core::{
    p,
    queries::{self, Bounds},
};
use wasm_bindgen::prelude::*;

fn count(data: &[f64], cursor: &mut usize) -> Result<usize, &'static str> {
    let v = *data.get(*cursor).ok_or("Missing query count")?;
    *cursor += 1;
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v > (data.len() - *cursor) as f64 {
        return Err("Invalid query count");
    }
    Ok(v as usize)
}
fn query(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 5
        || settings.iter().any(|v| !v.is_finite())
        || settings[0].fract() != 0.0
        || !(0.0..=6.0).contains(&settings[0])
    {
        return Err("Invalid geometry query settings");
    }
    let mode = settings[0] as u8;
    let point = p(settings[1], settings[2]);
    if mode == 6 {
        if data.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite region query");
        }
        let mut cursor = 0;
        let total = count(data, &mut cursor)?;
        let mut out = vec![];
        for _ in 0..total {
            let rings = count(data, &mut cursor)?;
            if rings == 0 {
                return Err("Missing outer ring");
            }
            let mut inside = false;
            for r in 0..rings {
                let n = count(data, &mut cursor)?;
                if n > (data.len() - cursor) / 2 {
                    return Err("Invalid query ring");
                }
                let points: Vec<_> = data[cursor..cursor + n * 2]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|xy| p(xy[0], xy[1]))
                    .collect();
                cursor += n * 2;
                let hit = queries::in_ring(point, &points);
                if r == 0 {
                    inside = hit;
                } else if hit {
                    inside = false;
                }
            }
            out.push(f64::from(inside));
        }
        if cursor != data.len() {
            return Err("Trailing region query data");
        }
        return Ok(out);
    }
    if (1..=3).contains(&mode) && (settings[3] < 0.0 || settings[4] < 0.0) {
        return Err("Negative query threshold");
    }
    let rect = Bounds {
        min: point,
        max: p(settings[3], settings[4]),
    };
    if mode >= 4 && (rect.min.x > rect.max.x || rect.min.y > rect.max.y) {
        return Err("Invalid query box");
    }
    let curves: Vec<_> = crate::regions::decode(data)?
        .into_iter()
        .map(|c| c.geometry)
        .collect();
    let out = match mode {
        0 => curves
            .iter()
            .flat_map(|c| {
                queries::bounds(c).map_or([0.0; 5], |b| [1.0, b.min.x, b.min.y, b.max.x, b.max.y])
            })
            .collect(),
        1 => curves
            .iter()
            .flat_map(|c| {
                queries::hit_distance(c, point, settings[3]).map_or([0.0; 2], |d| [1.0, d])
            })
            .collect(),
        2 | 3 => queries::closest(&curves, point, settings[3], mode == 3, settings[4])
            .map_or(vec![-1.0, 0.0, 0.0, 0.0, 0.0], |(i, q)| {
                vec![i as f64, q.distance, q.point.x, q.point.y, q.param]
            }),
        4 | 5 => curves
            .iter()
            .map(|c| {
                f64::from(if mode == 4 {
                    queries::intersects_box(c, rect)
                } else {
                    queries::contained(c, rect)
                })
            })
            .collect(),
        _ => unreachable!(),
    };
    Ok(out)
}
#[wasm_bindgen]
pub fn geometry_queries(data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(data, settings).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_settings_and_rings() {
        for settings in [
            vec![],
            vec![7.0, 0.0, 0.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, -1.0, 0.0],
            vec![4.0, 1.0, 0.0, 0.0, 1.0],
        ] {
            assert!(query(&[], &settings).is_err());
        }
        for data in [
            vec![],
            vec![1.0, 0.0],
            vec![1.0, 1.0, 2.0, 0.0, 0.0],
            vec![0.0, 1.0],
            vec![1.0, 1.0, f64::NAN],
        ] {
            assert!(query(&data, &[6.0, 0.0, 0.0, 0.0, 0.0]).is_err());
        }
    }
    #[test]
    fn contains_outer_and_excludes_holes() {
        let data = [
            1.0, 2.0, 4.0, 0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0, 4.0, 4.0, 4.0, 6.0, 4.0,
            6.0, 6.0, 4.0, 6.0,
        ];
        assert_eq!(query(&data, &[6.0, 2.0, 2.0, 0.0, 0.0]).unwrap(), vec![1.0]);
        assert_eq!(query(&data, &[6.0, 5.0, 5.0, 0.0, 0.0]).unwrap(), vec![0.0]);
    }
}
