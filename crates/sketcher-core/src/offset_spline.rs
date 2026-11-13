//! Trimmed parallel curves and compact, error-bounded cubic fitting.
use super::*;
#[path = "offset_contours.rs"]
mod contours;
#[path = "offset_fit.rs"]
mod fit;
#[derive(Clone)]
struct Node {
    p: Point2,
    n: Point2,
    t: Point2,
    corner: bool,
}
fn between(a: &Node, b: &Node, t: f64) -> Node {
    Node {
        p: step(a.p, sub(b.p, a.p), t),
        n: unit(step(a.n, sub(b.n, a.n), t)),
        t: unit(step(a.t, sub(b.t, a.t), t)),
        corner: false,
    }
}
fn intersection(a: Point2, b: Point2, c: Point2, d: Point2) -> Option<f64> {
    let (u, v, delta) = (sub(b, a), sub(d, c), sub(c, a));
    let det = cross(u, v);
    if det.abs() < 1e-12 {
        return None;
    }
    let (t, s) = (cross(delta, v) / det, cross(delta, u) / det);
    if (-1e-9..=1.0 + 1e-9).contains(&t) && (-1e-9..=1.0 + 1e-9).contains(&s) {
        Some(t.clamp(0.0, 1.0))
    } else {
        None
    }
}
fn remove_loops(nodes: Vec<Node>) -> Vec<Node> {
    let mut out: Vec<Node> = vec![];
    for q in nodes {
        let mut again = true;
        while again && out.len() > 2 {
            again = false;
            for i in 0..out.len() - 2 {
                if i == 0 && dist(q.p, out[0].p) < 1e-8 {
                    continue;
                }
                let Some(t) = intersection(out[i].p, out[i + 1].p, out.last().unwrap().p, q.p)
                else {
                    continue;
                };
                let mut hit = between(&out[i], &out[i + 1], t);
                hit.corner = true;
                out.truncate(i + 1);
                if dist(out[i].p, hit.p) > 1e-8 {
                    out.push(hit);
                } else {
                    out[i].corner = true;
                }
                again = true;
                break;
            }
        }
        if out.last().is_none_or(|n| dist(n.p, q.p) > 1e-8) {
            out.push(q);
        }
    }
    out
}
// Closed-path erosion may leave several valid boundaries. Preserve both branches of
// each crossing before rejecting folds inside the source's offset-distance band.
fn closed_contours(nodes: &[Node], d: f64) -> Vec<Vec<Node>> {
    let mut pending = vec![nodes.to_vec()];
    let mut loops = vec![];
    while let Some(ring) = pending.pop() {
        let mut pieces = None;
        'search: for i in 0..ring.len() - 1 {
            for j in i + 2..ring.len() - 1 {
                if i == 0 && j == ring.len() - 2 {
                    continue;
                }
                let [a, b, c, e] = [ring[i].p, ring[i + 1].p, ring[j].p, ring[j + 1].p];
                if a.x.max(b.x) < c.x.min(e.x) - 1e-9
                    || c.x.max(e.x) < a.x.min(b.x) - 1e-9
                    || a.y.max(b.y) < c.y.min(e.y) - 1e-9
                    || c.y.max(e.y) < a.y.min(b.y) - 1e-9
                {
                    continue;
                }
                let Some(t) = intersection(ring[i].p, ring[i + 1].p, ring[j].p, ring[j + 1].p)
                else {
                    continue;
                };
                let mut a = between(&ring[i], &ring[i + 1], t);
                let delta = sub(ring[j + 1].p, ring[j].p);
                let len = dot(delta, delta);
                let u = if len > 1e-20 {
                    dot(sub(a.p, ring[j].p), delta) / len
                } else {
                    0.0
                };
                let mut b = between(&ring[j], &ring[j + 1], u.clamp(0.0, 1.0));
                a.corner = true;
                b.corner = true;
                b.p = a.p;
                let mut first = vec![a.clone()];
                first.extend_from_slice(&ring[i + 1..=j]);
                first.push(b.clone());
                let mut second = vec![b];
                second.extend_from_slice(&ring[j + 1..ring.len() - 1]);
                second.extend_from_slice(&ring[..=i]);
                second.push(a);
                for v in [&mut first, &mut second] {
                    v.dedup_by(|a, b| dist(a.p, b.p) <= 1e-8);
                }
                if [first.len(), second.len()]
                    .iter()
                    .any(|&n| n < 4 || n >= ring.len())
                {
                    continue;
                }
                pieces = Some([first, second]);
                break 'search;
            }
        }
        if let Some(pieces) = pieces {
            pending.extend(pieces);
        } else {
            loops.push(ring);
        }
    }
    if loops.len() < 2 {
        return loops;
    }
    let source: Vec<_> = nodes.iter().map(|n| step(n.p, n.n, -d)).collect();
    let source_area = area(&source);
    let inward = source_area * dot(perp(nodes[0].t), nodes[0].n) * d > 0.0;
    loops.retain(|ring| {
        let loop_area = area(&ring.iter().map(|n| n.p).collect::<Vec<_>>());
        if loop_area.abs() < 1e-10 || (inward && loop_area * source_area <= 0.0) {
            return false;
        }
        let stride = ((ring.len() - 1) / 64).max(1);
        for i in (0..ring.len() - 1).step_by(stride) {
            let pt = middle(ring[i].p, ring[i + 1].p);
            if inside(pt, &source) != inward {
                return false;
            }
            for edge in source.windows(2) {
                let delta = sub(edge[1], edge[0]);
                let len = dot(delta, delta);
                let t = if len > 1e-20 {
                    (dot(sub(pt, edge[0]), delta) / len).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                if dist(pt, step(edge[0], delta, t)) < d.abs() - fit::TOLERANCE {
                    return false;
                }
            }
        }
        true
    });
    let bounds = |ring: &[Node]| {
        ring.iter().fold((f64::INFINITY, f64::INFINITY), |b, n| {
            (b.0.min(n.p.x), b.1.min(n.p.y))
        })
    };
    loops.sort_by(|a, b| {
        let a = bounds(a);
        let b = bounds(b);
        a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1))
    });
    loops
}
#[derive(Clone)]
struct Path {
    nodes: Vec<Node>,
    closed: bool,
}
fn crop(path: &mut Path, index: usize, t: f64, start: bool, point: Point2) {
    let mut hit = between(&path.nodes[index], &path.nodes[index + 1], t);
    hit.p = point;
    if start {
        path.nodes.drain(..index + 1);
        path.nodes.insert(0, hit.clone());
    } else {
        path.nodes.truncate(index + 1);
        path.nodes.push(hit.clone());
    }
    path.nodes.dedup_by(|a, b| dist(a.p, b.p) < 1e-8);
    if path.nodes.len() < 2 {
        path.nodes.push(hit);
    }
}
fn extend(path: &mut Path, point: Point2, start: bool) {
    let end = if start {
        &mut path.nodes[0]
    } else {
        path.nodes.last_mut().unwrap()
    };
    if dist(end.p, point) < 1e-8 {
        end.p = point;
        return;
    }
    end.corner = true;
    let join = Node {
        p: point,
        ..end.clone()
    };
    if start {
        path.nodes.insert(0, join);
    } else {
        path.nodes.push(join);
    }
}
fn roots(a: Point2, delta: Point2, center: Point2, radius: f64) -> Vec<f64> {
    let v = sub(a, center);
    let aa = dot(delta, delta);
    let b = dot(v, delta);
    let c = dot(v, v) - radius * radius;
    if aa < 1e-20 {
        return vec![];
    }
    let disc = b * b - aa * c;
    if disc < -1e-9 {
        return vec![];
    }
    let h = disc.max(0.0).sqrt();
    vec![(-b - h) / aa, (-b + h) / aa]
}
fn arc_contains(shape: &Shape, pt: Point2) -> bool {
    let Shape::Arc(c, _, [a, b], cw) = shape else {
        return true;
    };
    sweep(angle(*c, *a), angle(*c, pt), *cw) <= sweep(angle(*c, *a), angle(*c, *b), *cw) + 1e-7
}
fn join_analytic(path: &mut Path, shape: &mut Shape, start: bool, d: f64) {
    if !matches!(shape, Shape::Line(..) | Shape::Arc(..)) {
        extend(path, if start { shape.end() } else { shape.start() }, start);
        return;
    }
    let nodes = &path.nodes;
    let endpoint = if start {
        nodes[0].clone()
    } else {
        nodes.last().unwrap().clone()
    };
    let near = if start { shape.end() } else { shape.start() };
    let limit = 8.0 * d.abs() + 1e-5;
    let mut best: Option<(usize, f64, Point2, f64)> = None;
    let mut walked = 0.0;
    for k in 0..nodes.len() - 1 {
        let i = if start { k } else { nodes.len() - 2 - k };
        let a = nodes[i].p;
        let delta = sub(nodes[i + 1].p, a);
        let length = spline::length(delta);
        let ts = match shape {
            Shape::Line([p1, p2], _) => {
                let dir = sub(*p2, *p1);
                let det = cross(delta, dir);
                if det.abs() < 1e-12 {
                    vec![]
                } else {
                    vec![cross(sub(*p1, a), dir) / det]
                }
            }
            Shape::Arc(c, r, ..) => roots(a, delta, *c, *r),
            _ => unreachable!(),
        };
        for t in ts {
            if !(-1e-9..=1.0 + 1e-9).contains(&t) {
                continue;
            }
            let pt = step(a, delta, t.clamp(0.0, 1.0));
            let removed = walked + length * if start { t } else { 1.0 - t };
            if removed > limit || dist(pt, near) > limit || !arc_contains(shape, pt) {
                continue;
            }
            let score = removed + dist(pt, near);
            if best.as_ref().is_none_or(|b| score < b.3) {
                best = Some((i, t.clamp(0.0, 1.0), pt, score));
            }
        }
        walked += length;
        if walked > limit {
            break;
        }
    }
    let hit = if let Some((i, t, pt, _)) = best {
        crop(path, i, t, start, pt);
        pt
    } else {
        let dir = scale(endpoint.t, if start { -1.0 } else { 1.0 });
        let pt = match shape {
            Shape::Line([p1, p2], _) => {
                let line_dir = sub(*p2, *p1);
                let det = cross(dir, line_dir);
                let t = if det.abs() < 1e-12 {
                    f64::NAN
                } else {
                    cross(sub(*p1, endpoint.p), line_dir) / det
                };
                if t >= -1e-7 && t <= limit {
                    step(endpoint.p, dir, t)
                } else {
                    near
                }
            }
            Shape::Arc(c, r, ..) => {
                let mut candidates: Vec<_> = roots(endpoint.p, dir, *c, *r)
                    .into_iter()
                    .filter(|t| *t >= -1e-7 && *t <= limit)
                    .map(|t| step(endpoint.p, dir, t))
                    .collect();
                candidates.sort_by(|a, b| dist(*a, near).total_cmp(&dist(*b, near)));
                candidates.first().copied().unwrap_or(near)
            }
            _ => unreachable!(),
        };
        extend(path, pt, start);
        pt
    };
    if start {
        shape.set_end(hit);
    } else {
        shape.set_start(hit);
    }
}
fn join_paths(a: &mut Path, b: &mut Path, d: f64) {
    let limit = 8.0 * d.abs() + 1e-5;
    let mut best: Option<(usize, usize, f64, f64, f64, Point2)> = None;
    let mut along_a = 0.0;
    for i in (0..a.nodes.len() - 1).rev() {
        let aa = a.nodes[i].p;
        let da = sub(a.nodes[i + 1].p, aa);
        let la = spline::length(da);
        let mut along_b = 0.0;
        for j in 0..b.nodes.len() - 1 {
            let bb = b.nodes[j].p;
            let db = sub(b.nodes[j + 1].p, bb);
            let lb = spline::length(db);
            if let Some(t) = intersection(aa, a.nodes[i + 1].p, bb, b.nodes[j + 1].p) {
                let pt = step(aa, da, t);
                let u = if lb > 1e-12 {
                    dot(sub(pt, bb), db) / (lb * lb)
                } else {
                    0.0
                };
                let score = along_a + la * (1.0 - t) + along_b + lb * u;
                if score <= 2.0 * limit && best.as_ref().is_none_or(|v| score < v.4) {
                    best = Some((i, j, t, u.clamp(0.0, 1.0), score, pt));
                }
            }
            along_b += lb;
            if along_b > limit {
                break;
            }
        }
        along_a += la;
        if along_a > limit {
            break;
        }
    }
    if let Some((i, j, t, u, _, pt)) = best {
        crop(a, i, t, false, pt);
        crop(b, j, u, true, pt);
        return;
    }
    let end = a.nodes.last().unwrap();
    let start = &b.nodes[0];
    let det = cross(end.t, start.t);
    let delta = sub(start.p, end.p);
    let (t, u) = if det.abs() < 1e-12 {
        (f64::NAN, f64::NAN)
    } else {
        (cross(delta, start.t) / det, cross(delta, end.t) / det)
    };
    let pt = if t >= -1e-7 && u <= 1e-7 && t.abs() <= limit && u.abs() <= limit {
        step(end.p, end.t, t)
    } else {
        middle(end.p, start.p)
    };
    extend(a, pt, false);
    extend(b, pt, true);
}
fn parallel(item: &Item, raw: &SplineOffset, d: f64, single: bool, clean: bool) -> Option<Path> {
    let (Some((_, normals)), Some(tangents)) = (&raw.basis, raw.tangents) else {
        return None;
    };
    let sign = if dot(perp(tangents[0]), normals[0]) >= 0.0 {
        1.0
    } else {
        -1.0
    };
    let spans = match &item.geometry {
        Some(Geometry::Spline(s, _)) if !s.is_empty() => s.len(),
        Some(Geometry::EllipticalArc(..)) => 4,
        _ => return None,
    };
    let samples = (spans * 128).clamp(128, 4096);
    let mut nodes: Vec<_> = (0..=samples)
        .map(|j| {
            let v = j as f64 / samples as f64;
            let (pt, t) = match item.geometry.as_ref().unwrap() {
                Geometry::Spline(segments, _) => {
                    let param = if item.reversed { 1.0 - v } else { v };
                    let mut t = spline::tangent_at(segments, param);
                    if spline::length(t) < 1e-12 {
                        t = sub(
                            spline::point_at(segments, (param + 1e-5).min(1.0)),
                            spline::point_at(segments, (param - 1e-5).max(0.0)),
                        );
                    }
                    (
                        spline::point_at(segments, param),
                        scale(unit(t), if item.reversed { -1.0 } else { 1.0 }),
                    )
                }
                Geometry::EllipticalArc(c, major, minor, start, end, cw) => {
                    let (a, b, u, w) = ellipse(*c, *major, *minor);
                    let parameter = |pt: Point2| {
                        let q = sub(pt, *c);
                        (dot(q, w) / b).atan2(dot(q, u) / a)
                    };
                    let begin = parameter(*start);
                    let t = begin
                        + if *cw { -1.0 } else { 1.0 } * v * sweep(begin, parameter(*end), *cw);
                    (
                        ellipse_point(*c, a, b, u, w, t),
                        scale(
                            unit(step(scale(u, -a * t.sin()), w, b * t.cos())),
                            if *cw { -1.0 } else { 1.0 },
                        ),
                    )
                }
                _ => unreachable!(),
            };
            let n = scale(perp(t), sign);
            Node {
                p: step(pt, n, d),
                n,
                t,
                corner: false,
            }
        })
        .collect();
    let closed = single && matches!(item.geometry, Some(Geometry::Spline(_, true)));
    if closed {
        *nodes.last_mut().unwrap() = nodes[0].clone();
    }
    if d.abs() > 1e-12 && !closed && clean {
        nodes = remove_loops(nodes);
    }
    Some(Path { nodes, closed })
}
fn trace(i: usize, paths: &[Option<Path>], primitives: &[Primitive]) -> Vec<Point2> {
    if let Some(path) = &paths[i] {
        return path.nodes.iter().map(|n| n.p).collect();
    }
    match &primitives[i].shape {
        Shape::Line(v, _) => v.to_vec(),
        Shape::Arc(c, r, [a, b], cw) => {
            let begin = angle(*c, *a);
            let arc = sweep(begin, angle(*c, *b), *cw);
            (0..=64)
                .map(|j| {
                    add(
                        *c,
                        polar(
                            *r,
                            begin + if *cw { -1.0 } else { 1.0 } * arc * j as f64 / 64.0,
                        ),
                    )
                })
                .collect()
        }
        Shape::Spline(s) => s.points.clone(),
        Shape::Circle(..) => vec![],
    }
}
fn area(points: &[Point2]) -> f64 {
    points
        .iter()
        .enumerate()
        .map(|(i, p)| cross(*p, points[(i + 1) % points.len()]))
        .sum()
}
fn cut_section(
    id: usize,
    segment: usize,
    t: f64,
    start: bool,
    point: Point2,
    paths: &mut [Option<Path>],
    primitives: &mut [Primitive],
) {
    if let Some(path) = &mut paths[id] {
        crop(path, segment, t, start, point);
    } else if start {
        primitives[id].shape.set_start(point);
    } else {
        primitives[id].shape.set_end(point);
    }
}
fn trim_collapsed_sections(
    paths: &mut [Option<Path>],
    primitives: &mut [Primitive],
    closed: bool,
) -> Vec<usize> {
    let mut active: Vec<_> = (0..primitives.len()).collect();
    loop {
        let traces: Vec<_> = active
            .iter()
            .map(|&i| trace(i, paths, primitives))
            .collect();
        let bounds: Vec<_> = traces
            .iter()
            .map(|v| {
                v.iter().fold(
                    (
                        f64::INFINITY,
                        f64::NEG_INFINITY,
                        f64::INFINITY,
                        f64::NEG_INFINITY,
                    ),
                    |b, p| (b.0.min(p.x), b.1.max(p.x), b.2.min(p.y), b.3.max(p.y)),
                )
            })
            .collect();
        let mut found = None;
        'search: for i in 0..active.len() {
            for j in i + 1..active.len() {
                if (paths[active[i]].is_none()
                    && !matches!(primitives[active[i]].shape, Shape::Line(..)))
                    || (paths[active[j]].is_none()
                        && !matches!(primitives[active[j]].shape, Shape::Line(..)))
                {
                    continue;
                }
                let a = bounds[i];
                let b = bounds[j];
                if a.1 < b.0 || b.1 < a.0 || a.3 < b.2 || b.3 < a.2 {
                    continue;
                }
                let aa = &traces[i];
                let bb = &traces[j];
                for m in 0..aa.len() - 1 {
                    for n in 0..bb.len() - 1 {
                        let Some(t) = intersection(aa[m], aa[m + 1], bb[n], bb[n + 1]) else {
                            continue;
                        };
                        let pt = step(aa[m], sub(aa[m + 1], aa[m]), t);
                        let dir = sub(bb[n + 1], bb[n]);
                        let len = dot(dir, dir);
                        let u = if len > 1e-20 {
                            dot(sub(pt, bb[n]), dir) / len
                        } else {
                            0.0
                        };
                        if !(-1e-9..=1.0 + 1e-9).contains(&u) {
                            continue;
                        }
                        if j == i + 1
                            && dist(pt, *aa.last().unwrap()) < 1e-7
                            && dist(pt, bb[0]) < 1e-7
                        {
                            continue;
                        }
                        if closed
                            && i == 0
                            && j == active.len() - 1
                            && dist(pt, aa[0]) < 1e-7
                            && dist(pt, *bb.last().unwrap()) < 1e-7
                        {
                            continue;
                        }
                        let mut section = vec![pt];
                        section.extend_from_slice(&aa[m + 1..]);
                        for v in &traces[i + 1..j] {
                            section.extend_from_slice(v);
                        }
                        section.extend_from_slice(&bb[..=n]);
                        section.push(pt);
                        let loop_area = area(&section);
                        let total_area = if closed {
                            area(&traces.iter().flatten().copied().collect::<Vec<_>>())
                        } else {
                            f64::INFINITY
                        };
                        let forward = !closed || loop_area.abs() <= (total_area - loop_area).abs();
                        found = Some((i, j, m, n, t, u.clamp(0.0, 1.0), pt, forward));
                        break 'search;
                    }
                }
            }
        }
        let Some((i, j, m, n, t, u, pt, forward)) = found else {
            return active;
        };
        cut_section(active[i], m, t, !forward, pt, paths, primitives);
        cut_section(active[j], n, u, forward, pt, paths, primitives);
        active = if forward {
            active[..=i].iter().chain(&active[j..]).copied().collect()
        } else {
            active[i..=j].to_vec()
        };
    }
}
fn join_chain(
    items: &[Item],
    paths: &mut [Option<Path>],
    primitives: &mut [Primitive],
    closed: bool,
    d: f64,
) {
    for (i, item) in items.iter().enumerate() {
        let Some(Geometry::Arc(_, _, a, b, _)) = &item.geometry else {
            continue;
        };
        let prev = if i > 0 {
            Some(i - 1)
        } else if closed {
            Some(items.len() - 1)
        } else {
            None
        };
        let next = if i + 1 < items.len() {
            Some(i + 1)
        } else if closed {
            Some(0)
        } else {
            None
        };
        if let Shape::Arc(c, r, ends, _) = &mut primitives[i].shape {
            if prev.is_some_and(|j| paths[j].is_some()) {
                ends[0] = step(*c, unit(sub(*a, *c)), *r);
            }
            if next.is_some_and(|j| paths[j].is_some()) {
                ends[1] = step(*c, unit(sub(*b, *c)), *r);
            }
        }
    }
    let count = if closed {
        items.len()
    } else {
        items.len().saturating_sub(1)
    };
    for i in 0..count {
        let j = (i + 1) % items.len();
        if i == j {
            continue;
        }
        let mut a = paths[i].take();
        let mut b = paths[j].take();
        match (&mut a, &mut b) {
            (Some(a), Some(b)) => join_paths(a, b, d),
            (Some(a), None) => join_analytic(a, &mut primitives[j].shape, false, d),
            (None, Some(b)) => join_analytic(b, &mut primitives[i].shape, true, d),
            _ => {}
        }
        paths[i] = a;
        paths[j] = b;
    }
}
pub(super) fn refine(items: &[Item], primitives: &mut Vec<Primitive>, closed: bool, d: f64) {
    let mut paths: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, item)| match &primitives[i].shape {
            Shape::Spline(raw) => {
                parallel(item, raw, d, items.len() == 1, !(closed && items.len() > 1))
            }
            _ => None,
        })
        .collect();
    if closed && items.len() > 1 && d.abs() > 1e-12 {
        let mut candidates = primitives.clone();
        let mut candidate_paths = paths.clone();
        join_chain(items, &mut candidate_paths, &mut candidates, closed, d);
        if let Some(contours) = contours::split(items, &candidates, &paths, &candidate_paths, d) {
            *primitives = contours;
            return;
        }
        for path in paths.iter_mut().flatten() {
            if !path.closed {
                path.nodes = remove_loops(std::mem::take(&mut path.nodes));
            }
        }
    }
    if closed && paths.len() == 1 && d.abs() > 1e-12 {
        if let Some(path) = &mut paths[0] {
            if path.closed {
                let contours = closed_contours(&path.nodes, d);
                if !contours.is_empty() {
                    *primitives = contours
                        .into_iter()
                        .enumerate()
                        .map(|(contour, nodes)| Primitive {
                            source: primitives[0].source,
                            contour,
                            shape: Shape::Spline(fitted(&nodes, d, true, true)),
                        })
                        .collect();
                    return;
                }
                path.nodes = remove_loops(std::mem::take(&mut path.nodes));
            }
        }
    }
    join_chain(items, &mut paths, primitives, closed, d);
    let active = if d.abs() > 1e-12 {
        trim_collapsed_sections(&mut paths, primitives, closed)
    } else {
        (0..primitives.len()).collect()
    };
    for (i, path) in paths.into_iter().enumerate() {
        let Some(path) = path else {
            continue;
        };
        let mut nodes = if d.abs() > 1e-12 {
            remove_loops(path.nodes)
        } else {
            path.nodes
        };
        if nodes.len() < 2 {
            nodes.push(nodes[0].clone());
        }
        primitives[i].shape = Shape::Spline(fitted(&nodes, d, path.closed, true));
    }
    *primitives = active.into_iter().map(|i| primitives[i].clone()).collect();
}

