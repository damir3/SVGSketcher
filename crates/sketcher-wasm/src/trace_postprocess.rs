use sketcher_core::{
    trace_postprocess::{self, Placement, Radial, Relations},
    Point2,
};
use wasm_bindgen::prelude::*;
fn integer(v: f64) -> Result<usize, &'static str> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v >= usize::MAX as f64 {
        return Err("Invalid trace postprocess count");
    }
    Ok(v as usize)
}
fn point(p: &[f64], at: usize) -> Point2 {
    Point2::new(p[at], p[at + 1])
}
fn flag(v: f64) -> Result<bool, &'static str> {
    match v {
        0.0 => Ok(false),
        1.0 => Ok(true),
        _ => Err("Invalid trace presence flag"),
    }
}
fn query(mode: u32, data: &[f64], settings: &[f64]) -> Result<Vec<f64>, &'static str> {
    if data.iter().chain(settings).any(|v| !v.is_finite()) {
        return Err("Non-finite trace postprocess data");
    }
    match mode {
        0 => {
            if settings.len() != 11 {
                return Err("Invalid trace placement settings");
            }
            let (np, nr, na) = (
                integer(settings[8])?,
                integer(settings[9])?,
                integer(settings[10])?,
            );
            let size = np
                .checked_mul(2)
                .and_then(|v| v.checked_add(nr))
                .and_then(|v| na.checked_mul(3).and_then(|a| v.checked_add(a)));
            if size != Some(data.len()) {
                return Err("Invalid trace placement size");
            }
            let points: Vec<_> = data[..2 * np]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| point(p, 0))
                .collect();
            let arcs: Vec<_> = data[2 * np + nr..]
                .as_chunks::<3>()
                .0
                .iter()
                .map(|a| Ok([integer(a[0])?, integer(a[1])?, integer(a[2])?]))
                .collect::<Result<_, &str>>()?;
            trace_postprocess::place(Placement {
                image: [settings[0], settings[1], settings[2]],
                position: point(settings, 3),
                size: point(settings, 5),
                angle: settings[7],
                points: &points,
                radii: &data[2 * np..2 * np + nr],
                arcs: &arcs,
            })
        }
        1 => {
            if settings.len() != 8 {
                return Err("Invalid trace relation settings");
            }
            let (nl, nr, np, nc) = (
                integer(settings[0])?,
                integer(settings[1])?,
                integer(settings[6])?,
                integer(settings[7])?,
            );
            let flags = integer(settings[5])?;
            if flags > 15 {
                return Err("Invalid trace relation flags");
            }
            let size = nl
                .checked_mul(5)
                .and_then(|v| nr.checked_mul(4).and_then(|r| v.checked_add(r)))
                .and_then(|v| {
                    np.checked_add(nc)
                        .and_then(|n| n.checked_mul(2))
                        .and_then(|n| v.checked_add(n))
                });
            if size != Some(data.len()) {
                return Err("Invalid trace relation size");
            }
            let lines: Vec<_> = data[..5 * nl]
                .as_chunks::<5>()
                .0
                .iter()
                .map(|p| {
                    Ok(if flag(p[0])? {
                        Some([point(p, 1), point(p, 3)])
                    } else {
                        None
                    })
                })
                .collect::<Result<_, &str>>()?;
            let radial: Vec<_> = data[5 * nl..5 * nl + 4 * nr]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| {
                    Ok(Radial {
                        center: if flag(p[0])? { Some(point(p, 1)) } else { None },
                        radius: p[3],
                    })
                })
                .collect::<Result<_, &str>>()?;
            let rejected: Vec<_> = data[5 * nl + 4 * nr..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| Ok((integer(p[0])?, integer(p[1])?)))
                .collect::<Result<_, &str>>()?;
            trace_postprocess::relations(Relations {
                lines: &lines,
                radial: &radial,
                angle_tolerance: settings[2],
                tolerance: settings[3],
                scale: settings[4],
                flags: flags as u8,
                rejected_perpendicular: &rejected[..np],
                rejected_concentric: &rejected[np..],
            })
        }
        2 => {
            if settings.len() != 1 || !data.len().is_multiple_of(4) {
                return Err("Invalid trace displacement size");
            }
            let original: Vec<_> = data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| point(p, 0))
                .collect();
            let current: Vec<_> = data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| point(p, 2))
                .collect();
            trace_postprocess::moved(&original, &current, settings[0])
        }
        _ => Err("Invalid trace postprocess mode"),
    }
}
#[wasm_bindgen]
pub fn trace_postprocess(mode: u32, data: &[f64], settings: &[f64]) -> Result<Vec<f64>, JsValue> {
    query(mode, data, settings).map_err(JsValue::from_str)
}
