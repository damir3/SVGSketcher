use sketcher_core::{
    offset::{self, Item, Shape},
    regions::Geometry,
};
use wasm_bindgen::prelude::*;
fn flag(v: f64) -> bool {
    v == 0.0 || v == 1.0
}
fn query(curves: &[f64], records: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 6
        || settings.iter().any(|v| !v.is_finite())
        || !flag(settings[0])
        || ![0.0, 1.0, 2.0].contains(&settings[2])
        || !flag(settings[5])
    {
        return Err("Invalid offset settings");
    }
    if !records.len().is_multiple_of(4) || records.iter().any(|v| !v.is_finite()) {
        return Err("Invalid offset item records");
    }
    let geometries = crate::regions::decode(curves)?;
    let mut items = vec![];
    for r in records.as_chunks::<4>().0 {
        if r[0].fract() != 0.0
            || r[0] < -1.0
            || r[0] >= geometries.len() as f64
            || r[1].fract() != 0.0
            || !(0.0..=5.0).contains(&r[1])
            || r[2].fract() != 0.0
            || !(0.0..=3.0).contains(&r[2])
            || !flag(r[3])
        {
            return Err("Invalid offset item metadata");
        }
        let geometry = if r[0] == -1.0 {
            None
        } else {
            Some(geometries[r[0] as usize].geometry.clone())
        };
        let kind = r[1] as u8;
        if let Some(g) = &geometry {
            if !matches!(
                (kind, g),
                (0, Geometry::Segment(..))
                    | (1, Geometry::Arc(..))
                    | (2, Geometry::Spline(..))
                    | (3, Geometry::Circle(..))
                    | (4, Geometry::Ellipse(..))
                    | (5, Geometry::EllipticalArc(..))
            ) {
                return Err("Offset item kind does not match geometry");
            }
        }
        items.push(Item {
            geometry,
            kind,
            reversed: r[2] as u8 & 1 != 0,
            endpoint_reversed: r[2] as u8 & 2 != 0,
            gizmo_clockwise: r[3] == 1.0,
        });
    }
    let reference = settings[1];
    if reference.fract() != 0.0
        || (items.is_empty() && reference != -1.0)
        || (!items.is_empty() && (reference < 0.0 || reference >= items.len() as f64))
    {
        return Err("Invalid offset reference index");
    }
    let result = offset::calculate(
        &items,
        settings[0] == 1.0,
        if items.is_empty() {
            0
        } else {
            reference as usize
        },
        settings[2] as u8,
        settings[3],
        settings[4],
        settings[5] == 1.0,
    );
    let mut out = vec![
        result.error as f64,
        result.anchor.x,
        result.anchor.y,
        result.normal.x,
        result.normal.y,
        result.sides.len() as f64,
    ];
    for side in result.sides {
        out.extend([
            side.error as f64,
            side.side,
            side.distance,
            side.primitives.len() as f64,
        ]);
        for prim in side.primitives {
            let mut v = vec![];
            let tag = match prim.shape {
                Shape::Line(points, _) => {
                    for p in points {
                        v.extend([p.x, p.y]);
                    }
                    0.0
                }
                Shape::Arc(c, r, points, cw) => {
                    v.extend([
                        c.x,
                        c.y,
                        points[0].x,
                        points[0].y,
                        points[1].x,
                        points[1].y,
                        r,
                        if cw { 1.0 } else { 0.0 },
                    ]);
                    1.0
                }
                Shape::Circle(c, r) => {
                    v.extend([c.x, c.y, r]);
                    2.0
                }
                Shape::Spline(s) => {
                    v.extend([
                        s.points.len() as f64,
                        if s.closed { 1.0 } else { 0.0 },
                        if s.basis.is_some() { 1.0 } else { 0.0 },
                        if s.tangents.is_some() { 1.0 } else { 0.0 },
                        if s.handles.is_some() { 1.0 } else { 0.0 },
                    ]);
                    for p in s.points {
                        v.extend([p.x, p.y]);
                    }
                    if let Some((bases, normals)) = s.basis {
                        for p in bases.into_iter().chain(normals) {
                            v.extend([p.x, p.y]);
                        }
                    }
                    if let Some(tangents) = s.tangents {
                        for p in tangents {
                            v.extend([p.x, p.y]);
                        }
                    }
                    if let Some(handles) = s.handles {
                        for h in handles {
                            for p in h {
                                v.extend([p.x, p.y]);
                            }
                        }
                    }
                    3.0
                }
            };
            out.extend([prim.source as f64, tag, v.len() as f64]);
            out.extend(v);
        }
    }
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite offset result");
    }
    Ok(out)
}
/// Region geometry records plus [curve index or -1, kind, spline reversal bits, gizmo clockwise] per item.
/// Settings: [closed, reference item, direction, distance1, distance2, flip].
#[wasm_bindgen]
pub fn offset_geometry(
    curves: &[f64],
    items: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    query(curves, items, settings).map_err(JsValue::from_str)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_lengths_indices_kinds_flags_and_finite_values() {
        let line = [0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 10.0, 0.0];
        let item = [0.0; 4];
        let settings = [0.0, 0.0, 0.0, 2.0, 0.0, 0.0];
        assert!(query(&line, &item, &settings).is_ok());
        assert!(query(&line, &[0.0], &settings).is_err());
        assert!(query(&line, &item, &[]).is_err());
        for (i, v) in [(0, 1.0), (1, 1.0), (2, 0.5), (3, f64::NAN)] {
            let mut r = item;
            r[i] = v;
            assert!(query(&line, &r, &settings).is_err());
        }
        for (i, v) in [
            (0, 0.5),
            (1, -1.0),
            (1, 0.5),
            (2, 3.0),
            (3, f64::INFINITY),
            (5, 0.1),
        ] {
            let mut s = settings;
            s[i] = v;
            assert!(query(&line, &item, &s).is_err());
        }
    }
    #[test]
    fn empty_and_missing_geometry_preserve_invalid_result_layouts() {
        assert_eq!(
            query(&[], &[], &[0.0, -1.0, 0.0, 2.0, 0.0, 0.0]).unwrap(),
            vec![4.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        );
        let r = query(
            &[],
            &[-1.0, 0.0, 0.0, 0.0],
            &[0.0, 0.0, 0.0, -2.0, 0.0, 0.0],
        )
        .unwrap();
        assert_eq!(&r[6..], &[1.0, 1.0, -2.0, 0.0]);
    }
}
