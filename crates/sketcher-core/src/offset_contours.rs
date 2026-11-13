//! Source-preserving decomposition of mixed closed parallel boundaries.
use super::*;

#[derive(Clone)]
struct Edge {
    source: usize,
    a: Node,
    b: Node,
    t0: f64,
    t1: f64,
}
fn arc_span(shape: &Shape) -> f64 {
    let Shape::Arc(c, _, [a, b], cw) = shape else {
        unreachable!()
    };
    sweep(angle(*c, *a), angle(*c, *b), *cw)
}
fn arc_node(shape: &Shape, t: f64) -> Node {
    let Shape::Arc(c, r, [a, _], cw) = shape else {
        unreachable!()
    };
    let n = polar(
        1.0,
        angle(*c, *a) + if *cw { -1.0 } else { 1.0 } * arc_span(shape) * t,
    );
    Node {
        p: step(*c, n, *r),
        n,
        t: scale(perp(n), if *cw { -1.0 } else { 1.0 }),
        corner: false,
    }
}
fn parameter(shape: &Shape, pt: Point2) -> f64 {
    let Shape::Arc(c, _, [a, _], cw) = shape else {
        unreachable!()
    };
    let s = sweep(angle(*c, *a), angle(*c, pt), *cw);
    if s > TAU - 1e-8 {
        0.0
    } else {
        s / arc_span(shape)
    }
}
fn at(edge: &Edge, t: f64, primitives: &[Primitive]) -> Node {
    let shape = &primitives[edge.source].shape;
    if matches!(shape, Shape::Arc(..)) {
        arc_node(shape, edge.t0 + (edge.t1 - edge.t0) * t)
    } else {
        between(&edge.a, &edge.b, t)
    }
}
fn fraction(edge: &Edge, pt: Point2, primitives: &[Primitive]) -> f64 {
    let shape = &primitives[edge.source].shape;
    if matches!(shape, Shape::Arc(..)) {
        (parameter(shape, pt) - edge.t0) / (edge.t1 - edge.t0)
    } else {
        let delta = sub(edge.b.p, edge.a.p);
        dot(sub(pt, edge.a.p), delta) / dot(delta, delta)
    }
}
fn bounds(edge: &Edge, primitives: &[Primitive]) -> [f64; 4] {
    let shape = &primitives[edge.source].shape;
    let pad = if let Shape::Arc(_, r, ..) = shape {
        r * (arc_span(shape) * (edge.t1 - edge.t0)).powi(2) / 8.0 + 1e-8
    } else {
        1e-8
    };
    [
        edge.a.p.x.min(edge.b.p.x) - pad,
        edge.a.p.x.max(edge.b.p.x) + pad,
        edge.a.p.y.min(edge.b.p.y) - pad,
        edge.a.p.y.max(edge.b.p.y) + pad,
    ]
}
fn crossings(a: &Edge, b: &Edge, primitives: &[Primitive]) -> Vec<Point2> {
    let aa = &primitives[a.source].shape;
    let bb = &primitives[b.source].shape;
    let mut candidates = vec![];
    match (aa, bb) {
        (Shape::Arc(c, r, ..), Shape::Arc(q, s, ..)) => {
            let delta = *q - *c;
            let d = delta.length();
            if d < 1e-12 {
                if (r - s).abs() < 1e-8 {
                    candidates.extend([a.a.p, a.b.p, b.a.p, b.b.p]);
                }
            } else if d <= r + s + 1e-8 && d >= (r - s).abs() - 1e-8 {
                let x = (r * r - s * s + d * d) / (2.0 * d);
                let h = (r * r - x * x).max(0.0).sqrt();
                let u = delta * (1.0 / d);
                let mid = *c + u * x;
                let n = u.perp();
                candidates.extend([mid + n * h, mid - n * h]);
            }
        }
        (Shape::Arc(..), _) | (_, Shape::Arc(..)) => {
            let (circle, line) = if matches!(aa, Shape::Arc(..)) {
                (aa, b)
            } else {
                (bb, a)
            };
            let Shape::Arc(c, r, ..) = circle else {
                unreachable!()
            };
            let delta = line.b.p - line.a.p;
            for t in roots(line.a.p, delta, *c, *r) {
                candidates.push(line.a.p + delta * t);
            }
        }
        _ => {
            let u = a.b.p - a.a.p;
            let v = b.b.p - b.a.p;
            let delta = b.a.p - a.a.p;
            let det = u.cross(v);
            if det.abs() >= 1e-12 {
                candidates.push(a.a.p + u * (delta.cross(v) / det));
            } else if u.length_squared() > 1e-20 && delta.cross(u).abs() <= 1e-9 * u.length() {
                let t0 = delta.dot(u) / u.length_squared();
                let t1 = (b.b.p - a.a.p).dot(u) / u.length_squared();
                let lo = t0.min(t1).max(0.0);
                let hi = t0.max(t1).min(1.0);
                if lo <= hi + 1e-9 {
                    candidates.extend([a.a.p + u * lo, a.a.p + u * hi]);
                }
            }
        }
    }
    candidates.retain(|&pt| {
        [fraction(a, pt, primitives), fraction(b, pt, primitives)]
            .iter()
            .all(|t| (-1e-8..=1.0 + 1e-8).contains(t))
    });
    candidates
}
fn cut(edge: &Edge, pt: Point2, primitives: &[Primitive]) -> [Edge; 2] {
    let t = fraction(edge, pt, primitives).clamp(0.0, 1.0);
    let mut node = at(edge, t, primitives);
    node.p = pt;
    node.corner = true;
    let param = edge.t0 + (edge.t1 - edge.t0) * t;
    [
        Edge {
            b: node.clone(),
            t1: param,
            ..edge.clone()
        },
        Edge {
            a: node,
            t0: param,
            ..edge.clone()
        },
    ]
}
fn length(edge: &Edge, primitives: &[Primitive]) -> f64 {
    let shape = &primitives[edge.source].shape;
    if let Shape::Arc(_, r, ..) = shape {
        r * arc_span(shape) * (edge.t1 - edge.t0)
    } else {
        dist(edge.a.p, edge.b.p)
    }
}
fn ring_area(edges: &[Edge], primitives: &[Primitive]) -> f64 {
    edges
        .iter()
        .map(|e| {
            let shape = &primitives[e.source].shape;
            if let Shape::Arc(c, r, _, cw) = shape {
                cross(*c, sub(e.b.p, e.a.p))
                    + r * r * arc_span(shape) * (e.t1 - e.t0) * if *cw { -1.0 } else { 1.0 }
            } else {
                cross(e.a.p, e.b.p)
            }
        })
        .sum()
}
fn source_boundary(items: &[Item], paths: &[Option<Path>], d: f64) -> Vec<Point2> {
    items
        .iter()
        .enumerate()
        .flat_map(|(i, item)| {
            if let Some(path) = &paths[i] {
                path.nodes[..path.nodes.len() - 1]
                    .iter()
                    .map(|n| step(n.p, n.n, -d))
                    .collect()
            } else {
                let mut points = sample(item, 256);
                points.pop();
                points
            }
        })
        .collect()
}

