use sketcher_core::regions::{find_regions, Geometry, RegionCurve};
use sketcher_core::Point2;
use wasm_bindgen::prelude::*;

// Records: [tag, identity, closed/clockwise, payload slots, ...coordinates].
fn decode(data: &[f64]) -> Result<Vec<RegionCurve>, &'static str> {
    if data.iter().any(|x| !x.is_finite()) {
        return Err("Non-finite region curve data");
    }
    let mut out = vec![];
    let mut offset = 0;
    while offset < data.len() {
        let header = data
            .get(offset..offset + 4)
            .ok_or("Truncated region record")?;
        if !(0.0..=5.0).contains(&header[0])
            || header[0].fract() != 0.0
            || header[1] < 0.0
            || header[1] > u32::MAX as f64
            || header[1].fract() != 0.0
            || ![0.0, 1.0].contains(&header[2])
            || header[3] < 0.0
            || header[3].fract() != 0.0
            || header[3] > data.len() as f64
        {
            return Err("Invalid region record header");
        }
        let count = header[3] as usize;
        offset += 4;
        let v = data
            .get(offset..offset + count)
            .ok_or("Truncated region coordinates")?;
        let point = |i| Point2 {
            x: v[i],
            y: v[i + 1],
        };
        let geometry = match (header[0] as u8, count) {
            (0, 4) if header[2] == 0.0 => Geometry::Segment(point(0), point(2)),
            (1, 3) if header[2] == 0.0 && v[2] >= 0.0 => Geometry::Circle(point(0), v[2]),
            (2, 6) if header[2] == 0.0 => Geometry::Ellipse(point(0), point(2), point(4)),
            (3, 7) if v[2] >= 0.0 => {
                Geometry::Arc(point(0), v[2], point(3), point(5), header[2] == 1.0)
            }
            (4, 10) => Geometry::EllipticalArc(
                point(0),
                point(2),
                point(4),
                point(6),
                point(8),
                header[2] == 1.0,
            ),
            (5, n) if n % 8 == 0 => Geometry::Spline(
                v.as_chunks::<8>()
                    .0
                    .iter()
                    .map(|s| {
                        std::array::from_fn(|i| Point2 {
                            x: s[i * 2],
                            y: s[i * 2 + 1],
                        })
                    })
                    .collect(),
                header[2] == 1.0,
            ),
            _ => return Err("Invalid region curve payload"),
        };
        out.push(RegionCurve {
            id: header[1] as usize,
            geometry,
        });
        offset += count;
    }
    Ok(out)
}
fn packed(data: &[f64]) -> Result<Vec<f64>, &'static str> {
    let regions = find_regions(&decode(data)?);
    let mut out = vec![regions.len() as f64];
    for region in regions {
        out.extend([region.area, region.rings.len() as f64]);
        for ring in region.rings {
            out.push(ring.points.len() as f64);
            for p in ring.points {
                out.extend([p.x, p.y]);
            }
            out.push(ring.commands.len() as f64);
            out.extend(ring.commands);
        }
    }
    if out.iter().any(|x| !x.is_finite()) {
        return Err("Non-finite region result");
    }
    Ok(out)
}
/// One synchronous geometry call; there are no JS callbacks in region construction.
#[wasm_bindgen]
pub fn find_regions_packed(data: &[f64]) -> Result<Vec<f64>, JsValue> {
    packed(data).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_every_record_before_geometry() {
        for data in [
            vec![0.0],
            vec![1.0, 0.0, 0.0, 3.0, 0.0, 0.0, -1.0],
            vec![5.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0],
            vec![0.0, 0.0, 0.5, 4.0, 0.0, 0.0, 1.0, 1.0],
            vec![9.0, 0.0, 0.0, 0.0],
            vec![1.0, 4_294_967_296.0, 0.0, 3.0, 0.0, 0.0, 1.0],
            vec![1.0, f64::NAN, 0.0, 3.0, 0.0, 0.0, 1.0],
        ] {
            assert!(packed(&data).is_err());
        }
    }
    #[test]
    fn returns_empty_and_closed_ring_buffers() {
        assert_eq!(packed(&[]).unwrap(), vec![0.0]);
        let r = packed(&[1.0, 0.0, 0.0, 3.0, 0.0, 0.0, 1.0]).unwrap();
        assert_eq!(r[0], 1.0);
        assert_eq!(r[2], 1.0);
        assert_eq!(r[3], 96.0);
        assert_eq!(*r.last().unwrap(), 4.0);
    }
}
