use sketcher_core::{
    topology::{Graph, Node},
    Point2,
};
use wasm_bindgen::prelude::*;

fn index(value: f64, count: usize) -> Result<usize, &'static str> {
    if value < 0.0 || value.fract() != 0.0 || value >= count as f64 {
        return Err("Invalid topology index");
    }
    Ok(value as usize)
}

fn query(
    points: &[f64],
    links: &[f64],
    endpoints: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 4
        || !points.len().is_multiple_of(4)
        || !links.len().is_multiple_of(2)
        || !endpoints.len().is_multiple_of(2)
        || points
            .iter()
            .chain(links)
            .chain(endpoints)
            .chain(settings)
            .any(|v| !v.is_finite())
        || ![0.0, 1.0].contains(&settings[0])
        || settings[1] <= 0.0
    {
        return Err("Invalid topology buffers or settings");
    }
    let nodes: Vec<_> = points
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| {
            if ![0.0, 1.0].contains(&p[0])
                || ![0.0, 1.0].contains(&p[1])
                || (p[0] == 0.0 && (p[1] != 0.0 || p[2] != 0.0 || p[3] != 0.0))
            {
                return Err("Invalid topology point flags");
            }
            Ok(Node {
                position: (p[0] == 1.0).then_some(Point2 { x: p[2], y: p[3] }),
                listed: p[1] == 1.0,
            })
        })
        .collect::<Result<_, _>>()?;
    let pairs = |values: &[f64]| -> Result<Vec<[usize; 2]>, &'static str> {
        values
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| Ok([index(p[0], nodes.len())?, index(p[1], nodes.len())?]))
            .collect()
    };
    let origin = if settings[2] == -1.0 {
        None
    } else {
        Some(index(settings[2], nodes.len())?)
    };
    let links = pairs(links)?;
    let endpoints = pairs(endpoints)?;
    let graph = Graph::new(&nodes, &links, origin, settings[1]);
    if settings[0] == 0.0 {
        let members = graph.group(index(settings[3], nodes.len())?);
        let mut output = vec![members.len() as f64];
        output.extend(members.into_iter().map(|i| i as f64));
        return Ok(output);
    }
    if settings[3] != -1.0 {
        return Err("Invalid topology preparation seed");
    }
    let snapshot = graph.prepare(&endpoints);
    let mut output = vec![snapshot.groups.len() as f64];
    output.extend(snapshot.labels.into_iter().map(|i| i as f64));
    for group in snapshot.groups {
        output.push(group.members.len() as f64);
        output.extend(group.members.into_iter().map(|i| i as f64));
        output.push(group.connections.len() as f64);
        for c in group.connections {
            output.extend([c.primitive as f64, c.connected as f64, c.other as f64]);
        }
    }
    Ok(output)
}

#[wasm_bindgen]
pub fn topology_queries(
    points: &[f64],
    links: &[f64],
    endpoints: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    query(points, links, endpoints, settings).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_flags_indices_arity_and_unused_settings() {
        let points = [1.0, 1.0, 10.0, 20.0];
        for settings in [
            [0.0, 0.0, -1.0, 0.0],
            [2.0, 0.001, -1.0, 0.0],
            [0.0, 0.001, 2.0, 0.0],
            [0.0, 0.001, -1.0, 0.5],
            [1.0, 0.001, -1.0, 0.0],
        ] {
            assert!(query(&points, &[], &[], &settings).is_err());
        }
        for values in [
            &points[..3],
            &[0.0, 1.0, 0.0, 0.0],
            &[1.0, 1.0, f64::NAN, 0.0],
        ] {
            assert!(query(values, &[], &[], &[1.0, 0.001, -1.0, -1.0]).is_err());
        }
        assert!(query(&points, &[0.0, 1.0], &[], &[1.0, 0.001, -1.0, -1.0]).is_err());
        assert!(query(&points, &[], &[0.0], &[1.0, 0.001, -1.0, -1.0]).is_err());
        assert_eq!(
            query(&[], &[], &[], &[1.0, 0.001, -1.0, -1.0]).unwrap(),
            vec![0.0]
        );
        assert_eq!(
            query(&points, &[], &[], &[0.0, 0.001, -1.0, 0.0]).unwrap(),
            vec![1.0, 0.0]
        );
    }
}