pub(super) fn split(
    items: &[Item],
    primitives: &[Primitive],
    raw_paths: &[Option<Path>],
    paths: &[Option<Path>],
    d: f64,
) -> Option<Vec<Primitive>> {
    let mut edges = vec![];
    for (source, prim) in primitives.iter().enumerate() {
        let nodes = if let Some(path) = &paths[source] {
            path.nodes.clone()
        } else {
            match &prim.shape {
                Shape::Line([a, b], _) => {
                    let t = unit(sub(*b, *a));
                    [*a, *b]
                        .iter()
                        .map(|&p| Node {
                            p,
                            t,
                            n: perp(t),
                            corner: false,
                        })
                        .collect()
                }
                Shape::Arc(..) => (0..=64)
                    .map(|i| arc_node(&prim.shape, i as f64 / 64.0))
                    .collect(),
                _ => return None,
            }
        };
        for (i, pair) in nodes.windows(2).enumerate() {
            let edge = Edge {
                source,
                a: pair[0].clone(),
                b: pair[1].clone(),
                t0: i as f64 / (nodes.len() - 1) as f64,
                t1: (i + 1) as f64 / (nodes.len() - 1) as f64,
            };
            if length(&edge, primitives) > 1e-8 {
                edges.push(edge);
            }
        }
    }
    if edges.len() < 3
        || edges
            .iter()
            .enumerate()
            .any(|(i, e)| dist(e.b.p, edges[(i + 1) % edges.len()].a.p) > 1e-6)
    {
        return None;
    }
    let mut pending = vec![edges];
    let mut loops = vec![];
    while let Some(ring) = pending.pop() {
        let boxes: Vec<_> = ring.iter().map(|e| bounds(e, primitives)).collect();
        let total: f64 = ring.iter().map(|e| length(e, primitives)).sum();
        let mut pieces = None;
        'search: for i in 0..ring.len() {
            for j in i + 2..ring.len() {
                if i == 0 && j == ring.len() - 1 {
                    continue;
                }
                let a = boxes[i];
                let b = boxes[j];
                if a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2] {
                    continue;
                }
                for pt in crossings(&ring[i], &ring[j], primitives) {
                    let [al, ar] = cut(&ring[i], pt, primitives);
                    let [bl, br] = cut(&ring[j], pt, primitives);
                    let mut first = vec![ar];
                    first.extend_from_slice(&ring[i + 1..j]);
                    first.push(bl);
                    let mut second = vec![br];
                    second.extend_from_slice(&ring[j + 1..]);
                    second.extend_from_slice(&ring[..i]);
                    second.push(al);
                    let mut parts = [first, second];
                    for part in &mut parts {
                        part.retain(|e| length(e, primitives) > 1e-8);
                    }
                    if parts.iter().any(|v| {
                        v.len() < 2
                            || v.iter().map(|e| length(e, primitives)).sum::<f64>() >= total - 1e-8
                    }) {
                        continue;
                    }
                    for part in &mut parts {
                        part[0].a.corner = true;
                        part.last_mut().unwrap().b.corner = true;
                    }
                    pieces = Some(parts);
                    break 'search;
                }
            }
        }
        if let Some(pieces) = pieces {
            pending.extend(pieces);
        } else {
            loops.push(ring);
        }
    }
    if loops.len() < 2 {
        return None;
    }
    let source = source_boundary(items, raw_paths, d);
    let source_area = area(&source);
    loops.retain(|ring| {
        let a = ring_area(ring, primitives);
        if a.abs() < 1e-10 || (d < 0.0 && a * source_area <= 0.0) {
            return false;
        }
        let stride = (ring.len() / 64).max(1);
        for i in (0..ring.len()).step_by(stride) {
            let pt = at(&ring[i], 0.5, primitives).p;
            if inside(pt, &source) != (d < 0.0) {
                return false;
            }
            for j in 0..source.len() {
                let delta = sub(source[(j + 1) % source.len()], source[j]);
                let len = dot(delta, delta);
                let t = if len > 1e-20 {
                    (dot(sub(pt, source[j]), delta) / len).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                if dist(pt, step(source[j], delta, t)) < d.abs() - fit::TOLERANCE {
                    return false;
                }
            }
        }
        true
    });
    if d > 0.0 {
        // Dilation of a connected filled source has only one outer boundary.
        let outer = loops
            .iter()
            .enumerate()
            .filter(|(_, ring)| ring_area(ring, primitives) * source_area > 0.0)
            .max_by(|(_, a), (_, b)| {
                ring_area(a, primitives)
                    .abs()
                    .total_cmp(&ring_area(b, primitives).abs())
            })
            .map(|(i, _)| i);
        if let Some(outer) = outer {
            loops = loops
                .into_iter()
                .enumerate()
                .filter(|(i, ring)| *i == outer || ring_area(ring, primitives) * source_area < 0.0)
                .map(|(_, ring)| ring)
                .collect();
        }
    }
    if loops.len() < 2 {
        return None;
    }
    let min = |v: &[Edge]| {
        v.iter().fold((f64::INFINITY, f64::INFINITY), |b, e| {
            (b.0.min(e.a.p.x).min(e.b.p.x), b.1.min(e.a.p.y).min(e.b.p.y))
        })
    };
    loops.sort_by(|a, b| {
        let a = min(a);
        let b = min(b);
        a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1))
    });
    let mut result = vec![];
    for (contour, mut ring) in loops.into_iter().enumerate() {
        let start = (0..ring.len())
            .filter(|&i| ring[i].source != ring[(i + ring.len() - 1) % ring.len()].source)
            .min_by(|&i, &j| {
                ring[i]
                    .source
                    .cmp(&ring[j].source)
                    .then(ring[i].t0.total_cmp(&ring[j].t0))
            })
            .unwrap_or(0);
        ring.rotate_left(start);
        let mut runs: Vec<Vec<Edge>> = vec![];
        for e in ring {
            if runs.last().is_some_and(|v| v[0].source == e.source) {
                runs.last_mut().unwrap().push(e);
            } else {
                runs.push(vec![e]);
            }
        }
        for run in &runs {
            let first = &run[0];
            let last = run.last().unwrap();
            let original = &primitives[first.source];
            let shape = match &original.shape {
                Shape::Line(_, dir) => Shape::Line([first.a.p, last.b.p], *dir),
                Shape::Arc(c, r, _, cw) => Shape::Arc(*c, *r, [first.a.p, last.b.p], *cw),
                Shape::Spline(_) => {
                    let mut nodes = vec![first.a.clone()];
                    nodes.extend(run.iter().map(|e| e.b.clone()));
                    Shape::Spline(fitted(&nodes, d, runs.len() == 1, true))
                }
                _ => unreachable!(),
            };
            result.push(Primitive {
                source: original.source,
                contour,
                shape,
            });
        }
    }
    Some(result)
}
