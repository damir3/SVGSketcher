//! Region arrangement, graph traversal and exact boundary commands. Order and tolerances
//! follow math/regionsReference.ts; hash tables are used only for lookup, never traversal.
use crate::{intersect, spline, CubicBezier, Curve, Point2};
use std::collections::{HashMap, HashSet};
use std::f64::consts::{PI, TAU};

#[derive(Clone, Debug)]
pub enum Geometry {
    Segment(Point2, Point2),
    Circle(Point2, f64),
    Ellipse(Point2, Point2, Point2),
    Arc(Point2, f64, Point2, Point2, bool),
    EllipticalArc(Point2, Point2, Point2, Point2, Point2, bool),
    Spline(Vec<CubicBezier>, bool),
}
#[derive(Clone, Debug)]
pub struct RegionCurve {
    pub id: usize,
    pub geometry: Geometry,
}
#[derive(Clone, Debug)]
pub struct Ring {
    pub points: Vec<Point2>,
    pub commands: Vec<f64>,
}
#[derive(Clone, Debug)]
pub struct Region {
    pub area: f64,
    pub rings: Vec<Ring>,
}

fn p(x: f64, y: f64) -> Point2 {
    Point2 { x, y }
}
fn distance(a: Point2, b: Point2) -> f64 {
    spline::length(p(a.x - b.x, a.y - b.y))
}
fn angle(a: Point2, b: Point2) -> f64 {
    (b.y - a.y).atan2(b.x - a.x)
}
fn svg_angle(a: Point2, b: Point2) -> f64 {
    (-b.y - (-a.y)).atan2(b.x - a.x)
}
fn positive(value: f64) -> f64 {
    if value < 0.0 {
        value + TAU
    } else {
        value
    }
}
fn sweep(start: f64, end: f64, cw: bool) -> f64 {
    positive(if cw {
        (end - start) % TAU
    } else {
        (start - end) % TAU
    })
}
fn delta(start: f64, value: f64, cw: bool) -> f64 {
    sweep(start, value, cw)
}

