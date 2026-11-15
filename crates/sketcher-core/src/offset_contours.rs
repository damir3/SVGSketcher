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
pub(super) fn arc_node(shape: &Shape, t: f64) -> Node {
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

// At a vanishing arc the raw walk can retrace a line or pinch at a point.
// Split all crossings first, discard consumed edges, then trace the surviving
// boundary graph; splitting whole rings alone loses these zero-area folds.
fn surviving_loops(
    edges: &[Edge],
    primitives: &[Primitive],
    items: &[Item],
    source: &[Point2],
    d: f64,
) -> Vec<Vec<Edge>> {
    let boxes: Vec<_> = edges.iter().map(|e| bounds(e, primitives)).collect();
    let mut cuts = vec![vec![0.0, 1.0]; edges.len()];
    for i in 0..edges.len() {
        for j in i + 1..edges.len() {
            let (a, b) = (boxes[i], boxes[j]);
            if a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2] {
                continue;
            }
            for p in crossings(&edges[i], &edges[j], primitives) {
                cuts[i].push(fraction(&edges[i], p, primitives).clamp(0.0, 1.0));
                cuts[j].push(fraction(&edges[j], p, primitives).clamp(0.0, 1.0));
            }
        }
    }
    let valid = |e: &Edge| {
        if items[primitives[e.source].source].kind == 1
            && matches!(primitives[e.source].shape, Shape::Line(..))
        {
            return false;
        }
        let pt = at(e, 0.5, primitives).p;
        // A folded parallel lies inside the disk of radius |d|-r. Genuine
        // circular contacts around a consumed arc's endpoint lie outside it.
        if let Some(Geometry::Arc(center, radius, ..)) = items[primitives[e.source].source].geometry
        {
            if -d >= radius && squared(pt, center) <= (-d - radius).powi(2) + 1e-20 {
                return false;
            }
        }
        if !inside(pt, source) {
            return false;
        }
        for (i, &a) in source.iter().enumerate() {
            let delta = source[(i + 1) % source.len()] - a;
            let t = ((pt - a).dot(delta) / delta.length_squared().max(1e-24)).clamp(0.0, 1.0);
            if dist(pt, step(a, delta, t)) < d.abs() - fit::TOLERANCE {
                return false;
            }
        }
        true
    };
    let mut pieces = vec![];
    let mut vertices: Vec<Point2> = vec![];
    let mut links = vec![];
    for (e, ts) in edges.iter().zip(&mut cuts) {
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
        for pair in ts.windows(2) {
            let mut a = at(e, pair[0], primitives);
            let mut b = at(e, pair[1], primitives);
            a.corner |= pair[0] > 1e-10 || e.a.corner;
            b.corner |= pair[1] < 1.0 - 1e-10 || e.b.corner;
            let piece = Edge {
                source: e.source,
                a,
                b,
                t0: e.t0 + (e.t1 - e.t0) * pair[0],
                t1: e.t0 + (e.t1 - e.t0) * pair[1],
            };
            if length(&piece, primitives) <= 1e-8 || !valid(&piece) {
                continue;
            }
            let mut ids = [0; 2];
            for (k, pt) in [piece.a.p, piece.b.p].iter().enumerate() {
                ids[k] = vertices
                    .iter()
                    .position(|&v| dist(v, *pt) < 1e-7)
                    .unwrap_or_else(|| {
                        vertices.push(*pt);
                        vertices.len() - 1
                    });
            }
            pieces.push(piece);
            links.push(ids);
        }
    }
    let mut active = vec![true; pieces.len()];
    for i in 0..links.len() {
        if !active[i] {
            continue;
        }
        for j in i + 1..links.len() {
            if !active[j] {
                continue;
            }
            if links[i] == links[j] {
                active[j] = false;
            } else if links[i] == [links[j][1], links[j][0]] {
                active[i] = false;
                active[j] = false;
                break;
            }
        }
    }
    loop {
        let mut incoming = vec![0; vertices.len()];
        let mut outgoing = vec![0; vertices.len()];
        for (i, [a, b]) in links.iter().enumerate() {
            if active[i] {
                outgoing[*a] += 1;
                incoming[*b] += 1;
            }
        }
        let mut changed = false;
        for (i, [a, b]) in links.iter().enumerate() {
            if active[i] && (incoming[*a] == 0 || outgoing[*b] == 0) {
                active[i] = false;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let winding = area(source).signum();
    let mut loops = vec![];
    for start in 0..pieces.len() {
        if !active[start] {
            continue;
        }
        let mut ring = vec![];
        let mut current = start;
        loop {
            active[current] = false;
            ring.push(pieces[current].clone());
            let end = links[current][1];
            if end == links[start][0] {
                loops.push(ring);
                break;
            }
            let tangent = at(&pieces[current], 1.0, primitives).t;
            let next = (0..pieces.len())
                .filter(|&i| active[i] && links[i][0] == end)
                .max_by(|&a, &b| {
                    let turn = |i| {
                        let t = at(&pieces[i], 0.0, primitives).t;
                        tangent.cross(t).atan2(tangent.dot(t)) * winding
                    };
                    turn(a).total_cmp(&turn(b))
                });
            let Some(next) = next else {
                break;
            };
            current = next;
        }
    }
    loops
}

pub(super) fn split(
    items: &[Item],
    primitives: &[Primitive],
    raw_paths: &[Option<Path>],
    paths: &[Option<Path>],
    d: f64,
    consumed_arc: bool,
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
    let source = source_boundary(items, raw_paths, d);
    let mut loops = if consumed_arc {
        surviving_loops(&edges, primitives, items, &source, d)
    } else {
        vec![]
    };
    let mut pending = if consumed_arc { vec![] } else { vec![edges] };
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
    if loops.len() < 2 && !consumed_arc {
        return None;
    }
    let source_area = area(&source);
    loops.retain(|ring| {
        if consumed_arc
            && ring.iter().any(|e| {
                items[primitives[e.source].source].kind == 1
                    && matches!(primitives[e.source].shape, Shape::Line(..))
            })
        {
            return false;
        }
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
    if loops.is_empty() || (loops.len() < 2 && !consumed_arc) {
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