fn fitted(nodes: &[Node], d: f64, closed: bool, with_basis: bool) -> SplineOffset {
    let pieces = fit::fit(nodes, closed);
    let indices: Vec<_> = std::iter::once(pieces[0].start)
        .chain(pieces.iter().map(|p| p.end))
        .collect();
    let points: Vec<_> = indices.iter().map(|&i| nodes[i].p).collect();
    let normals = indices.iter().map(|&i| nodes[i].n).collect();
    let bases = indices
        .iter()
        .map(|&i| step(nodes[i].p, nodes[i].n, -d))
        .collect();
    let mut handles: Vec<_> = points
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            [
                if i > 0 { pieces[i - 1].curve[2] } else { p },
                if i < pieces.len() {
                    pieces[i].curve[1]
                } else {
                    p
                },
            ]
        })
        .collect();
    let last = handles.len() - 1;
    handles[0][0] = sub(scale(points[0], 2.0), handles[0][1]);
    handles[last][1] = sub(scale(points[last], 2.0), handles[last][0]);
    if closed {
        let seam = [handles[last][0], handles[0][1]];
        handles[0] = seam;
        handles[last] = seam;
    }
    SplineOffset {
        points,
        basis: with_basis.then_some((bases, normals)),
        tangents: with_basis.then_some([nodes[0].t, nodes.last().unwrap().t]),
        handles: Some(handles),
        closed,
    }
}

pub(super) fn simplify_closed(points: &[Point2], d: f64) -> SplineOffset {
    let handles = spline::natural_handles(points);
    let curves: Vec<_> = (0..points.len() - 1)
        .map(|i| [points[i], handles[i][1], handles[i + 1][0], points[i + 1]])
        .collect();
    let count = curves.len() * 16;
    let nodes: Vec<_> = (0..=count)
        .map(|i| {
            let t = i as f64 / count as f64;
            let tangent = unit(spline::tangent_at(&curves, t));
            Node {
                p: spline::point_at(&curves, t),
                t: tangent,
                n: scale(perp(tangent), -1.0),
                corner: false,
            }
        })
        .collect();
    fitted(&nodes, d, true, true)
}