#[derive(Clone, Copy)]
struct Ellipse {
    center: Point2,
    rx: f64,
    ry: f64,
    ux: f64,
    uy: f64,
    vx: f64,
    vy: f64,
}
impl Ellipse {
    fn new(center: Point2, major: Point2, minor: Point2) -> Self {
        let a = svg_angle(center, major);
        let (ux, uy) = (a.cos(), a.sin());
        Self {
            center,
            rx: distance(center, major),
            ry: distance(center, minor),
            ux,
            uy,
            vx: -uy,
            vy: ux,
        }
    }
    fn param(self, point: Point2) -> f64 {
        let (x, y) = (point.x - self.center.x, -point.y - (-self.center.y));
        ((x * self.vx + y * self.vy) / self.ry.max(1e-6))
            .atan2((x * self.ux + y * self.uy) / self.rx.max(1e-6))
    }
    fn point(self, t: f64) -> Point2 {
        let (u, v) = (self.rx * t.cos(), self.ry * t.sin());
        p(
            (self.center.x + self.ux * u) + self.vx * v,
            -((-self.center.y + self.uy * u) + self.vy * v),
        )
    }
}
impl Geometry {
    fn periodic(&self) -> bool {
        matches!(
            self,
            Self::Circle(..) | Self::Ellipse(..) | Self::Spline(_, true)
        )
    }
    fn arc(&self) -> bool {
        matches!(self, Self::Arc(..) | Self::EllipticalArc(..))
    }
    fn period(&self) -> f64 {
        if matches!(self, Self::Circle(..) | Self::Ellipse(..)) {
            TAU
        } else {
            1.0
        }
    }
    fn ellipse(&self) -> Option<Ellipse> {
        match *self {
            Self::Ellipse(c, a, b) | Self::EllipticalArc(c, a, b, ..) => {
                Some(Ellipse::new(c, a, b))
            }
            _ => None,
        }
    }
    fn endpoints(&self) -> Option<(Point2, Point2)> {
        match *self {
            Self::Arc(_, _, a, b, _) | Self::EllipticalArc(_, _, _, a, b, _) => Some((a, b)),
            _ => None,
        }
    }
    fn arc_angles(&self) -> (f64, f64, bool) {
        match *self {
            Self::Arc(c, _, a, b, cw) => (svg_angle(c, a), svg_angle(c, b), cw),
            Self::EllipticalArc(_, _, _, a, b, cw) => {
                let e = self.ellipse().unwrap();
                (e.param(a), e.param(b), cw)
            }
            _ => unreachable!(),
        }
    }
    pub(crate) fn point(&self, t: f64) -> Point2 {
        match *self {
            Self::Segment(a, b) => {
                let u = t.clamp(0.0, 1.0);
                p(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)
            }
            Self::Circle(c, r) => p(r * t.cos() + c.x, -(r * t.sin() + (-c.y))),
            Self::Ellipse(..) => self.ellipse().unwrap().point(t),
            Self::Arc(c, r, ..) => {
                let (a, b, cw) = self.arc_angles();
                let u = t.clamp(0.0, 1.0) * sweep(a, b, cw);
                let v = if cw { a + u } else { a - u };
                p(r * v.cos() + c.x, -(r * v.sin() + (-c.y)))
            }
            Self::EllipticalArc(..) => {
                let (a, b, cw) = self.arc_angles();
                let u = t.clamp(0.0, 1.0) * sweep(a, b, cw);
                self.ellipse()
                    .unwrap()
                    .point(if cw { a + u } else { a - u })
            }
            Self::Spline(ref segments, _) => spline::point_at(segments, t),
        }
    }
    fn sampled_point(&self, mut t: f64) -> Point2 {
        if let Some((a, b)) = self.endpoints() {
            if t <= 0.0 {
                return a;
            }
            if t >= 1.0 {
                return b;
            }
        }
        if matches!(self, Self::Spline(_, true)) && !(0.0..=1.0).contains(&t) {
            t = ((t % 1.0) + 1.0) % 1.0
        }
        self.point(t)
    }
    pub(crate) fn param(&self, point: Point2) -> f64 {
        match *self {
            Self::Segment(a, b) => {
                let (dx, dy) = (b.x - a.x, b.y - a.y);
                let l = dx * dx + dy * dy;
                if l < 1e-12 {
                    0.0
                } else {
                    (((point.x - a.x) * dx + (point.y - a.y) * dy) / l).clamp(0.0, 1.0)
                }
            }
            Self::Circle(c, _) => positive(svg_angle(c, point)),
            Self::Ellipse(..) => positive(self.ellipse().unwrap().param(point)),
            Self::Arc(c, _, _, _, cw) => {
                let (a, b, _) = self.arc_angles();
                let span = sweep(a, b, cw);
                if span < 1e-6 {
                    0.0
                } else {
                    (delta(a, svg_angle(c, point), cw) / span).clamp(0.0, 1.0)
                }
            }
            Self::EllipticalArc(_, _, _, _, _, cw) => {
                let (a, b, _) = self.arc_angles();
                let span = sweep(a, b, cw);
                if span < 1e-6 {
                    0.0
                } else {
                    (delta(a, self.ellipse().unwrap().param(point), cw) / span).clamp(0.0, 1.0)
                }
            }
            Self::Spline(ref segments, _) => spline::project(segments, point).0,
        }
    }
    fn cut(&self, point: Point2) -> (f64, Point2) {
        if let Some((a, b)) = self.endpoints() {
            let tol = if let Self::Arc(_, r, ..) = *self {
                1e-3_f64.max(r * 2e-4)
            } else {
                2e-3
            };
            if distance(a, point) < tol {
                return (0.0, a);
            }
            if distance(b, point) < tol {
                return (1.0, b);
            }
        }
        if let Self::Spline(segments, false) = self {
            if let (Some(a), Some(b)) = (segments.first(), segments.last()) {
                if distance(a[0], point) <= 1e-5 {
                    return (0.0, a[0]);
                }
                if distance(b[3], point) <= 1e-5 {
                    return (1.0, b[3]);
                }
            }
        }
        (self.param(point), point)
    }
    fn contains(&self, point: Point2) -> bool {
        if !self.arc() {
            return true;
        }
        let (a, b, cw) = self.arc_angles();
        let (value, tol) = if let Self::Arc(c, r, ..) = *self {
            (svg_angle(c, point), 1e-3 / r.max(1.0))
        } else {
            let e = self.ellipse().unwrap();
            if e.rx < 1e-6 || e.ry < 1e-6 {
                return false;
            }
            (e.param(point), 1e-3 / e.rx.min(e.ry).max(1.0))
        };
        let d = delta(a, value, cw);
        d <= sweep(a, b, cw) + tol || d >= TAU - tol
    }
    pub(crate) fn primitives(&self) -> Vec<Curve> {
        match *self {
            Self::Segment(p1, p2) => vec![Curve::Segment { p1, p2 }],
            Self::Circle(center, radius) | Self::Arc(center, radius, ..) => {
                vec![Curve::Circle { center, radius }]
            }
            Self::Ellipse(center, major_axis_point, minor_axis_point)
            | Self::EllipticalArc(center, major_axis_point, minor_axis_point, ..) => {
                vec![Curve::Ellipse {
                    center,
                    major_axis_point,
                    minor_axis_point,
                }]
            }
            Self::Spline(ref segments, _) => segments
                .iter()
                .map(|points| Curve::Bezier { points: *points })
                .collect(),
        }
    }
    fn bounds(&self) -> Option<[f64; 4]> {
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        let mut add = |q: Point2| {
            b[0] = b[0].min(q.x);
            b[1] = b[1].min(q.y);
            b[2] = b[2].max(q.x);
            b[3] = b[3].max(q.y);
        };
        match *self {
            Self::Segment(a, c) => {
                add(a);
                add(c)
            }
            Self::Spline(ref segments, _) => {
                for s in segments {
                    for q in s {
                        add(*q)
                    }
                }
            }
            Self::Circle(c, r) | Self::Arc(c, r, ..) => {
                add(p(c.x - r, c.y - r));
                add(p(c.x + r, c.y + r))
            }
            _ => {
                let e = self.ellipse().unwrap();
                let x = (e.rx * e.ux).hypot(e.ry * e.vx);
                let y = (e.rx * e.uy).hypot(e.ry * e.vy);
                add(p(e.center.x - x, e.center.y - y));
                add(p(e.center.x + x, e.center.y + y));
            }
        }
        if let Some((a, c)) = self.endpoints() {
            add(a);
            add(c)
        }
        let extent = (b[2] - b[0]).max(b[3] - b[1]);
        let magnitude = b.iter().map(|v| v.abs()).fold(0.0, f64::max);
        if b.iter().any(|v| !v.is_finite()) || !extent.is_finite() {
            return None;
        }
        let padding = 1e-3_f64.max(extent * 1e-4) + magnitude * f64::EPSILON * 32.0;
        Some([
            b[0] - padding,
            b[1] - padding,
            b[2] + padding,
            b[3] + padding,
        ])
    }
}
fn may_intersect(a: &Geometry, b: &Geometry, aa: Option<[f64; 4]>, bb: Option<[f64; 4]>) -> bool {
    if (matches!(a, Geometry::Segment(..))
        && matches!(b, Geometry::Ellipse(..) | Geometry::EllipticalArc(..)))
        || (matches!(b, Geometry::Segment(..))
            && matches!(a, Geometry::Ellipse(..) | Geometry::EllipticalArc(..)))
    {
        return true;
    }
    match (aa, bb) {
        (Some(a), Some(b)) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]),
        _ => true,
    }
}
pub(crate) fn intersections(a: &Geometry, b: &Geometry, pa: &[Curve], pb: &[Curve]) -> Vec<Point2> {
    let (first, second) = if !matches!(a, Geometry::Spline(..)) && matches!(b, Geometry::Spline(..))
    {
        (pb, pa)
    } else {
        (pa, pb)
    };
    let mut result: Vec<Point2> = Vec::new();
    for x in first {
        for y in second {
            for q in intersect(*x, *y) {
                if a.contains(q) && b.contains(q) && !result.iter().any(|v| distance(*v, q) < 1e-4)
                {
                    result.push(q)
                }
            }
        }
    }
    result
}
fn key_component(value: f64) -> u64 {
    let x = value * 1e5;
    let f = x.floor();
    let n = if x - f >= 0.5 { f + 1.0 } else { f };
    if n == 0.0 {
        0
    } else {
        n.to_bits()
    }
}
fn key(q: Point2) -> (u64, u64) {
    (key_component(q.x), key_component(q.y))
}
fn edge_key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}
#[derive(Clone, Copy, Debug)]
struct Edge {
    curve: usize,
    t0: f64,
    t1: f64,
    from: usize,
}
#[derive(Clone, Copy)]
struct Segment {
    a: Point2,
    b: Point2,
    curve: usize,
    t0: f64,
    t1: f64,
}
#[derive(Default)]
struct Graph {
    nodes: Vec<Point2>,
    keys: HashMap<(u64, u64), usize>,
    adj: Vec<Vec<usize>>,
    order: Vec<usize>,
    sources: HashMap<(usize, usize), Edge>,
}
impl Graph {
    fn node(&mut self, q: Point2) -> usize {
        let k = key(q);
        if let Some(i) = self.keys.get(&k) {
            return *i;
        }
        let x = f64::from_bits(k.0);
        let y = f64::from_bits(k.1);
        for dx in -1..=1 {
            for dy in -1..=1 {
                let xx = x + dx as f64;
                let yy = y + dy as f64;
                let near = (
                    if xx == 0.0 { 0 } else { xx.to_bits() },
                    if yy == 0.0 { 0 } else { yy.to_bits() },
                );
                if let Some(i) = self.keys.get(&near) {
                    if distance(q, self.nodes[*i]) <= 1e-5 {
                        return *i;
                    }
                }
            }
        }
        let i = self.nodes.len();
        self.nodes.push(q);
        self.adj.push(vec![]);
        self.keys.insert(k, i);
        i
    }
    fn add(&mut self, s: Segment) {
        let a = self.node(s.a);
        let b = self.node(s.b);
        if a == b {
            return;
        }
        for (x, y) in [(a, b), (b, a)] {
            if self.adj[x].is_empty() {
                self.order.push(x)
            }
            if !self.adj[x].contains(&y) {
                self.adj[x].push(y)
            }
        }
        self.sources.insert(
            edge_key(a, b),
            Edge {
                curve: s.curve,
                t0: s.t0,
                t1: s.t1,
                from: a,
            },
        );
    }
    fn remove_bridges(&mut self) {
        let mut discovery = vec![0; self.nodes.len()];
        let mut low = discovery.clone();
        let mut time = 0;
        let mut bridges = HashSet::new();
        for &root in &self.order {
            if discovery[root] != 0 {
                continue;
            }
            time += 1;
            discovery[root] = time;
            low[root] = time;
            let mut stack = vec![(root, 0)];
            while let Some(&(node, index)) = stack.last() {
                let parent = if stack.len() > 1 {
                    Some(stack[stack.len() - 2].0)
                } else {
                    None
                };
                if index == self.adj[node].len() {
                    stack.pop();
                    if let Some(parent) = parent {
                        low[parent] = low[parent].min(low[node]);
                        if low[node] > discovery[parent] {
                            bridges.insert(edge_key(parent, node));
                        }
                    }
                } else {
                    let next = self.adj[node][index];
                    stack.last_mut().unwrap().1 += 1;
                    if Some(next) == parent {
                        continue;
                    }
                    if discovery[next] == 0 {
                        time += 1;
                        discovery[next] = time;
                        low[next] = time;
                        stack.push((next, 0));
                    } else {
                        low[node] = low[node].min(discovery[next]);
                    }
                }
            }
        }
        for (node, adj) in self.adj.iter_mut().enumerate() {
            adj.retain(|next| !bridges.contains(&edge_key(node, *next)));
        }
    }
}
fn area(points: &[Point2]) -> f64 {
    let mut a = 0.0;
    for i in 0..points.len() {
        let (x, y) = (points[i], points[(i + 1) % points.len()]);
        a += x.x * y.y - x.y * y.x;
    }
    a / 2.0
}
fn inside(point: Point2, points: &[Point2]) -> bool {
    let mut yes = false;
    let mut j = points.len() - 1;
    for i in 0..points.len() {
        let (a, b) = (points[i], points[j]);
        if (a.y > point.y) != (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
        {
            yes = !yes
        }
        j = i;
    }
    yes
}

fn extract(segments: &[CubicBezier], a: f64, b: f64) -> Vec<CubicBezier> {
    if (a - b).abs() < 1e-5 {
        return vec![];
    }
    if a > b {
        let mut first = extract(segments, a, 1.0);
        first.extend(extract(segments, 0.0, b));
        return first;
    }
    if a <= 1e-5 && b >= 1.0 - 1e-5 {
        return segments.to_vec();
    }
    let n = segments.len() as f64;
    let mut out = vec![];
    for (i, segment) in segments.iter().enumerate() {
        let (start, end) = (i as f64 / n, (i + 1) as f64 / n);
        if end <= a + 1e-6 || start >= b - 1e-6 {
            continue;
        }
        let (t0, t1) = (
            ((start.max(a) - start) * n).clamp(0.0, 1.0),
            ((end.min(b) - start) * n).clamp(0.0, 1.0),
        );
        if t1 - t0 < 1e-6 {
            continue;
        }
        let mut s = *segment;
        if t1 < 1.0 - 1e-6 {
            s = spline::split_at(&s, t1)[0]
        }
        if t0 > 1e-6 {
            s = spline::split_at(&s, (t0 / t1.max(1e-6)).min(1.0))[1]
        }
        out.push(s)
    }
    out
}
#[derive(Clone, Copy)]
struct Run {
    edge: Edge,
    forward: bool,
    a: f64,
    b: f64,
    start: usize,
    end: usize,
}
fn commands(
    points: &[Point2],
    edges: &[Edge],
    nodes: &[usize],
    curves: &[RegionCurve],
) -> Vec<f64> {
    let mut out = vec![0.0, points[0].x, points[0].y];
    let mut runs: Vec<Run> = vec![];
    let mut i = 0;
    while i < edges.len() {
        let edge = edges[i];
        let forward = nodes[i] == edge.from;
        let mut r = Run {
            edge,
            forward,
            a: if forward { edge.t0 } else { edge.t1 },
            b: if forward { edge.t1 } else { edge.t0 },
            start: i,
            end: (i + 1) % points.len(),
        };
        while i + 1 < edges.len() {
            let next = edges[i + 1];
            let f = nodes[i + 1] == next.from;
            let (a, b) = if f {
                (next.t0, next.t1)
            } else {
                (next.t1, next.t0)
            };
            if curves[next.curve].id != curves[r.edge.curve].id || (r.b - a).abs() > 1e-6 {
                break;
            }
            r.b = b;
            r.end = (i + 2) % points.len();
            i += 1;
        }
        runs.push(r);
        i += 1;
    }
    for r in runs {
        let g = &curves[r.edge.curve].geometry;
        let end = points[r.end];
        if matches!(g, Geometry::Segment(..)) {
            out.extend([1.0, end.x, end.y]);
            continue;
        }
        if let Geometry::Spline(segments, _) = g {
            let (lo, hi) = (r.a.min(r.b), r.a.max(r.b));
            let mut pieces = if hi <= 1.0 {
                extract(segments, lo, hi)
            } else {
                let mut p = extract(segments, lo % 1.0, 1.0);
                p.extend(extract(segments, 0.0, hi % 1.0));
                p
            };
            if !r.forward {
                pieces.reverse();
                for s in &mut pieces {
                    s.reverse()
                }
            }
            for (i, s) in pieces.iter().enumerate() {
                let e = if i + 1 == pieces.len() { end } else { s[3] };
                out.extend([2.0, s[1].x, s[1].y, s[2].x, s[2].y, e.x, e.y]);
            }
            continue;
        }
        let (rx, ry, rotation, sweep_flag) = match *g {
            Geometry::Circle(_, radius) => (radius, radius, 0.0, r.forward),
            Geometry::Arc(_, radius, _, _, cw) => (radius, radius, 0.0, cw == r.forward),
            Geometry::Ellipse(c, a, _) => {
                let e = g.ellipse().unwrap();
                (e.rx, e.ry, -(angle(c, a) * 180.0 / PI), r.forward)
            }
            Geometry::EllipticalArc(c, a, _, _, _, cw) => {
                let e = g.ellipse().unwrap();
                (e.rx, e.ry, -(angle(c, a) * 180.0 / PI), cw == r.forward)
            }
            _ => unreachable!(),
        };
        let span = (r.b - r.a).abs()
            * if g.arc() {
                if let Geometry::Arc(c, _, a, b, cw) = *g {
                    sweep(-angle(c, a), -angle(c, b), cw)
                } else {
                    let (a, b, cw) = g.arc_angles();
                    sweep(a, b, cw)
                }
            } else {
                1.0
            };
        let mut arc = |to: Point2, s: f64| {
            out.extend([
                3.0,
                rx,
                ry,
                rotation,
                if s > PI { 1.0 } else { 0.0 },
                if sweep_flag { 1.0 } else { 0.0 },
                to.x,
                to.y,
            ])
        };
        if distance(end, points[r.start]) < 1e-5 && span > PI * 1.99 {
            arc(g.point((r.a + r.b) / 2.0), span / 2.0);
            arc(end, span / 2.0)
        } else {
            arc(end, span)
        }
    }
    out.push(4.0);
    out
}

pub fn find_regions(curves: &[RegionCurve]) -> Vec<Region> {
    let bounds: Vec<_> = curves.iter().map(|c| c.geometry.bounds()).collect();
    let primitives: Vec<_> = curves.iter().map(|c| c.geometry.primitives()).collect();
    let mut cuts = vec![vec![]; curves.len()];
    for i in 0..curves.len() {
        for j in i + 1..curves.len() {
            if curves[i].id == curves[j].id
                || !may_intersect(
                    &curves[i].geometry,
                    &curves[j].geometry,
                    bounds[i],
                    bounds[j],
                )
            {
                continue;
            }
            for q in intersections(
                &curves[i].geometry,
                &curves[j].geometry,
                &primitives[i],
                &primitives[j],
            ) {
                cuts[i].push(curves[i].geometry.cut(q));
                cuts[j].push(curves[j].geometry.cut(q));
            }
        }
    }
    let mut graph = Graph::default();
    for (index, c) in curves.iter().enumerate() {
        let g = &c.geometry;
        let raw = &mut cuts[index];
        raw.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        // Compare to the preceding raw cut, not the preceding retained cut.
        let unique: Vec<_> = raw
            .iter()
            .enumerate()
            .filter(|(i, c)| *i == 0 || (c.0 - raw[i - 1].0).abs() > 1e-6)
            .map(|(_, c)| *c)
            .collect();
        let mut intervals = vec![];
        if g.periodic() {
            if unique.is_empty() {
                intervals.push((0.0, g.point(0.0), g.period(), g.point(0.0)))
            } else {
                for i in 0..unique.len() {
                    let a = unique[i];
                    let b = unique[(i + 1) % unique.len()];
                    intervals.push((
                        a.0,
                        a.1,
                        if i + 1 < unique.len() {
                            b.0
                        } else {
                            b.0 + g.period()
                        },
                        b.1,
                    ));
                }
            }
        } else {
            let mut all = vec![(0.0, g.sampled_point(0.0))];
            all.extend(unique);
            all.push((1.0, g.sampled_point(1.0)));
            for w in all.windows(2) {
                intervals.push((w[0].0, w[0].1, w[1].0, w[1].1));
            }
        }
        for (t0, p0, t1, p1) in intervals {
            let count = if matches!(g, Geometry::Segment(..)) {
                1
            } else {
                (((if g.arc() { 48.0 } else { 96.0 }) * (t1 - t0).abs() / g.period())
                    .ceil()
                    .max(1.0)) as usize
            };
            let mut prev = p0;
            for k in 1..=count {
                let next = if k == count {
                    p1
                } else {
                    g.sampled_point(t0 + ((t1 - t0) * k as f64) / count as f64)
                };
                if distance(prev, next) > 1e-7 {
                    graph.add(Segment {
                        a: prev,
                        b: next,
                        curve: index,
                        t0: t0 + ((t1 - t0) * (k - 1) as f64) / count as f64,
                        t1: t0 + ((t1 - t0) * k as f64) / count as f64,
                    });
                }
                prev = next;
            }
        }
    }
    graph.remove_bridges();
    let around: Vec<_> = graph
        .adj
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let mut sorted = a.clone();
            sorted.sort_by(|a, b| {
                angle(graph.nodes[i], graph.nodes[*a])
                    .partial_cmp(&angle(graph.nodes[i], graph.nodes[*b]))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            sorted
        })
        .collect();
    let mut visited = HashSet::new();
    let mut loops: Vec<(Ring, f64)> = vec![];
    for &from in &graph.order {
        for &to in &graph.adj[from] {
            if visited.contains(&(from, to)) {
                continue;
            }
            let (mut a, mut b) = (from, to);
            let mut local = HashSet::new();
            let mut points = vec![];
            let mut nodes = vec![];
            let mut edges = vec![];
            for _ in 0..10000 {
                if !local.insert((a, b)) {
                    break;
                }
                points.push(graph.nodes[a]);
                nodes.push(a);
                if let Some(source) = graph.sources.get(&edge_key(a, b)) {
                    edges.push(*source)
                }
                let nexts = &around[b];
                let Some(index) = nexts.iter().position(|v| *v == a) else {
                    break;
                };
                let next = nexts[(index + nexts.len() - 1) % nexts.len()];
                a = b;
                b = next;
                if a == from && b == to {
                    break;
                }
            }
            visited.extend(local);
            if points.len() < 3 || a != from || b != to {
                continue;
            }
            let ar = area(&points);
            if ar <= 1e-7 {
                continue;
            }
            let commands = commands(&points, &edges, &nodes, curves);
            loops.push((Ring { points, commands }, ar));
        }
    }
    let parents: Vec<_> = loops
        .iter()
        .map(|(ring, ar)| {
            let mut parent = None;
            for (j, (other, other_ar)) in loops.iter().enumerate() {
                if other_ar <= ar || parent.is_some_and(|i: usize| *other_ar >= loops[i].1) {
                    continue;
                }
                if !inside(ring.points[0], &other.points) {
                    continue;
                }
                let shared = ring.points.iter().any(|p| {
                    other
                        .points
                        .iter()
                        .any(|q| (p.x - q.x).abs() < 1e-4 && distance(*p, *q) < 1e-4)
                });
                if !shared {
                    parent = Some(j)
                }
            }
            parent
        })
        .collect();
    loops
        .iter()
        .enumerate()
        .map(|(i, (ring, ar))| {
            let mut rings = vec![ring.clone()];
            let mut hole_area = 0.0;
            for (j, (hole, _)) in loops.iter().enumerate() {
                if parents[j] == Some(i) {
                    rings.push(hole.clone());
                    hole_area += area(&hole.points).abs();
                }
            }
            Region {
                area: ar - hole_area,
                rings,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn circle(id: usize, x: f64, r: f64) -> RegionCurve {
        RegionCurve {
            id,
            geometry: Geometry::Circle(p(x, 0.0), r),
        }
    }
    #[test]
    fn disconnected_nested_and_tangent_circles() {
        let r = find_regions(&[
            circle(0, 0.0, 10.0),
            circle(1, 0.0, 2.0),
            circle(2, 50.0, 1.0),
        ]);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].rings.len(), 2);
        assert_eq!(r[1].rings.len(), 1);
        assert_eq!(
            find_regions(&[circle(0, 0.0, 1.0), circle(1, 2.0, 1.0)]).len(),
            2
        );
    }
    #[test]
    fn js_rounds_negative_half_towards_positive_infinity() {
        assert_eq!(key(p(-0.000005, 0.0)), key(p(0.0, 0.0)));
        assert_eq!(key(p(-0.000015, 0.0)), key(p(-0.00001, 0.0)));
    }
    #[test]
    fn bridge_does_not_change_a_rectangle() {
        let mut c = vec![];
        let pts = [p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)];
        for i in 0..4 {
            c.push(RegionCurve {
                id: i,
                geometry: Geometry::Segment(pts[i], pts[(i + 1) % 4]),
            })
        }
        c.push(RegionCurve {
            id: 4,
            geometry: Geometry::Segment(pts[0], p(-5.0, -5.0)),
        });
        let r = find_regions(&c);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].area, 100.0);
    }
}
